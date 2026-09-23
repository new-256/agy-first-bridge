// tests/preset-workflow.test.mjs — 工作流引擎跨版本行的行为回归。
//
// 静态闸门（scripts/verify.mjs §6）只能证明"两行 + 守卫存在"；这里证明**语义**：
// 在模拟的 modern / legacy / 未知 三种 dsh 解析树下，两个 !!js 守卫的取值必须
// 恰好让**一个且仅一个**引擎行启用，且任何情况下都不抛异常（抛异常会让
// composition-inventory 把该行判为 'conditional'，行为不可预期）。
//
// 解析器与求值器都取自本机安装的 DSH 本体，不复制实现：
//   - cordis-plugin-include 的 entryListSchema（js-yaml 方言，!!js → __jsExpr）
//   - cordis-plugin-loader 的 evaluate()（preset 挂载时真正用的求值器）
// 若本机没有 DSH，则跳过并明确说明（不伪装成通过）。

import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0, skipped = 0
function check(label, cond) {
  if (cond) { pass++; console.log('ok: ' + label) }
  else { fail++; console.error('FAIL: ' + label) }
}

const DSH_NM = process.env.DSH_NODE_MODULES || 'C:/Users/lcl/AppData/Roaming/DSH Desktop/backend/dsh/node_modules'
const incPath = join(DSH_NM, '@deepseek-ai', 'cordis-plugin-include', 'lib', 'index.js')
const loaderPath = join(DSH_NM, '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js')
const jsyamlPath = join(DSH_NM, 'js-yaml', 'index.js')

if (!existsSync(incPath) || !existsSync(loaderPath) || !existsSync(jsyamlPath)) {
  console.log(`SKIP: local DSH not found at ${DSH_NM} — set DSH_NODE_MODULES to run this suite`)
  process.exit(0)
}

const inc = await import(pathToFileURL(incPath).href)
const { evaluate } = await import(pathToFileURL(loaderPath).href)
const jsyaml = (await import(pathToFileURL(jsyamlPath).href)).default

// ── 用真实的 entryListSchema 解析仓库里的 preset（整文件，非片段）────────────
const presetPath = join(root, 'preset', 'agy-first', 'agent.cordis.yml')
const parsed = jsyaml.load(readFileSync(presetPath, 'utf8'), { schema: inc.entryListSchema })
check('preset parses with the real entry-list schema', Array.isArray(parsed))

// 递归展开 group 行，取出两个工作流引擎行及其 !!js 守卫
function collect(rows, found = []) {
  for (const row of rows) {
    if (row && row.group === true) { collect(row.config || [], found); continue }
    if (row && typeof row.name === 'string') found.push(row)
  }
  return found
}
const flat = collect(parsed)
const ptcRow = flat.find((r) => r.name === '@deepseek-ai/dsh-workflow-ptc')
const wtRow = flat.find((r) => r.name === '@deepseek-ai/dsh-workflow-worker-thread')

check('preset carries a dsh-workflow-ptc row', !!ptcRow)
check('preset carries a dsh-workflow-worker-thread row', !!wtRow)
check('workflow-ptc row has a !!js disabled guard',
  !!(ptcRow && ptcRow.disabled && typeof ptcRow.disabled === 'object' && '__jsExpr' in ptcRow.disabled))
check('workflow-worker-thread row has a !!js disabled guard',
  !!(wtRow && wtRow.disabled && typeof wtRow.disabled === 'object' && '__jsExpr' in wtRow.disabled))

if (!ptcRow || !wtRow) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1) }

const ptcExpr = ptcRow.disabled.__jsExpr
const wtExpr = wtRow.disabled.__jsExpr

// ── 构造三种解析树，用真实求值器判定 ────────────────────────────────────────
const scratch = join(root, '.tmp-workflow-test')
function makeTree(name, pkgs) {
  const base = join(scratch, name)
  rmSync(base, { recursive: true, force: true })
  const nm = join(base, 'node_modules', '@deepseek-ai')
  mkdirSync(nm, { recursive: true })
  for (const p of pkgs) {
    mkdirSync(join(nm, p), { recursive: true })
    writeFileSync(join(nm, p, 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/' + p, version: '0.0.0', main: 'index.js' }))
    writeFileSync(join(nm, p, 'index.js'), '')
  }
  const cliDir = join(nm, 'dsh', 'lib')
  mkdirSync(cliDir, { recursive: true })
  writeFileSync(join(cliDir, 'bin.js'), '')
  return join(cliDir, 'bin.js').replaceAll('\\', '/')
}

const ctx = { baseUrl: pathToFileURL(presetPath).href }
function decide(bin) {
  const saved = process.argv[1]
  process.argv[1] = bin
  let ptc, wt
  try { ptc = evaluate(ctx, ptcExpr) } catch (e) { ptc = 'THREW:' + e.message }
  try { wt = evaluate(ctx, wtExpr) } catch (e) { wt = 'THREW:' + e.message }
  process.argv[1] = saved
  return { ptc, wt }
}

const cases = [
  ['modern runtime (ships workflow-ptc)', makeTree('modern', ['dsh-workflow-ptc']), true, false],
  ['legacy runtime (ships workflow-worker-thread)', makeTree('legacy', ['dsh-workflow-worker-thread']), false, true],
  ['unknown runtime (ships neither)', makeTree('empty', []), false, false],
]

for (const [label, bin, wantPtcEnabled, wantWtEnabled] of cases) {
  const { ptc, wt } = decide(bin)
  check(`${label}: guard does not throw`, typeof ptc === 'boolean' && typeof wt === 'boolean')
  check(`${label}: ptc row ${wantPtcEnabled ? 'enabled' : 'disabled'}`, ptc === !wantPtcEnabled)
  check(`${label}: worker-thread row ${wantWtEnabled ? 'enabled' : 'disabled'}`, wt === !wantWtEnabled)
  // 关键不变量：绝不出现"两行同时启用"（引擎重复注册 / 冲突）
  check(`${label}: not both engines enabled`, !(ptc === false && wt === false))
}

// 真实运行环境（本进程 argv[1] 不是 dsh bin，故锚点应判为"未知"→ 两行都禁用，
// 但这只证明守卫是防御性的：真正的判定发生在 dsh 进程内，argv[1] 即 dsh/lib/bin.js）
const realBin = join(DSH_NM, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (existsSync(realBin)) {
  const { ptc, wt } = decide(realBin.replaceAll('\\', '/'))
  check('against the installed DSH tree: exactly one engine row is enabled',
    (ptc === false) !== (wt === false))
  check('against the installed DSH tree: workflow-ptc is the enabled one (0.1.7-rc.1)',
    ptc === false && wt === true)
}

rmSync(scratch, { recursive: true, force: true })

console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`)
process.exit(fail ? 1 : 0)
