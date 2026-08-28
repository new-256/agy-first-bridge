# 安装指南

本插件提供两种形态。**多数用户直接用「持久 Agent Preset」即可**；需要浏览器状态灯时再用「动态 Cordis 插件」。

---

## 前提

- 一套可运行的 **DeepSeek Harness (DSH)**。
- 本机安装了 **`agy` CLI** 且在 `PATH` 中可用：

  ```bash
  agy --version   # 开发时验证：v1.1.22
  ```

- 会话组合里挂载了这些 Host 服务（`standard` preset 默认都有）：
  `tools`、`subprocess`、`systemPrompt`、`timer`；可选增强：`jobs`（后台任务）、`planMode`（plan 自动判定）、`sandboxPolicy`（默认 cwd）、`userQuestions`（回退弹窗）。

---

## 方式 A：持久 Agent Preset（推荐）

### 1. 找到你的用户 preset 根目录

Preset 目录位于：

```
${DSH_HOME:-$HOME/.dsh}/.agent-presets/
```

`DSH_HOME` 未设置时回退到 `$HOME/.dsh`。本仓库开发环境中它是：

```
C:\Users\<you>\AppData\Roaming\DSH Desktop\dsh-home\.agent-presets\
```

> 用 DSH 的 `agentPresets` 服务（`list()` / `resolve()`）可以在运行时读到每个 preset 的真实路径，不要凭空假设。

### 2. 复制 preset 目录

```powershell
# Windows PowerShell
Copy-Item -Recurse .\preset\agy-first "$env:DSH_HOME\.agent-presets\agy-first"
```

```bash
# macOS / Linux
cp -R ./preset/agy-first "${DSH_HOME:-$HOME/.dsh}/.agent-presets/agy-first"
```

复制后目录应为：

```
.agent-presets/agy-first/
├─ preset.yml
├─ agent.cordis.yml
└─ agy-first-bridge.mjs
```

### 3. （可选）核对工作目录默认值

`agy-first-bridge.mjs` 顶部有一个兜底常量：

```js
const CWD_FALLBACK = 'C:\\Users\\lcl\\Desktop\\DSH'
```

仅当会话未提供 `sandboxPolicy.workspaceRoot`、且调用时未显式传 `cwd` 时才会用到它。按需改成你的默认工作目录即可（一般无需改动）。

### 4. 校验它能挂载

在一个带 Cordis 能力的会话里，通过 `agentPresets.standingKeyFor('agy-first')` 做一次 mount 校验；返回成功即表示模块被正确导入、三个工具（`agy_run` / `agy_continue` / `agy_status`）已注册、提示段已装配、且没有触发根 realm 冲突。

也可以先做一次语法自检：

```bash
node --check ./preset/agy-first/agy-first-bridge.mjs
```

### 5. 使用

新开会话时选择 preset **`Agy-First 执行代理`**（id：`agy-first`）。你会得到 `standard` 的全部能力，外加 `agy_run` / `agy_continue` / `agy_status` 工具、agy 优先策略与限流/网络回退弹窗。

> **重要：切勿编辑随部署发行的 `agent-presets` 安装目录**（它会在升级时被覆盖，破坏 `cordis` 等出厂 preset 甚至会使该模式失效）。始终安装到**用户** preset 根目录下的独立子目录。

---

## 方式 B：动态 Cordis 插件（含浏览器状态灯）

动态形态是进程内临时插件，**进程重启后消失**，但它额外带来会话标题栏的实时状态灯。

1. 在一个已加载 Cordis 能力的 DSH 会话里，用 `cordis_define` 定义插件：
   - `code.host` = [`dynamic/host.js`](../dynamic/host.js) 的完整内容；
   - `code.client` = [`dynamic/client.js`](../dynamic/client.js) 的完整内容。
2. 用 `cordis_run`（`mode: "run"`）激活返回的 `pluginId` / `packageId`。
3. 首次运行 **Client 半** 时，DSH GUI 会弹出一次性审批（单勾仅授权当前包，双勾授权后续版本）。批准后，状态灯出现在会话标题栏右侧。
4. 需要临时停用用 `cordis_stop`；彻底删除用 `cordis_undefine`。

> 若本会话禁用了审批提示，Client 半会被自动拒绝——此时改用方式 A（回退弹窗依然可用，只是没有状态灯）。

---

## 卸载

- **Preset**：删除 `.agent-presets/agy-first/` 目录即可（下次读取 roster 时消失）。
- **动态插件**：`cordis_undefine <pluginId>`。
