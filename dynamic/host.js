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
const FALLBACK_LABEL = '使用 DSH 本地 API 配置（回退）'
const RETRY_LABEL = '重试 agy 一次'
const CANCEL_LABEL = '不回退（返回错误）'
const LIMIT_RE = /rate.?limit|ratelimit|429|too many|quota|exceed|network|offline|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|timeout|timed out|unavailable|503|502|500|connection|proxy|socket|tls|ssl|dns|网络|超时|限流|流量|受限|配额|连接|断开/i
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
  if (parsed) return { ok: exitCode === 0 && parsed.status === 'SUCCESS', status: typeof parsed.status === 'string' ? parsed.status : (exitCode === 0 ? 'UNKNOWN' : 'ERROR'), response: typeof parsed.response === 'string' ? parsed.response : '', conversationId: typeof parsed.conversation_id === 'string' ? parsed.conversation_id : null, durationSeconds: typeof parsed.duration_seconds === 'number' ? parsed.duration_seconds : null, numTurns: typeof parsed.num_turns === 'number' ? parsed.num_turns : null, totalTokens: parsed.usage && typeof parsed.usage.total_tokens === 'number' ? parsed.usage.total_tokens : null, exitCode: exitCode, mode: mode, stderr: stderrText ? String(stderrText).slice(-2000) : '' }
  return { ok: false, status: 'PARSE_ERROR', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: exitCode, mode: mode, stderr: stderrText ? String(stderrText).slice(-2000) : '', rawStdout: String(stdoutText || '').slice(-2000) }
}

