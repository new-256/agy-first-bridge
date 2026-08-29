# Architecture

[简体中文](../ARCHITECTURE.md)

## Background: the two planes of DSH / Cordis

DSH capabilities are composed with Cordis; each capability is a plugin row in a `cordis.yml`. There are two planes:

- **Host plane**: runs in the DSH Node.js process; owns the registries, the sandbox and approval stack, persistence, the model route, the subagent registry, and anything shared across sessions. Files, networking, commands, Agent/Session access, host events and services, and model tools live here.
- **Client plane**: runs in the browser page; owns themes, layout, current page state, tool cards, and Slot UI.

An **agent preset** is what one session contributes to those registries — its tools, persona, and prompt sections. A row that publishes a service belongs to the host composition; a row that only registers into `tools` / `systemPrompt` and publishes no service is "preset-plane safe" (like `tool-fs`) and needs no isolate realm. This plugin is the latter kind.

Host and Client communicate only through package-private JSON RPC: the host exposes methods with `harness.handle(method, handler)` and the client calls them with `host.call(method, args)`. The direction is **Client → Host**.

## Component overview

```
                          ┌─────────────────────── DSH Host (Node.js) ───────────────────────┐
                          │                                                                  │
   model (any mode) ──tool call──▶ agy_run / agy_continue / agy_status                          │
                          │        │                                                          │
                          │        ├─ buildArgv: always --dangerously-skip-permissions        │
                          │        │              + --output-format stream-json + print-timeout
                          │        │              + mode(auto→plan/accept-edits)/model/...     │
                          │        │                                                          │
                          │        ├─ subprocess.spawn(agy ...) ──────────▶ local agy CLI     │
                          │        │      exec.signal + ctx.timeout→terminate() for cancel     │
                          │        │      parse step_update events → current/trail (live)      │
                          │        │                                                          │
                          │        ├─ parse trailing result event → { ok, status, resp, conv }│
                          │        │                                                          │
                          │        ├─ failed & rate-limited/network? ─▶ userQuestions.ask()    │
                          │        │        fallback → { fallback:true, FALLBACK_TO_DSH }      │
                          │        │        retry    → run once more (max 2)                   │
                          │        │                                                          │
                          │        └─ update status snapshot (begin/end + foldStepUpdate) ─┐   │
                          │                                               │                    │
                          │  systemPrompt.section('agy:policy')           │ harness.handle('agy_status')
                          │                                               │        ▲           │
                          └────────────────────────────────────────────────┼────────┼──────────┘
                                                                          │ host.call('agy_status') every 1.2s
                          ┌──────────────── DSH Client (browser) ──────────┼────────┼───────┐
                          │  session header Slot: conversation.session.header.utilities │    │
                          │       Indicator light ──────────────────────────────────────┘    │
                          │       ● working / ok / failed / fallback / idle (theme tokens)     │
                          │       tooltip: current step + recent trail                          │
                          └───────────────────────────────────────────────────────────────────┘
```

## Host half (`dynamic/host.js` / `preset/.../agy-first-bridge.mjs`)

- `inject: ['tools', 'subprocess', 'systemPrompt', 'timer']` — hard dependencies; the rest are read optionally with `ctx.get()` (`jobs` / `planMode` / `sandboxPolicy` / `userQuestions`).
- `buildArgv()` assembles the agy command line, **always** including `--dangerously-skip-permissions`, `--output-format stream-json`, and `--print-timeout <sec>s`; with `mode:auto` it reads `planMode` to choose `plan` vs `accept-edits`.
- `runSync()` executes through `subprocess.spawn`, forwarding the caller's `exec.signal` to the child and using `ctx.timeout(() => handle.terminate(), (timeout+60)s)` as a safety net. While running, `startLiveParser()` incrementally reads stdout via `ctx.interval` and folds `step_update` events into `status.current` / `status.trail` (`foldStepUpdate`) — this powers live observation.
- The background path runs through `jobs.start({ kind:'bash', owner: exec.agent, run() {...} })`; `run()` returns `{ cancel, done }`, and `done` parses the result and updates status (a live parser is attached there too).
- `parseAgyJson()` tolerantly parses agy's `stream-json` output (scanning backward for the trailing `{"event":"result","result":{...}}` line, tolerating log lines; whole-string JSON as a fallback).
- The result is a single plain JSON object; `render()` produces a human-readable tool card.
- `agy_status` tool / RPC returns the plain scalar snapshot `{ state, running, current, trail, lastStatus, lastConversationId, updatedAt, projects[] }`; `projects[]` is sectioned per project (cwd), each section carrying that project's `current` (the step executing right now — tool name + arguments, or agent_response thinking/typing), `trail`, `lastStatus`, etc.; the top-level fields are the global aggregation (backward compatible). A `cwd` argument filters to a single project.

