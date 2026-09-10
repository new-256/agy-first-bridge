# Issue 草案：DSH 后端两件改进（对应会话 item B）

> 目标仓库：`deepseek-ai/dsh`（或 fork/内部实际上游）。以下两个问题均为**单 PR 体量**，
> 可分开提。

---

## Issue B-1：`dsh plugin add` / profile 挂载期校验 `client.js` 注册 id

**现象**：一个声明了 `dsh.client` 的包，若其 `client.js` 里 `__ModuleLoader__.load({id})`
的 `id` **不等于包的 `name`**，前端会在 arrive 阶段
`bundle ... loaded without registering "<pkg>" via __ModuleLoader__.load`，导致整个
client combo 失败，进而触发"Failed to load plugins"整屏红。

**问题**：后端在 `profile 编辑 / plugin add` 时**不知道**即将挂载的包是否满足该契约，
就把包加进 bundle list。第一次失败要等用户打开 Web UI 才暴露，现场已坏。

**建议**（`@deepseek-ai/dsh: lib/plugin-*.js`，即 `exportsPatch` / 挂载路径）：

1. 解析目标包的 `package.json` 时，若存在 `dsh.client`，同步尝试读取其指向的
   `client.js` 文本（只做一次小成本 IO）。
2. 用与 `scripts/verify.mjs`（agy-first-bridge）同款逻辑取出首个
   `__ModuleLoader__.load(...)` 调用的 `id`。
3. `id !== pkg.name` 时给出**明确警告**或拒绝加入 bundle list；提示文案请包含
   `expected "<pkg.name>" but got "<actual>"`，显著提高自助修复率。
4. 若包内确实没有 client.js（少了文件），同样拒绝，不要让"稍后缺文件"在浏览器端
   以 arrive throw 的形式爆发。

**附加收益**：`@deepseek-ai/dsh-client-modules` 的 `arrive()` throw 文本可以顺带在
message 里带上 `row.initialUrl` 中的包名（现在只带 url，排障时需要再 jq 一次网络面板）。

---

## Issue B-2：`dsh-client-modules` 单个 bundle 失败不应拖垮整个 combo

**现象**：与 B-1 同根。当前 `arrive(row)` throw 之后，整个 client combo（一个页面需要
激活的所有 client 模块）走的是"一个失败 = 全部失败"路径，用户会看到
`Failed to load plugins`，而其他无关插件被连带消失。

**建议**（`@deepseek-ai/dsh-client-modules: lib/client.js`）：

1. 把 `arrive(row)` 的 throw 改成把 failure 挂到该 row 的 `state`（例如
   `row.state = 'failed'`, `error`),并 `console.error`。
2. `arriveGraphRow` 遍历到 `failed` 节点时**跳过**其子树，但继续其他分支；
   或者提供 `mode: 'strict' | 'best-effort'`，默认 `best-effort`。
3. 在 UI 层把该 row 显示为红色"加载失败"芯片，而**不要**整屏失败。

**为什么这样做**：插件生态是 untrusted / 版本横飞的，单一包版本错位不该让整台
DSH Desktop 看上去"全坏"。这也直接降低了 `updater-backend.js::enterSafeMode`
被无谓触发的概率（见 Issue C）。

---

## Issue C（桌面壳侧，独立仓）：enterSafeMode 应定位"出问题的那一行"，而不是全部注释

**现象**：`updater-backend.js` 里 `enterSafeMode()` 会在检测到引导失败时调用
`commentPatchEntries(parsed.text, null)`（`null` 语义 = 注释所有条目）。同文件 L1563
已有 `commentPatchEntries(state.original, new Set([entryIndex]))` 的**单行**版本——说明
壳本身支持"只隔离某一个补丁条目"，只是 `enterSafeMode` 没用它。

**建议**：

1. `enterSafeMode` 收到触发原因时，把"是哪个 profile / 哪个补丁行失败"一并传下来
   （后端在 arrive throw 里已经有 `row.id` / `row.initialUrl`，只是没回传给壳）。
2. 改为 `commentPatchEntries(text, new Set([failingEntryIndex]))`，只隔离肇事者。
3. UI 提示改为"插件 `<name>` 加载失败已临时屏蔽，其余配置保留"，而不是
   "已进入安全模式（所有插件被禁用）"。

**短期缓解**（不需要上游改动也能落地）：本仓 agy-first-bridge ≥1.6.1 起在 publish 前用
`scripts/verify.mjs` 强制把 `load id` 与 `package.json name` 对齐，杜绝这一类导致
enterSafeMode 的常见触发源。

---

## 提交口径建议（贴在 issue 底部）

- 复现小脚本：用 v1.6.0 的 `agy-first-bridge`（故意保留 id 失配的那版）装到
  profile web，然后打开 Web，就能看到 B-1 的整屏红。
- 附件：`docs/handover/audit/compat-evidence.json`（本文同仓）已列出从
  `0.0.1-rc.1` 到 `0.1.5-rc.2` 每个 client-modules 版本的 throw 行号，证明
  契约从未变过、容忍策略也一直缺位。
