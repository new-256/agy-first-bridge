# agy-first-bridge

**简体中文** · [English](README.en.md)

> 一个用于 **DeepSeek Harness (DSH)** 的 Cordis 插件：把编码/构建/调试/排查等实际工作**优先派发给本机的 `agy` CLI**，DSH 全程掌控 agy（`--dangerously-skip-permissions`，agy 全程无提示），并在 **agy 流量受限 / 网络不通** 时弹窗让用户选择是否回退到 **DSH 本地 API 配置**；同时在会话标题栏提供一个 **实时状态灯**，清晰显示 agy 是否正在工作。

![agy 状态灯的几种状态](assets/indicator-states.svg)

---

## 这是什么

`agy-first-bridge` 给运行中的 DSH 会话注入两样东西：

1. **三个模型工具** —— `agy_run`、`agy_continue` 与 `agy_status`，把任务转交给本机 `agy` CLI 执行；
2. **一段 agy 优先策略提示** —— 让模型在**所有模式**（普通 / plan / accept-edits / 子代理 / workflow / ralph / goal 轮次）下都优先调用 agy 做实际工作，原生工具只用于只读查询和最终验证。

在此基础上，本插件还实现了用户要求的几项关键能力：

- **回退机制（弹窗确认）**：当 agy 疑似被限流或网络不通时，自动弹出确认框，让用户选择「使用 DSH 本地 API 配置（回退）」/「重试 agy 一次」/「不回退」。
- **实时状态灯（按项目，随软件启动）**：浏览器会话标题栏右侧的彩色指示灯**为每个项目（工作目录）分别显示一盏**，随该项目 agy 活动实时变化（工作中 / 成功 / 失败 / 本地回退），悬停可查看该项目**当前正在执行的步骤**。状态灯是**家级插件**（[`home-plugin/agy-indicator/`](home-plugin/agy-indicator/)，经 `cordis.patch.yml` 注册），随 DSH 启动自动加载、所有会话自动显示、无需审批。
- **实时观察（agy_status）**：`agy_status` 工具随时返回各项目 agy 此刻在干什么 —— 每个项目当前步骤（工具名 + 参数或思考/打字中）、最近步骤轨迹、最近完成运行。支持 `cwd` 参数只看某个项目。运行中即可调用，无需等待结束。

## 四种形态

同一套逻辑提供四种落地形态，按需选择：

| 形态 | 位置 | 能力 | 是否随进程重启保留 | 状态灯 |
| --- | --- | --- | --- | --- |
| **持久 Agent Preset**（DSH 内推荐） | [`preset/agy-first/`](preset/agy-first/) | 工具 + 优先策略 + 回退弹窗 + `agy_status` | ✅ 是（落盘为 preset） | ❌ 无（Host 面组合不含浏览器 UI） |
| **家级状态灯插件**（随软件启动） | [`home-plugin/agy-indicator/`](home-plugin/agy-indicator/) | 状态灯（所有会话自动显示，无需审批） | ✅ 是（cordis.patch.yml 注册） | ✅ 有 |
| **动态 Cordis 插件**（当前会话） | [`dynamic/`](dynamic/) | 工具 + 优先策略 + 回退弹窗 + **状态灯** + `agy_status` | ❌ 否（进程内临时） | ✅ 有（需一次性审批） |
| **MCP 服务器**（任何 MCP 宿主） | [`mcp/`](mcp/) | `agy_run` / `agy_continue` / `agy_status` 通过 `tools/list` 被 Claude Code、Codex、Cherry Studio 等**自动发现**，由宿主代理自主决定是否调用 | ✅ 是（注册进客户端配置） | ❌ 无 |

> **状态灯为什么需要家级插件？** Agent Preset 是 **Host 面** 组合（`agent.cordis.yml` 挂载 Host 插件），其中的 `.mjs` 只在 Node 侧运行，天然不含浏览器 UI；而实时状态灯是 **Client 面**（浏览器 Slot）组件。**家级插件**（`cordis.patch.yml` 注册，如 `home-plugin/agy-indicator/`）同时提供 Host 半（收集各会话推送的 agy 状态 + HTTP 路由）与 Client 半（浏览器轮询渲染），随 DSH 启动自动加载、所有会话自动显示、无需审批。动态插件形态（首次运行需 GUI 一次性审批）与家级形态的灯可并存：动态形态用自己的 host.call RPC，家级形态用事件推送。
>
> 回退弹窗是 Host 侧能力，preset 与动态两种形态都具备；MCP 形态没有 UI，限流时改为在结果文本中附加「勿循环重试」提示，由调用方代理决定回退。

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 经 npm 安装（v1.6.0+）

