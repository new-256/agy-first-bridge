# agy-first 策略（agy-first-bridge MCP）

[English](MCP-POLICY.md) · 中文 —— 权威副本；同时安装到 `~/.claude/CLAUDE.md` 与 `~/.codex/AGENTS.md`。

本机 **`agy`** 代理 CLI 通过 MCP 服务器 `agy` 对当前宿主可用，工具为 **`agy_run`**、**`agy_continue`** 与 **`agy_status`**（在本宿主中显示为服务器限定名 `mcp__agy__agy_run` / `mcp__agy__agy_continue` / `mcp__agy__agy_status`）。agy **在宿主的完全控制下全自动运行** —— 权限自动批准（`--dangerously-skip-permissions`）、从不弹提示，可改文件、跑构建、做跨文件排查。

## 优先规则 —— 决策表与上下文模式

### 工具选择决策
- **单次读取/glob/grep 或短命令（<30s）** → 使用宿主原生工具。
- **功能实现、代码编辑/重构、调试、跑构建、跨文件排查** → 优先调用 `agy_run`。
- **同一任务的后续跟进** → 调用 `agy_continue`（带上一次结果的 `conversationId` 或 `latest: true`，agy 自带会话上下文）。
- **对 agy 产物的最终构建/测试验证** → 使用宿主原生工具。
- **图像/视频生成** → 直接派发给 `agy_run` 且不指定模型（由 agy 自行选择）。

### 上下文协议（一个主题 = 一次 agy 会话）
- **主题首次派发**：包含紧凑的 CONTEXT 前置块（指向路径，不要粘贴文件全文；agy 会自行读取仓库；timeoutSec 默认 600s）：
  ```
  CONTEXT: 2-6 行 —— 目标；仓库根目录；关键路径；既有决策/约束；当前状态。
  TASK: 完整任务指令。
  ```
- **后续跟进**：调用 `agy_continue`，仅说明增量与新要求。
- 任务尚不允许写文件时，用 `agy_run` 且 `mode: "plan"`。
- 委派给子代理时，同样指示其优先调用 `agy_run`。
- `agy_run`/`agy_continue` 运行期间，可随时调用 `agy_status` 查看 agy 此刻在干什么（按项目/工作目录分节，含当前工具/步骤与最近轨迹），无需等待其结束。

## 回退 —— 禁止循环

当 agy **被限流或网络不通**时，工具结果文本会明确说明。**不要循环重试 agy**：用自身工具完成，或询问用户是否回退到本地模型 / API 配置。绝不让 agy 回调当前宿主。
