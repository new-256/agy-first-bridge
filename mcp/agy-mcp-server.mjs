#!/usr/bin/env node
// agy-mcp-server — expose the local `agy` CLI as MCP tools (stdio transport).
//
// Any MCP-capable host (Claude Code / Codex / Cherry Studio / any MCP client)
// can add this server; the agent then DISCOVERS the agy tools itself and
// decides when to call them — even when the host is NOT running an
// "agy-first" preset.
//
// Zero npm dependencies: implements the MCP stdio JSON-RPC surface directly
// (initialize, tools/list, tools/call, notifications). Protocol version
// negotiated with the client; tools mirror the DSH plugin:
//   - agy_run       dispatch a task to the local agy CLI
//   - agy_continue  continue an existing agy conversation
//   - agy_status    live snapshot of what agy is CURRENTLY doing
//
// DSH-style full control is kept: every invocation is non-interactive
// (--dangerously-skip-permissions, --print-timeout), so agy never prompts.
//
// Live observation: agy runs with --output-format stream-json; each
// `step_update` event (tool ACTIVE/DONE/ERROR, agent_response text_delta) is
// parsed on arrival and folded into an in-memory snapshot. Any agent can then
// call the `agy_status` tool to see what agy is doing RIGHT NOW (current tool
// and its arguments, step index, recent step trail) — no polling loops needed.
//
// Usage:
//   node agy-mcp-server.mjs                # stdio MCP server
//   node agy-mcp-server.mjs --check        # self-test (no MCP): lists tools, exits
//
// Register (examples):
//   Claude Code : claude mcp add agy -- node C:\path\to\agy-mcp-server.mjs
//   Codex       : add to ~/.codex/config.toml [mcp_servers.agy]
//                 command = "node"
//                 args    = ["C:\\path\\to\\agy-mcp-server.mjs"]

import { spawn } from 'node:child_process'
import { resolve as resolvePath, dirname, join as joinPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'

const NAME = 'agy-mcp-server'
const VERSION = '1.5.13'
const PROTOCOL = '2024-11-05'

// ── home-light bridge ────────────────────────────────────────────────────────
// 家级 agy 状态灯（cordis.patch.yml 的 agy-indicator）只收宿主进程内的
// ctx.emit('agy/status')；本 server 是 dsh-mcp-client 拉起的独立 stdio 子进程，
// 没有 ctx，无法直接 emit。桥接：每次状态变化把 projects 快照写到一个固定
// JSON 文件，家级灯 index.mjs 在 status 路由里读盘合并（同 cwd 覆盖）。
// 文件位置 = dsh-home\plugins\agy-indicator\mcp-live.json（相对本文件上溯两级
// 到 dsh-home，再进 plugins\agy-indicator\）。AGY_MCP_LIVE_FILE 可覆盖。
const MCP_LIVE_FILE = process.env.AGY_MCP_LIVE_FILE
  || joinPath(dirname(dirname(fileURLToPath(import.meta.url))), 'plugins', 'agy-indicator', 'mcp-live.json')

function persistLive() {
  try {
    const list = Object.keys(projects).map((k) => projects[k])
    // 字段对齐家级灯 mergeSnapshot：updatedAt/lastAt 用 epoch ms（家级
    // Number(ISO)=NaN 会回退 Date.now()，导致 ok 永不超时）。
    const out = list.map((p) => ({
      cwd: p.cwd,
      name: p.name,
      state: p.state,
      running: p.running,
      current: p.current || null,
      trail: Array.isArray(p.trail) ? p.trail.slice(-12) : [],
      lastStatus: p.last ? p.last.status : null,
      lastAt: p.last ? Date.parse(p.last.at) || 0 : 0,
      lastConversationId: p.last ? p.last.conversationId : null,
      updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : (Date.parse(p.updatedAt) || 0)
    }))
    const dir = dirname(MCP_LIVE_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(MCP_LIVE_FILE, JSON.stringify({ from: 'mcp', writtenAt: Date.now(), projects: out }), 'utf8')
  } catch (e) { /* 家级灯桥接失败不影响 agy 调用本身 */ }
}

// Reuse the exact fallback cwd of the DSH plugin unless overridden.
const CWD_FALLBACK = process.env.AGY_MCP_CWD || 'C:\\Users\\lcl\\Desktop\\DSH'

const LIMIT_RE = /rate.?limit|ratelimit|429|too many|quota|insufficient|credit|balance|exhausted|exceed|network|offline|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|timeout|timed out|unavailable|503|502|500|401|403|unauthorized|invalid api|api key|connection|proxy|socket|tls|ssl|dns|网络|超时|限流|流量|受限|配额|金额|余额|额度|认证|连接|断开/i

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

// ── live status snapshot: per-project + global aggregation ───────────────────
// Each agy run belongs to a project (its cwd). agy_status reports one section
// per project; the global row aggregates everything (backward compatible).
const MAX_TRAIL = 12
const MAX_ARG_LEN = 120
const MAX_PROJECTS = 12
const projects = Object.create(null) // cwd -> project record

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
    p = { cwd: key, name: projectName(key), state: 'idle', running: 0, current: null, trail: [], last: null, updatedAt: 0 }
    projects[key] = p
  }
  return p
}

