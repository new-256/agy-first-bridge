# 架构

## 背景：DSH / Cordis 的两个平面

DSH 的能力由 Cordis 组合而成，每个能力是 `cordis.yml` 里的一行插件。存在两个平面：

- **Host 平面**：跑在 DSH 的 Node.js 进程里，掌管注册表、沙箱与审批栈、持久化、模型路由、子代理注册表等跨会话共享的东西。文件、网络、命令、Agent/Session 访问、Host 事件与服务、模型工具都在这里。
- **Client 平面**：跑在浏览器页面里，负责主题、布局、当前页面状态、工具卡片、Slot UI。

一个 **Agent Preset** 是「单个会话向这些注册表贡献了什么」——它的工具、人设、提示段。发布服务的行属于 Host 组合；只向 `tools` / `systemPrompt` 注册、不发布服务的行是「preset 面安全」的（像 `tool-fs`），无需 isolate realm。本插件正属于后者。

Host 与 Client 之间只能通过包私有的 JSON RPC 通信：Host 用 `harness.handle(method, handler)` 暴露方法，Client 用 `host.call(method, args)` 调用，方向是 **Client → Host**。

## 组件总览

```
                          ┌─────────────────────────── DSH Host (Node.js) ───────────────────────────┐
                          │                                                                          │
  模型 (任一模式)  ──工具调用──▶  agy_run / agy_continue / agy_status                                │
                          │        │                                                                 │
                          │        ├─ buildArgv: 强制 --dangerously-skip-permissions               │
                          │        │              + --output-format stream-json + --print-timeout   │
                          │        │              + mode(auto→plan/accept-edits)/model/effort/...     │
                          │        │                                                                 │
                          │        ├─ subprocess.spawn(agy ...) ──────────▶  本机 agy CLI            │
                          │        │      exec.signal + ctx.timeout→terminate() 做取消/超时           │
                          │        │      逐行解析 step_update 事件 → 更新 current/trail（实时）      │
                          │        │                                                                 │
                          │        ├─ 解析末尾 result 事件 → { ok, status, response, convId, ... }    │
                          │        │                                                                 │
                          │        ├─ 失败且疑似限流/网络？ ──▶ userQuestions.ask()  ← 真人弹窗          │
                          │        │         回退 → { fallback:true, status:FALLBACK_TO_DSH }         │
                          │        │         重试 → 再跑一次（上限 2 次）                              │
                          │        │                                                                 │
                          │        └─ 更新 status 快照 (begin/end + foldStepUpdate) ──┐              │
                          │                                          │                                │
                          │   systemPrompt.section('agy:policy')     │ harness.handle('agy_status')   │
                          │                                          │            ▲                    │
                          └──────────────────────────────────────────┼────────────┼───────────────────┘
                                                                     │  host.call('agy_status') 每1.2s
                          ┌───────────────── DSH Client (浏览器) ──────┼────────────┼───────┐
                          │  会话标题栏 Slot: conversation.session.header.utilities │       │
                          │       状态灯 Indicator ────────────────────────────────┘       │
                          │       ● 工作中/成功/失败/本地回退/就绪（主题 token 上色）         │
                          └────────────────────────────────────────────────────────────────┘
```

## Host 半（`dynamic/host.js` / `preset/.../agy-first-bridge.mjs`）

