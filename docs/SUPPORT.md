# agy-first-bridge × DSH 支持声明（Support Matrix）

> 编制日期：2026-09-11（北京时间）
> 编制会话：agy-first-bridge 开发项目（本工作区）
> 数据源：`docs/handover/audit/compat-evidence.json`（逐版本拉取官方
> `@deepseek-ai/dsh-client-modules`、`@deepseek-ai/dsh-web-app` tarball 后做
> 字节级指纹抽取），并配合从 `npm view @deepseek-ai/dsh time` 得到的发布时间表。
> 结论是按"代码证据"做的，不是猜。

## 结论速查

| DSH（`@deepseek-ai/dsh`） | 状态 | 依据（agy-first-bridge ≥1.6.1） |
|---|---|---|
| `0.1.2-rc.1` 及以后（含 `0.1.3-alpha.2` / `0.1.5-alpha.*` / `0.1.5-rc.1` / `0.1.5-rc.2`） | **兼容（官方购买）** | client-modules 的 `arrive()` 契约（"bundle 必须注册与 graph row id 同名的工厂"）自 `0.1.2-rc.1` 起与生产 0.1.5-rc.1 **逐字节一致**（L248 的 throw 文本完整一致） |
| `0.1.1-rc.*` 及以前（`0.0.1-rc.*` / `0.1.0-rc.*` / `0.1.1-rc.1/2`） | **不推荐但未拒绝** | 同一条 `throw` 也早在 `0.0.1-rc.1` 就存在（L84）；差异在于 `reloadUrls`、`exactPackageSpecifier`、`stripClientSuffix` 等 dedup/热更辅助逻辑在 `0.1.2-rc.1` 才补全。**老版不会"崩"，但行为锚定不一致**（例如缺少 `reloadUrls`，`?v=N` 失效），不算"支持" |
| 桌面壳 `DSH Desktop`（`updater-backend.js enterSafeMode`） | **与本包无关** | 桌面壳在多层插件加载失败时会把**全部**补丁行注释掉，这是壳层行为；本包已修复自身 id 失配，壳层粒度问题已开上游 issue（见 `issue-B/C`） |

### 为什么"0.1.2-rc.1 是分水岭"

`plugins/web` 这层被加载时，前端模块装载器（`@deepseek-ai/dsh-client-modules`）会做两件与
agy-first-bridge 直接相关的事：

1. 从 `package.json` 的 `name` 推断 graph row id（即 `agy-first-bridge`，而不是内部的
   `agy-indicator`）。
2. `arrive()` 在 bundle 脚本 `load` 完成后校验该 id 是否已被 `__ModuleLoader__.load`
   注册；不命中就立即 `throw`（此即本次 v1.1.7 codebuddy-side 崩溃的根因类型，agy 侧自
   v1.6.1 修复）。

生产环境（`0.1.5-rc.1`）该 throw 位于 `client.js:248`：

```
throw new Error(`client-modules: bundle ${url} loaded without registering "${id}" via __ModuleLoader__.load`)
```

经过跨 9 个历史版本（0.0.1-rc.1 → 0.1.5-rc.2）逐版拉包指纹比对（见
`docs/handover/audit/fingerprints/` 下各 `arrive-window.txt`）：

- **`throw` 行为一致**：从 `0.0.1-rc.1` 起就有（那时在 `client.js:84`）。
- **`reloadUrls` / 热更配套却直到 `0.1.2-rc.1` 才引入**（该版的指纹里第一次能看到
  `reloadUrlRefs: 6`；更早版本为 0）。
- 由于我们约定"`__ModuleLoader__.load({id})` 的 id 必须 === 包名"是一条**硬契约**，
  而热更/版本切换又是日常 dev 工作流的基础，因此把"受支持"下限定在
  **`@deepseek-ai/dsh ≥ 0.1.2-rc.1`**。

### 桌面壳（DSH Desktop）侧

本包**不要求**特定桌面壳版本。桌面壳 `enterSafeMode()` 把多起加载失败时干掉所有补丁
行属于壳层粒度问题（item C），本仓的 `dsh.bundle.patch` 单一 id 行被全量注释时只需要
把 `profiles/web/package.json` 的 `dsh.profile.bundles` 中对应条目重新打开即可，与
本包内部实现无关。

## 上游继续保证（给维护者的提示）

- **新增 dsh 主版本时的责任**：发新版之前，跑一次

  ```bash
  npm view @deepseek-ai/dsh-client-modules@<new> dist.tarball
  # 拉下来解包 grep 'without registering' client.js
  ```

  若 throw 行改变（例如消息文案或 id 规则演化），**先更新本包 → 再升 dsh**。
- **不要**为了兼容老 dsh 而把 `client.js` 的注册 id 改回 `agy-indicator`。那是
  v1.6.1 的根因，会被老/新 dsh 同时判定"bundle 未注册指定 id"。

## 已发布版本（agy-first-bridge）一览

| npm 版本 | 主要变更 | 兼容性关键点 |
|---|---|---|
| `1.5.15` | 双包时代的"独立指示灯包"最后一个版本 | 不与"主包型（agy-first-bridge）"互操作；不再推荐装 |
| `1.6.0` | 双包合一（灯、MCP server、preset 并进 agy-first-bridge） | 引入 `client.js` 的 id 与 graph row id 不一致的**隐藏**问题 |
| `1.6.1` | **修复** 上述 id 失配（崩溃根因）；新增 `scripts/verify.mjs` 发布前闸门 | 升到此版本才能避免"插件页全灭" |
| `1.6.2`（latest） | **修复** "合并包布局下 MCP→灯 桥文件路径错位"（host 先前找 `<pkg>/home-plugin/agy-indicator/mcp-live.json`，改用 `DSH_HOME` 锚定到 `<dsh-home>/plugins/agy-indicator/mcp-live.json`） | 任何"以 junction/npm 形式装进 profiles/web/node_modules/agy-first-bridge"的部署都必须升到此版本，否则灯恒 idle |

## npm 包对照

| npm 包名 | 状态 | 说明 |
|---|---|---|
| `agy-first-bridge` | **mainline，latest=1.6.2** | 当前分发入口；preset、家级灯、MCP server 全在此包 |
| `agy-indicator` | **deprecated（保留 1.5.15）** | 1.6.0 起不再单独发布，保留只是不破坏历史 lock / 部署 |

## codebuddy 侧参考（本会话顺手治理）

| 包 | latest | 说明 |
|---|---|---|
| `codebuddy-first-bridge` | `1.1.9` | v1.1.7 引入 `dsh.bundle.patch` 标准形态；v1.1.8 修复同款 client.js 注册 id；v1.1.9 在 `scripts/verify.mjs` 加了 "load id == 包名" 静态护栏 |