function nowIso() { return new Date().toISOString() }

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

function foldStepUpdate(ev, cwd) {
  const s = ev && ev.step_update
  if (!s) return
  const p = ensureProject(cwd)
  p.updatedAt = nowIso()
  if (s.step_type === 'tool') {
    const tool = s.tool_name || (s.tool_info && s.tool_info.name) || 'tool'
    const args = summarizeArgs(s.tool_info && s.tool_info.parameters)
    const entry = { stepIndex: s.step_index, state: s.state, tool, args, at: nowIso() }
    p.trail.push(entry)
    if (p.trail.length > MAX_TRAIL) p.trail.shift()
    if (s.state === 'ACTIVE') {
      p.current = { tool, args, stepIndex: s.step_index, since: nowIso() }
    } else if (p.current && p.current.stepIndex === s.step_index) {
      p.current = null
    }
  } else if (s.step_type === 'agent_response' && s.state === 'ACTIVE' && s.text_delta) {
    p.current = { tool: 'agent_response', args: { text_delta: String(s.text_delta).slice(0, MAX_ARG_LEN) }, stepIndex: s.step_index, since: nowIso() }
  }
  persistLive()
}

function foldResult(parsed, cwd) {
  const p = ensureProject(cwd)
  p.updatedAt = nowIso()
  p.last = {
    status: typeof parsed.status === 'string' ? parsed.status : 'UNKNOWN',
    conversationId: typeof parsed.conversation_id === 'string' ? parsed.conversation_id : null,
    at: nowIso()
  }
  p.state = p.running > 0 ? 'running' : (p.last && p.last.status === 'SUCCESS' ? 'ok' : (p.last ? 'failed' : 'idle'))
  persistLive()
}

function globalSnapshot() {
  const list = Object.keys(projects).map((k) => projects[k])
  let runningCount = 0, current = null, trail = [], last = null, updatedAt = 0
  for (const p of list) {
    runningCount += p.running
    if (p.updatedAt > updatedAt) updatedAt = p.updatedAt
    if (p.running > 0 && !current && p.current) current = p.current
    if (p.last && (!last || (p.last.at > last.at))) last = p.last
    for (const e of p.trail) trail.push(e)
  }
  trail.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  trail = trail.slice(-MAX_TRAIL)
  return {
    state: runningCount > 0 ? 'running' : (last ? (last.status === 'SUCCESS' ? 'ok' : 'failed') : 'idle'),
    runningCount,
    current,
    trail,
    last,
    updatedAt
  }
}

