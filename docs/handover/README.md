# 交接入口（新会话先读这里）

> 生成于 2026-09-11，agy-first-bridge 开发会话收尾；**2026-09-12 复核修订**（仓库迁移新路径 + 部署状态审计，见下）。本目录 + 仓内文档构成全部交接素材。

## 30 秒恢复上下文

```powershell
cd C:\Users\lcl\Desktop\DSH插件开发\agy-first-bridge   # 仓库已从 Desktop\agy-first-bridge 迁至此处
git pull                        # HEAD 应为 9bf47e9 或更新
node scripts/verify.mjs         # 22 项全过 = 仓库可信
npm view agy-first-bridge dist-tags.latest   # 应为 1.6.2
```

## 文件导引

| 路径 | 用途 |
|---|---|
| `../SUPPORT.md` | **DSH 逐版本支持声明**（下限 ≥0.1.2-rc.1，基准 0.1.5-rc.1） |
| `../issues/BACKEND-ISSUES.md` | 提给 DSH 后端 / 桌面壳的 3 条 issue 草案（B-1 挂载期校验 id、B-2 单 bundle 隔离、C 壳层单行隔离），可直接复制开 issue |
| `audit/compat-evidence.json` | 回测矩阵原始证据（9 版 client-modules + 7 版 web-app 指纹摘要） |
| `audit/fingerprints/` | 关键版本 `client.js` 的 arrive() 窗口全文 + SHA256，供复算 |
| `audit/dsh-versions-time.json` | `@deepseek-ai/dsh` 全部 20 个已发布版本及发布时间 |

另：`C:\Users\lcl\Desktop\DSH\handover.zip`（~795 KB）保存了**完整的回测 tarball 原料**（9 版 client-modules + 7 版 web-app 解包树），想独立复跑指纹验证时展开即用；不需要可删。

## 本机部署状态（2026-09-12 复核，重要）

桌面端真实 dsh-home = `C:\Users\lcl\AppData\Roaming\DSH Desktop\dsh-home`（`~/.dsh` 是 CLI 端另一套 home，其 `profiles/web` 现装市场插件集 + bot-bridge，与 bridge 无关，勿混淆）。bridge 共三层，复核实测：

| 层 | 载体 | 状态 |
|---|---|---|
| 宿主 MCP 全局 | `cordis.patch.yml` 的 `mcp-agy-global` 行 → `dsh-home\bin\agy-mcp-server.mjs`（v1.6.2，绝对路径） | ✅ 实测 SUCCESS（会话内 `mcp__agy__*` 工具来源） |
| Agent preset | `.agent-presets\cordis-agy\agy-first-bridge.mjs`（默认 preset：原生 agy_run/continue/status/quota + agy-first 策略） | ✅ 实测 SUCCESS（拷贝略旧于 1.6.2：缺 AGY_QUOTA_SCRIPT 覆盖，但 fallback 仍命中 `dsh-home\bin\agy-quota.mjs`，无功能损失） |
| Profile bundle | `dsh-home\profiles\web`：bundles 含 agy-first-bridge，依赖 `^1.6.2` registry 安装 | ✅ **09-12 闭环修复**：死链 junction 已拆、`file:` 依赖已改 registry、node_modules 已装 npm 1.6.2（tgz SHA512 与 registry 一致；18 个 shipped 文件 ≡ v1.6.2 tag，行尾 CRLF 差异除外）；工作树仅领先 README.md 文档更新 + verify.mjs Unreleased 容错两个未发版小改动 |

- **为什么搬家会断**：profile 层当初是开发态接线——`file:` 依赖 + junction 直指仓库工作副本（配合 `patchReload: live`，改仓即生效、免发版）。npm 上的 1.6.2 本身完好；断的只是这条指向桌面源码目录的开发链。对照：同 profile 的 codebuddy-first-bridge 走 `^1.1.7` registry 安装，不受仓库位置影响。
- **闭环已执行（09-12）**：备份（`package.json.bak-20260912-loopclose` / `pnpm-lock.yaml.bak-20260912-loopclose`）→ 拆死链 junction → 依赖改 `^1.6.2` → `npm pack` 下载并 SHA512 校验后解包至 node_modules → pnpm-lock 三处对齐（importers/packages/snapshots）→ 一致性核验（installed ≡ tag）。**待重启 DSH Desktop 后**：用任一 agy 调用验证灯亮；`GET /agy-indicator/status` 应出现 `projects` 条目（1.6.2 修复了 mcp-live.json 合并路径）。
- **遗留谜团（下个会话可查）**：重启前的运行进程（当天 19:55 启动）里 `/agy-indicator/status` 由一个**磁盘上找不到的旧实现**应答（指纹 = 1.5.15 时代：presetActive 粘滞、不合并 mcp-live.json、无 presetSessions）；已排除宿主 patch 10 行、全部 bundle 包、preset、backend、app.asar、updater 暂存（多轮 ignore-free 全盘 grep）。重启后观察该路由是否被 1.6.2 实现接管即可定位其来源。
- 家级 `agy-indicator` 独立行已注释退役；`dsh-home\plugins\agy-indicator\` 现仅存 MCP 子进程写的 `mcp-live.json` 桥接快照（1.6.2 修的正是该文件路径解析）。旧包备份（含 `agy-indicator.bak-1.5.15` 完整旧实现）在 `dsh-home\backups\pkg-20260910/`；`bin\codebuddy-mcp-server.mjs` = v1.1.9（已同步）。

## 维护高频事项

- **开发纪律（必读）**：[docs/DEV-DISCIPLINE.md](../DEV-DISCIPLINE.md) —— 开发-制品闭环七条纪律；发布后本机部署必须切换制品形态，开发态接线不可跨会话存活。
- **发版流程**：改代码 → 三处版本（package.json / mcp VERSION / CHANGELOG 顶部条目）→ `npm run check` → commit + `git tag vX.Y.Z` → push（含 tags）→ `npm publish`（prepack 自动过 verify）→ `gh release create`（latest 指向新 tag）。网络抖动时 npm PUT 会 ECONNRESET 但实际已暂存，等 ~60s 后查 registry 再决定重试，避免 409 假象。
- **client.js 注册 id 永远 === 主包名 `agy-first-bridge`**（dsh-client-modules arrive() 契约，verify 已钉死）。
- **DSH 升级时**：先看新 `dsh-client-modules` 的 arrive() 是否仍与本仓指纹一致（`audit/fingerprints/` 对比），再决定 SUPPORT.md 支持的上下限。
- 姊妹仓 `codebuddy-first-bridge`（C:\Users\lcl\Desktop\codebuddy-bridge）latest=1.1.9，同款闸门在 `scripts/verify.mjs`。
