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
//
// DSH-style full control is kept: every invocation is non-interactive
// (--dangerously-skip-permissions, --output-format json, --print-timeout),
// so agy never prompts.
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
import { resolve as resolvePath } from 'node:path'

const NAME = 'agy-mcp-server'
const VERSION = '1.1.0'
const PROTOCOL = '2024-11-05'

// Reuse the exact fallback cwd of the DSH plugin unless overridden.
const CWD_FALLBACK = process.env.AGY_MCP_CWD || 'C:\\Users\\lcl\\Desktop\\DSH'

const LIMIT_RE = /rate.?limit|ratelimit|429|too many|quota|exceed|network|offline|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|timeout|timed out|unavailable|503|502|500|connection|proxy|socket|tls|ssl|dns|网络|超时|限流|流量|受限|配额|连接|断开/i

function isLimited(res) {
  if (!res || res.ok) return false
  if (res.status === 'SPAWN_ERROR' || res.status === 'AGY_UNAVAILABLE') return true
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

function parseAgyJson(stdoutText) {
  const trimmed = String(stdoutText || '').trim()
  if (trimmed) {
    try { return JSON.parse(trimmed) } catch {}
    const lines = trimmed.split(/\r?\n/).filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      const ln = lines[i].trim()
      if (ln.startsWith('{') && ln.endsWith('}')) {
        try { return JSON.parse(ln) } catch {}
      }
    }
  }
  return null
}

function buildResult(parsed, outcome, mode, stderrText, stdoutText) {
  const exitCode = outcome ? outcome.exitCode : null
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
      stderr: stderrText ? String(stderrText).slice(-2000) : ''
    }
  }
  return {
    ok: false, status: 'PARSE_ERROR', response: '', conversationId: null,
    durationSeconds: null, numTurns: null, totalTokens: null, exitCode,
    mode, stderr: stderrText ? String(stderrText).slice(-2000) : '',
    rawStdout: String(stdoutText || '').slice(-2000)
  }
}

function buildArgv(exe, a) {
  const argv = [exe, '-p', String(a.prompt), '--output-format', 'json', '--dangerously-skip-permissions']
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
    let out = '', err = ''
    let killed = false
    const timer = setTimeout(() => { killed = true; try { child.kill() } catch {} }, (timeoutSec + 60) * 1000)
    child.stdout.on('data', (d) => { out += d; if (out.length > 4_000_000) out = out.slice(-2_000_000) })
    child.stderr.on('data', (d) => { err += d; if (err.length > 1_000_000) err = err.slice(-500_000) })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, status: 'AGY_UNAVAILABLE', response: '', conversationId: null, durationSeconds: null, numTurns: null, totalTokens: null, exitCode: null, mode: args.mode || 'accept-edits', stderr: 'agy spawn failed: ' + String(e && e.message || e) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const outcome = { exitCode: killed ? 124 : code }
      const res = buildResult(parseAgyJson(out), outcome, args.mode || 'accept-edits', err, out)
      if (killed && !res.ok) res.stderr = (res.stderr ? res.stderr + ' ' : '') + '[killed by timeout guard]'
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

const TOOLS = [
  {
    name: 'agy_run',
    description: 'Dispatch a coding/build/debug/investigation task to the local agy agent CLI and return its final answer. agy runs fully non-interactively (permissions auto-approved, never prompts). Prefer it for implementation, multi-file edits, refactors and debugging; use your own tools for quick read-only lookups and final build/test verification. mode=plan runs agy read-only; default accept-edits applies edits directly.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The full task/instruction for agy. Be complete and self-contained.' },
        mode: { type: 'string', enum: ['plan', 'accept-edits'], description: 'plan = no writes; accept-edits = allow edits (default).' },
        model: { type: 'string', description: 'Optional agy model id.' },
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
  }
]

async function callTool(name, args) {
  const a = args || {}
  if (!a.prompt || !String(a.prompt).trim()) {
    return { content: [{ type: 'text', text: 'agy error: prompt is required' }], isError: true }
  }
  const mapped = { ...a }
  if (name === 'agy_continue' && !mapped.conversationId && mapped.latest) mapped.continueLatest = true
  const res = await runAgy(mapped)
  const out = textResult(res)
  if (!res.ok && !res.fallback) out.isError = false
  return out
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
  const valid = TOOLS.every((t) => t.name && t.inputSchema && t.inputSchema.type === 'object' && Array.isArray(t.inputSchema.required))
  console.log(JSON.stringify({ ok: valid, server: NAME, version: VERSION, tools: TOOLS.map((t) => t.name) }, null, 2))
  process.exit(valid ? 0 : 1)
}