function snapshot(filterCwd) {
  const g = globalSnapshot()
  let list = Object.keys(projects).map((k) => projects[k]).sort((a, b) => (b.updatedAt < a.updatedAt ? -1 : b.updatedAt > a.updatedAt ? 1 : 0))
  if (filterCwd) list = list.filter((p) => p.cwd === String(filterCwd))
  const out = {
    state: g.state,
    runningCount: g.runningCount,
    current: g.current,
    trail: g.trail,
    last: g.last,
    updatedAt: g.updatedAt,
    projects: list.map((p) => ({ cwd: p.cwd, name: p.name, state: p.state, running: p.running, current: p.current, trail: p.trail.slice(-MAX_TRAIL), last: p.last, updatedAt: p.updatedAt }))
  }
  // owned JSON only — no references to live objects
  return JSON.parse(JSON.stringify(out))
}

// ── agy parsing (stream-json events + final result) ──────────────────────────
function parseAgyJson(stdoutText) {
  const trimmed = String(stdoutText || '').trim()
  if (!trimmed) return null
  // stream-json: the LAST line is {"event":"result","result":{...}}
  const lines = trimmed.split(/\r?\n/).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i].trim()
    if (!ln.startsWith('{')) continue
    try {
      const obj = JSON.parse(ln)
      if (obj && obj.event === 'result' && obj.result) return obj.result
      if (obj && obj.status && obj.response !== undefined) return obj
    } catch {}
  }
  // whole-string JSON fallback
  try { return JSON.parse(trimmed) } catch {}
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
      exitCode,
      mode,
      stderr
    }
  }
  return {
    ok: false, status: 'PARSE_ERROR', response: '', conversationId: null,
    durationSeconds: null, numTurns: null, totalTokens: null, exitCode,
    mode, stderr,
    rawStdout: String(stdoutText || '').slice(-2000)
  }
}

function buildArgv(exe, a) {
  const argv = [exe, '-p', String(a.prompt), '--output-format', 'stream-json', '--dangerously-skip-permissions']
  const timeoutSec = clampInt(a.timeoutSec, 300, 10, 3600)
  argv.push('--print-timeout', timeoutSec + 's')
  let mode = a.mode || 'accept-edits'
  if (mode === 'plan' || mode === 'accept-edits') argv.push('--mode', mode)
  if (a.model) argv.push('--model', String(a.model))
  if (a.effort) argv.push('--effort', String(a.effort))
  if (Array.isArray(a.addDirs)) for (const d of a.addDirs) { if (d) argv.push('--add-dir', String(d)) }
  if (a.conversationId) argv.push('--conversation', String(a.conversationId))
  else if (a.continueLatest) argv.push('--continue')
  return { argv, timeoutSec }
}

