# agy MCP server — discoverable by any MCP-capable agent

[中文说明见下](#中文说明)

This directory ships a **standalone, dependency-free MCP (Model Context Protocol) server** that exposes the local `agy` CLI as two MCP tools:

| Tool | Purpose |
| --- | --- |
| `agy_run` | Dispatch a coding/build/debug/investigation task to the local agy CLI and return its final answer. |
| `agy_continue` | Continue an existing agy conversation (`conversationId`, or `latest: true`). |

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

## Self-test

```bash
node mcp/agy-mcp-server.mjs --check   # prints tool schema summary, exits 0
```

A full end-to-end probe (initialize → tools/list → a real `agy_run` returning `OK-FROM-AGY`) was executed during development; agy answered `status=SUCCESS` in ~4.7 s.

---

# 中文说明

本目录提供一个**独立的、零依赖的 MCP (Model Context Protocol) 服务器**，把本机 `agy` CLI 暴露为两个 MCP 工具：

| 工具 | 用途 |
| --- | --- |
| `agy_run` | 把编码/构建/调试/排查任务派发给本机 agy CLI，返回最终答复 |
| `agy_continue` | 继续已有的 agy 会话（`conversationId` 或 `latest: true`） |

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
