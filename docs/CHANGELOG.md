# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [1.5.0] - 2026

### Added
- **状态灯随软件启动（home-level `agy-indicator` 插件）**：状态灯不再依赖动态插件（重启即失）或 preset（无 UI），而是作为**家级插件**通过 `cordis.patch.yml` 注册（`dsh-home/plugins/agy-indicator/`，junction 到 `node_modules/agy-indicator` 与 `profiles/node_modules/agy-indicator`），随 DSH 启动自动加载、**所有会话自动显示**、无需审批。
  - host 半（`lib/index.mjs`）：`ctx.on('agy/status')` 收集各会话 agy-first-bridge 推送的快照，维护按 cwd 索引的全局项目表；经 `webServer` 注册 `GET /agy-indicator/status` 暴露 JSON；10 分钟未更新的 idle 项目自动过滤。
  - client 半（`lib/client.js`）：浏览器花名册模块（`window.__ModuleLoader__.load`），挂载 `conversation.session.header.utilities`，每 1.2s 轮询 HTTP 路由，按项目分别渲染状态灯（同 v1.4.0 样式：`⟳`/`✓`/`✗`/`↩` + 项目名）。
- **preset 形态推送状态**：`agy-first-bridge.mjs` 的 `begin`/`end`/`foldStepUpdate` 每次更新后 `ctx.emit('agy/status', { snapshot })`，供家级收集器合并。动态插件形态（沙箱无 `ctx.emit`）维持自身 client 半灯（`host.call('agy_status')`），无需家级推送。

### Notes
- `cordis.patch.yml` 通过 Cordis HMR 热重载：改 `lib/index.mjs` 后 bump `?v=N` 即生效，改 `lib/client.js` 后刷新浏览器即生效（无需重启 DSH）。

## [1.4.0] - 2026

### Added
- **UI 状态灯按项目分别显示（per-project status lights）**：状态快照按**项目（工作目录 cwd）**分组。DSH 会话标题栏渲染**每个项目一盏灯**（项目名 + 各自状态：工作中/成功/失败/回退），tooltip 显示该项目当前步骤与最近轨迹；`agy_status` 工具 / MCP 工具按项目分节返回，并支持 `cwd` 参数只查某个项目。
- 并发验证：两个 agy 任务在不同 cwd 同时运行，快照分别列出两个项目，各自的运行计数、当前步骤、轨迹与最近结果互不混淆。

### Changed
- 状态追踪由全局单例改为 per-project 表（`projects[cwd]`）+ 全局聚合（顶层字段保留，向后兼容）；项目按最近活动排序，最多保留 12 个项目。

## [1.3.0] - 2026

### Added
- **实时观察 agy 当前正在干什么（live observation）**：所有形态改用 `--output-format stream-json` 运行 agy，逐行解析 `step_update` 事件（`step_type`：tool / agent_response / user_input；`state`：ACTIVE / DONE / ERROR；`tool_name` + 参数）。
- **`agy_status` 工具**（三种形态统一）：返回实时快照 —— 运行计数、**当前正在执行的步骤**（工具名 + 参数，或 agent_response 思考/打字中）、最近步骤轨迹（执行的工具、完成/出错）、最近一次完成运行的状态与会话 id。可在 agy 运行期间随时调用，无需等待结束。
  - DSH preset（`preset/agy-first/`）与动态插件（`dynamic/host.js`）：新增模型工具 `agy_status`；状态灯（`dynamic/client.js`）tooltip 同步显示当前步骤与最近轨迹。
  - MCP 服务器（`mcp/agy-mcp-server.mjs`）：新增 `agy_status` MCP 工具，Claude Code / Codex 等宿主可随时查看 agy 在干什么。
- `agy:policy` 提示段与 `MCP-POLICY.md` 增加「可用 `agy_status` 观察进行中的 agy 运行」。

### Changed
- agy 输出格式由 `json` 改为 `stream-json`（兼容解析：末行为 `{"event":"result",...}`，容忍额外日志行）。

## [1.2.0] - 2026

### Added
- **DSH 随软件启动自动加载**：本地部署 `agent-presets.default` 已设为 `cordis-agy`（合并 preset：cordis 自改能力 + agy 优先 + MCP 桥）。新会话创建时自动挂载，无需手动选择。
- **DSH 内 MCP 补充注册**：`cordis-agy` preset 增加 `@deepseek-ai/dsh-mcp-client` 行，把同一 MCP 服务器注册为 DSH 原生工具（`mcp__agy__agy_run` / `mcp__agy__agy_continue`），`failOnStartupError: false` 保证 agy 缺失不阻塞会话启动。
- **外部软件 MCP 注册**：Claude Code（`claude mcp add -s user agy`，已 ✓ Connected）与 Codex（`~/.codex/config.toml` 的 `[mcp_servers.agy]`，已 enabled）。
- **披露并优先使用策略**：`MCP-POLICY.md`（中英双语）安装到 `~/.claude/CLAUDE.md` 与 `~/.codex/AGENTS.md`，要求外部代理优先调用 `mcp__agy__*` 做实际工作、禁止限流循环重试。
- **版本管理**：新增 `package.json`（v1.2.0，Node ≥18）；MCP 服务器自报版本升至 1.2.0；Git tag `v1.2.0` + GitHub Release。

### Changed
- MCP 服务器版本常量 `1.1.0` → `1.2.0`。
- 服务器稳定副本统一存放于 `dsh-home\bin\agy-mcp-server.mjs`（仓库删除不影响已注册的三端）。

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
