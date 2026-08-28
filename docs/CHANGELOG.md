# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [1.1.0] - 2026

### Added
- **MCP 服务器**（`mcp/agy-mcp-server.mjs`）：零依赖 stdio MCP 服务器，把 `agy_run` / `agy_continue` 暴露给任何支持 MCP 的宿主（Claude Code / Codex / Cherry Studio…）。宿主代理通过 `tools/list` **自动发现**工具并**自主决定**是否调用——无需加载任何 agy-first preset。保持完全宿主控制（`--dangerously-skip-permissions`、JSON 输出、超时强杀）；限流/网络失败在结果文本中附加防循环提示（MCP 无 UI 弹窗，回退决策交给调用方）。已通过真实握手（initialize → tools/list → tools/call）与真实 `agy_run` 端到端验证。
- MCP 自检命令：`node mcp/agy-mcp-server.mjs --check`。
- 注册文档：`mcp/README.md`（Claude Code / Codex / 通用 JSON 配置、`AGY_MCP_CWD` 环境变量）。

### Fixed
- MCP 服务器在 stdin 提前关闭时不再杀死进行中的 agy 调用（等待 `pendingCalls` 归零后才退出）。

### Changed
- 本地部署：新增 `cordis-agy` 合并 preset（cordis 自改能力 + agy 优先）并设为 DSH 默认；该副本移除了 `tool-cordis` 行，避免在已运行 cordis 的进程里重复注册 inspect provider 导致挂载失败（原因与恢复方法记录在组合文件注释中）。

## [1.0.0] - 2026

首个发布版本。

### Added
- **agy 桥接工具**：`agy_run` 与 `agy_continue`，把编码/构建/调试/排查等任务派发给本机 `agy` CLI。
- **DSH 完全控制 agy**：每次调用强制 `--dangerously-skip-permissions` + `--output-format json` + `--print-timeout`；agy 全程无提示，模式/模型/effort/cwd/超时/后台/取消均由 DSH 决定。
- **agy 优先策略提示段**（`agy:policy`）：覆盖普通 / plan / accept-edits / 子代理 / workflow / ralph / goal 轮次等所有模式。
- **`mode:auto`**：读取 `planMode` 自动在 `plan` / `accept-edits` 间切换。
- **后台任务**：`background:true` 经 `jobs` 服务运行，返回 `jobId`，用 `job_output` 收结果。
- **限流 / 网络回退弹窗**：失败且疑似受限时经 `userQuestions.ask()` 弹窗，提供「使用 DSH 本地 API 配置（回退）/ 重试 / 不回退」；子代理无真人应答者时自动跳过，最多重试 2 次防循环，后台失败不弹窗。
- **实时状态灯**（动态形态）：会话标题栏 Slot 中的彩色指示灯，每 1.2s 轮询 Host `agy_status` RPC，展示 工作中 / 成功 / 失败 / 本地回退 / 就绪，颜色取自主题 token。
- **两种形态**：持久 Agent Preset（`preset/agy-first/`，随重启保留，含回退）与动态 Cordis 插件（`dynamic/`，含状态灯）。
- 文档：README、安装指南、架构、回退与状态灯说明。
- 英文文档：`README.en.md` 与 `docs/en/`（安装 / 架构 / 回退与状态灯）。
- 持续集成：`.github/workflows/ci.yml`，在 Node 18/20/22 上对所有源文件跑 `node --check`，并校验 preset YAML。
- 资源：`assets/indicator-states.svg`，展示状态灯各状态。

### Notes / Known limitations
- 状态灯仅在动态 Cordis 插件形态提供；Preset 形态为 Host 面组合，不含浏览器 UI（回退弹窗两种形态都有）。
- Preset 内的 `.mjs` 为零依赖自包含模块（用户目录无法解析 `@deepseek-ai/*`）。
- `--dangerously-skip-permissions` 意味着 agy 会无提示改文件/执行命令，请在信任的环境使用。
