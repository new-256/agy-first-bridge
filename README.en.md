# agy-first-bridge

[简体中文](README.md) · **English**

> A Cordis plugin for the **DeepSeek Harness (DSH)** that makes the model **prefer the local `agy` CLI** for real work (coding, builds, debugging, multi-file investigation) across **every mode**. DSH stays fully in control of agy (`--dangerously-skip-permissions`, so agy never prompts). When agy is **rate-limited or the network is down**, it pops a confirmation dialog asking whether to fall back to the **DSH local API config**, and it shows a **live status light** in the session header indicating whether agy is currently working.

![agy status light states](assets/indicator-states.svg)

---

## What it is

`agy-first-bridge` contributes two things to a running DSH session:

1. **Three model tools** — `agy_run`, `agy_continue` and `agy_status`, which hand tasks to the local `agy` CLI.
2. **An agy-first policy prompt section** — instructs the model to prefer agy for real work in **all modes** (normal / plan / accept-edits / subagent / workflow / ralph / goal rounds); native tools are reserved for read-only lookups and final verification.

On top of that it implements the key capabilities that motivated the project:

- **Fallback mechanism (confirmation dialog):** when agy looks rate-limited or the network is unreachable, a dialog pops up offering *"use the DSH local API config (fall back)" / "retry agy once" / "do not fall back"*.
- **Live status lights (per project, start-up persistent):** coloured indicators on the right of the browser session header — **one per project (working directory)** — reflecting each project's agy activity in real time (working / ok / failed / fallback); hovering shows the step that project's agy is currently executing. The light is a **home-level plugin** ([`home-plugin/agy-indicator/`](home-plugin/agy-indicator/), registered via `cordis.patch.yml`): it loads automatically with DSH, appears in **every session**, and needs **no approval**.
- **Live observation (`agy_status`):** the `agy_status` tool returns a snapshot of what agy is doing RIGHT NOW, sectioned per project — each project's current step (tool name + arguments, or thinking/typing), recent step trail, last completed run. Optional `cwd` filters to one project. Callable mid-flight, no waiting.

## Four forms

The same logic ships in four forms; pick per need:

| Form | Location | Capabilities | Survives restart | Status light |
| --- | --- | --- | --- | --- |
| **Persistent agent preset** (recommended) | [`preset/agy-first/`](preset/agy-first/) | tools + policy + fallback dialog + `agy_status` | ✅ yes (persisted preset) | ❌ no (host-plane composition has no browser UI) |
| **Home-level status-light plugin** (start-up persistent) | [`home-plugin/agy-indicator/`](home-plugin/agy-indicator/) | status light (every session, no approval) | ✅ yes (cordis.patch.yml) | ✅ yes |
| **Dynamic Cordis plugin** (in-session) | [`dynamic/`](dynamic/) | tools + policy + fallback dialog + **status light** + `agy_status` | ❌ no (process-local) | ✅ yes (one-time approval) |
| **MCP server** (any MCP host) | [`mcp/`](mcp/) | `agy_run` / `agy_continue` / `agy_status` auto-discovered via `tools/list` by Claude Code, Codex, Cherry Studio, … | ✅ yes (registered in client config) | ❌ no |

> **Why does the status light need a home-level plugin?** An agent preset is a **host-plane** composition (`agent.cordis.yml` mounts host plugins), and its `.mjs` runs only on the Node side, so it inherently has no browser UI. The live status light is a **client-plane** (browser Slot) component. A **home-level plugin** (registered via `cordis.patch.yml`, e.g. [`home-plugin/agy-indicator/`](home-plugin/agy-indicator/)) provides both a host half (collecting agy status pushed by each session + an HTTP route) and a client half (the browser poll-and-render light), so it loads with DSH, appears in every session and needs no approval. The dynamic form's light (one-time GUI approval) and the home-level light can coexist: the dynamic form uses its own `host.call` RPC, the home-level one uses event push.
>
> The fallback dialog is a host-side capability and is present in **both** the preset and dynamic forms. The MCP form has no UI; on rate-limit it appends a "don't loop-retry" note to the result text and lets the calling agent decide.

See [docs/en/ARCHITECTURE.md](docs/en/ARCHITECTURE.md).

## Quick start

