// agy-first-bridge — a self-contained Cordis plugin for an authored agent preset.
//
// It registers three model tools (agy_run, agy_continue, agy_status) that
// dispatch work to the local `agy` CLI, and injects an "agy-first" priority
// prompt section. DSH fully controls agy: every invocation runs non-interactively
// with --dangerously-skip-permissions so agy never prompts and DSH decides all
// of its work. agy_status reports a live snapshot of what agy is CURRENTLY doing
// (current step + recent trail), fed by parsing agy's stream-json output.
//
// This module is imported by the cordis loader as an ESM plugin (named exports
// `name`, `inject`, `apply`). It is intentionally dependency-free: a locally
// authored preset lives under the user home, where Node's upward node_modules
// walk cannot reach the harness's own packages, so it must NOT `import` any
// @deepseek-ai/* package. Tool definitions are therefore hand-built plain
// objects (no `defineTool` helper) and registered through `ctx.tools.register`.

export const name = 'agy-first-bridge'
export const inject = ['tools', 'subprocess', 'systemPrompt', 'timer']

const CWD_FALLBACK = 'C:\\Users\\lcl\\Desktop\\DSH'

const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true }

// Labels for the rate-limit / network fallback confirmation dialog.
const FALLBACK_LABEL = '使用 DSH 本地 API 配置（回退）'
const RETRY_LABEL = '重试 agy 一次'
const CANCEL_LABEL = '不回退（返回错误）'
const LIMIT_RE = /rate.?limit|ratelimit|429|too many|quota|insufficient|credit|balance|exhausted|exceed|network|offline|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|timeout|timed out|unavailable|503|502|500|401|403|unauthorized|invalid api|api key|connection|proxy|socket|tls|ssl|dns|网络|超时|限流|流量|受限|配额|金额|余额|额度|认证|连接|断开/i
const MAX_TRAIL = 12
const MAX_ARG_LEN = 120

function isLimited(res) {
  if (!res || res.ok) return false
  if (res.status === 'SPAWN_ERROR' || res.status === 'AGY_UNAVAILABLE' || res.status === 'HUNG_TIMEOUT') return true
  const hay = String(res.stderr || '') + ' ' + String(res.response || '') + ' ' + String(res.status || '')
  return LIMIT_RE.test(hay)
}

