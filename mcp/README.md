# agy MCP server — discoverable by any MCP-capable agent

[中文说明见下](#中文说明)

This directory ships a **standalone, dependency-free MCP (Model Context Protocol) server** that exposes the local `agy` CLI as three MCP tools:

| Tool | Purpose |
| --- | --- |
| `agy_run` | Dispatch a coding/build/debug/investigation task to the local agy CLI and return its final answer. |
| `agy_continue` | Continue an existing agy conversation (`conversationId`, or `latest: true`). |
| `agy_status` | **Live observation**: what agy is doing RIGHT NOW (running count, current step = tool name + arguments or thinking/typing, recent step trail, last completed run). Call it mid-flight to watch progress. |

**Why:** the DSH plugin (preset / dynamic form) only exists inside DSH sessions. With the MCP server, *any* MCP-capable host — Claude Code, Codex, Cherry Studio, Cline, etc. — **discovers the tools itself** (`tools/list`) and decides when to call them, even when no "agy-first" preset is loaded. The agent stays in control of *whether* to delegate to agy; the server guarantees *how* agy runs.

## Live observation

agy runs with `--output-format stream-json`; each `step_update` event is parsed
on arrival and folded into an in-memory snapshot. Any agent can call
`agy_status` while `agy_run`/`agy_continue` is still in flight:

```
agy status: running (1 running)
current: step 4 → run_command {"CommandLine":"pwsh -Command Get-ChildItem …"}
recent steps:
  [ACTIVE] step 2 list_dir {"DirectoryPath":"C:\\Users\\lcl\\Desktop"}
  [DONE]   step 2 list_dir {"DirectoryPath":"C:\\Users\\lcl\\Desktop"}
last: ERROR conv=753f2cda-… @ 2026-08-28T10:27:55.958Z
```

No polling loops needed — the snapshot is owned by the server process and
exposed on demand.

**Why:** the DSH plugin (preset / dynamic form) only exists inside DSH sessions. With the MCP server, *any* MCP-capable host — Claude Code, Codex, Cherry Studio, Cline, etc. — **discovers the tools itself** (`tools/list`) and decides when to call them, even when no "agy-first" preset is loaded. The agent stays in control of *whether* to delegate to agy; the server guarantees *how* agy runs.

## Guarantees (same as the DSH plugin)

- **Full host control:** every invocation is non-interactive — `--dangerously-skip-permissions`, `--output-format json`, `--print-timeout <n>s`. agy never prompts; edits are applied without asking (mode `plan` runs read-only instead).
- **Timeout guard:** a kill timer at `timeoutSec + 60`; results are parsed from agy's JSON output (tolerant to extra log lines).
- **Rate-limit detection:** the tool result text is annotated when the failure matches the rate-limit/network regex, telling the agent **not to retry in a loop** and finish with its own tools (MCP has no UI dialog, so the fallback decision is left to the calling agent / user).
- **No dependencies:** one `.mjs` file, Node ≥ 18. No `npm install`.

## Register the server

Server command: `node <repo>/mcp/agy-mcp-server.mjs` (stdio transport).

### Claude Code

```bash
claude mcp add agy -- node "C:\Users\lcl\Desktop\agy-first-bridge\mcp\agy-mcp-server.mjs"
# project scope default; add -s user to make it available in every project
```

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.agy]
command = "node"
args = ["C:\\Users\\lcl\\Desktop\\agy-first-bridge\\mcp\\agy-mcp-server.mjs"]
```

### Generic MCP client (JSON)

```json
{
  "mcpServers": {
    "agy": {
      "command": "node",
      "args": ["C:\\Users\\lcl\\Desktop\\agy-first-bridge\\mcp\\agy-mcp-server.mjs"]
    }
  }
}
```

### Environment

- `AGY_MCP_CWD` — default working directory for agy calls that do not pass `cwd` (default `C:\Users\lcl\Desktop\DSH`).

### Disclose-and-prefer policy for external agents

Install [`MCP-POLICY.md`](../MCP-POLICY.md) (bilingual) into the global instruction
file of each MCP host so the agent **prefers** `mcp__agy__*` for real work and never
loops on rate-limit failures:

```bash
copy MCP-POLICY.md %USERPROFILE%\.claude\CLAUDE.md   # Claude Code (global memory)
copy MCP-POLICY.md %USERPROFILE%\.codex\AGENTS.md    # Codex
```

On this development machine both files are already installed.

### DSH itself (via `@deepseek-ai/dsh-mcp-client`)

Inside DSH, the same bridge is registered in the `cordis-agy` preset with one plugin row, so the model also sees the server-qualified native tools `mcp__agy__agy_run` / `mcp__agy__agy_continue`:

```yaml
- id: mcp-agy
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: agy
    transport: stdio
    command: node
    args: ['<stable copy>\agy-mcp-server.mjs']
    toolCallTimeoutMs: 600000
    failOnStartupError: false
