# 回退机制与状态灯

本文档说明用户要求的两项能力：**agy 受限时的回退弹窗**，以及**实时状态灯**。

---

## 一、回退机制（弹窗确认）

### 触发条件

`agy_run` / `agy_continue` 每次执行后，若结果 `ok === false` 且被判定为「疑似流量受限 / 网络不通」，就会触发回退弹窗。判定 `isLimited(res)` 命中任一即可：

- `status` 为 `SPAWN_ERROR` 或 `AGY_UNAVAILABLE`（进程起不来 / 找不到 agy）；
- `stderr` + `response` + `status` 拼起来命中以下正则（大小写不敏感）：

  ```
  rate limit / ratelimit / 429 / too many / quota / exceed /
  network / offline / ENETUNREACH / ECONNREFUSED / ECONNRESET /
  ETIMEDOUT / EAI_AGAIN / ENOTFOUND / timeout / timed out /
  unavailable / 503 / 502 / 500 / connection / proxy / socket /
  tls / ssl / dns / 网络 / 超时 / 限流 / 流量 / 受限 / 配额 / 连接 / 断开
  ```

### 弹窗内容

通过 DSH 的 `userQuestions.ask()` 弹出一个单选题：

> **agy 受限** —— agy 调用失败（疑似流量受限/网络不通，状态=`<status>`）。是否改用 DSH 本地 API 配置继续？

三个选项：

| 选项 | 行为 |
| --- | --- |
| **使用 DSH 本地 API 配置（回退）** | 返回 `{ ok:false, fallback:true, status:'FALLBACK_TO_DSH', reason:<原status> }`。模型据此改用**原生工具 / 本地模型**完成任务，且不再调用 agy。 |
| **重试 agy 一次** | 立即再执行一次 agy（最多累计 2 次）。 |
| **不回退（返回错误）** | 原样返回 agy 错误结果，由模型决定后续。 |

### 防阻塞 / 防循环设计

- **无真人应答者时不弹窗**：`userQuestions.ask()` 只对「当前存活的运行根」有效。若调用来自被托管的子代理（`exec.agent` 非存活根，或被其他 agent 拥有），`ask()` 会抛 `CALLER_NOT_LIVE` / `DELEGATED_CALLER`；本插件捕获后按 `'error'` 处理（不弹窗、直接返回错误），避免子代理永久卡住。缺少 `userQuestions` 服务时同理。
- **最多 2 次尝试**：主循环 `attempt >= 2` 即停，杜绝反复重试。
- **后台任务不弹窗**：`background:true` 的任务在 `jobs` 里异步跑，完成时真人上下文未必还在，因此后台失败**不**触发弹窗——工具返回里也提示「前台重跑才会被询问」。
- **不让 agy 回调 DSH**：策略提示明确禁止 agy 反向调用 DSH，避免环路。

### 模型侧约定（提示段）

插件注入的 `agy:policy` 提示段包含如下约定，确保模型正确消费回退结果：

> 当 agy 被限流或网络不通时，agy_run/agy_continue 会自动弹窗询问是否使用 DSH 本地 API 配置。若返回 `fallback=true`（`status FALLBACK_TO_DSH`），表示用户选择回退：请用原生 DSH 工具 / 本地模型完成本任务，且**不要**再调用 agy。若 `ok=false` 但没有 `fallback`，报告 agy 错误。绝不循环调用 agy；绝不让 agy 回调 DSH。

### 时序

```
agy_run
  └─ runSync ──▶ 结果 res
       ├─ res.ok?                         ──▶ 返回成功
       ├─ !isLimited(res)?                ──▶ 原样返回错误
       └─ isLimited(res):
            askFallback(exec, res)
              ├─ 无真人应答者              ──▶ 返回错误
              ├─ 选「回退」                ──▶ 返回 { fallback:true, FALLBACK_TO_DSH }
              ├─ 选「重试」且 attempt<2     ──▶ 再跑一次
              └─ 选「不回退」              ──▶ 原样返回错误
```

---

## 二、实时状态灯（仅动态形态）

### 位置与外观

状态灯注册在浏览器会话标题栏右侧的 Slot `conversation.session.header.utilities`（`id: agy-indicator`），是一枚「彩色圆点 + 文案」的小胶囊，鼠标悬停显示 `state / running / last / conv` 详情。

| 状态 `state` | 圆点颜色（主题 token） | 文案 |
| --- | --- | --- |
| `running` | 品牌色 `--dsw-alias-brand-primary`（呼吸动画） | `AGY 工作中`（并发多个时显示 `×N`） |
| `ok` | 成功色 `--dsw-alias-state-success-primary` | `AGY` |
| `failed` | 错误色 `--dsw-alias-state-error-primary` | `AGY 失败` |
| `fallback` | 警告色 `--dsw-alias-state-warn-primary` | `本地回退` |
| `idle` | 次要文字色 `--dsw-alias-label-secondary` | `AGY 就绪` |

所有颜色都取自 DSH 主题 token，因此自动适配明暗主题。

### 数据来源

Host 维护**按项目（cwd）分组**的内存状态快照，每次 agy 调用前后更新对应项目：

```js
projects[cwd] = { state, running, lastStatus, lastAt, lastConversationId, fallbackActive, current, trail, updatedAt }
begin(cwd)          // 该项目 running++，state='running'
end(res, cwd)       // 该项目 running--，据结果置 ok/failed/fallback；清空 current
foldStepUpdate(ev, cwd) // 逐行解析 stream-json 的 step_update 事件 → 该项目 current / trail
```

每个项目的 `current` 是该项目 agy **此刻正在执行的步骤**（工具名 + 参数，或 agent_response 思考/打字中）；`trail` 是最近 N 条步骤轨迹。它们由运行期间的增量解析实时填充，因此状态灯（**每项目一盏**）与 `agy_status` 工具都能在 agy 运行中就显示「它正在干什么」。

Host 通过 `harness.handle('agy_status', () => snapshot())` 暴露只读快照（含全局聚合 + `projects[]`）；Client 组件用 `ctx.interval` 每 1.2s `host.call('agy_status')` 拉取并按项目重渲染，tooltip 展示该项目 `current` 与最近 `trail`。这是标准的 Client→Host 包私有 RPC，快照只含标量字段，不含任何 Host 活对象引用。

### 一次性审批

Client 半首次运行时，DSH GUI 会请求审批（Cordis 的单勾/双勾授权机制）。批准后状态灯即出现。若会话禁用了审批提示，Client 半会被自动拒绝——此时回退弹窗仍可用，只是没有状态灯。

### 为什么 Preset 形态没有状态灯

Preset 是 Host 面组合，其 `.mjs` 只在 Node 侧运行、不含浏览器 UI。要在 Preset 形态也常驻状态灯，需要额外发布一个 Client 插件 bundle（并配合 `pnpm run dev:web` 重建），不在本插件范围内。回退弹窗是 Host 能力，两种形态都具备。
