# 交接入口（新会话先读这里）

> 生成于 2026-09-11，agy-first-bridge 开发会话收尾。本目录 + 仓内文档构成全部交接素材。

## 30 秒恢复上下文

```powershell
cd C:\Users\lcl\Desktop\agy-first-bridge
git pull                        # HEAD 应为 4e04767 或更新
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

## 本机部署状态（重要）

- `profiles/web` 已迁移为主包名形态：`node_modules/agy-first-bridge` 是 junction → 本仓；`bundles` 名单、pnpm-lock 均已对齐；旧包备份在 `dsh-home/backups/pkg-20260910/`。
- `dsh-home/bin/agy-mcp-server.mjs` = v1.6.2、`codebuddy-mcp-server.mjs` = v1.1.9（已同步）。
- ⚠️ **1.6.2 的灯修复需要重启 DSH Desktop 才进运行时**（node_modules bundle 不支持补丁热替 host 半）。重启后用任一 agy 调用验证灯亮即可。

## 维护高频事项

- **发版流程**：改代码 → 三处版本（package.json / mcp VERSION / CHANGELOG 顶部条目）→ `npm run check` → commit + `git tag vX.Y.Z` → push（含 tags）→ `npm publish`（prepack 自动过 verify）→ `gh release create`（latest 指向新 tag）。网络抖动时 npm PUT 会 ECONNRESET 但实际已暂存，等 ~60s 后查 registry 再决定重试，避免 409 假象。
- **client.js 注册 id 永远 === 主包名 `agy-first-bridge`**（dsh-client-modules arrive() 契约，verify 已钉死）。
- **DSH 升级时**：先看新 `dsh-client-modules` 的 arrive() 是否仍与本仓指纹一致（`audit/fingerprints/` 对比），再决定 SUPPORT.md 支持的上下限。
- 姊妹仓 `codebuddy-first-bridge`（C:\Users\lcl\Desktop\codebuddy-bridge）latest=1.1.9，同款闸门在 `scripts/verify.mjs`。
