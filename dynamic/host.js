// dynamic/host.js
//
// code.host body for the in-session (dynamic) Cordis plugin variant.
// Paste this verbatim into cordis_define({ code: { host: <this file> }, ... }).
//
// This is the HOST half: it registers the agy_run / agy_continue / agy_status
// model tools, the agy-first prompt-policy section, the rate-limit/network
// fallback dialog (userQuestions.ask), and the agy_status RPC handler that the
// browser indicator light polls. It is functionally equivalent to the persisted
// preset module in ../preset/agy-first/agy-first-bridge.mjs, with additions the
// preset form cannot use: in-memory status tracking and harness.handle().
//
// Live observation: agy runs with --output-format stream-json; each
// `step_update` event (tool ACTIVE/DONE/ERROR, agent_response text_delta) is
// folded into the status snapshot as it arrives. The agy_status tool / RPC then
// report what agy is doing RIGHT NOW (current tool + args, step index, recent
// step trail, last completed run).
//
// Sandbox notes (differ from a real Node module):
//   - No import/require, no TypeScript/JSX, no bundler.
//   - No AbortController / process / Buffer / native timers — use ctx.timeout
//     and the caller's exec.signal instead.
//   - Tools are registered with harness.registerTool(ctx, harness.defineTool(...)),
//     NOT ctx.tools.register (that plain-object form is only for the preset).

const CWD_FALLBACK = 'C:\\Users\\lcl\\Desktop\\DSH'
// agy_quota 独立脚本的绝对路径（dynamic 沙箱无 import.meta/process，用固定路径）。
const QUOTA_SCRIPT = 'C:\\Users\\lcl\\Desktop\\agy-first-bridge\\bin\\agy-quota.mjs'
const QUOTA_NODE = 'node'
const FALLBACK_LABEL = '使用 DSH 本地 API 配置（回退）'
const RETRY_LABEL = '重试 agy 一次'
const CANCEL_LABEL = '不回退（返回错误）'
// 网络/限流/额度耗尽/认证失败归类（v1.5.7 增强：补 quota/credit/balance/exhausted/401/403/unauthorized）。
// 命中即视为"受限"，触发回退弹窗，避免 DSH 静默死等。
const LIMIT_RE = /rate.?limit|ratelimit|429|too many|quota|insufficient|credit|balance|exhausted|exceed|network|offline|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|timeout|timed out|unavailable|503|502|500|401|403|unauthorized|invalid api|api key|connection|proxy|socket|tls|ssl|dns|网络|超时|限流|流量|受限|配额|金额|余额|额度|认证|连接|断开/i
const MAX_TRAIL = 12
const MAX_ARG_LEN = 120

function clampInt(v, def, min, max) { const n = Number(v); if (!Number.isFinite(n)) return def; const i = Math.floor(n); if (i < min) return min; if (i > max) return max; return i }
function shortLabel(p) { const s = String(p || '').replace(/\s+/g, ' ').trim(); return s.length > 80 ? s.slice(0, 77) + '...' : s }
function summarizeArgs(parameters) { if (!parameters || typeof parameters !== 'object') return undefined; const out = {}; for (const k of Object.keys(parameters)) { let v = parameters[k]; if (typeof v === 'string' && v.length > MAX_ARG_LEN) v = v.slice(0, MAX_ARG_LEN) + '…'; out[k] = v } return out }

function parseStreamJson(stdoutText) {
  const trimmed = String(stdoutText || '').trim()
  if (!trimmed) return null
  const lines = trimmed.split(/\r?\n/).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i].trim()
    if (!ln.startsWith('{')) continue
    try {
      const obj = JSON.parse(ln)
      if (obj && obj.event === 'result' && obj.result) return obj.result
      if (obj && obj.status && obj.response !== undefined) return obj
    } catch (e) {}
  }
  try { return JSON.parse(trimmed) } catch (e) {}
  return null
}

function buildResult(parsed, outcome, mode, stderrText, stdoutText) {
  const exitCode = outcome ? outcome.exitCode : null
  // agy 超时/错误时信息在 result.error 字段（如 "timeout waiting for response"），
  // 必须并入 stderr 供 isLimited 归类（v1.5.8 修复：网络挂起不再静默 FAILED）。
  const errText = parsed && typeof parsed.error === 'string' && parsed.error ? parsed.error : ''
  const stderr = (stderrText ? String(stderrText).slice(-2000) : '') + (errText ? (stderrText ? ' ' : '') + errText : '')
  if (parsed) return { ok: exitCode === 0 && parsed.status === 'SUCCESS', status: typeof parsed.status === 'string' ? parsed.status : (exitCode === 0 ? 'UNKNOWN' : 'ERROR'), response: typeof parsed.response === 'string' ? parsed.response : '', conversationId: typeof parsed.conversation_id === 'string' ? parsed.conversation_id : null, durationSeconds: typeof parsed.duration_seconds === 'number' ? parsed.duration_seconds : null, numTurns: typeof parsed.num_turns === 'number' ? parsed.num_turns : null, totalTokens: parsed.usage && typeof parsed.usage.total_tokens === 'number' ? parsed.usage.total_tokens : null, exitCode: exitCode, mode: mode, stderr: stderr }
  return { ok: false, status: 'PARSE_ERROR', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: exitCode, mode: mode, stderr: stderr, rawStdout: String(stdoutText || '').slice(-2000) }
}