### Key constraints (sandbox vs real Node)

| Constraint | Dynamic plugin (sandbox) | Preset `.mjs` (real Node) |
| --- | --- | --- |
| `import` / `require` | ❌ forbidden | ⚠️ available, but **cannot reach** `@deepseek-ai/*` (an upward search from the user home never finds the harness packages), so the module is **dependency-free** |
| `AbortController` | ❌ absent (use `exec.signal` + `handle.terminate()`) | ✅ present, but the same approach is kept for parity |
| `process` / `Buffer` / native timers | ❌ absent | ✅ present (unused) |
| Tool registration | `harness.registerTool(ctx, harness.defineTool({...}))` | `ctx.tools.register(<plain ToolDefinition object>)` |
| Host→Client RPC | `harness.handle('agy_status', ...)` | ⚠️ no client half, so not registered (and no consumer) |

> This is why, before v1.5.0, **the status light existed only in the dynamic form**: a preset is a host-plane composition whose `.mjs` runs only on the Node side and has no browser UI; the live light is a client-plane Slot component that must be loaded by the client half of a dynamic Cordis plugin. **v1.5.0 adds a home-level plugin form that solves persistence** (see below).

## Home-level status-light plugin (`home-plugin/agy-indicator/`, v1.5.0+)

The status light no longer depends on an in-session dynamic plugin (lost on restart); it is registered through `cordis.patch.yml` as a **home-level plugin** that starts with the software, appears in every session, and needs no approval:

```
In-session agy-first-bridge (preset, real Node module)          DSH Host (root realm)
  begin/end/foldStepUpdate ── ctx.emit('agy/status', {snapshot})
                                          │  (events are app-level broadcasts; isolate realms isolate services only)
                                          ▼
                        agy-indicator host half (lib/index.mjs)
                          ctx.on('agy/status') → global projects[cwd] table
                          webServer.register({kind:'exact', path:'/agy-indicator/status'})
                                          │  GET → JSON {state, running, projects[]}
                                          ▼
                        DSH Client (browser)
                          agy-indicator client half (lib/client.js, roster module)
                          fetch('/agy-indicator/status') every 1.2s → render one light per project
```

- host half `lib/index.mjs`: `ctx.on('agy/status')` collects snapshots and merges them by cwd into a global project table (idle projects untouched for 10 minutes are filtered out; max 24); exposes `GET /agy-indicator/status` via `webServer`.
- client half `lib/client.js`: `window.__ModuleLoader__.load({id, factory})` format (same as `dsh-model-status`), mounted in `conversation.session.header.utilities`, polls the HTTP route and renders.
- **Two data channels coexist**: the preset (real module) pushes via `ctx.emit` (standard Cordis API); the dynamic sandbox has no `ctx.emit`, so its client half uses its own `host.call('agy_status')` RPC. They do not interfere and show the same content.
- `cordis.patch.yml` hot-reloads via Cordis HMR: bump `?v=N` after editing `lib/index.mjs`; refresh the browser after editing `lib/client.js`.

## Client half (`dynamic/client.js`)

- `inject: ['timer']`, with `ctx.get('slots')` read optionally.
- Injects a stylesheet (with a pulse animation) via `styles.insert(css)`, wrapped in `ctx.effect` so it is cleaned up on unload.
- The `Indicator` component polls `host.call('agy_status')` every 1.2s inside `React.useEffect` via `ctx.interval(tick, 1200)`, rendering **one pill per project** (snapshot `projects[]`), each coloured by that project's `state` and labelled with the project name; its tooltip shows that project's `current` step and recent `trail`; the timer is disposed on unmount.
- Registered into the Slot `conversation.session.header.utilities` (session scope, list kind) with `id: 'agy-indicator'`.

## Lifecycle and reversibility

Every side effect is attached to the current fiber and reclaimed on `cordis_stop` / `cordis_undefine` / preset unload:

- tools: `ctx.tools.register(...)` / `harness.registerTool(...)` return disposers;
- prompt section: `ctx.systemPrompt.section(...)`;
- styles: `styles.insert(...)` (wrapped in `ctx.effect`);
- timers: `ctx.timeout(...)` / `ctx.interval(...)` return disposers.

## Data discipline

The plugin never serializes DSH live objects (Service / Event / Slot / Session). It reads only the leaf fields it needs (agy's stdout text, exit code, etc.) and builds the smallest owned JSON object, free of host references, to cross the RPC boundary and render.