本包发布在 npm（`agy-first-bridge`，零运行时依赖），**全套组件（连通器 + 灯 + MCP + 动态插件）单包分发**：

```powershell
npm install -g agy-first-bridge
# 或仅本地安装：npm install agy-first-bridge
```

- **MCP 服务器**：全局安装后直接用 bin —— `agy-mcp-server`（或免安装 `npx agy-first-bridge` 的 bin）：
  ```bash
  claude mcp add agy -- agy-mcp-server
  ```
- **Agent Preset**：把 `node_modules/agy-first-bridge/preset/agy-first/`（全局安装则在 npm 全局目录下）复制到 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/agy-first/`，与方式 A 相同。
- **额度门禁脚本**：preset 被复制出包目录后，设置环境变量让 5h 门禁继续生效：
  ```powershell
  $env:AGY_QUOTA_SCRIPT = "<npm包路径>\bin\agy-quota.mjs"
  ```
  （不设置时门禁静默跳过，限流仍有回退弹窗兜底。）
- **家级状态灯（标准安装，v1.6.0 起并入主包）**：
  ```powershell
  dsh plugin --profile web add agy-first-bridge
  ```
  主包 `package.json` 自带 DSH 插件面（`main` → 灯 Host 半、`exports` 双面、`dsh.bundle.patch` → 包内 `home-plugin/agy-indicator/cordis.patch.yml`），安装后 bundle 层自动挂载灯。独立 npm 包 `agy-indicator` 自 v1.6.0 起**弃用留档**（不再更新），旧式安装（复制目录 + junction + 用户层裸包名 `agy-indicator`）仍受支持。

> preset 组合遵循 DSH 0.1.3-alpha.2+ 的 `dsh-persona` 校验（`config.prefix` 必填 + `config.suffix` 可选）；更早版本同样兼容。

## 快速开始

### 方式 A：作为持久 Agent Preset 安装（推荐）

把 `preset/agy-first/` 整个目录复制到你的 DSH 用户 preset 根目录下：

```
${DSH_HOME:-$HOME/.dsh}/.agent-presets/agy-first/
```

Windows 示例（本仓库开发环境）：

```powershell
Copy-Item -Recurse .\preset\agy-first "$env:DSH_HOME\.agent-presets\agy-first"
```

然后新开一个 DSH 会话，选择名为 **`Agy-First 执行代理`**（id：`agy-first`）的 preset 即可。它继承 `standard` preset 的全部能力，额外提供 `agy_run` / `agy_continue` 工具、agy 优先策略与限流/网络回退弹窗。

> ⚠️ **不要**编辑随部署一起发行的 `agent-presets` 安装目录（升级会覆盖）。始终安装到用户 preset 根目录下的独立子目录。

完整步骤与校验方法见 [docs/INSTALL.md](docs/INSTALL.md)。

### 方式 B：安装家级状态灯插件（随软件启动、所有会话可见）

**v1.6.0 起灯并入主包**：主包 `agy-first-bridge` 的 `package.json` 自带 DSH 插件面——`main` → `home-plugin/agy-indicator/lib/index.mjs`（Host 半入口）、`exports["./client"]` → 灯 `client.js`（浏览器半）、`dsh.bundle.patch` → 包内 `cordis.patch.yml`（bundle 补丁层，安装后自动挂载）。Host 行用**裸包名**注册，Client 半靠 `dsh.client` 声明被宿主 client-modules 自动纳入浏览器花名册——**无需单独 client 行**。独立 npm 包 `agy-indicator` 弃用留档。

**本机开发部署**（junction 直连源码目录，改动即热载）：

```powershell
# 1) 复制插件源码
$dshHome = "$env:APPDATA\DSH Desktop\dsh-home"
Copy-Item -Recurse .\home-plugin\agy-indicator "$dshHome\plugins\agy-indicator"

