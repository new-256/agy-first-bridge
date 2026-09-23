// 生成 bundle patch 的 preset 声明行：把 preset/agy-first/agent.cordis.yml
// verbatim 转录为 home-plugin/agy-indicator/cordis.patch.yml 里的
// preset-cordis-agy 声明（新版 DSH 预设机制：bundle patch 声明行，
// 替代 legacy .agent-presets 目录机制——新版已不再读该目录）。
//
// 转录规则（照官方 editing-cordis-compositions skill 的迁移指引）：
//   - id 取目录名 cordis-agy
//   - name/description 取 preset.yml
//   - order 缺省则给 5
//   - plugins 从 agent.cordis.yml verbatim（缩进整体 +4）
//   - 相对行 './agy-first-bridge.mjs' → './preset/agy-first/agy-first-bridge.mjs'
//     （声明行在包根 patch，解析基准是包根，不再是指定 presetDir）
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = ROOT + 'preset/agy-first/agent.cordis.yml'
const DST = ROOT + 'home-plugin/agy-indicator/cordis.patch.yml'

const src = readFileSync(SRC, 'utf8')
const lines = src.split(/\r?\n/)

// 去掉尾部空行
while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()

// 转录 plugins：行整体缩进 +10（`plugins:` 键在 8 空格缩进处，YAML 块序列
// 项必须 ≥ 键缩进；官方 presets/*.patch.yml 模板用 10）
//
// 相对行改写：'./agy-first-bridge.mjs' → 裸子路径 'agy-first-bridge/preset-plugin'。
// preset mount 的 baseUrl 不指向包内任何已知目录（实测 ./ 与 ../../ 均挂起），
// 相对形态不可移植；裸名走 Node 模块解析（同 host 侧行 name: agy-first-bridge），
// 经 package.json exports 的 "./preset-plugin" 子路径定位插件文件，机器无关。
const plugins = lines.map((l) => {
  if (l.trim() === '') return ''
  if (l.includes("./agy-first-bridge.mjs")) {
    return '          ' + l.replace("'./agy-first-bridge.mjs'", "'agy-first-bridge/preset-plugin'")
  }
  return '          ' + l
}).join('\n')

const header = `# agy-indicator — bundle 补丁层（并入主包 agy-first-bridge v1.6.0）
#
# 本文件由 DSH 插件系统在安装后自动作为 profile 的 bundle 层挂载：
#   dsh plugin --profile web add agy-first-bridge      (npm registry)
#   dsh plugin --profile web add <本地包路径>           (本地安装)
# 声明位置: 主包 package.json 的 dsh.bundle.patch。
#
# host 半用裸包名 agy-first-bridge 解析（主包 package.json main →
# home-plugin/agy-indicator/lib/index.mjs）；client 半（浏览器）靠
# 主包 package.json 的 dsh.client 声明被宿主 client-modules 自动纳入
# 花名册，无需单独一行。
#
# 独立 npm 包 agy-indicator 自 v1.6.0 起弃用（留档不更新）；灯随主包分发。
# 旧式安装（复制本目录 + junction + 用户层裸包名 agy-indicator）仍受支持：
# 用户层 cordis.patch.yml 同 id 行后应用，整体覆盖本行。
# 此处只放通用默认值。机器特定配置请写在用户层补丁
#   Windows: %APPDATA%\\DSH Desktop\\dsh-home\\cordis.patch.yml
# 的同 id 行里 — 用户层后应用，按行 id 整体覆盖本行 config。
- insert:
    - id: agy-indicator
      name: agy-first-bridge

# ═════════════════════════════════════════════════════════════════════════════
# cordis-agy 预设声明（v1.7.1：迁移到新版 DSH 预设机制）
#
# DSH 0.1.6+ 弃用了 legacy 目录机制（$DSH_HOME/.agent-presets/<id>/，
# 含 preset.yml + agent.cordis.yml —— 官方 editing-cordis-compositions
# skill 明言 "Nothing reads that directory any more"），改为 bundle patch
# 声明行注册。症状：升级后 cordis-agy 从预设花名册消失，报
#   Unknown agent preset: cordis-agy (gateway/internal)
# 所有记录 agentPreset: cordis-agy 的旧会话 resume 失败。
#
# 本行按官方迁移指引生成（scripts/gen-preset-decl.mjs）：
#   - id 取 legacy 目录名 cordis-agy（旧会话头引用此 id，不可改）
#   - name/description 取 preset.yml；order 5（排在官方预设之后）
#   - plugins 从 agent.cordis.yml verbatim 转录
#   - 相对行 './agy-first-bridge.mjs' → 裸子路径 'agy-first-bridge/preset-plugin'
#     （preset mount 的 baseUrl 不指向包内已知目录，相对形态不可移植；
#     裸名走 Node 解析 + package.json exports 子路径，机器无关）
# 修改预设内容时：改 preset/agy-first/agent.cordis.yml，再跑
#   node scripts/gen-preset-decl.mjs
# 重新生成本声明行（不要手改 plugins 缩进块）。
# ═════════════════════════════════════════════════════════════════════════════
- insert:
    - id: preset-cordis-agy
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: cordis-agy
        name: Agy-First 执行代理
        description: >-
          完整编码 Agent（standard 全部能力），额外提供 agy_run/agy_continue
          工具并注入"agy 优先"策略：各种模式下先把实现、编辑、调试、构建、
          跨文件排查派给本机 agy CLI（DSH 完全控制、agy 无提示改文件、默认
          后台执行），原生工具仅用于只读查询与最终验证。
        order: 5
        plugins:
`

writeFileSync(DST, header + plugins + '\n')
console.log('written:', DST)
console.log('plugins lines:', lines.length)

