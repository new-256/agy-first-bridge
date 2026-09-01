# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [1.5.10] - 2026

### Added
- **模型选择策略**：DSH 根据任务需求自行决定 agy 用哪个模型（model 参数）。
  - gy_quota 输出每个模型的 amily（gemini/claude/gpt/other）与 ecommended（Claude/GPT 3p = false）；render 中 3p 标 [3p: Claude/GPT 不推荐]；--summary 的 topModels 只列推荐模型。
  - policyText 新增 Model selection policy 段：优先 Gemini 池子 / 工具模型（recommended:true），**不要向 agy_run 传 Claude/GPT (3p) 模型**（本套餐上基本不可用）。
  - **生图/图像编辑任务**：直接交给 agy_run 且**不指定 model**——agy 自行选择图像模型处理，不做过滤拦截。

### Notes
- 模型家族识别规则：name 含 claude → claude；含 gpt → gpt；含 gemini → gemini；其余 → other。
- 实测：28 模型中推荐 25 个（Gemini 21 + 工具类 4），Claude 2 + GPT 1 标不推荐。
## [1.5.9] - 2026

### Added
- **Google AI 套餐池子额度查询**（参考开源项目 [lbjlaq/Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) 的方法，已实测打通）：
  - 新增独立脚本 in/agy-quota.mjs：读 Windows 凭据管理器 gemini:antigravity（agy OAuth 登录时写入）→ 用 Antigravity 公开 OAuth client 刷新 access_token → 调 Google Cloud Code API：
    - etchAvailableModels：每模型池子剩余百分比（remainingFraction → %）；
    - etrieveUserQuotaSummary：分组套餐余量（weekly 周窗口 + 5h 快窗口）。
  - 新增工具 **gy_quota**（preset / 动态形态 / MCP 三处实现）：返回 { ok, models[], groups[], tier }；--summary 返回紧凑摘要。
  - **家级灯**：弹窗顶部显示周套餐余量（/agy-indicator/quota 路由，5 分钟缓存）；周额度 <20% 琥珀色警告。
  - **谨慎调用**：前台 gy_run 前 30 分钟缓存预检周余量，<20% 时在结果附 [quota] 警告（建议降低规模或先查 agy_quota）。
- 凭据读取用 csc.exe 现编译最小 C# 程序（规避本机 Add-Type 因 LIB 自引用失效的问题），编译产物缓存于 %TEMP%。

### Notes
- 实测本机数据：Gemini 周额度 27%（reset 09/03）、Claude/GPT 周 100%；每模型池子 98-100%。
- 动态形态的 agy_quota 随下次插件重定义生效（本次会话的旧动态插件不含该工具）。
## [1.5.8] - 2026

### Fixed
- **超时不再静默 FAILED**：实测发现 agy 超时时错误信息位于 result JSON 的 rror 字段（如 	imeout waiting for response），而非 stderr；此前 DSH 侧 isLimited 检测不到 → 网络挂起/超时只返回 FAILED 不弹回退窗。
- 现在 uildResult 将 parsed.error 并入 stderr → 	imeout 词命中 LIMIT_RE → 正确触发回退弹窗（可选 DSH 本地 API 继续 / 重试 / 返回错误）。
- 实测确认：agy 自身 --print-timeout 是有效的第一道防线（timeoutSec=10 + sleep 40 时 17s 退出，不无限等）；DSH 侧 	imeoutSec+60s 硬超时是第二道防线。
- 同步至 preset / 动态形态 / MCP 三种实现。
## [1.5.7] - 2026

### Fixed / Added
- **防死等加固（工作探测）**：
  - DSH 侧进程超时强制 terminate（	imeoutSec + 60s，绝不无限等）；超时时明确报 HUNG_TIMEOUT（区别于解析失败），并附**最后事件摘要**（最后步骤、最近轨迹、距上次活动秒数），便于区分"长任务正常"与"真卡死"。
  - 实测确认：agy 在后台长命令（如 sleep 40s / build）期间**不产生 step_update 事件**，因此**不做"无事件即杀"的心跳**（会误杀长任务）；以进程超时为唯一防线，长任务请调大 	imeoutSec。
  - HUNG_TIMEOUT 计入"受限"归类 → 触发回退弹窗（网络挂起场景）。
- **错误归类增强**：LIMIT_RE 补充额度/认证词（quota|insufficient|credit|balance|exhausted|401|403|unauthorized|金额|余额|额度|认证），额度耗尽/认证失败快速识别并触发回退，不再静默。
- **弹窗透明化**：家级详情弹窗显示每个运行项目"无活动 Ns"（>90s 琥珀色提示：长任务请耐心 / 疑似卡住可取消重试）。
- 同步至 preset / 动态形态 / MCP 三种实现。
## [1.5.6] - 2026

### Added
- **点击灯弹窗实时查看 agy 活动**：点击标题栏状态灯打开详情面板，逐项目显示：
  - 当前步骤（高亮）：当前: step N → 工具名 + 参数 JSON；
  - 最近步骤：最近 6 条轨迹（[ACTIVE/DONE] step N 工具 参数）；
  - 项目 cwd 与上次状态（last=SUCCESS + 会话号）。
  - 数据跟随 1.2s 轮询**自动刷新**，无需关闭重开；关闭方式：× 按钮 / 点击遮罩 / Esc。
  - 纯浏览器实现（原生 setInterval/clearInterval + React），不引入 Cordis ctx，保持切换会话不空白。
- 目视实测：运行中点击灯 → 面板实时显示 step → tool + 参数变化；完成后显示 ✓ + 轨迹。
## [1.5.5] - 2026