# 2) 建 junction（host 解析与浏览器花名册都需要）
New-Item -ItemType Junction -Path "$dshHome\node_modules\agy-indicator" -Target "$dshHome\plugins\agy-indicator"
New-Item -ItemType Junction -Path "$dshHome\profiles\node_modules\agy-indicator" -Target "$dshHome\plugins\agy-indicator"

# 3) 在 cordis.patch.yml 追加 host 行（裸包名，HMR 自动热载）：
#    - insert:
#        - id: agy-indicator
#          name: agy-indicator
```

**跨设备分发**（npm 安装主包，标准形态）：

```powershell
dsh plugin --profile web add agy-first-bridge
```

主包内 `home-plugin/agy-indicator/cordis.patch.yml`（bundle 层）自带通用默认行；机器特定配置写到用户层 `cordis.patch.yml` 的同 id 行（后应用、整体覆盖）。旧式 `dsh plugin --profile web add agy-indicator`（独立包）仍可用于已安装旧版的环境，但包不再更新。

配合 **preset 形态**（方式 A）使用：preset 里的 `agy-first-bridge.mjs` 每次状态变化会 `ctx.emit('agy/status')` 推送到家级收集器，灯随之实时更新；改 `lib/client.js` 后刷新浏览器即生效。Host 半源码（`lib/index.mjs`）改动后需重启 DSH 生效；开发期可把 name 临时改成 `agy-indicator?v=N` 触发热重载（DSH HMR 监听 patch 文件，URL 变化即重新 import），改完一轮后恢复裸包名。

### 方式 C：作为动态 Cordis 插件运行（含状态灯）

在一个已加载 Cordis 能力的 DSH 会话里，用 `cordis_define` + `cordis_run` 定义并激活插件，Host 半用 [`dynamic/host.js`](dynamic/host.js)，Client 半用 [`dynamic/client.js`](dynamic/client.js)。首次运行 Client 半时，DSH GUI 会请求一次性审批，批准后状态灯即出现在会话标题栏。

### 方式 D：作为 MCP 服务器注册（任何 MCP 宿主可发现）

不需要 DSH 时，把 [`mcp/agy-mcp-server.mjs`](mcp/agy-mcp-server.mjs) 注册为 MCP 服务器，Claude Code / Codex / Cherry Studio 等宿主即可通过 `tools/list` 自动发现 `agy_run` / `agy_continue` / `agy_status` 并自主决定调用：

```bash
# Claude Code 示例（npm 安装后可直接用 bin）
claude mcp add agy -- agy-mcp-server
# 或免安装 npx / 本仓库开发环境
claude mcp add agy -- npx -y agy-first-bridge
claude mcp add agy -- node "C:\Users\lcl\Desktop\agy-first-bridge\mcp\agy-mcp-server.mjs"
```

Codex / 通用 JSON 配置、环境变量与自检见 [`mcp/README.md`](mcp/README.md)。

## 依赖前提

- **DeepSeek Harness (DSH)**，且会话已挂载所需 Host 服务：`tools`、`subprocess`、`systemPrompt`、`timer`（可选 `jobs`、`planMode`、`sandboxPolicy`、`userQuestions`）。
- 本机已安装并在 `PATH` 中可用的 **`agy` CLI**（开发时验证版本 v1.1.22）。
- 状态灯还需 DSH 的 Web GUI（Client 面）。

## 工具用法

`agy_run(prompt, mode?, model?, effort?, cwd?, addDirs?, timeoutSec?, background?)`

- `mode`：`auto`（默认，跟随 DSH plan 状态自动选 `plan`/`accept-edits`）、`plan`、`accept-edits`。
- `background: true`：作为后台任务运行，立即返回 `jobId`，用 `job_output` 收结果。
- 返回：`{ ok, status, response, conversationId, durationSeconds, numTurns, totalTokens, exitCode, mode, stderr }`；回退时为 `{ ok:false, fallback:true, status:'FALLBACK_TO_DSH', ... }`。

`agy_continue(prompt, conversationId? | latest?, ...)` —— 复用某个 agy 会话上下文继续对话，其余参数同上。

`agy_status(cwd?)` —— **实时观察**：返回各项目 agy 此刻在干什么（`{ state, running, current, trail, lastStatus, lastConversationId, updatedAt, projects[] }`）。`projects[]` 按项目（工作目录）分节：`current` 为该项目当前正在执行的步骤（工具名 + 参数，或 agent_response 思考/打字中），`trail` 为最近步骤轨迹。可选 `cwd` 只查某个项目。`agy_run`/`agy_continue` 运行期间即可调用，无需等待结束。

## DSH 完全控制 agy

每次调用 agy 都强制带 `--dangerously-skip-permissions` 与 `--output-format stream-json`，因此 **agy 从不弹权限提示，改文件也不询问**；模式、模型、effort、工作目录、超时、是否后台、能否中止全部由 DSH 侧决定，可通过 `exec.signal` + `handle.terminate()` 取消。`stream-json` 的每个 `step_update` 事件实时喂给 `agy_status` 快照。

## 回退与状态灯

见 [docs/FALLBACK-AND-INDICATOR.md](docs/FALLBACK-AND-INDICATOR.md)。要点：

- 失败识别：非零退出，或 `stderr/response/status` 命中 `rate limit / 429 / quota / timeout / ECONN* / 网络 / 超时 / 限流 / 配额 …` 等特征。
- 弹窗通过 DSH 的 `userQuestions.ask()` 实现；被子代理调用（无真人应答者）时自动跳过弹窗、按错误返回，避免永久阻塞。
- 最多重试 2 次，杜绝循环；后台任务失败不弹窗（前台重跑才提示）。
- 状态灯每 1.2s 轮询 Host 的 `agy_status` RPC，颜色取自主题 token，自动适配明暗。

## 目录结构

```
agy-first-bridge/
├─ README.md
├─ README.en.md
├─ LICENSE
├─ .gitignore
├─ package.json                 # 版本元数据（v1.5.15，Node ≥18）
├─ MCP-POLICY.md / MCP-POLICY.zh.md   # 外部代理「披露并优先」策略（安装到 ~/.claude/CLAUDE.md 与 ~/.codex/AGENTS.md）
├─ .github/workflows/ci.yml     # node --check + YAML 校验（Node 18/20/22）
├─ assets/indicator-states.svg
├─ preset/
│  └─ agy-first/                 # 持久 Agent Preset（DSH 内推荐形态）
│     ├─ preset.yml              #   名称/描述
│     ├─ agent.cordis.yml        #   组合：standard + 一行 agy 插件
│     └─ agy-first-bridge.mjs    #   自包含、零依赖的 Host 插件模块
├─ home-plugin/
│  └─ agy-indicator/             # 家级状态灯插件（随软件启动、所有会话可见）
│     ├─ package.json            #   dsh.client 声明（浏览器花名册）
│     └─ lib/
│        ├─ index.mjs            #   Host 半：收集 agy/status 事件 + HTTP 路由
│        ├─ client-entry.mjs     #   裸名行占位入口（防二次加载 index.mjs 崩溃）
│        └─ client.js            #   浏览器半：轮询渲染每项目灯
├─ dynamic/                      # 动态 Cordis 插件形态
│  ├─ host.js                    #   code.host 函数体
│  └─ client.js                  #   code.client 函数体（空骨架：UI 由家级灯统一呈现）
├─ mcp/                          # MCP 服务器（任何 MCP 宿主可发现）
│  ├─ agy-mcp-server.mjs         #   零依赖 stdio MCP 服务器
│  └─ README.md                  #   注册方法（Claude Code/Codex/DSH/通用）
└─ docs/
   ├─ INSTALL.md
   ├─ ARCHITECTURE.md
   ├─ FALLBACK-AND-INDICATOR.md
   ├─ SUPPORT.md                   # DSH 逐版本支持声明（基于逐 tarball 指纹回测）
   ├─ CHANGELOG.md                 # 版本历史（1.0.0 → 1.6.2）
   ├─ issues/BACKEND-ISSUES.md     # 提给 DSH/桌面壳上游的 issue 草案（item B/C）
   └─ handover/                    # 会话交接资料（audit 证据 + 客户端契约指纹）
   └─ en/                          # 英文文档
