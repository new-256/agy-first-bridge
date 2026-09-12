# 开发纪律：开发-制品闭环（DEV DISCIPLINE）

> 制度化于 2026-09-12 —— 由 agy-first-bridge 仓库迁移断链事故确立（见文末事故背景）。
> 本纪律适用于本机**所有 DSH 插件**的开发与部署；本仓的发布操作细节见
> [handover/README.md](handover/README.md)「维护高频事项」。

## 闭环流程（每版必走，缺一环不算完成）

```
开发 → 测试 → 提交仓库 → 发版（tag + npm publish）
     → 卸载本地开发态接线
     → 从制品源安装（registry / 固定 tag）
     → 测试（含需要重启的运行时验证）
     → 对比一致性（已安装 ≡ 发布 tag）
     → 闭环备案（写入交接文档并提交）
     → 等待下一次修订
```

加粗环节（卸载开发态 → 制品安装 → 一致性对比 → 备案）最常被跳过，也全部是事故来源。

## 七条纪律

1. **交付即制品**：版本发布并验证通过后，本机部署必须切换到**制品形态**（registry 安装，如 `^1.6.2`）。禁止让 `file:` 依赖 / junction 直连仓库工作副本的开发态接线跨会话存活。
2. **开发态是临时的**：开发态接线（`file:` + junction + `patchReload: live`）仅限活跃开发会话内使用，用于「改仓即生效、免发版」；会话收尾时必须拆除，或在交接文档中显式标注「当前为开发态 + 接线位置」。
3. **路径解耦**：部署配置（`package.json` / `pnpm-lock.yaml` / `cordis.patch.yml`）中禁止出现指向**易变路径**（桌面、用户目录、可迁移的仓库位置）的引用。一律使用 registry 包名或长期稳定路径；确需本地引用（如 tgz），把 tgz 本身视为制品并放在稳定位置。
4. **完整性校验**：从制品源安装必须校验完整性——`npm pack` 下载后比对 tgz SHA512 与 `npm view <pkg>@<ver> dist.integrity`，逐字节一致才算数；手工部署也不例外。
5. **一致性核验**：安装后对比「已安装文件 vs 发布 tag」：文件清单 + 内容哈希（行尾 CRLF/LF 需归一化后再比）。任何差异必须逐项归因（未发版改动 / 构建产物差异），不允许存在未解释的差异。本仓可参考姊妹仓 `codebuddy-first-bridge` 的 `scripts/audit-npm-sync.mjs` 思路。
6. **交接文档反映真实形态**：交接 / 部署文档必须记录**当前真实部署形态**（制品态还是开发态）、各层版本、验证方法；「待重启验证」的变更要写明验证步骤。文档描述与实际不符时，以实测为准并立即修订文档。
7. **闭环备案**：闭环执行记录（备份文件名、完整性校验值、对比结论、提交号）写入交接文档并提交进仓库。

## 本机部署形态速查（本仓三层）

| 层 | 载体 | 形态 |
| --- | --- | --- |
| 宿主 MCP 全局 | `dsh-home\cordis.patch.yml` 的 `mcp-agy-global` 行 → `bin\agy-mcp-server.mjs` | 稳定绝对路径 + 自包含拷贝（路径解耦 ✓） |
| Agent preset | `dsh-home\.agent-presets\cordis-agy\agy-first-bridge.mjs` | 自包含拷贝（不依赖仓库位置 ✓；重大修复需手动同步） |
| Profile bundle | `dsh-home\profiles\web`（依赖 `^1.6.2` registry 安装） | **制品态**（2026-09-12 闭环修复后 ✓） |

## 事故背景（为什么有这份纪律）

2026-09-12：`agy-first-bridge` v1.6.2 发布验证通过后，本机 profile 层仍保留着
`file:C:/Users/lcl/Desktop/agy-first-bridge` 依赖 + `node_modules\agy-first-bridge`
junction 直连仓库工作副本的开发态接线。仓库目录随后迁移到
`Desktop\DSH插件开发\agy-first-bridge`，junction 悬空 → **状态灯 bundle 静默失效**
（宿主层走绝对路径、preset 层是自包含拷贝，两者幸存——这解释了为什么工具仍可用而灯不亮，
排查耗时远超开发本身）。当日执行闭环修复：拆死链 → registry 安装 1.6.2（tgz SHA512 与
registry 一致）→ 18 个 shipped 文件与 `v1.6.2` tag 逐文件核验一致 → pnpm-lock 三处对齐 →
闭环备案（提交 `42ccbd4`）。

**教训：开发态接线是有保质期的债——发布之日就是还债之时。**