### Fixed
- **脉冲圆点颜色无辨识度**：--dsw-alias-brand-primary 实际解析为近黑色（ar(--dsw-static-neutral-bluish-1000) = #0f1115），running 圆点看起来是灰点。改用静态蓝 --dsw-static-blue-500 (#3b82f6)，ok 改用 --dsw-static-green-500 (#22c55e)。
- **灯文字显示项目名而非 AGY**（如 "⟳ DSH"）：统一显示 "AGY"（⟳ AGY / ✓ AGY / ✗ AGY / ↩ AGY），项目名与当前步骤移入 tooltip（project: DSH + 步骤轨迹）。
## [1.5.4] - 2026

### Added
- **全软件统一为一盏 agy 状态灯**：此前动态插件（当前会话）与家级插件（全局）各自渲染标题栏灯，普通模式下会出现两盏 "AGY 就绪"。v1.5.4 起动态形态**不再注册自己的灯**，改为通过家级 host 暴露的 `agyCollector` 服务（`ctx.provide('agyCollector', { mergeSnapshot })`）把快照推入**同一张全局表**，由家级灯统一显示——任何形态（preset 或动态）的 agy 活动都反映在同一盏灯上。
- **模式感知的显示策略**：
  - `presetActive=true`（有 agy 优先会话在线，preset 挂载时 `ctx.emit('agy/mode', {active:true})` 宣告、每 30s 续期）：家级灯**常驻**显示，无项目时显示占位 "AGY 就绪"。
  - `presetActive=false`（普通模式会话）：家级灯**仅调用 agy 时临时出现**——运行/回退期间显示，ok/failed 结果保留 8 秒后隐藏，空闲时标题栏无灯。

### Fixed
- **后端启动崩溃（`service "agyCollector" has been registered`）**：patch 中裸名行 `agy-indicator` 通过 `package.json` 的 `main` 解析，此前 `main` 指向 `lib/index.mjs`，导致同一份宿主逻辑被 file:// 行与裸名行加载成两个模块实例（ESM URL 不同），`apply` 执行两次、`ctx.provide('agyCollector')` 二次注册同名服务 → 后端启动失败。修复：新增 `lib/client-entry.mjs`（空操作占位），`main`/`exports["."]` 改指向该占位，裸名行只承担 client-modules 花名册扫描职责，宿主逻辑仅由 file:// 行加载；`index.mjs` 的 `provide` 加 try/catch 双保险。
- 目视实测（普通模式 + 动态形态）：空闲无灯 → `⟳ DSH` 品牌色脉冲（运行中）→ `✓ DSH` 绿点（完成后 8 秒）→ 灯消失。

## [1.5.3] - 2026

### Fixed
- **动态灯读不到状态（永远显示占位灰点 + `agy[undefined]undefined`）**：Cordis 动态插件的 `host.call` 返回 host-runner 的 invoke 包装 `{ ok, value }`，而非 handler 的原始结果。`dynamic/client.js` 此前直接把包装对象当作 snapshot 使用，`s.state`/`s.projects` 恒为 undefined，灯永远渲染占位符。已改为**解包 `value`**（防御性：仅当 `v.ok === true && 'value' in v` 时解包，否则原样使用）。修复后动态灯显示真实状态：`⟳ 项目名`（工作中，品牌色脉冲）、`✓ 项目名`（成功，绿点）、`✗`/`↩`，悬浮 tooltip 显示当前步骤与最近轨迹。
- 目视实测（真实 agy 调用）：标题栏灯 就绪 → `⟳ DSH` 脉冲 → `✓ DSH`（last=SUCCESS）。

## [1.5.2] - 2026

### Fixed
- **动态形态 agy_run 触发 Host guard 拒绝**：Cordis 动态插件沙箱不暴露 `ctx.emit`（runner guard 拒绝任何访问并产生告警）。`dynamic/host.js` 此前在 `publish()` 中调用 `ctx.emit`，虽被 try/catch 包裹，仍会污染运行时状态。已改为 **no-op**：动态形态不推送事件（其浏览器灯通过 `harness.handle('agy_status')` RPC 读取快照），preset 形态（真 Node 模块）保留真实 `ctx.emit` 推送。
- 目视实测（真实 agy 调用）确认状态灯全链路：标题栏灯 就绪（灰点）→ `⟳ DSH` 工作中（品牌色脉冲）→ `✓ DSH` 成功（绿点，last=SUCCESS）。

## [1.5.1] - 2026

### Fixed
- **切换会话（对话任务）时窗口空白**：家级 `agy-indicator` 的 client 半（`lib/client.js`）在组件卸载清理中曾依赖 Cordis `ctx.interval` 的 disposer；若其形态与预期不符，卸载会抛错，导致 React 渲染树崩溃、对话窗口空白。已改为**浏览器原生 `setInterval`/`clearInterval`**（组件内零 `ctx` 引用），卸载清理必然成功；`apply` 改用产品同款 `ctx.inject(['slots'], ...)` 等待服务就绪模式。
- **家级灯与动态插件灯同 slot 撞 id**：家级 client 的 Slot id 由 `agy-indicator` 改为 **`agy-indicator-home`**，避免与动态插件形态（`dynamic/client.js`，id `agy-indicator`）同时运行时在同一 slot 冲突。

### Changed
- `home-plugin/agy-indicator/lib/client.js` 重写（对齐 dsh-model-status 成熟模式）；部署副本已同步，花名册热更新，刷新浏览器即生效。

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
