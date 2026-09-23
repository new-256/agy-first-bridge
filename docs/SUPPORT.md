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

### 工作流引擎改名与"整预设挂载"契约（v1.7.1 修复，DSH 侧硬约束）

这是本包第二个与 DSH 强耦合的契约点，性质与上面那条 `arrive()` 不同：**失败粒度是"整个 preset"**。

上游在 `@deepseek-ai/dsh-base@0.1.6-alpha.1` 把工作流引擎包改名：

| DSH 版本区间 | 引擎包 |
|---|---|
| ≤ `0.1.5-rc.3` | `@deepseek-ai/dsh-workflow-worker-thread` |
| ≥ `0.1.6-alpha.1` | `@deepseek-ai/dsh-workflow-ptc` |

**两条线都还在服役**（`npm dist-tags` 实测）：`latest = 0.1.5-rc.3`（worker-thread）、`next = 0.1.7-rc.1` 与 `alpha = 0.1.7-alpha.2`（workflow-ptc）。所以**写死任一个包名都会打断另一条线**。

失败为什么是"整个 preset"：`@deepseek-ai/dsh-agent-preset-registry` 的 `mountPreset()` 在挂载后调用 `auditRows()`，后者遍历每个 enabled 行并 `await fiber.await()`；**任一行抛出即 `audit.failed.length > 0` → `throw new Error(audit.failed.join("\n"))`**，整个挂载被拒。注意 `disabled` 行在 `auditRows()` 里被 `continue` 跳过，**不会**被判失败——这正是修复所依赖的机制。

修复形态（`preset/agy-first/agent.cordis.yml`）：

```yaml
- id: workflow-ptc
  name: '@deepseek-ai/dsh-workflow-ptc'
  disabled: !!js >-
    (() => { try { return !process.getBuiltinModule('node:module').createRequire(process.argv[1]).resolve('@deepseek-ai/dsh-workflow-ptc') } catch { return true } })()
  config:
    provider: spawn

- id: workflow-worker-thread
  name: '@deepseek-ai/dsh-workflow-worker-thread'
  disabled: !!js >-
    (() => { try { const r = process.getBuiltinModule('node:module').createRequire(process.argv[1]); try { return !!r.resolve('@deepseek-ai/dsh-workflow-ptc') } catch { return !r.resolve('@deepseek-ai/dsh-workflow-worker-thread') } } catch { return true } })()
  config:
    provider: spawn
```

为什么必须这样写（三条都是实测结论）：

1. **单行无法选包**。`Entry._init()` 把 `this.options.name` **原样**交给 `tree.import(name)`；只有 `config` 与 `disabled` 会过 `interpolate()`（`!!js` 求值）。所以 `name:` 不能写表达式。
2. **求值器里可用什么**：`!!js` 由 `new Function("ctx","expr","with (ctx) { return eval(expr) }")` 求值。实测可用 `process`、`process.getBuiltinModule`、`globalThis`、`fetch`、`ctx.baseUrl`；**`require` / `module` / `__dirname` 是 `undefined`，裸 `import` 是 SyntaxError**——故必须走 `process.getBuiltinModule('node:module').createRequire(...)`。
3. **锚点必须是 `process.argv[1]`**。它是运行中的 `dsh/lib/bin.js`，与 loader 做 `import(name)` 的解析树相同。实测 `createRequire(import.meta.url)` 或任何 preset 目录下的锚点都会 `MODULE_NOT_FOUND`（preset 目录没有 `node_modules`），导致守卫恒真、引擎永不加载。

守卫**永不抛异常**：`composition-inventory.js` 的 `disabledContribution()` 在求值抛错时把该行判为 `'conditional'`（"留给真实挂载决定"），行为不可预期，故全部包在 try/catch 里。

`!!js` 方言本身（`tag:yaml.org,2002:js` → `{ __jsExpr }`）由 `@deepseek-ai/cordis-plugin-include` 提供，其 `^1.0.7` 自 dsh `0.1.2-rc.1` 起即为依赖，覆盖本包全部受支持范围。