function clampInt(v, def, min, max) {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  const i = Math.floor(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

function shortLabel(prompt) {
  const s = String(prompt || '').replace(/\s+/g, ' ').trim()
  return s.length > 80 ? s.slice(0, 77) + '...' : s
}

function summarizeArgs(parameters) {
  if (!parameters || typeof parameters !== 'object') return undefined
  const out = {}
  for (const k of Object.keys(parameters)) {
    let v = parameters[k]
    if (typeof v === 'string' && v.length > MAX_ARG_LEN) v = v.slice(0, MAX_ARG_LEN) + '…'
    out[k] = v
  }
  return out
}

// stream-json: the LAST line is {"event":"result","result":{...}}; tolerate
// extra log lines and whole-string JSON.
function parseAgyJson(stdoutText) {
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
  if (parsed) {
    return {
      ok: exitCode === 0 && parsed.status === 'SUCCESS',
      status: typeof parsed.status === 'string' ? parsed.status : (exitCode === 0 ? 'UNKNOWN' : 'ERROR'),
      response: typeof parsed.response === 'string' ? parsed.response : '',
      conversationId: typeof parsed.conversation_id === 'string' ? parsed.conversation_id : null,
      durationSeconds: typeof parsed.duration_seconds === 'number' ? parsed.duration_seconds : null,
      numTurns: typeof parsed.num_turns === 'number' ? parsed.num_turns : null,
      totalTokens: parsed.usage && typeof parsed.usage.total_tokens === 'number' ? parsed.usage.total_tokens : null,
      exitCode: exitCode,
      mode: mode,
      stderr: stderr
    }
  }
  return {
    ok: false,
    status: 'PARSE_ERROR',
    response: '',
    conversationId: null,
    durationSeconds: null,
    numTurns: null,
    totalTokens: null,
    exitCode: exitCode,
    mode: mode,
    stderr: stderr,
    rawStdout: String(stdoutText || '').slice(-2000)
  }
}

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

export function apply(ctx) {
  const subprocess = ctx.subprocess
  const jobs = ctx.get('jobs')
  const planMode = ctx.get('planMode')
  const sandboxPolicy = ctx.get('sandboxPolicy')

  // ── live status snapshot: per-project + global aggregation ────────────────
  // Each agy run belongs to a project (its cwd). agy_status reports one section
  // per project; the global row aggregates everything (backward compatible).
  const projects = Object.create(null) // cwd -> project record
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
        const idle = Object.keys(projects).filter((k) => projects[k].running === 0)
        const victim = (idle.length ? idle : Object.keys(projects)).sort((a, b) => projects[a].updatedAt - projects[b].updatedAt)[0]
        delete projects[victim]
      }
      p = { cwd: key, name: projectName(key), state: 'idle', running: 0, lastStatus: null, lastAt: 0, lastConversationId: null, lastOk: false, lastFailed: false, fallbackActive: false, current: null, trail: [], updatedAt: 0 }
      projects[key] = p
    }
    return p
  }
  function nowIso() { return new Date().toISOString() }
  function globalStatus() {
    const list = Object.keys(projects).map((k) => projects[k])
    let running = 0, lastStatus = null, lastAt = 0, lastConversationId = null, fallbackActive = false, current = null, trail = [], updatedAt = 0
    for (const p of list) {
      running += p.running
      if (p.updatedAt > updatedAt) updatedAt = p.updatedAt
      if (p.running > 0 && !current && p.current) current = p.current
      if (p.lastAt > lastAt) { lastAt = p.lastAt; lastStatus = p.lastStatus; lastConversationId = p.lastConversationId }
      if (p.fallbackActive) fallbackActive = true
      for (const e of p.trail) trail.push(e)
    }
    trail.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    trail = trail.slice(-MAX_TRAIL)
    const state = running > 0 ? 'running' : (fallbackActive ? 'fallback' : (lastStatus ? (lastStatus === 'SUCCESS' || lastOk ? 'ok' : 'failed') : 'idle'))
    return { state, running, lastStatus, lastAt, lastConversationId, fallbackActive, current, trail, updatedAt }
  }
  function statusSnapshot() {
    const g = globalStatus()
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

  // Publish the current snapshot to the home-level agy-indicator collector
  // (cordis.patch.yml) so the persistent browser light can show it. The event
  // is an app-level broadcast; the collector merges projects by cwd.
  function publish() {
    try { ctx.emit('agy/status', { snapshot: statusSnapshot() }) } catch (e) { /* ignore */ }
  }

  // 宣告 agy 优先模式：家级灯据此决定常驻显示（presetActive）。
  // preset 挂载即宣告；周期性续期，避免会话空闲时被误判为非 agy 模式。
  // （动态形态沙箱无 ctx.emit，靠 ctx.get('agyCollector').mergeSnapshot 推状态，
  //   不宣告模式 → 普通模式灯仅在调用 agy 时临时显示。）
  function announceMode() {
    try { ctx.emit('agy/mode', { active: true }) } catch (e) { /* ignore */ }
  }
  announceMode()
  try { const t = ctx.setInterval ? ctx.setInterval(announceMode, 30000) : null; if (t && ctx.effect) ctx.effect(() => () => { try { t() } catch (e) {} }) } catch (e) {}

  function resolveCwd(args) {
    if (args && args.cwd) return String(args.cwd)
    if (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string' && sandboxPolicy.workspaceRoot) return sandboxPolicy.workspaceRoot
    return CWD_FALLBACK
  }

  function planActiveFor(exec) {
    try {
      if (planMode && exec && exec.agent) {
        const st = planMode.get(exec.agent)
        return !!(st && st.active)
      }
    } catch (e) {}
    return false
  }

  const stdio = {
    stdin: 'ignore',
    stdout: { maxBytes: 4000000, spill: { maxBytes: 40000000 } },
    stderr: { maxBytes: 1000000, spill: { maxBytes: 8000000 } }
  }

  function readStreams(handle) {
    const stdoutText = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    const stderrText = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
    return { stdoutText, stderrText }
  }

  // Parse NDJSON step_update lines incrementally from the growing stdout buffer.
  function startLiveParser(handle, cwd) {
    let cursor = 0
    const tick = () => {
      try {
        const full = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
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
    return ctx.interval(tick, 250)
  }

  async function runSync(argv, cwd, timeoutSec, callerSignal) {
    const spec = { argv, cwd, stdio, graceMs: 5000 }
    if (callerSignal) spec.signal = callerSignal
    const handle = subprocess.spawn(spec)
    // 超时强制 terminate（DSH 侧最终防线，绝不无限等）。
    // terminate 时记录最后事件摘要，便于区分"长命令正常"vs"真卡死"。
    let lastEventSummary = '(no events yet)'
    let timedOut = false
    const disposeTimer = ctx.timeout(() => {
      timedOut = true
      try {
        const p = ensureProject(cwd)
        lastEventSummary = (p.current ? ('last step ' + p.current.stepIndex + ' -> ' + p.current.tool) : '') +
          ' | trail=' + (p.trail.length ? p.trail.slice(-2).map((e) => '[' + e.state + ']' + e.tool).join(',') : 'empty') +
          ' | elapsed=' + Math.round((Date.now() - (p.updatedAt || Date.now())) / 1000) + 's since last activity'
      } catch (e) {}
      try { handle.terminate() } catch (e) {}
    }, (timeoutSec + 60) * 1000)
    const disposeLive = startLiveParser(handle, cwd)
    try {
      const outcome = await handle.done
      const s = readStreams(handle)
      return { outcome, stdoutText: s.stdoutText, stderrText: s.stderrText, timedOut, lastEventSummary }
    } finally {
      disposeLive()
      disposeTimer()
    }
  }

  function fallbackResult(res, mode) {
    return { ok: false, fallback: true, status: 'FALLBACK_TO_DSH', response: '', conversationId: (res && res.conversationId) || null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: res ? res.exitCode : null, mode: mode, stderr: res ? res.stderr : '', reason: res ? res.status : 'unknown' }
  }

  // On a rate-limit / network failure, ask the human whether to fall back to the
  // DSH local API config. Returns 'fallback' | 'retry' | 'error'. When no live
  // human answerer exists (e.g. a delegated subagent), returns 'error' silently.
  async function askFallback(exec, res) {
    const uq = ctx.get('userQuestions')
    if (!uq || !exec || !exec.agent) return 'error'
    const detail = String(res.stderr || res.response || res.status || '').slice(-600)
    try {
      const ans = await uq.ask({
        agent: exec.agent,
        signal: exec.signal,
        questions: [{
          id: 'agy-fallback',
          header: 'agy 受限',
          question: 'agy 调用失败（疑似流量受限/网络不通，状态=' + String(res.status) + '）。是否改用 DSH 本地 API 配置继续？',
          detail: detail,
          options: [
            { label: FALLBACK_LABEL, description: '本次改由 DSH 本地模型/原生工具完成，不再走 agy' },
            { label: RETRY_LABEL, description: '再调用一次 agy（网络抖动时可用）' },
            { label: CANCEL_LABEL, description: '不回退，直接返回 agy 错误' }
          ]
        }]
      })
      const sel = (ans && ans.answers && ans.answers[0] && ans.answers[0].selected) || []
      if (sel.indexOf(FALLBACK_LABEL) >= 0) return 'fallback'
      if (sel.indexOf(RETRY_LABEL) >= 0) return 'retry'
      return 'error'
    } catch (e) { return 'error' }
  }

  async function coreExecute(rawArgs, exec) {
    const args = rawArgs || {}
    if (!args.prompt || !String(args.prompt).trim()) {
      return { ok: false, status: 'BAD_ARGS', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: null, mode: 'auto', stderr: 'prompt is required' }
    }
    let exe = 'agy'
    let exeOk = true
    let resolveErr = ''
    try { exe = await subprocess.resolveExecutable('agy', undefined, exec ? exec.signal : undefined) } catch (e) { exeOk = false; resolveErr = String(e && e.message || e) }
    const cwd = resolveCwd(args)
    const built = buildArgv(exe, args, planActiveFor(exec))

    // 额度预检（v1.5.9）：执行前快速查周套餐余量，过低时在结果里附警告。
    // 带 30 分钟缓存，避免每次调用都刷新 token / 请求 API。
    let quotaWarning = ''
    if (!args.background) {
      try {
        const q = await cachedQuotaCheck()
        if (q && q.ok) {
          const low = (q.groups || []).flatMap((g) => (g.buckets || []).filter((b) => b.window === 'weekly')).filter((b) => typeof b.remainingFraction === 'number' && b.remainingFraction < 0.2)
          if (low.length) {
            quotaWarning = '\n[quota] 周套餐余量低：' + low.map((b) => (b.bucketId || '') + ' ' + Math.round(b.remainingFraction * 100) + '% (reset ' + (b.resetTime || '?') + ')').join('、') + ' —— 建议降低任务规模或用 agy_quota 确认。'
          }
        }
      } catch (e) { /* 预检失败不阻塞 */ }
    }

    if (!exeOk) {
      begin(cwd)
      let res = { ok: false, status: 'AGY_UNAVAILABLE', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: null, mode: built.mode, stderr: 'agy executable not found: ' + resolveErr }
      if (await askFallback(exec, res) === 'fallback') res = fallbackResult(res, built.mode)
      end(res, cwd)
      return res
    }

    if (args.background && jobs && exec && exec.agent) {
      try {
        begin(cwd)
        const jobId = jobs.start({
          kind: 'bash',
          label: 'agy: ' + shortLabel(args.prompt),
          owner: exec.agent,
          run() {
            const handle = subprocess.spawn({ argv: built.argv, cwd, stdio, graceMs: 5000 })
            const disposeLive = startLiveParser(handle, cwd)
            const done = handle.done.then((outcome) => {
              disposeLive()
              const s = readStreams(handle)
              const res = buildResult(parseAgyJson(s.stdoutText), outcome, built.mode, s.stderrText, s.stdoutText)
              end(res, cwd)
              return { status: res.ok ? 'completed' : 'failed', detail: 'agy ' + res.status, output: JSON.stringify(res) }
            }).catch((err) => {
              disposeLive()
              end({ ok: false, status: 'JOB_ERROR' }, cwd)
              return { status: 'failed', detail: String(err && err.message || err) }
            })
            return { cancel() { try { handle.terminate() } catch (e) {} }, done }
          }
        })
        return { ok: true, background: true, jobId: String(jobId), mode: built.mode, note: 'agy running in background; collect with job_output ' + String(jobId) + '. Background failures do NOT open the fallback dialog; on failure re-run in foreground to be prompted.' }
      } catch (e) {
        end({ ok: false, status: 'JOB_START_ERROR' }, cwd)
      }
    }

    begin(cwd)
    try {
      let attempt = 0
      let res
      while (true) {
        attempt += 1
        const r = await runSync(built.argv, cwd, built.timeoutSec, exec ? exec.signal : undefined)
        if (r.timedOut) {
          // DSH 侧超时强制终止：明确报 HUNG_TIMEOUT（区别于解析失败），
          // 附最后事件摘要供诊断；视为"受限"以触发回退弹窗（网络挂起场景）。
          res = { ok: false, status: 'HUNG_TIMEOUT', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: r.outcome ? r.outcome.exitCode : null, mode: built.mode, stderr: 'agy did not finish within ' + built.timeoutSec + 's (DSH hard timeout). Last activity: ' + r.lastEventSummary + '. NOTE: if the task was a long-running script (build/test), raise timeoutSec; this was a hang guard, not necessarily a failure of agy.' }
          break
        }
        res = buildResult(parseAgyJson(r.stdoutText), r.outcome, built.mode, r.stderrText, r.stdoutText)
        if (res.ok || !isLimited(res) || attempt >= 2) break
        const decision = await askFallback(exec, res)
        if (decision === 'fallback') { res = fallbackResult(res, built.mode); break }
        if (decision === 'retry') continue
        break
      }
      if (!res.ok && !res.fallback && isLimited(res) && attempt >= 2) {
        if (await askFallback(exec, res) === 'fallback') res = fallbackResult(res, built.mode)
      }
      if (quotaWarning && res.ok) res.response = String(res.response || '') + quotaWarning
      end(res, cwd)
      return res
    } catch (e) {
      const res = { ok: false, status: 'SPAWN_ERROR', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: null, mode: built.mode, stderr: String(e && e.message || e) }
      const out = (await askFallback(exec, res) === 'fallback') ? fallbackResult(res, built.mode) : res
      end(out, cwd)
      return out
    }
  }

  function renderResult(args, value) {
    const v = value || {}
    if (v.background) {
      return [{ type: 'text', text: 'agy dispatched in background (mode=' + v.mode + '). jobId=' + v.jobId + '. Collect with job_output.' }]
    }
    if (v.fallback) {
      return [{ type: 'text', text: 'agy 回退：用户选择使用 DSH 本地 API 配置（原因 ' + v.reason + '）。请改用原生工具/本地模型完成本任务，不要再调 agy。' }]
    }
    const head = 'agy ' + (v.ok ? 'OK' : 'FAILED') + ' [status=' + v.status + ' mode=' + v.mode + (v.conversationId ? ' conv=' + v.conversationId : '') + (v.totalTokens != null ? ' tokens=' + v.totalTokens : '') + (v.durationSeconds != null ? ' ' + v.durationSeconds + 's' : '') + ']'
    const body = v.response ? v.response : (v.stderr ? '[stderr] ' + v.stderr : (v.rawStdout ? '[raw] ' + v.rawStdout : ''))
    return [{ type: 'text', text: head + (body ? '\n\n' + body : '') }]
  }

  const runTool = {
    name: 'agy_run',
    description: 'Dispatch a coding/build/debug/investigation task to the local agy agent CLI and return its final answer. Prefer this for implementation, edits, refactors, multi-file investigation and debugging in every mode. DSH fully controls agy: it always runs non-interactively with permissions auto-approved (agy never prompts). Use read-only native tools only for quick lookups and for final build/test verification. In mode=auto the DSH plan state decides agy plan vs accept-edits. Set background=true for long tasks and collect the result via job_output.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'The full task/instruction for agy. Be complete and self-contained.' },
        mode: { type: 'string', enum: ['auto', 'plan', 'accept-edits'], description: 'auto follows DSH plan state; plan = no writes; accept-edits = allow edits. Default auto.' },
        model: { type: 'string', description: 'Optional agy model id — pick from the Gemini pool or utility models per the model-selection policy (use agy_quota to see the recommended:true list). Do NOT pass a Claude/GPT (3p) model.' },
        effort: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Optional reasoning effort.' },
        cwd: { type: 'string', description: 'Working directory for agy. Defaults to the DSH workspace root.' },
        addDirs: { type: 'array', items: { type: 'string' }, description: 'Extra directories to add to agy workspace.' },
        timeoutSec: { type: 'integer', description: 'Print timeout seconds (10-3600, default 300).' },
        background: { type: 'boolean', description: 'Run as a background job and return a jobId immediately.' }
      }
    },
    output: { schema: OUTPUT_SCHEMA, render: renderResult },
    execute(args, exec) { return coreExecute(args, exec) }
  }

  const continueTool = {
    name: 'agy_continue',
    description: 'Continue an existing agy conversation with a follow-up prompt, reusing agy context. Pass conversationId from a prior agy_run result, or set latest=true to continue the most recent agy conversation. Same DSH-controlled, no-prompt execution as agy_run.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Follow-up instruction for the ongoing agy conversation.' },
        conversationId: { type: 'string', description: 'agy conversation id to resume (from a prior agy_run result).' },
        latest: { type: 'boolean', description: 'Continue the most recent agy conversation instead of a specific id.' },
        mode: { type: 'string', enum: ['auto', 'plan', 'accept-edits'], description: 'Execution mode; default auto.' },
        model: { type: 'string', description: 'Optional agy model id.' },
        effort: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Optional reasoning effort.' },
        cwd: { type: 'string', description: 'Working directory for agy.' },
        timeoutSec: { type: 'integer', description: 'Print timeout seconds (10-3600, default 300).' },
        background: { type: 'boolean', description: 'Run as a background job and return a jobId immediately.' }
      }
    },
    output: { schema: OUTPUT_SCHEMA, render: renderResult },
    execute(args, exec) {
      const a = args || {}
      const mapped = { prompt: a.prompt, mode: a.mode, model: a.model, effort: a.effort, cwd: a.cwd, timeoutSec: a.timeoutSec, background: a.background }
      if (a.conversationId) mapped.conversationId = a.conversationId
      else if (a.latest) mapped.continueLatest = true
      return coreExecute(mapped, exec)
    }
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

  const statusTool = {
    name: 'agy_status',
    description: 'Read a live snapshot of what the local agy agent is currently doing. Returns one section per project (working directory): running count, the current step (tool name + arguments being executed, or agent_response thinking/typing), the recent step trail (tools executed, done/error), and the last completed run status + conversation id. Optional cwd filters to a single project. Call this to check on an in-flight agy_run/agy_continue without waiting for it to finish.',
    parameters: { type: 'object', additionalProperties: false, required: [], properties: { cwd: { type: 'string', description: 'Optional: filter the snapshot to a single project (working directory).' } } },
    output: { schema: OUTPUT_SCHEMA, render: renderStatus },
    execute(args) {
      const a = args || {}
      const snap = statusSnapshot()
      if (a.cwd) {
        const key = String(a.cwd)
        snap.projects = snap.projects.filter((p) => p.cwd === key)
        const g = snap.projects[0]
        if (g) { snap.state = g.state; snap.running = g.running; snap.current = g.current; snap.trail = g.trail; snap.lastStatus = g.lastStatus; snap.lastAt = g.lastAt; snap.lastConversationId = g.lastConversationId; snap.fallbackActive = g.fallbackActive; snap.updatedAt = g.updatedAt }
      }
      return snap
    }
  }

  // agy_quota：查询 agy 所用 Google AI 套餐（Antigravity OAuth）的池子额度。
  // 复用独立脚本 bin/agy-quota.mjs（凭据→刷新 token→fetchAvailableModels +
  // retrieveUserQuotaSummary），stdout 输出 JSON。脚本路径：相对本模块向上两级的 bin。
  let quotaCache = { at: 0, data: null }
  async function cachedQuotaCheck() {
    const now = Date.now()
    if (quotaCache.data && now - quotaCache.at < 30 * 60 * 1000) return quotaCache.data
    const res = await execQuotaScript()
    quotaCache = { at: now, data: res }
    return res
  }

  async function execQuotaScript() {
    const scriptPath = new URL('../../bin/agy-quota.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
    const node = process.execPath || 'node'
    const handle = subprocess.spawn({ argv: [node, scriptPath], cwd: CWD_FALLBACK, stdio, graceMs: 5000 })
    const outcome = await handle.done
    const s = readStreams(handle)
    const stdoutText = s.stdoutText || ''
    const jsonMatch = stdoutText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { ok: false, error: 'no JSON output: ' + stdoutText.slice(0, 300) }
    try {
      const parsed = JSON.parse(jsonMatch[0])
      return parsed
    } catch (e) { return { ok: false, error: 'parse error: ' + e.message } }
  }

  const quotaTool = {
    name: 'agy_quota',
    description: 'Query the Google AI plan (Antigravity OAuth consumer) quota pool behind the local agy CLI. Reads the Windows credential manager entry (gemini:antigravity) that agy wrote at login, refreshes the access token, then calls Google Cloud Code quota APIs: fetchAvailableModels (per-model remaining pool percentage) and retrieveUserQuotaSummary (grouped plan buckets: weekly + 5h windows). Returns { ok, models: [{name, percentage, resetTime, displayName}], groups: [{displayName, buckets: [{bucketId, window, remainingFraction, resetTime}]}], tier }. Call this BEFORE agy_run when you want to confirm there is quota left (e.g. weekly Gemini bucket below ~20% is low; avoid heavy runs then). If the credential is missing the tool returns { ok:false, error } and agy_run still works normally.',
    parameters: { type: 'object', additionalProperties: false, required: [], properties: { summary: { type: 'boolean', description: 'Return only a compact summary line (weekly buckets + top models).' } } },
    output: { schema: OUTPUT_SCHEMA, render: function renderQuota(args, value) {
      const v = value || {}
      if (!v.ok) return [{ type: 'text', text: 'agy_quota failed: ' + String(v.error || 'unknown') }]
      const lines = []
      lines.push('agy quota [tier=' + (v.tier || '?') + ']')
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
    } },
    async execute(args) {
      const a = args || {}
      const res = await execQuotaScript()
      if (res.ok && a.summary) {
        // 紧凑摘要
        const weekly = (res.groups || []).flatMap((g) => (g.buckets || []).filter((b) => b.window === 'weekly').map((b) => ({ g: g.displayName, id: b.bucketId, pct: Math.round((b.remainingFraction || 0) * 100), reset: b.resetTime })))
        const top = (res.models || []).slice(0, 4).map((m) => (m.displayName || m.name) + ' ' + m.percentage + '%').join(', ')
        return { ok: true, summary: { weekly, topModels: top }, models: res.models, groups: res.groups, tier: res.tier }
      }
      return res
    }
  }

  ctx.effect(() => ctx.tools.register(runTool))
  ctx.effect(() => ctx.tools.register(continueTool))
  ctx.effect(() => ctx.tools.register(statusTool))
  ctx.effect(() => ctx.tools.register(quotaTool))

  const policyText = [
    'agy-first execution policy (local agy CLI bridge).',
    '',
    'A local sub-agent CLI named "agy" is available through the agy_run and agy_continue tools. DSH fully controls agy: every agy invocation runs non-interactively with all permissions auto-approved, so agy never prompts and DSH decides all of its work. Use agy_status any time to see what agy is doing right now — reported per project (working directory), each with its current tool/step and recent trail; while a run is in flight you can call it without waiting.',
    '',
    'Priority rule for EVERY mode (normal, plan, accept-edits, subagent/workflow/ralph delegation, and goal rounds):',
    '- For any real work \u2014 implementing features, editing/refactoring code, debugging, running builds, or multi-file investigation \u2014 prefer dispatching the task to agy_run FIRST with a complete, self-contained prompt.',
    '- Use native read/write/shell tools mainly for quick read-only lookups and for the final build/test verification of what agy produced.',
    '- In plan mode, call agy_run with mode=auto (or mode=plan): agy will plan without writing files.',
    '- In accept-edits/normal mode, agy_run applies edits directly (DSH-controlled, no prompt).',
    '- When you delegate to a DSH subagent or workflow, instruct that delegate to also prefer agy_run.',
    '- For long-running tasks, call agy_run with background=true and collect the result with job_output; use agy_status to watch progress.',
    '',
    'Fallback protocol: when agy is rate-limited or the network is down, agy_run/agy_continue automatically pop a confirmation dialog asking the user whether to use the DSH local API config. If the returned result has fallback=true (status FALLBACK_TO_DSH), the user chose to fall back: complete the task with native DSH tools / the local model and DO NOT call agy again for this task. If ok=false without fallback, report the agy error. Background failures do not open the dialog. Never loop agy calls; never ask agy to call back into DSH.',
    '',
    'Model selection policy (v1.5.10): you decide which model agy uses, based on the task at hand. Call agy_quota first to see the available pool and per-model remaining %. Use the Gemini pool (gemini-* models) or the other utility models (tab_*, chat_*) — the recommended:true entries. Do NOT pass a Claude or GPT model (family claude/gpt, marked [3p: 不推荐]) to agy_run: those 3p models are effectively unusable on this plan and will fail or produce poor results. When the task is image generation / image editing, dispatch it straight to agy_run WITHOUT specifying a model: agy itself selects the right image model and handles it; do not filter or block image tasks.'
  ].join('\n')

  ctx.effect(() => ctx.systemPrompt.section({ name: 'agy:policy', order: 5, text: policyText }))
}