```

## 版本与发布

版本管理遵循语义化版本（`package.json` + Git tag + GitHub Release）。每版标注**实测适配的 DSH 版本**：

| 版本 | 适配 DSH | 内容 |
| --- | --- | --- |
| [v1.6.2](https://github.com/new-256/agy-first-bridge/releases/tag/v1.6.2) | ≥ 0.1.2-rc.1（建议 ≥0.1.3-alpha.2；实测 0.1.5-rc.1） | **修复合并包装下状态灯恒 idle**：host 半不再以 `import.meta.url` 找 `mcp-live.json`，改为 `AGY_MCP_LIVE_FILE` → `DSH_HOME` → `%APPDATA%\DSH Desktop\dsh-home` → `~/.dsh` 锚定，对齐 `dsh-plugin-manager-plus` 的 detectDshHome；verify 闸门加路径回归护栏 |
| [v1.6.1](https://github.com/new-256/agy-first-bridge/releases/tag/v1.6.1) | ≥ 0.1.2-rc.1 | **修复整屏崩溃（全新安装 `Failed to load plugins`）**：client.js 里 `__ModuleLoader__.load` 的 id 改为 npm 包名 `agy-first-bridge`（1.6.0 写成了 `agy-indicator`，违背 dsh-client-modules `arrive()` 的 id 契约）；新增 `scripts/verify.mjs` 22 项发布前闸门（含 id 契约和版本三锁） |
| [v1.6.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.6.0) | 0.1.3-alpha.2 | **双包合一**：灯并入主包 `agy-first-bridge`（主包 `package.json` 增加 DSH 插件面——`main` → 灯 Host 半、`exports` 双面、`dsh.bundle.patch`；`dsh plugin --profile web add agy-first-bridge` 单命令装灯），独立 npm 包 `agy-indicator` 弃用留档。⚠️ 存在两处后继修复，请直接使用 ≥v1.6.2 |
| [v1.5.15](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.15) | 0.1.3-alpha.2 | **适配 dsh-persona 新校验**（DSH 0.1.3-alpha.2 起 `prefix` 必填；旧 `text:` 拒绝挂载 → 迁移为 `prefix`+`suffix`，原文语义逐字保留）＋ **npm 发布**（去 `private`、加 `bin`/`files`/provenance，`agy-mcp-server` 可 `npx`）＋ `AGY_QUOTA_SCRIPT` 环境变量覆盖额度脚本路径（npm 安装布局自适配）＋ **agry-indicator 标准 npm 包形态**（`main` → `lib/index.mjs` Host 半、`exports` 双面暴露、`dsh.bundle.patch` bundle 补丁层；host 行改裸包名 `agy-indicator`，对齐官方 `dsh-comfyui-bridge`，跨设备 `dsh plugin --profile web add agy-indicator`） |
| [v1.5.14](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.14) | 0.1.2-alpha.5 | **修复状态灯永久冻结**：聚合状态表达式里的裸变量 `lastOk`（未声明 → 非 SUCCESS 结束必抛被吞的 ReferenceError）——灯冻结在旧 "running" 快照、agy_status 报「lastOk is not defined」；同 codebuddy-core v1.1.0 整改只看 `lastStatus`，preset/dynamic/web-search 桥三处同修 |
| [v1.5.13](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.13) | 0.1.2-alpha.5 | **agy MCP 全局注入**（家级 patch 注册 → 所有 preset 都能调 `mcp__agy__*`）＋ **MCP 通道点灯**（server 写盘 `mcp-live.json`，家级灯读盘合并）＋ **额度门禁只认 5h**（移除周额度软警告与相关提示词；周用量不再参与单次任务判断）＋ 修复调用结束后状态灯跨会话常驻（`OK_HOLD_MS` 不再随全局租约放大到 10 分钟） |
| [v1.5.12](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.12) | 0.1.2-alpha.4 | **修复 agy_quota 在含空格路径（DSH Desktop）下恒失败**：`new URL().pathname` 的 `%20` 编码无法还原 → 改用 `fileURLToPath` + 脚本缺失 fallback + 报错带退出码/stderr；preset 与 MCP 同修 |
| [v1.5.11](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.11) | 0.1.1-rc.2 | **5h 额度硬阻断**：Gemini 5h 池子 <10% 时 agy_run/agy_continue 静默不调用（QUOTA_BLOCKED，无弹窗/不通知用户），改用原生工具；周 <20% 保持软提示 |
| [v1.5.10](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.10) | 0.1.1-rc.2 | **模型选择策略**：DSH 按任务自行决定 agy 用哪个模型——agy_quota 输出按模型家族标注（family: gemini/claude/gpt/other + recommended），Claude/GPT (3p) 标为不推荐并排除出 topModels；policyText 明确"不用 Claude/GPT、生图任务直通 agy 不指定模型" |
| [v1.5.9](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.9) | 0.1.1-rc.2 | **Google AI 套餐池子额度查询**：新工具 agy_quota（读 Windows 凭据 → 刷新 OAuth token → fetchAvailableModels/retrieveUserQuotaSummary）；家级弹窗显示周套餐余量；周额度<20% 时 agy_run 附谨慎提示 |
| [v1.5.8](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.8) | 0.1.1-rc.2 | **修复超时误判**：agy 超时错误在 result.error 字段（"timeout waiting for response"），现并入 stderr 归类 → 网络挂起正确触发回退弹窗（此前静默 FAILED） |
| [v1.5.7](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.7) | 0.1.1-rc.2 | **防死等加固**：进程超时强制终止 + HUNG_TIMEOUT 明确报错（附最后事件摘要，区分长命令与真卡死）；额度/认证错误归类增强（quota/余额/额度/401/403）；弹窗显示"无活动 Ns"透明化 |
| [v1.5.6](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.6) | 0.1.1-rc.2 | **点击灯弹窗实时查看 agy 活动**：点状态灯弹出详情面板（当前步骤/工具参数/最近轨迹/上次状态），数据随 1.2s 轮询自动刷新，×/遮罩/Esc 关闭 |
| [v1.5.5](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.5) | 0.1.1-rc.2 | **辨识度优化**：running 圆点改用静态蓝（--dsw-static-blue-500 #3b82f6，原 brand-primary 解析为近黑）、ok 用 static-green-500；灯文字统一显示 AGY（非项目名），项目名/步骤进 tooltip |
| [v1.5.4](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.4) | 0.1.1-rc.2 | **全软件统一为一盏灯 + 模式感知显示**：动态形态不再自渲染灯，改经家级 `agyCollector` 服务把状态推入同一张表；preset 模式常驻（`presetActive`），普通模式仅调用 agy 时临时显示（ok 保留 8s 后隐藏）；**修复后端启动崩溃**（裸名行经 main 二次加载 index.mjs 导致 `agyCollector` 重复注册——新增 `lib/client-entry.mjs` 占位 + main 改向 + provide 防御） |
| [v1.5.3](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.3) | 0.1.1-rc.2 | **修复动态灯读不到状态（永远显示占位灰点）**：`host.call` 返回 invoke 包装 `{ok, value}`，client 必须解包 `value` 才能拿到真实 snapshot；修复后动态灯显示真实状态（⟳ 工作中/✓ 成功），悬浮 tooltip 显示步骤轨迹 |
| [v1.5.2](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.2) | 0.1.1-rc.2 | **修复动态形态 agy_run 触发 Host guard 拒绝**：动态插件沙箱不暴露 `ctx.emit`，`dynamic/host.js` 的 `publish()` 改为 no-op（动态灯走 `agy_status` RPC，不推事件）；实测调用 agy_run 状态灯全链路正常（就绪→⟳ 工作中→✓ 成功） |
| [v1.5.1](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.1) | 0.1.1-rc.2 | **修复切换会话空白**：家级灯 client 半改用原生 setInterval/clearInterval（卸载不再可能抛错），Slot id 改为 `agy-indicator-home` 避免与动态插件撞 id |
| [v1.5.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.5.0) | 0.1.1-rc.2 | **状态灯随软件启动**：家级插件 `agy-indicator`（cordis.patch.yml 注册，所有会话自动显示、无需审批）；preset 每次状态变化推送事件到家级收集器 |
| [v1.4.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.4.0) | 0.1.1-rc.2 | **UI 状态灯按项目分别显示**：per-project 快照（按 cwd 分组）、每项目一盏灯、`agy_status` 支持 `cwd` 过滤、双项目并发验证 |
| [v1.3.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.3.0) | 0.1.1-rc.2 | **实时观察**：所有形态改用 `stream-json` 逐事件解析，新增 `agy_status` 工具（当前步骤/轨迹/最近运行），状态灯 tooltip 显示当前步骤 |
| [v1.2.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.2.0) | 0.1.1-rc.2 | DSH 随软件自启（默认 preset `cordis-agy`）、DSH 内 MCP 注册、外部软件 MCP 注册（Claude Code/Codex）、披露并优先策略、版本管理 |
| [v1.1.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.1.0) | 0.1.1-rc.2 | MCP 服务器（零依赖、任何 MCP 宿主可发现）、CI 扩展 |
| [v1.0.0](https://github.com/new-256/agy-first-bridge/releases/tag/v1.0.0) | 0.1.1-rc.2 | agy 桥接工具、DSH 完全控制、回退弹窗、状态灯、两种形态、文档与 CI |

详见 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

### 与 DSH 的版本兼容性（速查）

支持声明的完整证据在 [docs/SUPPORT.md](docs/SUPPORT.md)（逐 tarball 字节级指纹回测自 `0.0.1-rc.1` → `0.1.5-rc.2`）。

- **支持下限：`@deepseek-ai/dsh ≥ 0.1.2-rc.1`** —— 从这一版起 `dsh-client-modules` 才补全 `reloadUrls` / `exactPackageSpecifier` 等契约细节（同一条 `arrive()` 校验「`__ModuleLoader__.load({id})` 的 `id` 必须等于包名」从 `0.0.1-rc.1` 起就存在，但早期缺少配套契约构成，**不算支持**）。
- **当前开发基准：`0.1.5-rc.1`**（也是 `latest` dist-tag；本机生产环境实测灯/工具/回退一切正常）。
- **桌面壳（DSH Desktop）**：对壳版本**无要求**；壳的 enterSafeMode 粒度问题与本插件无关（详见 `docs/issues/BACKEND-ISSUES.md`）。

## 开发纪律（开发-制品闭环）

本仓及本机所有 DSH 插件的开发遵循**闭环纪律**：开发 → 测试 → 提交 → 发版 → **卸载本地开发态接线** → **从制品源（npm registry）安装** → 测试 → **对比一致性（已安装 ≡ 发布 tag）** → 闭环备案 → 等待下一次修订。发布后本机部署一律使用制品形态（registry 安装），`file:`/junction 直连工作副本的开发态接线仅限活跃开发会话内使用。全文见 **[docs/DEV-DISCIPLINE.md](docs/DEV-DISCIPLINE.md)**（含七条纪律与 2026-09-12 仓库迁移断链事故背景）。

## 安全说明

- `--dangerously-skip-permissions` 表示 agy 会在不再询问的情况下改动文件、执行命令。这是「DSH 完全控制 agy」这一需求的直接实现，请仅在你信任 agy 执行环境时使用。
- 插件只向 Host 的 `tools` / `systemPrompt` 注册、并暴露一个包私有的 `agy_status` 只读 RPC，不发布任何跨会话服务，因此可安全放入 preset 面（无需 isolate realm）。
- 所有副作用（工具注册、提示段、样式、定时器）都通过 `ctx.effect` / `ctx.tools.register` / `ctx.timeout` 挂到当前 Fiber，插件停止/更新/卸载时自动清理。

---

## English summary

`agy-first-bridge` is a Cordis plugin for the **DeepSeek Harness (DSH)**. It registers two model tools (`agy_run`, `agy_continue`) that dispatch real work to the local **`agy` CLI** under full DSH control (`--dangerously-skip-permissions`, so agy never prompts), and injects an *agy-first* policy so the model prefers agy across every mode. When agy is **rate-limited or the network is down**, it pops a confirmation dialog offering the **DSH local API config** as a fallback, and it renders a **live status light** in the session header showing whether agy is currently working.

Four forms are shipped: a **persistent agent preset** (`preset/agy-first/`, survives restart, host-side fallback included), a **home-level status-light plugin** (`home-plugin/agy-indicator/`, registered via `cordis.patch.yml`, the light appears in every session with no approval), a **dynamic Cordis plugin** (`dynamic/`, adds the browser status light, needs a one-time approval), and [`mcp/`](mcp/), a zero-dependency **MCP server** that exposes `agy_run` / `agy_continue` to *any* MCP-capable host (Claude Code, Codex, Cherry Studio, …), where the agent discovers the tools itself and decides when to call them — even without any agy-first preset.

👉 **Full English documentation: [README.en.md](README.en.md)** — with English guides under [`docs/en/`](docs/en/) (install, architecture, fallback & indicator).

## License

[MIT](LICENSE) © 2026 chenglong