function runAgy(args) {
  return new Promise((resolve) => {
    const exe = process.platform === 'win32' ? 'agy.exe' : 'agy'
    const { argv, timeoutSec } = buildArgv(exe, args)
    const cwd = args.cwd ? resolvePath(String(args.cwd)) : CWD_FALLBACK
    let child
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (e) {
      resolve({ ok: false, status: 'SPAWN_ERROR', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: null, mode: args.mode || 'accept-edits', stderr: String(e && e.message || e) })
      return
    }
    const p = ensureProject(cwd)
    p.running += 1
    p.state = 'running'
    p.updatedAt = nowIso()
    persistLive()
    let out = '', err = ''
    let killed = false
    const timer = setTimeout(() => { killed = true; try { child.kill() } catch {} }, (timeoutSec + 60) * 1000)
    let lineBuf = ''
    child.stdout.on('data', (d) => {
      out += d
      if (out.length > 4_000_000) out = out.slice(-2_000_000)
      // parse NDJSON lines as they arrive (live observation)
      lineBuf += d
      let idx
      while ((idx = lineBuf.indexOf('\n')) >= 0) {
        const line = lineBuf.slice(0, idx)
        lineBuf = lineBuf.slice(idx + 1)
        const t = line.trim()
        if (!t.startsWith('{')) continue
        try {
          const obj = JSON.parse(t)
          if (obj && obj.event === 'step_update') foldStepUpdate(obj, cwd)
        } catch {}
      }
    })
    child.stderr.on('data', (d) => { err += d; if (err.length > 1_000_000) err = err.slice(-500_000) })
    child.on('error', (e) => {
      clearTimeout(timer)
      p.running = Math.max(0, p.running - 1)
      p.state = 'failed'
      p.updatedAt = nowIso()
      persistLive()
      resolve({ ok: false, status: 'AGY_UNAVAILABLE', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: null, mode: args.mode || 'accept-edits', stderr: 'agy spawn failed: ' + String(e && e.message || e) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      p.running = Math.max(0, p.running - 1)
      p.current = null
      const outcome = { exitCode: killed ? 124 : code }
      const parsed = parseAgyJson(out)
      if (parsed) foldResult(parsed, cwd)
      persistLive()
      let res = buildResult(parsed, outcome, args.mode || 'accept-edits', err, out)
      if (killed && !res.ok) {
        res.status = 'HUNG_TIMEOUT'
        res.stderr = (res.stderr ? res.stderr + ' ' : '') + '[killed by DSH timeout guard after ' + timeoutSec + 's; if this was a long-running script (build/test) raise timeoutSec]'
      }
      resolve(res)
    })
  })
}

function textResult(res) {
  if (res.fallback) {
    return { content: [{ type: 'text', text: 'agy unavailable (' + res.reason + '). Use native tools / the local model for this task; do not retry agy.' }] }
  }
  const limited = !res.ok && isLimited(res)
  const head = 'agy ' + (res.ok ? 'OK' : 'FAILED') + ' [status=' + res.status + ' mode=' + res.mode +
    (res.conversationId ? ' conv=' + res.conversationId : '') +
    (res.totalTokens != null ? ' tokens=' + res.totalTokens : '') +
    (res.durationSeconds != null ? ' ' + res.durationSeconds + 's' : '') + ']'
  let note = ''
  if (limited) note = '\n\n[Note: this looks like a rate-limit / network failure. Do NOT retry agy in a loop; finish the task with your own tools, or ask the user.]'
  const body = res.response || (res.stderr ? '[stderr] ' + res.stderr : (res.rawStdout ? '[raw] ' + res.rawStdout : ''))
  return { content: [{ type: 'text', text: head + (body ? '\n\n' + body : '') + note }] }
}

function statusText(filterCwd) {
  const s = snapshot(filterCwd)
  const lines = []
  lines.push('agy status: ' + s.state + (s.runningCount > 0 ? ' (' + s.runningCount + ' running)' : '') + (s.projects.length > 1 ? ' across ' + s.projects.length + ' projects' : ''))
  if (s.projects.length) {
    for (const p of s.projects) {
      const cur = p.current ? (' step ' + p.current.stepIndex + ' → ' + p.current.tool + (p.current.args ? ' ' + JSON.stringify(p.current.args) : '')) : (p.running > 0 ? ' (starting / thinking)' : '')
      lines.push('· ' + p.name + ' [' + p.state + (p.running > 0 ? ' ×' + p.running : '') + ']' + cur + (p.last ? ' | last=' + p.last.status + (p.last.conversationId ? ' ' + p.last.conversationId.slice(0, 8) : '') : ''))
      if (p.trail.length) {
        lines.push('    steps:')
        for (const e of p.trail.slice(-3)) {
          const a = e.args ? ' ' + JSON.stringify(e.args) : ''
          lines.push('      [' + e.state + '] step ' + e.stepIndex + ' ' + e.tool + a)
        }
      }
    }
  } else {
    if (s.current) {
      const c = s.current
      lines.push('current: step ' + c.stepIndex + ' → ' + c.tool + (c.args ? ' ' + JSON.stringify(c.args) : ''))
    } else if (s.state === 'running') {
      lines.push('current: (starting / thinking)')
    }
    if (s.trail.length) {
      lines.push('recent steps:')
      for (const e of s.trail.slice(-6)) {
        const a = e.args ? ' ' + JSON.stringify(e.args) : ''
        lines.push('  [' + e.state + '] step ' + e.stepIndex + ' ' + e.tool + a)
      }
    }
    if (s.last) lines.push('last: ' + s.last.status + (s.last.conversationId ? ' conv=' + s.last.conversationId : '') + ' @ ' + s.last.at)
  }
  if (s.updatedAt) lines.push('updatedAt: ' + s.updatedAt)
  return lines.join('\n')
}

const TOOLS = [
  {
    name: 'agy_run',
    description: 'Dispatch a coding/build/debug/investigation task to the local agy agent CLI and return its final answer. agy runs fully non-interactively (permissions auto-approved, never prompts). Prefer it for implementation, multi-file edits, refactors and debugging; use your own tools for quick read-only lookups and final build/test verification. mode=plan runs agy read-only; default accept-edits applies edits directly. While it runs, call agy_status to watch what agy is doing live.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The full task/instruction for agy. Be complete and self-contained.' },
        mode: { type: 'string', enum: ['plan', 'accept-edits'], description: 'plan = no writes; accept-edits = allow edits (default).' },
        model: { type: 'string', description: 'Optional agy model id — pick from the Gemini pool or utility models per the model-selection policy (use agy_quota to see the recommended:true list). Do NOT pass a Claude/GPT (3p) model.' },
        effort: { type: 'string', enum: ['low', 'medium', 'high'] },
        cwd: { type: 'string', description: 'Working directory for agy (default: AGY_MCP_CWD or the DSH workspace).' },
        addDirs: { type: 'array', items: { type: 'string' } },
        timeoutSec: { type: 'integer', description: '10-3600, default 300.' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'agy_continue',
    description: 'Continue an existing agy conversation with a follow-up prompt, reusing agy context. Pass conversationId from a prior agy_run result, or latest=true for the most recent conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        conversationId: { type: 'string' },
        latest: { type: 'boolean', description: 'Continue the most recent agy conversation.' },
        mode: { type: 'string', enum: ['plan', 'accept-edits'] },
        model: { type: 'string' },
        effort: { type: 'string', enum: ['low', 'medium', 'high'] },
        cwd: { type: 'string' },
        timeoutSec: { type: 'integer' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'agy_status',
    description: 'Read a live snapshot of what the local agy agent is currently doing. Returns one section per project (working directory): running count, the current step (tool name + arguments being executed, or agent_response thinking/typing), the recent step trail (tools executed, done/error), and the last completed run status + conversation id. Optional cwd filters to a single project. Call this to check on an in-flight agy_run/agy_continue without waiting for it to finish.',
    inputSchema: { type: 'object', properties: { cwd: { type: 'string', description: 'Optional: filter the snapshot to a single project (working directory).' } } }
  },
  {
    name: 'agy_quota',
    description: 'Query the Google AI plan (Antigravity OAuth consumer) quota pool behind the local agy CLI. Reads the Windows credential manager entry (gemini:antigravity) that agy wrote at login, refreshes the access token, then calls Google Cloud Code quota APIs: fetchAvailableModels (per-model remaining pool percentage) and retrieveUserQuotaSummary (grouped plan buckets: weekly + 5h windows). Each model carries family (gemini/claude/gpt/other) and recommended (false for Claude/GPT 3p models — do not pass those to agy_run; they are effectively unusable). Call before agy_run only if you want the numbers: the Gemini 5h window is the sole gate (agy_run/agy_continue already refuse silently below 10% of it), while the weekly window is NOT a per-task gate — an exhausted weekly bucket only means agy is a poor pick for the rest of the week, never a reason to abort or shrink the current task.',
    inputSchema: { type: 'object', properties: { summary: { type: 'boolean', description: 'Return only a compact summary (weekly buckets + top models).' } } }
  }
]

// 执行独立额度脚本 bin/agy-quota.mjs（凭据→刷新 token→fetchAvailableModels +
// retrieveUserQuotaSummary），stdout JSON。无 30 分钟缓存问题（MCP 每次调用实查，
// 成本可接受；如需缓存可后续加）。
function quotaScriptPath() {
  // fileURLToPath 而非 .pathname：路径含空格（"DSH Desktop"）时 .pathname
  // 会给出百分号编码（%20），且盘符正则只剥前导斜杠、保留 %20，导致脚本
  // 永远打不开 → agy_quota 恒报 no JSON output。
  const primary = fileURLToPath(new URL('../bin/agy-quota.mjs', import.meta.url))
  if (existsSync(primary)) return primary
  const fallback = 'C:\\Users\\lcl\\Desktop\\agy-first-bridge\\bin\\agy-quota.mjs'
  if (existsSync(fallback)) return fallback
  return primary // 不存在也返回，让 spawn 报真实错误
}
function execQuota() {
  return new Promise((resolve) => {
    const scriptPath = quotaScriptPath()
    const node = process.execPath || 'node'
    let out = ''
    let err = ''
    let child
    try {
      child = spawn(node, [scriptPath], { cwd: CWD_FALLBACK, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message || e) })
      return
    }
    const timer = setTimeout(() => { try { child.kill() } catch {} }, 60000)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: 'spawn: ' + String(e && e.message || e) }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const m = out.match(/\{[\s\S]*\}/)
      if (!m) { resolve({ ok: false, error: 'no JSON output (exit=' + code + '): ' + (out + ' ' + err).slice(0, 300) }); return }
      try { resolve(JSON.parse(m[0])) } catch (e) { resolve({ ok: false, error: 'parse: ' + e.message }) }
    })
  })
}