function isLimited(res) { if (!res || res.ok) return false; if (res.status === 'SPAWN_ERROR' || res.status === 'AGY_UNAVAILABLE') return true; const hay = String(res.stderr || '') + ' ' + String(res.response || '') + ' ' + String(res.status || ''); return LIMIT_RE.test(hay) }

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

    // ── live status shared with the browser indicator light ──────────────────
    // current = the step agy is executing right now; trail = recent step events.
    const status = { state: 'idle', running: 0, lastStatus: null, lastAt: 0, lastConversationId: null, fallbackActive: false, current: null, trail: [], updatedAt: Date.now() }
    function nowIso() { return new Date().toISOString() }
    function snapshot() { return { state: status.state, running: status.running, lastStatus: status.lastStatus, lastAt: status.lastAt, lastConversationId: status.lastConversationId, fallbackActive: status.fallbackActive, current: status.current, trail: status.trail.slice(-MAX_TRAIL), updatedAt: status.updatedAt } }
    function begin() { status.running += 1; status.state = 'running'; status.updatedAt = Date.now() }
    function end(res) { status.running = Math.max(0, status.running - 1); status.lastStatus = res ? res.status : null; status.lastAt = Date.now(); if (res && res.conversationId) status.lastConversationId = res.conversationId; if (res && res.fallback) { status.fallbackActive = true; status.state = 'fallback' } else if (status.running > 0) { status.state = 'running' } else { status.state = res && res.ok ? 'ok' : 'failed' } status.current = null; status.updatedAt = Date.now() }
    function foldStepUpdate(ev) {
      const s = ev && ev.step_update
      if (!s) return
      status.updatedAt = Date.now()
      if (s.step_type === 'tool') {
        const tool = s.tool_name || (s.tool_info && s.tool_info.name) || 'tool'
        const args = summarizeArgs(s.tool_info && s.tool_info.parameters)
        const entry = { stepIndex: s.step_index, state: s.state, tool: tool, args: args, at: nowIso() }
        status.trail.push(entry)
        if (status.trail.length > MAX_TRAIL) status.trail.shift()
        if (s.state === 'ACTIVE') { status.current = { tool: tool, args: args, stepIndex: s.step_index, since: nowIso() } }
        else if (status.current && status.current.stepIndex === s.step_index) { status.current = null }
      } else if (s.step_type === 'agent_response' && s.state === 'ACTIVE' && s.text_delta) {
        status.current = { tool: 'agent_response', args: { text_delta: String(s.text_delta).slice(0, MAX_ARG_LEN) }, stepIndex: s.step_index, since: nowIso() }
      }
    }
    harness.handle('agy_status', function () { return snapshot() })

    function resolveCwd(args) { if (args && args.cwd) return String(args.cwd); if (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string' && sandboxPolicy.workspaceRoot) return sandboxPolicy.workspaceRoot; return CWD_FALLBACK }
    function planActiveFor(exec) { try { if (planMode && exec && exec.agent) { const st = planMode.get(exec.agent); return !!(st && st.active) } } catch (e) {} return false }

    const stdio = { stdin: 'ignore', stdout: { maxBytes: 4000000, spill: { maxBytes: 40000000 } }, stderr: { maxBytes: 1000000, spill: { maxBytes: 8000000 } } }
    function readStreams(h) { return { stdoutText: h.collected.stdout ? h.collected.stdout.readFrom(0).text : '', stderrText: h.collected.stderr ? h.collected.stderr.readFrom(0).text : '' } }

    // Parse NDJSON step_update lines incrementally from the growing stdout buffer.
    function startLiveParser(h) {
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
            try { const obj = JSON.parse(t); if (obj && obj.event === 'step_update') foldStepUpdate(obj) } catch (e) {}
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
      const disposeTimer = ctx.timeout(function () { try { handle.terminate() } catch (e) {} }, (timeoutSec + 60) * 1000)
      const disposeLive = startLiveParser(handle)
      try { const outcome = await handle.done; const s = readStreams(handle); return { outcome, stdoutText: s.stdoutText, stderrText: s.stderrText } } finally { disposeLive(); disposeTimer() }
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

      if (!exeOk) {
        begin()
        let res = { ok: false, status: 'AGY_UNAVAILABLE', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: null, mode: built.mode, stderr: 'agy executable not found: ' + resolveErr }
        if (await askFallback(exec, res) === 'fallback') res = fallbackResult(res, built.mode)
        end(res); return res
      }

      if (args.background && jobs && exec && exec.agent) {
        try {
          begin()
          const jobId = jobs.start({ kind: 'bash', label: 'agy: ' + shortLabel(args.prompt), owner: exec.agent, run: function () {
            const handle = subprocess.spawn({ argv: built.argv, cwd, stdio, graceMs: 5000 })
            const disposeLive = startLiveParser(handle)
            const done = handle.done.then(function (outcome) { disposeLive(); const s = readStreams(handle); const res = buildResult(parseStreamJson(s.stdoutText), outcome, built.mode, s.stderrText, s.stdoutText); end(res); return { status: res.ok ? 'completed' : 'failed', detail: 'agy ' + res.status, output: JSON.stringify(res) } }).catch(function (err) { disposeLive(); end({ ok: false, status: 'JOB_ERROR' }); return { status: 'failed', detail: String(err && err.message || err) } })
            return { cancel: function () { try { handle.terminate() } catch (e) {} }, done: done }
          } })
          return { ok: true, background: true, jobId: String(jobId), mode: built.mode, note: 'agy running in background; collect with job_output ' + String(jobId) + '. Background failures do NOT open the fallback dialog; on failure re-run in foreground to be prompted.' }
        } catch (e) { end({ ok: false, status: 'JOB_START_ERROR' }) }
      }

      begin()
      try {
        let attempt = 0; let res
        while (true) {
          attempt += 1
          const r = await runSync(built.argv, cwd, built.timeoutSec, exec ? exec.signal : undefined)
          res = buildResult(parseStreamJson(r.stdoutText), r.outcome, built.mode, r.stderrText, r.stdoutText)
          if (res.ok || !isLimited(res) || attempt >= 2) break
          const decision = await askFallback(exec, res)
          if (decision === 'fallback') { res = fallbackResult(res, built.mode); break }
          if (decision === 'retry') continue
          break
        }
        if (!res.ok && !res.fallback && isLimited(res) && attempt >= 2) { if (await askFallback(exec, res) === 'fallback') res = fallbackResult(res, built.mode) }
        end(res); return res
      } catch (e) { const res = { ok: false, status: 'SPAWN_ERROR', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: null, mode: built.mode, stderr: String(e && e.message || e) }; const out = (await askFallback(exec, res) === 'fallback') ? fallbackResult(res, built.mode) : res; end(out); return out }
    }

    function renderResult(args, value) {
      const v = value || {}
      if (v.background) return [{ type: 'text', text: 'agy dispatched in background (mode=' + v.mode + '). jobId=' + v.jobId + '. Collect with job_output.' }]
      if (v.fallback) return [{ type: 'text', text: 'agy 回退：用户选择使用 DSH 本地 API 配置（原因 ' + v.reason + '）。请改用原生工具/本地模型完成本任务，不要再调 agy。' }]
      const head = 'agy ' + (v.ok ? 'OK' : 'FAILED') + ' [status=' + v.status + ' mode=' + v.mode + (v.conversationId ? ' conv=' + v.conversationId : '') + (v.totalTokens != null ? ' tokens=' + v.totalTokens : '') + (v.durationSeconds != null ? ' ' + v.durationSeconds + 's' : '') + ']'
      const body = v.response ? v.response : (v.stderr ? '[stderr] ' + v.stderr : (v.rawStdout ? '[raw] ' + v.rawStdout : ''))
      return [{ type: 'text', text: head + (body ? '\n\n' + body : '') }]
    }

    function renderStatus(args, value) {
      const v = value || {}
      const lines = []
      lines.push('agy status: ' + v.state + (v.running > 0 ? ' (' + v.running + ' running)' : ''))
      if (v.current) { const c = v.current; lines.push('current: step ' + c.stepIndex + ' → ' + c.tool + (c.args ? ' ' + JSON.stringify(c.args) : '')) }
      else if (v.state === 'running') { lines.push('current: (starting / thinking)') }
      if (v.trail && v.trail.length) {
        lines.push('recent steps:')
        for (const e of v.trail.slice(-6)) { const a = e.args ? ' ' + JSON.stringify(e.args) : ''; lines.push('  [' + e.state + '] step ' + e.stepIndex + ' ' + e.tool + a) }
      }
      if (v.lastStatus) lines.push('last: ' + v.lastStatus + (v.lastConversationId ? ' conv=' + v.lastConversationId : '') + (v.lastAt ? ' @ ' + new Date(v.lastAt).toISOString() : ''))
      if (v.updatedAt) lines.push('updatedAt: ' + new Date(v.updatedAt).toISOString())
      return [{ type: 'text', text: lines.join('\n') }]
    }

    const OUT = { schema: { type: 'object', additionalProperties: true }, render: renderResult }
    const STATUS_OUT = { schema: { type: 'object', additionalProperties: true }, render: renderStatus }

    harness.registerTool(ctx, harness.defineTool({ name: 'agy_run', description: 'Dispatch a coding/build/debug/investigation task to the local agy agent CLI and return its final answer. DSH fully controls agy (--dangerously-skip-permissions; agy never prompts). On rate-limit/network failure DSH pops a fallback dialog; fallback=true means finish with native tools. background=true returns a jobId. While it runs, call agy_status to watch what agy is doing live.', parameters: { prompt: { type: 'string', description: 'The full task/instruction for agy. Be complete and self-contained.', required: true }, mode: { type: 'string', enum: ['auto', 'plan', 'accept-edits'], description: 'auto follows DSH plan state; plan = no writes; accept-edits = allow edits.' }, model: { type: 'string', description: 'Optional agy model id.' }, effort: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Optional reasoning effort.' }, cwd: { type: 'string', description: 'Working directory for agy.' }, addDirs: { type: 'array', items: { type: 'string' }, description: 'Extra directories to add to agy workspace.' }, timeoutSec: { type: 'integer', description: 'Print timeout seconds (10-3600, default 300).' }, background: { type: 'boolean', description: 'Run as a background job and return a jobId.' } }, output: OUT, execute: function (args, exec) { return coreExecute(args, exec) } }))

    harness.registerTool(ctx, harness.defineTool({ name: 'agy_continue', description: 'Continue an existing agy conversation with a follow-up prompt. Pass conversationId or set latest=true. Same DSH-controlled, no-prompt execution and same fallback dialog as agy_run.', parameters: { prompt: { type: 'string', description: 'Follow-up instruction for the ongoing agy conversation.', required: true }, conversationId: { type: 'string', description: 'agy conversation id to resume.' }, latest: { type: 'boolean', description: 'Continue the most recent agy conversation.' }, mode: { type: 'string', enum: ['auto', 'plan', 'accept-edits'], description: 'Execution mode.' }, model: { type: 'string', description: 'Optional agy model id.' }, effort: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Optional reasoning effort.' }, cwd: { type: 'string', description: 'Working directory for agy.' }, timeoutSec: { type: 'integer', description: 'Print timeout seconds (10-3600, default 300).' }, background: { type: 'boolean', description: 'Run as a background job and return a jobId.' } }, output: OUT, execute: function (args, exec) { const a = args || {}; const mapped = { prompt: a.prompt, mode: a.mode, model: a.model, effort: a.effort, cwd: a.cwd, timeoutSec: a.timeoutSec, background: a.background }; if (a.conversationId) mapped.conversationId = a.conversationId; else if (a.latest) mapped.continueLatest = true; return coreExecute(mapped, exec) } }))

    harness.registerTool(ctx, harness.defineTool({ name: 'agy_status', description: 'Read a live snapshot of what the local agy agent is currently doing: running count, the current step (tool name + arguments being executed, or agent_response thinking/typing), the recent step trail (tools executed, done/error), and the last completed run status + conversation id. Call this to check on an in-flight agy_run/agy_continue without waiting for it to finish.', parameters: {}, output: STATUS_OUT, execute: function () { return snapshot() } }))

    const policyText = [
      'agy-first execution policy (local agy CLI bridge, with fallback + live indicator + live status tool).',
      '',
      'A local sub-agent CLI named "agy" is available through the agy_run and agy_continue tools. DSH fully controls agy: every invocation runs non-interactively with all permissions auto-approved, so agy never prompts and DSH decides all of its work. A header status light shows when agy is working; call agy_status any time to see what agy is doing right now (current tool/step and recent trail).',
      '',
      'Priority rule for EVERY mode (normal, plan, accept-edits, subagent/workflow/ralph delegation, and goal rounds):',
      '- For any real work — implementing features, editing/refactoring code, debugging, running builds, or multi-file investigation — prefer dispatching the task to agy_run FIRST with a complete, self-contained prompt.',
      '- Use native read/write/shell tools mainly for quick read-only lookups and for the final build/test verification of what agy produced.',
      '- In plan mode, call agy_run with mode=auto (or mode=plan); in accept-edits/normal mode agy_run applies edits directly.',
      '- When you delegate to a DSH subagent or workflow, instruct that delegate to also prefer agy_run.',
      '- For long-running tasks, call agy_run with background=true and collect the result with job_output; use agy_status to watch progress.',
      '',
      'Fallback protocol: when agy is rate-limited or the network is down, agy_run/agy_continue automatically pop a confirmation dialog asking the user whether to use the DSH local API config. If the returned result has fallback=true (status FALLBACK_TO_DSH), the user chose to fall back: complete the task with native DSH tools / the local model and DO NOT call agy again for this task. If ok=false without fallback, report the agy error. Never loop agy calls; never ask agy to call back into DSH.'
    ].join('\n')

    ctx.systemPrompt.section({ name: 'agy:policy', order: 5, text: policyText })
  }
}
