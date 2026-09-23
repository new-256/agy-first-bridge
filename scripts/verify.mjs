#!/usr/bin/env node
// scripts/verify.mjs — 发布元数据一致性闸门（npm run check / prepack 自动调用）。
//
// 为什么必须存在：v1.6.0 把灯并入主包后，client.js 的 __ModuleLoader__ 注册 id
// 仍写着旧内层包名 "agy-indicator"，而 client-modules 按主包名
// "agy-first-bridge" 生成 graph 行 id —— 全新安装时浏览器 arrive() 抛
//   'bundle ... loaded without registering "agy-first-bridge"'，
// combo 机制单模块失败糊掉整屏插件页（同款事故见 codebuddy-first-bridge 1.1.7）。
// 该错误只能在首启时暴露，npm publish 前无任何静态拦截。本脚本把这条契约钉死，
// 并顺带锁版本号与分发结构，防止回退。

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
function check(label, cond) {
  if (cond) { console.log('ok: ' + label) }
  else { console.error('FAIL: ' + label); failed = true }
}
function read(rel) { return readFileSync(join(root, rel), 'utf8') }

// ── 1. 版本号三处锁死：package.json ↔ MCP VERSION ↔ CHANGELOG 顶部 ───────────
const pkg = JSON.parse(read('package.json'))
const mcpSrc = read(join('mcp', 'agy-mcp-server.mjs'))
const changelog = read(join('docs', 'CHANGELOG.md'))

const mcpMatch = mcpSrc.match(/^const VERSION = '([^']+)'/m)
// Skip an "## [Unreleased]" ledger section if present — it is documentation
// that hasn't shipped yet, not the currently released version.
const logMatch = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)

check('mcp server declares VERSION', !!mcpMatch)
check('CHANGELOG has a top version entry', !!logMatch)
if (mcpMatch) check('version sync package.json == MCP VERSION (' + pkg.version + ')', pkg.version === mcpMatch[1])
if (logMatch) check('version sync package.json == CHANGELOG top (' + pkg.version + ')', pkg.version === logMatch[1])

