// tests/preset-resolve.test.mjs — preset 的"每一行都必须可解析"总闸门。
//
// 为什么这是**通用**护栏，而不只是工作流引擎的补丁测试：
// `@deepseek-ai/dsh-agent-preset-registry` 的 mountPreset() 在挂载后跑
// auditRows()，遍历每个 enabled 行并 await fiber.await()；**任一行导入失败即
// `throw new Error(audit.failed.join("\n"))`，拒绝整个 preset 挂载**。
// 也就是说上游对 preset 里**任何**一个包改名 / 下线 / 调整子路径导出，症状都是
// "agy-first 预设整体不可用"，而不是丢那一个工具。v1.7.1 修的就是这个形状的
// 事故（dsh-workflow-worker-thread → dsh-workflow-ptc）。
//
// 本测试对 preset 里**每一个 enabled 行**做真实的模块解析（裸包名走
// createRequire(运行中 CLI 的 argv[1])，相对路径行查文件是否存在），因此任何
// 上游改名都会在 CI / 本地立刻暴露成"哪一行挂了"，而不是等到用户会话起不来。
//
// disabled 行按 auditRows() 的语义跳过（它 `continue` 掉 disabled 行，不判失败）
// —— 这正是 v1.7.1 双行自证方案得以成立的前提，故此处必须与之保持一致。

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
function check(label, cond) {
  if (cond) { pass++; console.log('ok: ' + label) }
  else { fail++; console.error('FAIL: ' + label) }
}

const DSH_NM = process.env.DSH_NODE_MODULES || 'C:/Users/lcl/AppData/Roaming/DSH Desktop/backend/dsh/node_modules'
const incPath = join(DSH_NM, '@deepseek-ai', 'cordis-plugin-include', 'lib', 'index.js')
const loaderPath = join(DSH_NM, '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js')
const jsyamlPath = join(DSH_NM, 'js-yaml', 'index.js')
const binPath = join(DSH_NM, '@deepseek-ai', 'dsh', 'lib', 'bin.js')

if (!existsSync(incPath) || !existsSync(loaderPath) || !existsSync(jsyamlPath) || !existsSync(binPath)) {
  console.log(`SKIP: local DSH not found at ${DSH_NM} — set DSH_NODE_MODULES to run this suite`)
  process.exit(0)
}

const inc = await import(pathToFileURL(incPath).href)
const { evaluate } = await import(pathToFileURL(loaderPath).href)
const jsyaml = (await import(pathToFileURL(jsyamlPath).href)).default

const presetPath = join(root, 'preset', 'agy-first', 'agent.cordis.yml')
const presetUrl = pathToFileURL(presetPath).href
const rows = jsyaml.load(readFileSync(presetPath, 'utf8'), { schema: inc.entryListSchema })
check('preset parses with the real entry-list schema', Array.isArray(rows))

// 展平 group 行，保留层级 id 便于报错定位
function walk(list, out = [], prefix = '') {
  for (const row of list) {
    const id = (prefix ? prefix + '/' : '') + (row.id || '?')
    if (row.group === true) { walk(row.config || [], out, id); continue }
    out.push({ id, name: row.name, disabled: row.disabled })
  }
  return out
}
const flat = walk(rows)
check('preset declares at least one plugin row', flat.length > 0)
check('every row declares a name string', flat.every((r) => typeof r.name === 'string' && r.name !== ''))

// 与 dsh 进程一致：以运行中 CLI 的 argv[1] 为解析基准
const liveArgv = process.argv[1]
process.argv[1] = binPath.replaceAll('\\', '/')
const requireFromCli = process.getBuiltinModule('node:module').createRequire(process.argv[1])
const ctx = { baseUrl: presetUrl }

const isExpr = (v) => v && typeof v === 'object' && '__jsExpr' in v
const enabled = [], disabled = []
for (const row of flat) {
  let d
  if (isExpr(row.disabled)) {
    try { d = Boolean(evaluate(ctx, row.disabled.__jsExpr)) }
    catch (e) { d = `THREW:${e.message}` }
  } else d = Boolean(row.disabled)
  check(`row ${row.id}: disabled guard evaluates to a boolean`, typeof d === 'boolean')
  ;(d === true ? disabled : enabled).push(row)
}
process.argv[1] = liveArgv

console.log(`\n  ${enabled.length} enabled row(s), ${disabled.length} disabled (skipped by auditRows)\n`)

// ── 核心断言：每个 enabled 行都必须可解析 ───────────────────────────────────
const broken = []
for (const row of enabled) {
  if (row.name.startsWith('.')) {
    // 相对路径行：loader 用 new URL(name, baseUrl) 解析，等价于"文件必须存在"
    const target = fileURLToPathSafe(new URL(row.name, presetUrl))
    const ok = target !== null && existsSync(target)
    check(`enabled row ${row.id} (${row.name}) resolves to an existing file`, ok)
    if (!ok) broken.push([row.id, row.name, 'file not found'])
    continue
  }
  let err = null
  try { requireFromCli.resolve(row.name) } catch (e) { err = e.code || e.message }
  check(`enabled row ${row.id} (${row.name}) resolves in the live dsh tree`, err === null)
  if (err) broken.push([row.id, row.name, err])
}

console.log('')
if (broken.length === 0) {
  console.log(`PASS: all ${enabled.length} enabled rows resolve — the preset will mount`)
} else {
  console.error(`FAIL: ${broken.length} enabled row(s) do not resolve; auditRows() would reject the ENTIRE preset mount:`)
  for (const [id, name, err] of broken) console.error(`   - ${id} (${name}): ${err}`)
}

function fileURLToPathSafe(url) {
  try { return fileURLToPath(url) } catch { return null }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