```

`failOnStartupError: false` keeps a missing `agy` CLI from blocking session start; `toolCallTimeoutMs` covers long agy runs.

## Self-test

```bash
node mcp/agy-mcp-server.mjs --check   # prints tool schema summary, exits 0
```

A full end-to-end probe (initialize → tools/list → a real `agy_run` returning `OK-FROM-AGY`) was executed during development; agy answered `status=SUCCESS` in ~4.7 s.

---

# 中文说明

本目录提供一个**独立的、零依赖的 MCP (Model Context Protocol) 服务器**，把本机 `agy` CLI 暴露为三个 MCP 工具：

| 工具 | 用途 |
| --- | --- |
| `agy_run` | 把编码/构建/调试/排查任务派发给本机 agy CLI，返回最终答复 |
| `agy_continue` | 继续已有的 agy 会话（`conversationId` 或 `latest: true`） |
| `agy_status` | **实时观察**：agy 此刻在干什么（运行计数、当前步骤 = 工具名+参数或思考/打字中、最近步骤轨迹、最近完成运行）。运行中随时可查，无需等待结束 |

**用途：** DSH 插件（preset / 动态形态）只在 DSH 会话内存在。有了 MCP 服务器，任何支持 MCP 的宿主（Claude Code、Codex、Cherry Studio、Cline 等）都能通过 `tools/list` **自行发现**这些工具，并**自主决定**何时调用——即使当前没有加载任何 "agy-first" preset。是否委派给 agy 由调用方代理决定；服务器只保证 agy 的运行方式。

## 实时观察

agy 以 `--output-format stream-json` 运行；每个 `step_update` 事件到达即被解析并入内存快照。`agy_run`/`agy_continue` 仍在进行时，任何代理都能调用 `agy_status`：

```
agy status: running (1 running)
current: step 4 → run_command {"CommandLine":"pwsh -Command Get-ChildItem …"}
recent steps:
  [ACTIVE] step 2 list_dir {"DirectoryPath":"C:\\Users\\lcl\\Desktop"}
  [DONE]   step 2 list_dir {"DirectoryPath":"C:\\Users\\lcl\\Desktop"}
last: ERROR conv=753f2cda-… @ 2026-08-28T10:27:55.958Z
```

无需轮询——快照归服务器进程所有，按需返回。

**用途：** DSH 插件（preset / 动态形态）只在 DSH 会话内存在。有了 MCP 服务器，任何支持 MCP 的宿主（Claude Code、Codex、Cherry Studio、Cline 等）都能通过 `tools/list` **自行发现**这两个工具，并**自主决定**何时调用——即使当前没有加载任何 "agy-first" preset。是否委派给 agy 由调用方代理决定；服务器只保证 agy 的运行方式。

## 保证（与 DSH 插件一致）

- **宿主完全控制：** 所有调用均非交互——`--dangerously-skip-permissions`、`--output-format json`、`--print-timeout`。agy 绝不弹提示，直接改文件（`mode=plan` 时只读）。
- **超时守卫：** `timeoutSec + 60` 后强杀；agy 的 JSON 输出容忍日志行干扰。
- **限流检测：** 失败命中限流/网络正则时，在工具结果文本中附加提示，要求调用方**不要循环重试**、改用自身工具完成（MCP 无 UI 弹窗，回退决策交给调用方代理/用户）。
- **零依赖：** 单个 `.mjs` 文件，Node ≥ 18，无需 `npm install`。

## 注册服务器

服务器命令：`node <repo>/mcp/agy-mcp-server.mjs`（stdio 传输）。

### Claude Code

```bash
claude mcp add agy -- node "C:\Users\lcl\Desktop\agy-first-bridge\mcp\agy-mcp-server.mjs"
# 默认项目级；加 -s user 对所有项目生效
```

### Codex（`~/.codex/config.toml`）

```toml
[mcp_servers.agy]
command = "node"
args = ["C:\\Users\\lcl\\Desktop\\agy-first-bridge\\mcp\\agy-mcp-server.mjs"]
```

### 通用 MCP 客户端（JSON）

```json
{
  "mcpServers": {
    "agy": {
      "command": "node",
      "args": ["C:\\Users\\lcl\\Desktop\\agy-first-bridge\\mcp\\agy-mcp-server.mjs"]
    }
  }
}
```

### 环境变量

- `AGY_MCP_CWD` — 未传 `cwd` 时 agy 的默认工作目录（默认 `C:\Users\lcl\Desktop\DSH`）。

## 自检

```bash
node mcp/agy-mcp-server.mjs --check   # 打印工具 schema 摘要，退出码 0
```