// ── 2. 【核心】client 半注册 id 必须 === 主包名 ──────────────────────────────
// client-modules（@deepseek-ai/dsh-client-modules）host 侧 locatePkgJson 解析
// loader 行裸名到 package.json，以其 name 作 graph 行 id；浏览器 arrive() 校验
// bundle 必须注册同名模块，否则抛错并使整批 combo 加载失败。
const clientSrc = read(join('home-plugin', 'agy-indicator', 'lib', 'client.js'))
const regMatch = clientSrc.match(/__ModuleLoader__\s*\.\s*load\s*\(\s*\{[\s\S]*?id:\s*["']([^"']+)["']/)
check('client.js contains a __ModuleLoader__.load registration', !!regMatch)
if (regMatch) {
  check(
    'client module id === main package name ("' + pkg.name + '"); got "' + (regMatch && regMatch[1]) + '"',
    regMatch[1] === pkg.name
  )
  // 显式禁止退回旧内层包名（双保险，错误信息更直白）
  check('client module id is NOT the deprecated inner-package name "agy-indicator"', regMatch[1] !== 'agy-indicator')
}

// ── 3. 标准 npm 分发形态（v1.6.0 合并）结构钉死 ─────────────────────────────
check('main package main points to indicator lib/index.mjs',
  pkg.main === './home-plugin/agy-indicator/lib/index.mjs')
check('main package exports ./client points to client.js',
  pkg.exports && pkg.exports['./client'] === './home-plugin/agy-indicator/lib/client.js')
check('main package exports ./package.json exposed',
  pkg.exports && pkg.exports['./package.json'] === './package.json')
check('main package declares dsh.client.platform=web',
  pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web')
check('main package declares dsh.bundle.patch',
  pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './home-plugin/agy-indicator/cordis.patch.yml')

const bundlePatch = read(join('home-plugin', 'agy-indicator', 'cordis.patch.yml'))
check('bundle patch layer has an insert row named after the MAIN package',
  /-\s+id:\s*agy-indicator\b/.test(bundlePatch) && /name:\s*agy-first-bridge\b/.test(bundlePatch))

// host 半的 MCP live 文件定位必须与安装布局无关（v1.6.2 回归护栏）：
// 合并主包下 index.mjs 在 <pkg>/home-plugin/agy-indicator/lib/，不能只靠
// new URL('../mcp-live.json')（会指到包内），必须用 detectDshHome/DSH_HOME
// 锚定 <dsh-home>/plugins/agy-indicator/mcp-live.json。
const hostSrc = read(join('home-plugin', 'agy-indicator', 'lib', 'index.mjs'))
check('host resolves MCP live file via DSH_HOME/detectDshHome (layout-independent)',
  /DSH_HOME/.test(hostSrc) && /plugins['",\s)]+agy-indicator['",\s)]+mcp-live\.json/.test(hostSrc))
check('host keeps AGY_MCP_LIVE_FILE explicit override first', /AGY_MCP_LIVE_FILE/.test(hostSrc))

// ── 4. 内层包：private（不得独立发布），结构自洽 ────────────────────────────
const hpPkgPath = join('home-plugin', 'agy-indicator', 'package.json')
if (existsSync(join(root, hpPkgPath))) {
  const hpPkg = JSON.parse(read(hpPkgPath))
  check('inner package agy-indicator is private (never republished)', hpPkg.private === true)
  check('inner package main is lib/index.mjs (no client-entry placeholder)', hpPkg.main === './lib/index.mjs')
  check('inner package version syncs with main package', hpPkg.version === pkg.version)
}

// ── 5. preset 组合结构要素（防止 YAML 宽容 loader 放行漂移）─────────────────
const cordis = read(join('preset', 'agy-first', 'agent.cordis.yml'))
check('agent.cordis.yml has bridge row id agy-first-bridge', /^- id: agy-first-bridge$/m.test(cordis))
check('agent.cordis.yml bridge row points to ./agy-first-bridge.mjs',
  /name:\s*['"]?\.\/agy-first-bridge\.mjs['"]?/.test(cordis))

const presetYml = read(join('preset', 'agy-first', 'preset.yml'))
check('preset.yml declares name', /^name:\s*\S+/m.test(presetYml))
check('preset.yml declares description', /^description:\s*\S+/m.test(presetYml))

// ── 6. 工作流引擎跨版本行（v1.7.1）──────────────────────────────────────────
// 上游把工作流引擎改名了：dsh-base ≤0.1.5-rc.3 发
// @deepseek-ai/dsh-workflow-worker-thread，≥0.1.6-alpha.1 发改名后的
// @deepseek-ai/dsh-workflow-ptc。两条发布线都还在服役（npm latest=0.1.5-rc.3
// 仍是 worker-thread，next/alpha=0.1.7-* 已是 ptc），所以写死任一个都会打断
// 另一条线。而 preset 行的 name 是**原样 import** 的（只有 config/disabled 走
// interpolate()），一行无法选包 —— 必须两行都声明、各自用 !!js disabled 自证。
// 一旦有人"简化"成单行写死包名，就会在另一半 dsh 上让整个 preset 挂载失败
// （auditRows() 见到任一 enabled 行 import 失败即拒绝整个 preset），故在此钉死。
const allIds = new Set((cordis.match(/^[ \t]*- id: (\S+)$/gm) || []).map((r) => r.trim().slice(6)))

check('preset declares the modern workflow engine row (workflow-ptc)', allIds.has('workflow-ptc'))
check('preset declares the legacy workflow engine row (workflow-worker-thread)',
  allIds.has('workflow-worker-thread'))

// 两行都必须带 !!js disabled 守卫，且守卫基于 process.argv[1] 探测解析基准。
// 用逐行扫描而非跨行正则，避免回溯歧义。
const lines = cordis.split('\n')
for (const id of ['workflow-ptc', 'workflow-worker-thread']) {
  const start = lines.findIndex((l) => new RegExp(`^[ \\t]*- id: ${id}$`).test(l))
  let body = ''
  if (start !== -1) {
    for (let i = start + 1; i < lines.length; i++) {
      if (/^[ \t]*- id: /.test(lines[i])) break
      body += lines[i] + '\n'
    }
  }
  check(`workflow row ${id} carries a !!js disabled guard`, /disabled:\s*!!js/.test(body))
  check(`workflow row ${id} guard probes process.argv[1] (live CLI resolution base)`,
    /process\.argv\[1\]/.test(body) && /createRequire/.test(body))
  // 两行都不得被无条件 disabled（那会让引擎在任何 dsh 上都不加载）
  check(`workflow row ${id} is not unconditionally disabled`, !/^[ \t]*disabled:\s*true\s*$/m.test(body))
}

// ── 7. 预设声明行（v1.7.1 注册机制迁移）─────────────────────────────────────
// DSH 0.1.6+ 不再读 $DSH_HOME/.agent-presets/<id>/（官方 skill 明言
// "Nothing reads that directory any more"），预设必须经 bundle patch 里的
// @deepseek-ai/dsh-agent-preset 声明行注册。声明行由 scripts/gen-preset-decl.mjs
// 从 preset/agy-first/agent.cordis.yml verbatim 转录生成 —— 两者一旦漂移
// （改了源文件忘了重跑生成器），GUI 里 cordis-agy 会重新挂载失败/内容过期。
// 此节钉死三件事：声明行存在、id/name/order 正确、plugins 与源文件一致。
const declMatch = bundlePatch.match(/^    - id: preset-cordis-agy$/m)
check('bundle patch declares the preset row (preset-cordis-agy)', !!declMatch)
check('bundle patch preset row registers @deepseek-ai/dsh-agent-preset',
  /name:\s*['"]@deepseek-ai\/dsh-agent-preset['"]/.test(bundlePatch))
check('bundle patch preset config id is cordis-agy (legacy session ids depend on it)',
  /^\s+id:\s*cordis-agy$/m.test(bundlePatch))
check('bundle patch preset bridge row uses the bare subpath (agy-first-bridge/preset-plugin)',
  /name:\s*['"]?agy-first-bridge\/preset-plugin['"]?/.test(bundlePatch))
check('package.json exports the ./preset-plugin subpath',
  pkg.exports && pkg.exports['./preset-plugin'] === './preset/agy-first/agy-first-bridge.mjs')

// verbatim 转录一致性：声明行 plugins 块 = 源文件每行去缩进（+10），
// 除 bridge 行的 name 从 './agy-first-bridge.mjs' 改写为裸子路径外逐行相同。
if (declMatch) {
  const srcLines = cordis.split('\n').map((l) => l.replace(/\r$/, ''))
  while (srcLines.length && srcLines[srcLines.length - 1].trim() === '') srcLines.pop()
  const patchLines = bundlePatch.split('\n')
  const declIdx = patchLines.findIndex((l) => l.trim() === '- id: preset-cordis-agy')
  // plugins 块从 'plugins:' 键之后开始
  let pi = declIdx
  while (pi < patchLines.length && !/^ {8}plugins:$/.test(patchLines[pi])) pi++
  const transcribed = []
  for (let i = pi + 1; i < patchLines.length; i++) {
    const l = patchLines[i]
    if (l === '' ) { transcribed.push(l); continue }
    if (/^ {0,8}\S/.test(l)) break // 缩进 ≤8 = 出了 plugins 块
    transcribed.push(l.slice(10))
  }
  while (transcribed.length && transcribed[transcribed.length - 1].trim() === '') transcribed.pop()
  const expect = srcLines.map((l) =>
    l.includes('./agy-first-bridge.mjs')
      ? l.replace("'./agy-first-bridge.mjs'", "'agy-first-bridge/preset-plugin'")
      : l)
  check('bundle patch plugins block is a verbatim transcription of agent.cordis.yml (' +
    expect.length + ' lines)', transcribed.join('\n') === expect.join('\n'))
}

process.exit(failed ? 1 : 0)