**给维护者**：升级 DSH 主版本后，若 preset 整体挂不上（会话起不来、报 `never started` 或 import 失败），先看 `auditRows()` 报的是哪一行。任何**被上游改名/移除**的行都会以这种方式炸掉整个 preset，而不只是丢那一个工具。回归护栏：`scripts/verify.mjs` §6（静态）+ `tests/preset-workflow.test.mjs`（语义，用本机 DSH 真实的 `entryListSchema` 与 `evaluate()`）。

## 已发布版本（agy-first-bridge）一览

| npm 版本 | 主要变更 | 兼容性关键点 |
|---|---|---|
| `1.5.15` | 双包时代的"独立指示灯包"最后一个版本 | 不与"主包型（agy-first-bridge）"互操作；不再推荐装 |
| `1.6.0` | 双包合一（灯、MCP server、preset 并进 agy-first-bridge） | 引入 `client.js` 的 id 与 graph row id 不一致的**隐藏**问题 |
| `1.6.1` | **修复** 上述 id 失配（崩溃根因）；新增 `scripts/verify.mjs` 发布前闸门 | 升到此版本才能避免"插件页全灭" |
| `1.7.1`（latest） | **修复 agent preset 在 DSH ≥0.1.6-alpha.1 上整体挂载失败**：上游把工作流引擎 `@deepseek-ai/dsh-workflow-worker-thread` 改名为 `@deepseek-ai/dsh-workflow-ptc`（翻转点 `dsh-base@0.1.6-alpha.1`）。`auditRows()` 见任一 enabled 行导入失败即拒绝**整个** preset，故症状是预设整体不可用。改为两行并存 + `!!js disabled` 自证（探测 `process.argv[1]` 的解析基准），三条发布线（modern / legacy / 未知）均实测正确 | **受影响范围：DSH ≥0.1.6-alpha.1 上 1.7.0 及以前的 preset 全部挂不上**。preset 层需手动同步拷贝（`preset/agy-first/*`）；MCP bin 层需替换文件 |
| `1.7.0` | **激励结构修复**（根因分析驱动）：上下文协议（CONTEXT 前置块 + `agy_continue` 延续）、默认后台化（决策与回退循环下沉至 Job，后台失败同样弹回退框，后台获得 DSH 硬超时防线）、决策点钩子（`agy:policy` 移至 `TOOL_SUBAGENT+10`、子代理 persona 注入、政策改紧凑决策表）；timeoutSec 默认 600s，结果头行去 `tokens=` | 无兼容性硬要求；任何 ≥1.6.2 的部署可直接升级。preset 层需手动同步拷贝（`preset/agy-first/*`），MCP bin 层需替换文件 |
| `1.6.2` | **修复** "合并包布局下 MCP→灯 桥文件路径错位"（host 先前找 `<pkg>/home-plugin/agy-indicator/mcp-live.json`，改用 `DSH_HOME` 锚定到 `<dsh-home>/plugins/agy-indicator/mcp-live.json`） | 任何"以 junction/npm 形式装进 profiles/web/node_modules/agy-first-bridge"的部署都必须升到此版本，否则灯恒 idle |

## npm 包对照

| npm 包名 | 状态 | 说明 |
|---|---|---|
| `agy-first-bridge` | **mainline，latest=1.7.0** | 当前分发入口；preset、家级灯、MCP server 全在此包 |
| `agy-indicator` | **deprecated（保留 1.5.15）** | 1.6.0 起不再单独发布，保留只是不破坏历史 lock / 部署 |

## codebuddy 侧参考（本会话顺手治理）

| 包 | latest | 说明 |
|---|---|---|
| `codebuddy-first-bridge` | `1.1.9` | v1.1.7 引入 `dsh.bundle.patch` 标准形态；v1.1.8 修复同款 client.js 注册 id；v1.1.9 在 `scripts/verify.mjs` 加了 "load id == 包名" 静态护栏 |
