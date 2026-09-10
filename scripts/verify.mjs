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
const logMatch = changelog.match(/^## \[([^\]]+)\]/m)

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

process.exit(failed ? 1 : 0)
