# agy-first policy (agy-first-bridge MCP)

English | [中文](docs/MCP-POLICY.zh.md) — canonical copy; also installed into
`~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` on the authoring machine.

The local **`agy`** agent CLI is available to this host through the MCP server
`agy`, exposed as the tools **`agy_run`**, **`agy_continue`** and **`agy_status`**
(here they appear server-qualified as `mcp__agy__agy_run` /
`mcp__agy__agy_continue` / `mcp__agy__agy_status`).
agy runs **fully non-interactively under host control** — permissions are
auto-approved (`--dangerously-skip-permissions`), it never prompts, and it can
edit files, run builds, and investigate multi-file code.

## Priority rule — disclose and prefer

- For **real work** — implementing features, editing/refactoring code,
  debugging, running builds, multi-file investigation — **prefer dispatching the
  task to `agy_run` first**, with a complete, self-contained prompt.
- Use your own native read/write/shell tools mainly for **quick read-only
  lookups** and for the **final build/test verification** of what agy produced.
- When the task must not write files yet, call `agy_run` with `mode: "plan"`.
- For follow-ups on an existing task, use `agy_continue` with the
  `conversationId` from the previous result (or `latest: true`).
- When you delegate to a sub-agent, tell it to also prefer `agy_run`.
- While `agy_run`/`agy_continue` is running, you may call `agy_status` any time
  to see what agy is doing right now — reported per project (working
  directory), each with its current tool/step and recent trail — without
  waiting for it to finish.

## Fallback — never loop

When agy is **rate-limited or the network is down**, the tool result text says
so explicitly. **Do NOT retry agy in a loop.** Finish the task with your own
tools, or ask the user whether to fall back to the local model / API config.
Never ask agy to call back into this host.