async function callTool(name, args) {
  if (name === 'agy_quota') {
    const res = await execQuota()
    const lines = []
    if (!res.ok) {
      lines.push('agy_quota failed: ' + String(res.error || 'unknown'))
    } else {
      lines.push('agy quota [tier=' + (res.tier || '?') + ']')
      for (const g of (res.groups || [])) {
        for (const b of (g.buckets || [])) {
          const pct = typeof b.remainingFraction === 'number' ? Math.round(b.remainingFraction * 100) : '?'
          lines.push('· ' + (b.bucketId || g.displayName || '') + ' [' + (b.window || '') + '] ' + pct + '%' + (b.resetTime ? ' reset=' + b.resetTime : ''))
        }
      }
      lines.push('models (pool %):')
      for (const m of (res.models || []).slice(0, 10)) { lines.push('  ' + (m.displayName || m.name) + ' : ' + m.percentage + '%' + (m.recommended === false ? ' [3p: Claude/GPT 不推荐]' : '') + (m.resetTime ? ' (reset ' + m.resetTime + ')' : '')) }
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }
  if (name === 'agy_status') {
    const a = args || {}
    return { content: [{ type: 'text', text: statusText(a.cwd) }] }
  }
  const a = args || {}
  if (!a.prompt || !String(a.prompt).trim()) {
    return { content: [{ type: 'text', text: 'agy error: prompt is required' }], isError: true }
  }
  const mapped = { ...a }
  if (name === 'agy_continue' && !mapped.conversationId && mapped.latest) mapped.continueLatest = true
  // v1.5.11 5h 硬阻断：Gemini 5h 池子 <10% → 不调用 agy，静默返回（不通知用户）。
  const block = await quotaBlock5h()
  if (block) return { content: [{ type: 'text', text: block }] }
  const res = await runAgy(mapped)
  const out = textResult(res)
  if (!res.ok && !res.fallback) out.isError = false
  return out
}

// 5h 硬阻断（v1.5.11）：Gemini 5h 池子余量 <10% 时返回阻断文案，否则 null。
// 带 30 分钟缓存（与 preset/dynamic 的 cachedQuotaCheck 一致；缓存额度数据本身，
// 每次调用从中计算阻断，避免反复刷新 token）。
let quotaBlockCache = { at: 0, data: null }
async function quotaBlock5h() {
  const now = Date.now()
  let q = quotaBlockCache.data
  if (!q || now - quotaBlockCache.at >= 30 * 60 * 1000) {
    try { q = await execQuota() } catch (e) { q = null }
    quotaBlockCache = { at: now, data: q }
  }
  if (!q || !q.ok) return null
  const fiveH = (q.groups || []).flatMap((g) => (g.buckets || [])
    .filter((b) => b.window === '5h' && (String(b.bucketId || '').toLowerCase().includes('gemini') || String(g.displayName || '').toLowerCase().includes('gemini')))
    .map((b) => ({ bucketId: b.bucketId, remainingFraction: b.remainingFraction, resetTime: b.resetTime })))
  const low5h = fiveH.find((b) => typeof b.remainingFraction === 'number' && b.remainingFraction < 0.10)
  if (!low5h) return null
  return 'agy 未调用（5h 池子额度 <10%）：Gemini 5h pool quota < 10% (' + Math.round(low5h.remainingFraction * 100) + '%, reset ' + (low5h.resetTime || '?') + '). Use native tools; do not call agy.'
}

// ── minimal JSON-RPC / MCP stdio plumbing ────────────────────────────────────
let buf = ''
function writeMsg(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}
function handleLine(line) {
  if (!line.trim()) return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  const { id, method, params } = msg
  const isReq = id !== undefined && id !== null
  const reply = (result) => writeMsg({ jsonrpc: '2.0', id, result })
  const replyErr = (code, message) => writeMsg({ jsonrpc: '2.0', id, error: { code, message } })

  if (method === 'initialize') {
    reply({
      protocolVersion: (params && params.protocolVersion) || PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: NAME, version: VERSION }
    })
    return
  }
  if (method === 'notifications/initialized' || (method || '').startsWith('notifications/')) return
  if (method === 'ping') { reply({}); return }
  if (method === 'tools/list') { reply({ tools: TOOLS }); return }
  if (method === 'tools/call') {
    const name = params && params.name
    if (!TOOLS.some((t) => t.name === name)) { replyErr(-32602, 'Unknown tool: ' + name); return }
    pendingCalls++
    callTool(name, params && params.arguments)
      .then(reply, (e) => replyErr(-32603, String(e && e.message || e)))
      .finally(() => { pendingCalls--; maybeExit() })
    return
  }
  if (method === 'resources/list') { reply({ resources: [] }); return }
  if (method === 'prompts/list') { reply({ prompts: [] }); return }
  if (isReq) replyErr(-32601, 'Method not found: ' + method)
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx)
    buf = buf.slice(idx + 1)
    try { handleLine(line) } catch (e) { /* keep server alive */ }
  }
})
// Track in-flight tool calls so stdin EOF does not kill pending work: MCP
// clients keep the pipe open, but a CLI probe may close stdin after writing
// its lines while a long agy run is still in flight. Only exit when the
// transport is gone AND no tool call is pending.
let pendingCalls = 0
let stdinClosed = false
function maybeExit() { if (stdinClosed && pendingCalls === 0) process.exit(0) }
process.stdin.on('end', () => { stdinClosed = true; maybeExit() })
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

// --check self-test: verify tool schema surface, no MCP handshake.
if (process.argv.includes('--check')) {
  const valid = TOOLS.every((t) => t.name && t.inputSchema && t.inputSchema.type === 'object')
  console.log(JSON.stringify({ ok: valid, server: NAME, version: VERSION, tools: TOOLS.map((t) => t.name) }, null, 2))
  process.exit(valid ? 0 : 1)
}