function isLimited(res) { if (!res || res.ok) return false; if (res.status === 'SPAWN_ERROR' || res.status === 'AGY_UNAVAILABLE' || res.status === 'HUNG_TIMEOUT') return true; const hay = String(res.stderr || '') + ' ' + String(res.response || '') + ' ' + String(res.status || ''); return LIMIT_RE.test(hay) }

function buildArgv(exe, args, planActive) {
  const argv = [exe, '-p', String(args.prompt), '--output-format', 'stream-json', '--dangerously-skip-permissions']
  const timeoutSec = clampInt(args.timeoutSec, 300, 10, 3600)
  argv.push('--print-timeout', timeoutSec + 's')
  let mode = args.mode || 'auto'
  if (mode === 'auto') mode = planActive ? 'plan' : 'accept-edits'
  if (mode === 'plan' || mode === 'accept-edits') argv.push('--mode', mode)
  if (args.model) argv.push('--model', String(args.model))
  if (args.effort) argv.push('--effort', String(args.effort))
  if (Array.isArray(args.addDirs)) for (const d of args.addDirs) { if (d) argv.push('--add-dir', String(d)) }
  if (args.conversationId) argv.push('--conversation', String(args.conversationId))
  else if (args.continueLatest) argv.push('--continue')
  return { argv, timeoutSec, mode }
}

