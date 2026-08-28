# Fallback mechanism & status light

[简体中文](../FALLBACK-AND-INDICATOR.md)

This document describes the two requested capabilities: the **fallback dialog when agy is limited**, and the **live status light**.

---

## 1. Fallback mechanism (confirmation dialog)

### Trigger

After each `agy_run` / `agy_continue` execution, if the result has `ok === false` and is judged "likely rate-limited / network down", the fallback dialog is triggered. `isLimited(res)` matches when any of the following holds:

- `status` is `SPAWN_ERROR` or `AGY_UNAVAILABLE` (process could not start / agy not found);
- the concatenation of `stderr` + `response` + `status` matches this regex (case-insensitive):

  ```
  rate limit / ratelimit / 429 / too many / quota / exceed /
  network / offline / ENETUNREACH / ECONNREFUSED / ECONNRESET /
  ETIMEDOUT / EAI_AGAIN / ENOTFOUND / timeout / timed out /
  unavailable / 503 / 502 / 500 / connection / proxy / socket /
  tls / ssl / dns / 网络 / 超时 / 限流 / 流量 / 受限 / 配额 / 连接 / 断开
  ```

### Dialog

A single-choice question is raised through DSH's `userQuestions.ask()`:

> **agy 受限** — agy call failed (likely rate-limited/network down, status=`<status>`). Switch to the DSH local API config and continue?

Three options:

| Option | Behaviour |
| --- | --- |
| **使用 DSH 本地 API 配置（回退）** (use DSH local API config / fall back) | Returns `{ ok:false, fallback:true, status:'FALLBACK_TO_DSH', reason:<original status> }`. The model then completes the task with **native tools / the local model** and does not call agy again. |
| **重试 agy 一次** (retry agy once) | Immediately runs agy once more (up to 2 attempts total). |
| **不回退（返回错误）** (do not fall back) | Returns the agy error as-is; the model decides what to do next. |

### Anti-block / anti-loop design

- **No dialog when there is no live human answerer.** `userQuestions.ask()` is valid only for the exact live runtime root. If the call comes from a delegated subagent (`exec.agent` is not the live root, or is owned by another agent), `ask()` throws `CALLER_NOT_LIVE` / `DELEGATED_CALLER`; the plugin catches it and treats it as `'error'` (no dialog, return the error), so a subagent never blocks forever. The same applies when the `userQuestions` service is absent.
- **At most 2 attempts.** The main loop stops at `attempt >= 2`, preventing repeated retries.
- **Background jobs do not prompt.** A `background:true` task runs asynchronously through `jobs`, and a human context may no longer be present at completion, so background failures do **not** open the dialog — the tool's return note also says "re-run in the foreground to be prompted".
- **agy never calls back into DSH.** The policy prompt explicitly forbids agy from calling back into DSH, avoiding loops.

### Model-side contract (prompt section)

The injected `agy:policy` section includes this contract so the model consumes the fallback result correctly:

> When agy is rate-limited or the network is down, agy_run/agy_continue automatically pop a dialog asking whether to use the DSH local API config. If the result has `fallback=true` (`status FALLBACK_TO_DSH`), the user chose to fall back: complete the task with native DSH tools / the local model and do **not** call agy again. If `ok=false` without `fallback`, report the agy error. Never loop agy calls; never ask agy to call back into DSH.

### Sequence

```
agy_run
  └─ runSync ──▶ result res
       ├─ res.ok?                         ──▶ return success
       ├─ !isLimited(res)?                ──▶ return error as-is
       └─ isLimited(res):
            askFallback(exec, res)
              ├─ no live human answerer   ──▶ return error
              ├─ "fall back"              ──▶ return { fallback:true, FALLBACK_TO_DSH }
              ├─ "retry" and attempt<2    ──▶ run once more
              └─ "do not fall back"       ──▶ return error as-is
```

---

## 2. Live status light (dynamic form only)

### Location and appearance

The light is registered in the Slot `conversation.session.header.utilities` on the right of the browser session header (`id: agy-indicator`). It is a small pill of "coloured dot + label"; hovering shows `state / running / last / conv` detail.

| `state` | Dot colour (theme token) | Label |
| --- | --- | --- |
| `running` | brand `--dsw-alias-brand-primary` (pulsing) | `AGY 工作中` (shows `×N` when several run concurrently) |
| `ok` | success `--dsw-alias-state-success-primary` | `AGY` |
| `failed` | error `--dsw-alias-state-error-primary` | `AGY 失败` |
| `fallback` | warning `--dsw-alias-state-warn-primary` | `本地回退` |
| `idle` | secondary label `--dsw-alias-label-secondary` | `AGY 就绪` |

All colours come from DSH theme tokens, so the light adapts to light/dark automatically.

### Data source

The host keeps an in-memory status snapshot **grouped by project (cwd)**, updating the relevant project before and after each agy call:

```js
projects[cwd] = { state, running, lastStatus, lastAt, lastConversationId, fallbackActive, current, trail, updatedAt }
begin(cwd)          // that project running++, state='running'
end(res, cwd)       // that project running--, set ok/failed/fallback from the result; clear current
foldStepUpdate(ev, cwd) // parse stream-json step_update events line by line → that project's current / trail
```

Each project's `current` is the step that project's agy is **executing right now** (tool name + arguments, or agent_response thinking/typing); `trail` is its recent step history. Both are filled incrementally while the run is in flight, so the indicator (one pill per project) and the `agy_status` tool can show "what agy is doing" *during* a run, not only after it.

The host exposes the read-only snapshot (global aggregation + `projects[]`) via `harness.handle('agy_status', () => snapshot())`; the client component pulls it every 1.2s with `ctx.interval` + `host.call('agy_status')` and re-renders per project, with each tooltip showing that project's `current` and recent `trail`. This is standard Client→Host package-private RPC, and the snapshot carries only scalar fields — no references to host live objects.

### One-time approval

The first time the client half runs, the DSH GUI requests approval (Cordis's single/double-check grant mechanism). Once granted, the light appears. If the session disables approval prompts, the client half is auto-rejected — the fallback dialog still works, just without the light.

### Why the preset form has no status light

A preset is a host-plane composition whose `.mjs` runs only on the Node side and carries no browser UI. Keeping a persistent status light in the preset form would require publishing a separate client plugin bundle (rebuilt with `pnpm run dev:web`), which is out of scope for this plugin. The fallback dialog is a host capability and is present in both forms.