- `inject: ['tools', 'subprocess', 'systemPrompt', 'timer']` —— 硬依赖；其余用 `ctx.get()` 可选读取（`jobs` / `planMode` / `sandboxPolicy` / `userQuestions`）。
- `buildArgv()` 组装 agy 命令行，**始终**带上 `--dangerously-skip-permissions`、`--output-format stream-json`、`--print-timeout <sec>s`；`mode:auto` 时读 `planMode` 决定 `plan` 还是 `accept-edits`。
- `runSync()` 通过 `subprocess.spawn` 执行，把调用方 `exec.signal` 透传给子进程，并用 `ctx.timeout(() => handle.terminate(), (timeout+60)s)` 兜底超时。运行期间 `startLiveParser()` 用 `ctx.interval` 增量读取 stdout，把 `step_update` 事件折入 `status.current` / `status.trail`（`foldStepUpdate`），实现**实时观察**。
- 后台路径通过 `jobs.start({ kind:'bash', owner: exec.agent, run() {...} })` 执行，`run()` 返回 `{ cancel, done }`；`done` 解析结果并回填状态（同样挂 live parser）。
- `parseAgyJson()` 容错解析 agy 的 `stream-json` 输出（从末尾向前找 `{"event":"result","result":{...}}`，容忍日志行；整体 JSON 兜底）。
- 结果统一为一个纯 JSON 对象；`render()` 生成人类可读的工具卡片文本。
- `agy_status` 工具 / RPC 返回纯标量快照 `{ state, running, current, trail, lastStatus, lastConversationId, updatedAt, projects[] }`；`projects[]` 按项目（cwd）分节，每节含该项目 `current`（正在执行的步骤：工具名+参数，或 agent_response 思考/打字中）、`trail`、`lastStatus` 等；顶层字段为全局聚合（向后兼容）。支持 `cwd` 参数只看某个项目。

### 关键约束（沙箱 vs 真实 Node）

| 约束 | 动态插件（沙箱） | Preset `.mjs`（真实 Node） |
| --- | --- | --- |
| `import` / `require` | ❌ 禁止 | ⚠️ 可用，但**够不到** `@deepseek-ai/*`（用户目录向上找不到 harness 包），故本模块**零依赖** |
| `AbortController` | ❌ 无（改用 `exec.signal` + `handle.terminate()`） | ✅ 有，但仍沿用同一套以保持一致 |
| `process` / `Buffer` / 原生定时器 | ❌ 无 | ✅ 有（未使用） |
| 工具注册 | `harness.registerTool(ctx, harness.defineTool({...}))` | `ctx.tools.register(<纯对象 ToolDefinition>)` |
| Host→Client RPC | `harness.handle('agy_status', ...)` | ⚠️ 无 Client 半，故不注册（也无消费者） |

> 这也是**状态灯只在动态形态出现**的原因：Preset 是 Host 面组合，其 `.mjs` 只在 Node 侧运行，没有浏览器 UI；实时灯是 Client 面 Slot 组件，必须由动态 Cordis 插件的 Client 半加载。

## Client 半（`dynamic/client.js`）

- `inject: ['timer']`，`ctx.get('slots')` 可选读取。
- 用 `styles.insert(css)` 注入带呼吸动画的样式（`ctx.effect` 包裹，随插件卸载清理）。
- `Indicator` 组件在 `React.useEffect` 里用 `ctx.interval(tick, 1200)` 每 1.2s 调 `host.call('agy_status')`，**为每个项目渲染一盏灯**（快照 `projects[]`），据各项目 `state` 上色 + 项目名；tooltip 显示该项目 `current` 步骤与最近 `trail`；卸载时释放定时器。
- 注册到 Slot `conversation.session.header.utilities`（session 作用域，列表型），`id: 'agy-indicator'`。

## 生命周期与可逆性

所有副作用都挂到当前 Fiber，`cordis_stop` / `cordis_undefine` / preset 卸载时自动回收：

- 工具：`ctx.tools.register(...)` / `harness.registerTool(...)` 返回 disposer；
- 提示段：`ctx.systemPrompt.section(...)`；
- 样式：`styles.insert(...)`（`ctx.effect` 包裹）；
- 定时器：`ctx.timeout(...)` / `ctx.interval(...)` 返回 disposer。

## 数据流纪律

插件从不序列化 DSH 的活对象（Service / Event / Slot / Session）。它只读取需要的叶子字段（agy 的 stdout 文本、退出码等），构造最小的、无 Host 引用的 JSON 对象跨 RPC 传输和展示。