### Option A: install as a persistent agent preset (recommended)

Copy the whole `preset/agy-first/` directory into your DSH user preset root:

```
${DSH_HOME:-$HOME/.dsh}/.agent-presets/agy-first/
```

Windows example (this repo's dev environment):

```powershell
Copy-Item -Recurse .\preset\agy-first "$env:DSH_HOME\.agent-presets\agy-first"
```

Then start a new DSH session and select the preset named **`Agy-First 执行代理`** (id: `agy-first`). It inherits everything from the `standard` preset and adds the `agy_run` / `agy_continue` tools, the agy-first policy, and the rate-limit/network fallback dialog.

> ⚠️ **Do not** edit the shipped `agent-presets` install that ships with the deployment (an upgrade overwrites it). Always install under your **user** preset root as a separate subdirectory.

Full steps and validation are in [docs/en/INSTALL.md](docs/en/INSTALL.md).

### Option B: install the home-level status-light plugin (start-up persistent, every session)

Copy [`home-plugin/agy-indicator/`](home-plugin/agy-indicator/) into the DSH home plugin directory and register it in `cordis.patch.yml`; the light then loads automatically with DSH, appears in every session, and needs no approval:

```powershell
# 1) copy the plugin source
$dshHome = "$env:APPDATA\DSH Desktop\dsh-home"
Copy-Item -Recurse .\home-plugin\agy-indicator "$dshHome\plugins\agy-indicator"

# 2) create junctions (needed by both host resolution and the browser roster)
New-Item -ItemType Junction -Path "$dshHome\node_modules\agy-indicator" -Target "$dshHome\plugins\agy-indicator"
New-Item -ItemType Junction -Path "$dshHome\profiles\node_modules\agy-indicator" -Target "$dshHome\plugins\agy-indicator"

# 3) append two rows to cordis.patch.yml (HMR hot-reloads, no restart needed):
#    - insert:
#        - id: agy-indicator
#          name: file:///.../plugins/agy-indicator/lib/index.mjs?v=1
#    - insert:
#        - id: agy-indicator-client
#          name: agy-indicator
```

Pair it with the **preset form** (Option A): the preset's `agy-first-bridge.mjs` emits `ctx.emit('agy/status')` on every state change, which the home-level collector merges and the light renders. After editing `lib/index.mjs`, bump `?v=N` to hot-reload; after editing `lib/client.js`, refresh the browser.

### Option C: run as a dynamic Cordis plugin (with the status light)

In a DSH session that has Cordis capabilities loaded, define and activate the plugin with `cordis_define` + `cordis_run`, using [`dynamic/host.js`](dynamic/host.js) for the host half and [`dynamic/client.js`](dynamic/client.js) for the client half. The first time the client half runs, the DSH GUI asks for a one-time approval; once granted, the status light appears in the session header.

## Requirements

- **DeepSeek Harness (DSH)** with the needed host services mounted: `tools`, `subprocess`, `systemPrompt`, `timer` (optional: `jobs`, `planMode`, `sandboxPolicy`, `userQuestions`).
- A local **`agy` CLI** available on `PATH` (verified against v1.1.22 during development).
- The DSH Web GUI (client plane) is additionally required for the status light.

## Tool usage

`agy_run(prompt, mode?, model?, effort?, cwd?, addDirs?, timeoutSec?, background?)`

- `mode`: `auto` (default — follows DSH plan state, choosing `plan`/`accept-edits`), `plan`, `accept-edits`.
- `background: true`: run as a background job and return a `jobId`; collect via `job_output`.
- Returns: `{ ok, status, response, conversationId, durationSeconds, numTurns, totalTokens, exitCode, mode, stderr }`; on fallback it is `{ ok:false, fallback:true, status:'FALLBACK_TO_DSH', ... }`.

`agy_continue(prompt, conversationId? | latest?, ...)` — continue an existing agy conversation; other parameters as above.

`agy_status(cwd?)` — **live observation**: returns a snapshot of what agy is doing right now (`{ state, running, current, trail, lastStatus, lastConversationId, updatedAt, projects[] }`). `projects[]` is sectioned per project (working directory): `current` is the step that project is executing right now (tool name + arguments, or agent_response thinking/typing); `trail` is its recent step history. Optional `cwd` filters to one project. Callable while `agy_run`/`agy_continue` is in flight, no waiting.

## DSH fully controls agy

Every agy call is forced with `--dangerously-skip-permissions` and `--output-format stream-json`, so **agy never prompts and never asks before editing files**; mode, model, effort, working directory, timeout, background, and cancellation are all decided by DSH, and a run can be cancelled through `exec.signal` + `handle.terminate()`. Each `step_update` event from the stream feeds the `agy_status` snapshot in real time.

## Fallback & status light

See [docs/en/FALLBACK-AND-INDICATOR.md](docs/en/FALLBACK-AND-INDICATOR.md). Highlights:

- Failure detection: non-zero exit, or `stderr/response/status` matching `rate limit / 429 / quota / timeout / ECONN* / network / …` (plus Chinese equivalents).
- The dialog uses DSH's `userQuestions.ask()`; when there is no live human answerer (e.g. a delegated subagent) the dialog is skipped and an error is returned, avoiding a permanent block.
- At most 2 attempts (no loops); background failures do not open the dialog (re-run in the foreground to be prompted).
- The status light polls the host `agy_status` RPC every 1.2s; colours come from theme tokens and adapt to light/dark.

## Repository layout

```
agy-first-bridge/
├─ README.md / README.en.md
├─ LICENSE
├─ .gitignore
├─ package.json                    # version metadata (v1.5.12, Node >=18)
├─ MCP-POLICY.md                   # disclose-and-prefer policy for external agents (also ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md)
├─ .github/workflows/ci.yml       # node --check + YAML validation
├─ assets/indicator-states.svg    # status-light states diagram
├─ preset/
│  └─ agy-first/                   # persistent agent preset (recommended)
│     ├─ preset.yml
│     ├─ agent.cordis.yml          #   standard + one agy plugin row
│     └─ agy-first-bridge.mjs      #   self-contained, dependency-free host module
├─ home-plugin/
│  └─ agy-indicator/               # home-level status-light plugin (start-up persistent)
│     ├─ package.json              #   dsh.client declaration (browser roster)
│     └─ lib/
│        ├─ index.mjs              #   host half: collects agy/status events + HTTP route
│        └─ client.js              #   browser half: poll + render per-project light
├─ dynamic/                        # dynamic Cordis plugin form (with status light)
│  ├─ host.js                      #   code.host body
│  └─ client.js                    #   code.client body (browser status light)
├─ mcp/                            # MCP server (discoverable by any MCP host)
│  ├─ agy-mcp-server.mjs           #   zero-dependency stdio MCP server
│  └─ README.md                    #   registration (Claude Code / Codex / DSH / generic)
└─ docs/
   ├─ INSTALL.md / ARCHITECTURE.md / FALLBACK-AND-INDICATOR.md / CHANGELOG.md   (中文)
   └─ en/INSTALL.md / ARCHITECTURE.md / FALLBACK-AND-INDICATOR.md               (English)
```

## Versions & releases

Semantic versioning via `package.json` + Git tags + GitHub Releases (see [docs/CHANGELOG.md](docs/CHANGELOG.md)). Each release notes the **DSH version it was tested against**:

| Version | DSH | Highlights |
| --- | --- | --- |
| [v1.5.12](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.12) | 0.1.2-alpha.4 | **Fix agy_quota failing on paths containing spaces** (`DSH Desktop`): `new URL().pathname` percent-encodes spaces (`%20`) that the drive-letter regex cannot restore → switched to `fileURLToPath()` + fallback script path + exit-code/stderr in errors; fixed in both preset and MCP |
| [v1.5.11](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.11) | 0.1.1-rc.2 | **5h quota hard block**: when the Gemini 5h pool drops below 10%, agy_run/agy_continue silently refuse to call agy (QUOTA_BLOCKED, no dialog / no user notification) — finish with native tools; weekly <20% stays a soft hint |
| [v1.5.10](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.10) | 0.1.1-rc.2 | **Model selection policy**: DSH decides the agy model per task — agy_quota marks each model's family (gemini/claude/gpt/other + recommended); Claude/GPT (3p) marked not recommended and excluded from topModels; policyText says never pass Claude/GPT and send image tasks to agy without a model |
| [v1.5.9](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.9) | 0.1.1-rc.2 | **Google AI plan quota query**: new tool agy_quota (Windows credential → OAuth refresh → fetchAvailableModels/retrieveUserQuotaSummary); home light popup shows weekly quota; agy_run appends a caution note when weekly quota <20% |
| [v1.5.8](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.8) | 0.1.1-rc.2 | **Fix timeout misclassification**: agy timeout errors live in result.error ("timeout waiting for response") — now merged into stderr so network hangs correctly trigger the fallback dialog (previously silent FAILED) |
| [v1.5.7](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.7) | 0.1.1-rc.2 | **Hang-proofing**: forced process terminate + explicit HUNG_TIMEOUT with last-event summary; quota/auth error classification extended (quota/balance/401/403); dialog shows "no activity for Ns" |
| [v1.5.6](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.6) | 0.1.1-rc.2 | **Click-the-light live activity panel**: click the status light to open a details panel (current step / tool args / recent trail / last status), refreshed by the 1.2s poll; close via ×/overlay/Esc |
| [v1.5.5](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.5) | 0.1.1-rc.2 | **Legibility polish**: running dot uses static blue, ok uses static green; the light always says AGY (project name/step moved to tooltip) |
| [v1.5.4](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.4) | 0.1.1-rc.2 | **One app-wide light + mode-aware display**: dynamic form stops self-rendering, pushes state via the home-level `agyCollector`; preset form always on, normal mode shows temporarily after agy calls; **fix backend startup crash** (added `lib/client-entry.mjs` placeholder) |
| [v1.5.3](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.3) | 0.1.1-rc.2 | **Fix dynamic light reading no state**: `host.call` returns an invoke wrapper `{ok, value}`; the client must unwrap `value` — after the fix the dynamic light shows real state |
| [v1.5.2](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.2) | 0.1.1-rc.2 | **Fix dynamic agy_run rejected by Host guard**: dynamic sandbox lacks `ctx.emit` → `publish()` became a no-op; verified full light chain (ready → running → success) |
| [v1.5.1](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.1) | 0.1.1-rc.2 | **Fix blank window on session switch**: home-level light client uses native setInterval/clearInterval (unmount can no longer throw); Slot id changed to `agy-indicator-home` to avoid colliding with the dynamic plugin |
| [v1.5.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.0) | 0.1.1-rc.2 | **Status light starts with the software**: home-level plugin `agy-indicator` (registered via `cordis.patch.yml`, appears in every session, no approval); the preset emits status events to the home-level collector on every state change |
| [v1.4.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.4.0) | 0.1.1-rc.2 | **Per-project status lights**: snapshots grouped by project (cwd), one light per project in the UI, `agy_status` supports `cwd` filtering, verified with two concurrent projects |
| [v1.3.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.3.0) | 0.1.1-rc.2 | **Live observation**: all forms run agy with `stream-json` and parse `step_update` events; new `agy_status` tool (current step / trail / last run); status-light tooltip shows the current step |
| [v1.2.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.2.0) | 0.1.1-rc.2 | DSH auto-start (default preset `cordis-agy`), in-DSH MCP registration, external MCP registration (Claude Code / Codex), disclose-and-prefer policy, version management |
| [v1.1.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.1.0) | 0.1.1-rc.2 | Zero-dependency MCP server discoverable by any MCP host, CI extension |
| [v1.0.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.0.0) | 0.1.1-rc.2 | agy bridge tools, full DSH control, fallback dialog, status light, both forms, docs & CI |

## Security notes

- `--dangerously-skip-permissions` means agy will edit files and run commands without asking again. This is the direct implementation of the "DSH fully controls agy" requirement; use it only where you trust agy's execution environment.
- The plugin only registers into the host `tools` / `systemPrompt` registries and exposes one package-private read-only `agy_status` RPC; it publishes no cross-session service, so it is safe on the preset plane (no isolate realm needed).
- All side effects (tool registration, prompt section, styles, timers) are attached to the current fiber via `ctx.effect` / `ctx.tools.register` / `ctx.timeout`, and are cleaned up automatically on stop / update / undefine.

## License

[MIT](LICENSE) © 2026 chenglong
