# agy-first-bridge 交接文档

> **交接日期**: 2026-10-07
> **插件版本**: 1.7.1
> **适配 DSH 版本**: 0.1.7-rc.1（当前本机）→ 0.2.0-rc.2（升级目标，已验证兼容）
> **源码位置**: `C:\Users\lcl\Desktop\DSH插件开发\agy-first-bridge`
> **npm**: https://www.npmjs.com/package/agy-first-bridge
> **GitHub**: https://github.com/new-256/agy-first-bridge

---

## 一、这个插件是什么

DeepSeek Harness 的桥接插件：把编码/构建/调试/排查等实际工作**优先派发给本机的 `agy` CLI**（`--dangerously-skip-permissions` 全程无提示，DSH 掌控），并在 **agy 限流/网络不通**时弹窗让用户选择是否回退到 DSH 本地 API 配置；同时在会话标题栏为每个项目（工作目录）提供一盏**实时状态灯**。

### 提供的三个模型工具

| 工具 | 作用 |
|---|---|
| `agy_run` | 派发任务到本机 agy CLI 执行 |
| `agy_continue` | 继续已有 agy 会话（复用 context） |
| `agy_status` | 实时返回各项目 agy 当前在做什么（当前步骤/轨迹/最近运行） |

另有一段"agy 优先策略提示"，让模型在所有模式下优先调用 agy，原生工具只用于只读查询和最终验证。

### 四种形态（同一套逻辑）

| 形态 | 位置 | 能力 | 持久 |
|---|---|---|---|
| Agent Preset（DSH 推荐） | `preset/agy-first/` | 工具+策略+回退弹窗 | ✅ |
| 家级状态灯插件 | `home-plugin/agy-indicator/` | 状态灯（自动加载无需审批） | ✅ |
| 动态 Cordis 插件 | `dynamic/` | 工具+策略+弹窗+灯（需一次性审批） | ❌ 会话内临时 |
| MCP 服务器 | `mcp/` | 供任何 MCP 宿主自动发现 | ✅ |

---

## 二、运行/加载机制

1. profile 的 `package.json` → `dsh.profile.bundles` 含 `"agy-first-bridge"`
2. 入口（`main`）：`home-plugin/agy-indicator/lib/index.mjs`
3. 家级插件经 `cordis.patch.yml` 注册，随 DSH 启动自动加载
4. Host 半（收集各会话状态 + HTTP 路由）+ Client 半（浏览器轮询渲染状态灯）

---

## 三、0.2.0 兼容性（已验证）

| 检查项 | 结论 |
|---|---|
| peerDependencies | **无声明** → 0.2.0 强制校验直接通过，**无需 version-exemption** |
| API 使用 | 仅靠 agy CLI + 自持逻辑，与 DSH 内部 API 解耦，低风险 |
| 版本历史关键适配 | v1.7.1 已针对上游 workflow-engine 改名（`dsh-workflow-worker-thread` → `dsh-workflow-ptc`）做自探测双行，preset 在各 release 线均可挂载 |

> 金标准验证：隔离目录安装 0.2.0-rc.2 + 本插件，用官方兼容性评估实跑通过（详见主交接文档）。

---

## 四、构建 / 测试 / 发布

- 无独立编译步骤（lib 为 `.mjs` 直接运行）；动态模板由 `scripts/` 生成
- 测试：见 `tests/`（`node --test`）
- **发布流程**：
  ```bash
  # 改代码 → bump package.json version + CHANGELOG → git commit + tag
  git tag vX.Y.Z && git push --tags
  npm publish --registry=https://registry.npmjs.org
  # 更新 profile 依赖 → 重启 DSH 验证
  ```
- ⚠️ npm 账号开了 2FA，发布需用**勾选 "Bypass 2FA" 的 Granular Token**（已配置），或加 `--otp=xxxxxx`

---

## 五、接手注意事项

1. 依赖的是**本机 `agy` CLI**，接手环境需先装好并配置好 agy 凭据；DSH 无法替代 agy 本身。
2. 状态灯按项目（cwd）分别显示，排查问题先确认对应工作目录。
3. 插件坚持"零 @deepseek-ai 运行时依赖"纪律，改代码勿轻易引入对 DSH 内部包的硬依赖。
4. 相关文档：`README.md`、`docs/ARCHITECTURE.md`、`MCP-POLICY.md`、`docs/DEV-DISCIPLINE.md`
