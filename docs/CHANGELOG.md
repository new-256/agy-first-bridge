# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

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