return {
  inject: ['tools', 'subprocess', 'systemPrompt', 'timer'],
  apply(ctx) {
    const subprocess = ctx.subprocess
    const jobs = ctx.get('jobs')
    const planMode = ctx.get('planMode')
    const sandboxPolicy = ctx.get('sandboxPolicy')

    // ── live status: per-project + global aggregation ────────────────────────
    // Each agy run belongs to a project (its cwd). The light renders one dot per
    // project; the global row aggregates everything (backward compatible).
    const projects = Object.create(null) // cwd -> { cwd, name, state, running, current, trail, lastStatus, lastAt, lastConversationId, lastOk, lastFailed, fallbackActive, updatedAt }
    const MAX_PROJECTS = 12
    function projectName(cwd) {
      const s = String(cwd || '')
      const parts = s.split(/[\\/]/).filter(Boolean)
      return parts.length ? parts[parts.length - 1] : s
    }
    function ensureProject(cwd) {
      const key = String(cwd || CWD_FALLBACK)
      let p = projects[key]
      if (!p) {
        if (Object.keys(projects).length >= MAX_PROJECTS) {
          // drop the least recently updated idle project
          const idle = Object.keys(projects).filter((k) => projects[k].running === 0)
          if (idle.length) { const victim = idle.sort((a, b) => projects[a].updatedAt - projects[b].updatedAt)[0]; delete projects[victim] }
          else { const victim = Object.keys(projects).sort((a, b) => projects[a].updatedAt - projects[b].updatedAt)[0]; delete projects[victim] }
        }
        p = { cwd: key, name: projectName(key), state: 'idle', running: 0, lastStatus: null, lastAt: 0, lastConversationId: null, lastOk: false, lastFailed: false, fallbackActive: false, current: null, trail: [], updatedAt: 0 }
        projects[key] = p
      }
      return p
    }
    function nowIso() { return new Date().toISOString() }
    function globalState() {
      const list = Object.keys(projects).map((k) => projects[k])
      let running = 0, lastStatus = null, lastAt = 0, lastConversationId = null, fallbackActive = false, current = null, trail = [], updatedAt = 0
      for (const p of list) {
        running += p.running
        if (p.updatedAt > updatedAt) updatedAt = p.updatedAt
        if (p.running > 0) { if (!current && p.current) current = p.current }
        if (p.lastAt > lastAt) { lastAt = p.lastAt; lastStatus = p.lastStatus; lastConversationId = p.lastConversationId }
        if (p.fallbackActive) fallbackActive = true
        for (const e of p.trail) { trail.push(e) }
      }
      trail.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
      trail = trail.slice(-MAX_TRAIL)
      // v1.5.14 修复：原 `lastStatus === 'SUCCESS' || lastOk` 里 lastOk 是未声明的
      // 裸标识符（应为 p.lastOk 的聚合，循环里从未提取）→ 非成功结束计算聚合状态
      // 必抛 ReferenceError 且被吞，状态灯冻结在旧快照。同 codebuddy-core v1.1.0
      // 整改：只看 lastStatus。
      const state = running > 0 ? 'running' : (fallbackActive ? 'fallback' : (lastStatus ? (lastStatus === 'SUCCESS' ? 'ok' : 'failed') : 'idle'))
      return { state, running, lastStatus, lastAt, lastConversationId, fallbackActive, current, trail, updatedAt }
    }
    function snapshot() {
      const g = globalState()
      const list = Object.keys(projects).map((k) => projects[k]).sort((a, b) => b.updatedAt - a.updatedAt)
      return {
        state: g.state, running: g.running, lastStatus: g.lastStatus, lastAt: g.lastAt, lastConversationId: g.lastConversationId, fallbackActive: g.fallbackActive, current: g.current, trail: g.trail, updatedAt: g.updatedAt,
        projects: list.map((p) => ({ cwd: p.cwd, name: p.name, state: p.state, running: p.running, current: p.current, trail: p.trail.slice(-MAX_TRAIL), lastStatus: p.lastStatus, lastAt: p.lastAt, lastConversationId: p.lastConversationId, fallbackActive: p.fallbackActive, updatedAt: p.updatedAt }))
      }
    }
    function begin(cwd) { const p = ensureProject(cwd); p.running += 1; p.state = 'running'; p.updatedAt = Date.now(); publish() }
    function end(res, cwd) {
      const p = ensureProject(cwd)
      p.running = Math.max(0, p.running - 1)
      p.lastStatus = res ? res.status : null
      p.lastAt = Date.now()
      if (res && res.conversationId) p.lastConversationId = res.conversationId
      if (res && res.fallback) { p.fallbackActive = true; p.state = 'fallback' }
      else if (p.running > 0) { p.state = 'running' }
      else { p.state = res && res.ok ? 'ok' : 'failed'; p.lastOk = !!(res && res.ok); p.lastFailed = !(res && res.ok) }
      p.current = null
      p.updatedAt = Date.now()
      publish()
    }
    function foldStepUpdate(ev, cwd) {
      const s = ev && ev.step_update
      if (!s) return
      const p = ensureProject(cwd)
      p.updatedAt = Date.now()
      if (s.step_type === 'tool') {
        const tool = s.tool_name || (s.tool_info && s.tool_info.name) || 'tool'
        const args = summarizeArgs(s.tool_info && s.tool_info.parameters)
        const entry = { stepIndex: s.step_index, state: s.state, tool: tool, args: args, at: nowIso() }
        p.trail.push(entry)
        if (p.trail.length > MAX_TRAIL) p.trail.shift()
        if (s.state === 'ACTIVE') { p.current = { tool: tool, args: args, stepIndex: s.step_index, since: nowIso() } }
        else if (p.current && p.current.stepIndex === s.step_index) { p.current = null }
      } else if (s.step_type === 'agent_response' && s.state === 'ACTIVE' && s.text_delta) {
        p.current = { tool: 'agent_response', args: { text_delta: String(s.text_delta).slice(0, MAX_ARG_LEN) }, stepIndex: s.step_index, since: nowIso() }
      }
      publish()
    }

    // Publish the current snapshot to the home-level agy-indicator collector.
    // Dynamic sandbox has no ctx.emit, so instead of an event we call the
    // home-level collector service (ctx.provide('agyCollector', ...) in
    // home-plugin/agy-indicator/lib/index.mjs) and merge the snapshot into the
    // SAME global table the home light polls. This keeps ONE light in the whole
    // app: the home-level one. The PRESET form uses ctx.emit('agy/status').
    function publish() {
      try {
        const collector = ctx.get('agyCollector')
        if (collector && typeof collector.mergeSnapshot === 'function') collector.mergeSnapshot(snapshot())
      } catch (e) { /* ignore */ }
    }
    harness.handle('agy_status', function () { return snapshot() })

    function resolveCwd(args) { if (args && args.cwd) return String(args.cwd); if (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string' && sandboxPolicy.workspaceRoot) return sandboxPolicy.workspaceRoot; return CWD_FALLBACK }
    function planActiveFor(exec) { try { if (planMode && exec && exec.agent) { const st = planMode.get(exec.agent); return !!(st && st.active) } } catch (e) {} return false }

    const stdio = { stdin: 'ignore', stdout: { maxBytes: 4000000, spill: { maxBytes: 40000000 } }, stderr: { maxBytes: 1000000, spill: { maxBytes: 8000000 } } }
    function readStreams(h) { return { stdoutText: h.collected.stdout ? h.collected.stdout.readFrom(0).text : '', stderrText: h.collected.stderr ? h.collected.stderr.readFrom(0).text : '' } }

    // Parse NDJSON step_update lines incrementally from the growing stdout buffer.
    function startLiveParser(h, cwd) {
      let cursor = 0
      const tick = function () {
        try {
          const full = h.collected.stdout ? h.collected.stdout.readFrom(0).text : ''
          if (full.length <= cursor) return
          const fresh = full.slice(cursor)
          cursor = full.length
          const lines = fresh.split(/\r?\n/)
          for (const ln of lines) {
            const t = ln.trim()
            if (!t.startsWith('{')) continue
            try { const obj = JSON.parse(t); if (obj && obj.event === 'step_update') foldStepUpdate(obj, cwd) } catch (e) {}
          }
        } catch (e) {}
      }
      const dispose = ctx.interval(tick, 250)
      return dispose
    }

    async function runSync(argv, cwd, timeoutSec, callerSignal) {
      const spec = { argv, cwd, stdio, graceMs: 5000 }
      if (callerSignal) spec.signal = callerSignal
      const handle = subprocess.spawn(spec)
      // 超时强制 terminate（DSH 侧最终防线，绝不无限等）。
      // terminate 时记录最后事件摘要，便于区分"长命令正常"vs"真卡死"。
      let lastEventSummary = '(no events yet)'
      let timedOut = false
      const disposeTimer = ctx.timeout(function () {
        timedOut = true
        try {
          const p = ensureProject(cwd)
          lastEventSummary = (p.current ? ('last step ' + p.current.stepIndex + ' -> ' + p.current.tool) : '') +
            ' | trail=' + (p.trail.length ? p.trail.slice(-2).map(function (e) { return '[' + e.state + ']' + e.tool }).join(',') : 'empty') +
            ' | elapsed=' + Math.round((Date.now() - (p.updatedAt || Date.now())) / 1000) + 's since last activity'
        } catch (e) {}
        try { handle.terminate() } catch (e) {}
      }, (timeoutSec + 60) * 1000)
      const disposeLive = startLiveParser(handle, cwd)
      try {
        const outcome = await handle.done
        const s = readStreams(handle)
        return { outcome, stdoutText: s.stdoutText, stderrText: s.stderrText, timedOut, lastEventSummary }
      } finally { disposeLive(); disposeTimer() }
    }

    function fallbackResult(res, mode) { return { ok: false, fallback: true, status: 'FALLBACK_TO_DSH', response: '', conversationId: (res && res.conversationId) || null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: res ? res.exitCode : null, mode: mode, stderr: res ? res.stderr : '', reason: res ? res.status : 'unknown' } }

    async function askFallback(exec, res) {
      const uq = ctx.get('userQuestions')
      if (!uq || !exec || !exec.agent) return 'error'
      const detail = String(res.stderr || res.response || res.status || '').slice(-600)
      try {
        const ans = await uq.ask({ agent: exec.agent, signal: exec.signal, questions: [{ id: 'agy-fallback', header: 'agy 受限', question: 'agy 调用失败（疑似流量受限/网络不通，状态=' + String(res.status) + '）。是否改用 DSH 本地 API 配置继续？', detail: detail, options: [ { label: FALLBACK_LABEL, description: '本次改由 DSH 本地模型/原生工具完成，不再走 agy' }, { label: RETRY_LABEL, description: '再调用一次 agy（网络抖动时可用）' }, { label: CANCEL_LABEL, description: '不回退，直接返回 agy 错误' } ] }] })
        const sel = (ans && ans.answers && ans.answers[0] && ans.answers[0].selected) || []
        if (sel.indexOf(FALLBACK_LABEL) >= 0) return 'fallback'
        if (sel.indexOf(RETRY_LABEL) >= 0) return 'retry'
        return 'error'
      } catch (e) { return 'error' }
    }

    async function coreExecute(rawArgs, exec) {
      const args = rawArgs || {}
      if (!args.prompt || !String(args.prompt).trim()) return { ok: false, status: 'BAD_ARGS', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: null, mode: 'auto', stderr: 'prompt is required' }
      let exe = 'agy'; let exeOk = true; let resolveErr = ''
      try { exe = await subprocess.resolveExecutable('agy', undefined, exec ? exec.signal : undefined) } catch (e) { exeOk = false; resolveErr = String(e && e.message || e) }
      const cwd = resolveCwd(args)
      const built = buildArgv(exe, args, planActiveFor(exec))

      // 额度预检（v1.5.13 起只看 5h 窗口）：
      // 单次任务的门禁只取决于 Gemini 5h 池子——5h 枯竭意味着本轮任务里
      // agy 确实跑不动，必须阻断（<10% → 静默 QUOTA_BLOCKED，不弹窗）。
      // 周用量【不参与单次任务判断】：周额度耗尽只说明这个子代理这周不该再用，
      // 属于「换/不用 agy」的选择，不是 agy 临时不可用，因此不再在调用路径上
      // 产生 [quota] 警告或影响结果（周信息仍可由 agy_quota 工具主动查询）。
      // cachedQuotaCheck 带 30 分钟缓存，预检失败静默（不阻塞调用）。
      try {
        const q = await cachedQuotaCheck()
        if (q && q.ok) {
          // 5h 硬阻断：取 Gemini 相关 5h 桶（bucketId 含 gemini 或组名含 Gemini）。
          const fiveHBuckets = (q.groups || []).flatMap(function (g) {
            return (g.buckets || []).filter(function (b) { return b.window === '5h' && (String(b.bucketId || '').toLowerCase().indexOf('gemini') >= 0 || String(g.displayName || '').toLowerCase().indexOf('gemini') >= 0) }).map(function (b) { return { bucketId: b.bucketId, remainingFraction: b.remainingFraction, resetTime: b.resetTime } })
          })
          const low5h = fiveHBuckets.find(function (b) { return typeof b.remainingFraction === 'number' && b.remainingFraction < 0.10 })
          if (low5h) {
            return { ok: false, status: 'QUOTA_BLOCKED', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: null, mode: built.mode, stderr: 'agy blocked: Gemini 5h pool quota < 10% (' + Math.round(low5h.remainingFraction * 100) + '%, reset ' + (low5h.resetTime || '?') + '). Use native tools; do not call agy.' }
          }
        }
      } catch (e) { /* ignore */ }

      if (!exeOk) {
        begin(cwd)
        let res = { ok: false, status: 'AGY_UNAVAILABLE', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: null, mode: built.mode, stderr: 'agy executable not found: ' + resolveErr }
        if (await askFallback(exec, res) === 'fallback') res = fallbackResult(res, built.mode)
        end(res, cwd); return res
      }

      if (args.background && jobs && exec && exec.agent) {
        try {
          begin(cwd)
          const jobId = jobs.start({ kind: 'bash', label: 'agy: ' + shortLabel(args.prompt), owner: exec.agent, run: function () {
            const handle = subprocess.spawn({ argv: built.argv, cwd, stdio, graceMs: 5000 })
            const disposeLive = startLiveParser(handle, cwd)
            const done = handle.done.then(function (outcome) { disposeLive(); const s = readStreams(handle); const res = buildResult(parseStreamJson(s.stdoutText), outcome, built.mode, s.stderrText, s.stdoutText); end(res, cwd); return { status: res.ok ? 'completed' : 'failed', detail: 'agy ' + res.status, output: JSON.stringify(res) } }).catch(function (err) { disposeLive(); end({ ok: false, status: 'JOB_ERROR' }, cwd); return { status: 'failed', detail: String(err && err.message || err) } })
            return { cancel: function () { try { handle.terminate() } catch (e) {} }, done: done }
          } })
          return { ok: true, background: true, jobId: String(jobId), mode: built.mode, note: 'agy running in background; collect with job_output ' + String(jobId) + '. Background failures do NOT open the fallback dialog; on failure re-run in foreground to be prompted.' }
        } catch (e) { end({ ok: false, status: 'JOB_START_ERROR' }, cwd) }
      }

      begin(cwd)
      try {
        let attempt = 0; let res
        while (true) {
          attempt += 1
          const r = await runSync(built.argv, cwd, built.timeoutSec, exec ? exec.signal : undefined)
          if (r.timedOut) {
            // DSH 侧超时强制终止：明确报 HUNG_TIMEOUT（区别于解析失败），
            // 附最后事件摘要供诊断；视为"受限"以触发回退弹窗（网络挂起场景）。
            res = { ok: false, status: 'HUNG_TIMEOUT', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: r.outcome ? r.outcome.exitCode : null, mode: built.mode, stderr: 'agy did not finish within ' + built.timeoutSec + 's (DSH hard timeout). Last activity: ' + r.lastEventSummary + '. NOTE: if the task was a long-running script (build/test), raise timeoutSec; this was a hang guard, not necessarily a failure of agy.' }
            break
          }
          res = buildResult(parseStreamJson(r.stdoutText), r.outcome, built.mode, r.stderrText, r.stdoutText)
          if (res.ok || !isLimited(res) || attempt >= 2) break
          const decision = await askFallback(exec, res)
          if (decision === 'fallback') { res = fallbackResult(res, built.mode); break }
          if (decision === 'retry') continue
          break
        }
        if (!res.ok && !res.fallback && isLimited(res) && attempt >= 2) { if (await askFallback(exec, res) === 'fallback') res = fallbackResult(res, built.mode) }
        end(res, cwd); return res
      } catch (e) { const res = { ok: false, status: 'SPAWN_ERROR', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: null, mode: built.mode, stderr: String(e && e.message || e) }; const out = (await askFallback(exec, res) === 'fallback') ? fallbackResult(res, built.mode) : res; end(out, cwd); return out }
    }

    function renderResult(args, value) {
      const v = value || {}
      if (v.background) return [{ type: 'text', text: 'agy dispatched in background (mode=' + v.mode + '). jobId=' + v.jobId + '. Collect with job_output.' }]
      if (v.fallback) return [{ type: 'text', text: 'agy 回退：用户选择使用 DSH 本地 API 配置（原因 ' + v.reason + '）。请改用原生工具/本地模型完成本任务，不要再调 agy。' }]
      if (v.status === 'QUOTA_BLOCKED') return [{ type: 'text', text: 'agy 未调用（5h 池子额度 <10%）：' + (v.stderr || '') + ' —— 请直接用原生工具/本地模型完成本任务。' }]
      const head = 'agy ' + (v.ok ? 'OK' : 'FAILED') + ' [status=' + v.status + ' mode=' + v.mode + (v.conversationId ? ' conv=' + v.conversationId : '') + (v.totalTokens != null ? ' tokens=' + v.totalTokens : '') + (v.durationSeconds != null ? ' ' + v.durationSeconds + 's' : '') + ']'
      const body = v.response ? v.response : (v.stderr ? '[stderr] ' + v.stderr : (v.rawStdout ? '[raw] ' + v.rawStdout : ''))
      return [{ type: 'text', text: head + (body ? '\n\n' + body : '') }]
    }

    function renderStatus(args, value) {
      const v = value || {}
      const lines = []
      lines.push('agy status: ' + v.state + (v.running > 0 ? ' (' + v.running + ' running)' : '') + (v.projects && v.projects.length > 1 ? ' across ' + v.projects.length + ' projects' : ''))
      const projList = (v.projects && v.projects.length) ? v.projects : null
      if (projList) {
        for (const p of projList) {
          const cur = p.current ? (' step ' + p.current.stepIndex + ' → ' + p.current.tool + (p.current.args ? ' ' + JSON.stringify(p.current.args) : '')) : (p.running > 0 ? ' (starting / thinking)' : '')
          lines.push('· ' + p.name + ' [' + p.state + (p.running > 0 ? ' ×' + p.running : '') + ']' + cur + (p.lastStatus ? ' | last=' + p.lastStatus + (p.lastConversationId ? ' ' + p.lastConversationId.slice(0, 8) : '') : ''))
          if (p.trail && p.trail.length) {
            lines.push('    steps:')
            for (const e of p.trail.slice(-3)) { const a = e.args ? ' ' + JSON.stringify(e.args) : ''; lines.push('      [' + e.state + '] step ' + e.stepIndex + ' ' + e.tool + a) }
          }
        }
      } else {
        if (v.current) { const c = v.current; lines.push('current: step ' + c.stepIndex + ' → ' + c.tool + (c.args ? ' ' + JSON.stringify(c.args) : '')) }
        else if (v.state === 'running') { lines.push('current: (starting / thinking)') }
        if (v.trail && v.trail.length) {
          lines.push('recent steps:')
          for (const e of v.trail.slice(-6)) { const a = e.args ? ' ' + JSON.stringify(e.args) : ''; lines.push('  [' + e.state + '] step ' + e.stepIndex + ' ' + e.tool + a) }
        }
        if (v.lastStatus) lines.push('last: ' + v.lastStatus + (v.lastConversationId ? ' conv=' + v.lastConversationId : '') + (v.lastAt ? ' @ ' + new Date(v.lastAt).toISOString() : ''))
      }
      if (v.updatedAt) lines.push('updatedAt: ' + new Date(v.updatedAt).toISOString())
      return [{ type: 'text', text: lines.join('\n') }]
    }

    // agy_quota：查询 agy 所用 Google AI 套餐池子额度。跑独立脚本 bin/agy-quota.mjs，
    // stdout JSON。带 30 分钟缓存（每次 agy_run 前预检复用）。
    let quotaCache = { at: 0, data: null }
    async function cachedQuotaCheck() {
      const now = Date.now()
      if (quotaCache.data && now - quotaCache.at < 30 * 60 * 1000) return quotaCache.data
      let res
      try {
        const handle = subprocess.spawn({ argv: [QUOTA_NODE, QUOTA_SCRIPT], cwd: CWD_FALLBACK, stdio, graceMs: 5000 })
        const outcome = await handle.done
        const s = readStreams(handle)
        const m = String(s.stdoutText || '').match(/\{[\s\S]*\}/)
        res = m ? JSON.parse(m[0]) : { ok: false, error: 'no JSON output: ' + String(s.stdoutText || '').slice(0, 300) }
      } catch (e) { res = { ok: false, error: String(e && e.message || e) } }
      quotaCache = { at: now, data: res }
      return res
    }

    function renderQuota(args, value) {
      const v = value || {}
      if (!v.ok) return [{ type: 'text', text: 'agy_quota failed: ' + String(v.error || 'unknown') }]
      const lines = ['agy quota [tier=' + (v.tier || '?') + ']']
      if (Array.isArray(v.groups)) {
        for (const g of v.groups) {
          for (const b of (g.buckets || [])) {
            const pct = typeof b.remainingFraction === 'number' ? Math.round(b.remainingFraction * 100) : '?'
            lines.push('· ' + (b.bucketId || g.displayName || '') + ' [' + (b.window || '') + '] ' + pct + '%' + (b.resetTime ? ' reset=' + b.resetTime : ''))
          }
        }
      }
      if (Array.isArray(v.models) && v.models.length) {
        lines.push('models (pool %):')
        for (const m of v.models.slice(0, 10)) { lines.push('  ' + (m.displayName || m.name) + ' : ' + m.percentage + '%' + (m.recommended === false ? ' [3p: Claude/GPT 不推荐]' : '') + (m.resetTime ? ' (reset ' + m.resetTime + ')' : '')) }
        if (v.models.length > 10) lines.push('  … and ' + (v.models.length - 10) + ' more')
      }
      return [{ type: 'text', text: lines.join('\n') }]
    }

    const QUOTA_OUT = { schema: { type: 'object', additionalProperties: true }, render: renderQuota }
    const OUT = { schema: { type: 'object', additionalProperties: true }, render: renderResult }
    const STATUS_OUT = { schema: { type: 'object', additionalProperties: true }, render: renderStatus }

    harness.registerTool(ctx, harness.defineTool({ name: 'agy_run', description: 'Dispatch a coding/build/debug/investigation task to the local agy agent CLI and return its final answer. DSH fully controls agy (--dangerously-skip-permissions; agy never prompts). On rate-limit/network failure DSH pops a fallback dialog; fallback=true means finish with native tools. background=true returns a jobId. While it runs, call agy_status to watch what agy is doing live.', parameters: { prompt: { type: 'string', description: 'The full task/instruction for agy. Be complete and self-contained.', required: true }, mode: { type: 'string', enum: ['auto', 'plan', 'accept-edits'], description: 'auto follows DSH plan state; plan = no writes; accept-edits = allow edits.' }, model: { type: 'string', description: 'Optional agy model id — pick from the Gemini pool or utility models per the model-selection policy (use agy_quota to see the recommended:true list). Do NOT pass a Claude/GPT (3p) model.' }, effort: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Optional reasoning effort.' }, cwd: { type: 'string', description: 'Working directory for agy.' }, addDirs: { type: 'array', items: { type: 'string' }, description: 'Extra directories to add to agy workspace.' }, timeoutSec: { type: 'integer', description: 'Print timeout seconds (10-3600, default 300).' }, background: { type: 'boolean', description: 'Run as a background job and return a jobId.' } }, output: OUT, execute: function (args, exec) { return coreExecute(args, exec) } }))

    harness.registerTool(ctx, harness.defineTool({ name: 'agy_continue', description: 'Continue an existing agy conversation with a follow-up prompt. Pass conversationId or set latest=true. Same DSH-controlled, no-prompt execution and same fallback dialog as agy_run.', parameters: { prompt: { type: 'string', description: 'Follow-up instruction for the ongoing agy conversation.', required: true }, conversationId: { type: 'string', description: 'agy conversation id to resume.' }, latest: { type: 'boolean', description: 'Continue the most recent agy conversation.' }, mode: { type: 'string', enum: ['auto', 'plan', 'accept-edits'], description: 'Execution mode.' }, model: { type: 'string', description: 'Optional agy model id — pick from the Gemini pool or utility models per the model-selection policy (use agy_quota to see the recommended:true list). Do NOT pass a Claude/GPT (3p) model.' }, effort: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Optional reasoning effort.' }, cwd: { type: 'string', description: 'Working directory for agy.' }, timeoutSec: { type: 'integer', description: 'Print timeout seconds (10-3600, default 300).' }, background: { type: 'boolean', description: 'Run as a background job and return a jobId.' } }, output: OUT, execute: function (args, exec) { const a = args || {}; const mapped = { prompt: a.prompt, mode: a.mode, model: a.model, effort: a.effort, cwd: a.cwd, timeoutSec: a.timeoutSec, background: a.background }; if (a.conversationId) mapped.conversationId = a.conversationId; else if (a.latest) mapped.continueLatest = true; return coreExecute(mapped, exec) } }))

    harness.registerTool(ctx, harness.defineTool({ name: 'agy_status', description: 'Read a live snapshot of what the local agy agent is currently doing. Returns one section per project (working directory): running count, current step (tool name + arguments being executed, or agent_response thinking/typing), recent step trail, last completed run status + conversation id. Call this to check on an in-flight agy_run/agy_continue without waiting for it to finish.', parameters: { cwd: { type: 'string', description: 'Optional: filter the snapshot to a single project (working directory).' } }, output: STATUS_OUT, execute: function (args) { const a = args || {}; const snap = snapshot(); if (a.cwd) { const key = String(a.cwd); snap.projects = snap.projects.filter(function (p) { return p.cwd === key }); const g = snap.projects[0]; if (g) { snap.state = g.state; snap.running = g.running; snap.current = g.current; snap.trail = g.trail; snap.lastStatus = g.lastStatus; snap.lastAt = g.lastAt; snap.lastConversationId = g.lastConversationId; snap.fallbackActive = g.fallbackActive; snap.updatedAt = g.updatedAt } } return snap } }))

    harness.registerTool(ctx, harness.defineTool({ name: 'agy_quota', description: 'Query the Google AI plan (Antigravity OAuth consumer) quota pool behind the local agy CLI. Reads the Windows credential manager entry (gemini:antigravity) that agy wrote at login, refreshes the access token, then calls Google Cloud Code quota APIs: fetchAvailableModels (per-model remaining pool percentage) and retrieveUserQuotaSummary (grouped plan buckets: weekly + 5h windows). Returns { ok, models: [{name, percentage, resetTime, displayName}], groups: [{displayName, buckets: [{bucketId, window, remainingFraction, resetTime}]}], tier }. GATING RULE: only the Gemini 5h window decides whether agy can run this task — agy_run/agy_continue already refuse silently below 10% of the 5h pool, so you normally do not need to pre-check. The weekly window is NOT a per-task gate: a drained weekly bucket only means agy is a poor choice for the rest of the week (pick another subagent or your own tools), never a reason to abort or shrink the current task. If the credential is missing the tool returns { ok:false, error } and agy_run still works normally.', parameters: { summary: { type: 'boolean', description: 'Return only a compact summary (weekly buckets + top models).' } }, output: QUOTA_OUT, execute: async function (args) { const a = args || {}; const res = await cachedQuotaCheck(); if (res.ok && a.summary) { const weekly = (res.groups || []).flatMap(function (g) { return (g.buckets || []).filter(function (b) { return b.window === 'weekly' }).map(function (b) { return { g: g.displayName, id: b.bucketId, pct: Math.round((b.remainingFraction || 0) * 100), reset: b.resetTime } }) }); const top = (res.models || []).slice(0, 4).map(function (m) { return (m.displayName || m.name) + ' ' + m.percentage + '%' }).join(', '); return { ok: true, summary: { weekly: weekly, topModels: top }, models: res.models, groups: res.groups, tier: res.tier } } return res } }))

    const policyText = [
      'agy-first execution policy (local agy CLI bridge, with fallback + live indicator + live status tool).',
      '',
      'A local sub-agent CLI named "agy" is available through the agy_run and agy_continue tools. DSH fully controls agy: every invocation runs non-interactively with all permissions auto-approved, so agy never prompts and DSH decides all of its work. A header status light shows when agy is working — one light per project (working directory), so parallel runs in different projects are tracked separately; call agy_status any time to see what agy is doing right now (per project: current tool/step and recent trail).',
      '',
      'Priority rule for EVERY mode (normal, plan, accept-edits, subagent/workflow/ralph delegation, and goal rounds):',
      '- For any real work — implementing features, editing/refactoring code, debugging, running builds, or multi-file investigation — prefer dispatching the task to agy_run FIRST with a complete, self-contained prompt.',
      '- Use native read/write/shell tools mainly for quick read-only lookups and for the final build/test verification of what agy produced.',
      '- In plan mode, call agy_run with mode=auto (or mode=plan); in accept-edits/normal mode agy_run applies edits directly.',
      '- When you delegate to a DSH subagent or workflow, instruct that delegate to also prefer agy_run.',
      '- For long-running tasks, call agy_run with background=true and collect the result with job_output; use agy_status to watch progress.',
      '',
      'Fallback protocol: when agy is rate-limited or the network is down, agy_run/agy_continue automatically pop a confirmation dialog asking the user whether to use the DSH local API config. If the returned result has fallback=true (status FALLBACK_TO_DSH), the user chose to fall back: complete the task with native DSH tools / the local model and DO NOT call agy again for this task. If ok=false without fallback, report the agy error. Never loop agy calls; never ask agy to call back into DSH.',
      '',
      'Model selection policy (v1.5.10): you decide which model agy uses, based on the task at hand. Call agy_quota first to see the available pool and per-model remaining %. Use the Gemini pool (gemini-* models) or the other utility models (tab_*, chat_*) — the recommended:true entries. Do NOT pass a Claude or GPT model (family claude/gpt, marked [3p: 不推荐]) to agy_run: those 3p models are effectively unusable on this plan and will fail or produce poor results. When the task is image generation / image editing, dispatch it straight to agy_run WITHOUT specifying a model: agy itself selects the right image model and handles it; do not filter or block image tasks.',
      '',
      'Quota guard (v1.5.13): the ONLY quota gate for a task is the Gemini 5h pool — below 10% agy_run/agy_continue SILENTLY refuse to call agy (status QUOTA_BLOCKED, no dialog, no user notification), because a drained 5h window means agy genuinely cannot work this round; finish the task with native tools instead. Weekly quota is NOT a task gate and is no longer checked on the call path: a low or exhausted weekly bucket only means agy is a poor pick for the rest of the week (prefer another subagent or your own tools next time) — never shrink, delay, or abandon the current task because of weekly usage.'
    ].join('\n')

    ctx.systemPrompt.section({ name: 'agy:policy', order: 5, text: policyText })
  }
}
