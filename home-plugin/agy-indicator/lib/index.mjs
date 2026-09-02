// agy-indicator — host half.
//
// 收集各会话 agy-first-bridge 插件（preset 或动态形态）推送的 agy 运行快照，
// 维护一张按项目（工作目录 cwd）索引的全局表，并通过 webServer 注册
// GET /agy-indicator/status 路由暴露给浏览器。
//
// 两个数据入口：
//   1. preset 形态（真 Node 模块，agy-first-bridge preset）：apply 时
//      ctx.emit('agy/mode', { active: true }) 宣告 agy 优先模式；每次状态
//      变化 ctx.emit('agy/status', { snapshot }) 推送快照。
//   2. 动态形态（当前会话的 cordis 动态插件，沙箱无 ctx.emit）：通过
//      ctx.provide 暴露的 agyCollector 服务调用 mergeSnapshot(snapshot) 推入。
//
// 家级（cordis.patch.yml）插件运行在 host 组合的 root realm；会话内插件的
// ctx.emit 事件是 app 级广播，不受 isolate realm（只隔离服务）影响。
//
// 路由返回 JSON：{ state, running, projects[], presetActive, lastModeAt }。
// presetActive 是「心跳租约」（TTL 75s，preset 每 30s 心跳续期）而非粘滞布尔
// （对齐 codebuddy-indicator v1.1.1）：最后一个 agy preset 会话关闭后租约到期
// 自动熄灭。家级 client 另按本会话 agentPreset 做 per-session 判定（agy preset
// 会话常驻 / 普通会话按需显示），这里的租约是其判定不可用（UNKNOWN）时的回退。
// 客户端（lib/client.js）每 1.2s 轮询一次并按项目渲染状态灯。

export const name = 'agy-indicator'
export const inject = []
export function apply(ctx) {
  // 池子额度（Google AI 套餐）查询：可选增强。
  // 若仓库脚本 bin/agy-quota.mjs 存在（AGY_QUOTA_SCRIPT 或默认路径），
  // GET /agy-indicator/quota 返回额度快照；否则返回 { ok:false }。
  // 独立于主状态路由，失败不影响灯本身。
  let quotaCache = { at: 0, data: null }
  const QUOTA_CACHE_MS = 5 * 60 * 1000
  const QUOTA_DEFAULT_SCRIPT = 'C:\\Users\\lcl\\Desktop\\agy-first-bridge\\bin\\agy-quota.mjs'
  const quotaScriptPath = process.env.AGY_QUOTA_SCRIPT || QUOTA_DEFAULT_SCRIPT
  ;(async () => {
    try {
      const { execFile } = await import('node:child_process')
      async function fetchQuota() {
        const now = Date.now()
        if (quotaCache.data && now - quotaCache.at < QUOTA_CACHE_MS) return quotaCache.data
        return new Promise((resolve) => {
          execFile('node', [quotaScriptPath, '--summary'], { timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
            let res
            if (err) { res = { ok: false, error: String(err.message || err) } }
            else {
              const m = String(stdout || '').match(/\{[\s\S]*\}/)
              res = m ? JSON.parse(m[0]) : { ok: false, error: 'no JSON' }
            }
            quotaCache = { at: Date.now(), data: res }
            resolve(res)
          })
        })
      }
      if (typeof ctx.inject === 'function') {
        ctx.inject(['webServer'], (webCtx) => {
          const ws = webCtx.get('webServer')
          if (!ws || typeof ws.register !== 'function') return
          webCtx.effect(() => ws.register({
            kind: 'exact',
            path: '/agy-indicator/quota',
            handler: async (req, res) => {
              try {
                const q = await fetchQuota()
                res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
                res.end(JSON.stringify(q))
              } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }))
              }
            }
          }), 'agy-indicator: quota route')
        })
      }
    } catch (e) {
      // child_process 不可用：跳过额度路由（家级灯仍正常工作）
    }
  })()

  // cwd -> project record（全局视角：项目按工作目录唯一）
  const projects = Object.create(null)
  const MAX_PROJECTS = 24
  // 是否有 agy 优先会话在线（preset 挂载时 emit 'agy/mode' 续租）。
  // presetActive 是「心跳租约」而非粘滞标志（对齐 codebuddy-indicator v1.1.1）：
  // preset 每 30s 宣告一次 active:true，TTL 75s（≈两拍容差，容忍事件循环抖动）。
  // 最后一个 agy-first 会话关闭后心跳停止，租约到期自动熄灭 —— 否则任何会话
  // 加载过一次 preset 之后，所有会话（含非 agy 模式）的标题栏都会常驻灯。
  // 家级 client 另做 per-session 判定（本会话 agentPreset 才是常驻的真正依据），
  // 这里的租约是客户端判定不可用（UNKNOWN）时的回退。
  const PRESET_TTL_MS = 75000
  let presetActiveUntil = 0
  let lastModeAt = 0

  function projectName(cwd) {
    const s = String(cwd || '')
    const parts = s.split(/[\\/]/).filter(Boolean)
    return parts.length ? parts[parts.length - 1] : s
  }

  function mergeSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return
    const list = Array.isArray(snap.projects) ? snap.projects : (snap.cwd ? [snap] : [])
    for (const p of list) {
      if (!p || !p.cwd) continue
      projects[p.cwd] = {
        cwd: p.cwd,
        name: p.name || projectName(p.cwd),
        state: p.state || 'idle',
        running: Number(p.running) || 0,
        current: p.current || null,
        trail: Array.isArray(p.trail) ? p.trail.slice(-12) : [],
        lastStatus: p.lastStatus || null,
        lastAt: p.lastAt || 0,
        lastConversationId: p.lastConversationId || null,
        fallbackActive: !!p.fallbackActive,
        updatedAt: Number(p.updatedAt) || Date.now()
      }
    }
    // 淘汰超龄 idle 项目，防止表无限增长
    const keys = Object.keys(projects)
    if (keys.length > MAX_PROJECTS) {
      const stale = keys
        .map((k) => projects[k])
        .filter((p) => p.running === 0 && !p.fallbackActive)
        .sort((a, b) => a.updatedAt - b.updatedAt)
      const drop = Math.max(0, keys.length - MAX_PROJECTS)
      for (let i = 0; i < drop && i < stale.length; i++) delete projects[stale[i].cwd]
    }
  }

  // preset 形态挂载时宣告 agy 优先模式（常驻灯依据）。active:true 续租；
  // active:false 立即熄灭（preset 当前不主动发 false——依赖租约到期——但收到
  // 即尊重，面向未来语义完整）。
  ctx.on('agy/mode', (payload) => {
    try {
      if (payload && payload.active) {
        presetActiveUntil = Date.now() + PRESET_TTL_MS
        lastModeAt = Date.now()
      } else {
        presetActiveUntil = 0
      }
    } catch (e) { /* ignore */ }
  })

  // 监听会话内 agy-first-bridge（preset 形态）的事件推送
  ctx.on('agy/status', (payload) => {
    try {
      const snap = payload && typeof payload === 'object' && payload.snapshot ? payload.snapshot : payload
      mergeSnapshot(snap)
    } catch (e) {
      // 快照合并失败不应影响宿主；忽略单次坏负载
    }
  })

  // ── MCP 形态桥接（读盘合并）────────────────────────────────────────────
  // mcp__agy__* 工具由 agy-mcp-server.mjs（dsh-mcp-client 拉起的独立子进程）
  // 执行，它没有 ctx 无法 emit；约定把状态写到本插件目录下的 mcp-live.json
  // （AGY_MCP_LIVE_FILE 可覆盖，默认 <dsh-home>/plugins/agy-indicator/）。
  // 这里在每次 status 请求（client 每 1.2s 轮询）时读盘合并，MCP 会话的
  // 运行/结果即可进同一张 projects 表 → 普通模式调用 mcp__agy__ 也有灯。
  const MCP_LIVE_FILE = process.env.AGY_MCP_LIVE_FILE
    || new URL('../mcp-live.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ')
  let liveReadAt = 0
  const LIVE_READ_MIN_MS = 400
  let fsRead = null
  let fsExists = null
  ;(async () => {
    try {
      const fs = await import('node:fs')
      fsRead = fs.readFileSync
      fsExists = fs.existsSync
    } catch (e) { fsRead = null; fsExists = null }
  })()
  function mergeLiveFile() {
    if (!fsRead || !fsExists) return
    const now = Date.now()
    if (now - liveReadAt < LIVE_READ_MIN_MS) return
    liveReadAt = now
    try {
      if (!fsExists(MCP_LIVE_FILE)) return
      const text = fsRead(MCP_LIVE_FILE, 'utf8')
      if (!text) return
      const data = JSON.parse(text)
      if (!data || !Array.isArray(data.projects)) return
      mergeSnapshot({ projects: data.projects })
    } catch (e) { /* 无文件/坏 JSON：忽略 */ }
  }

  // 暴露服务给动态形态（沙箱无 ctx.emit，通过服务方法推入）。
  // 注意：该服务被 ctx.provide 后，会话内动态插件可 ctx.get('agyCollector')。
  // 防御：若已被注册（理论上 client-entry.mjs 占位保证裸名行不再加载本文件，
  // 双保险防止同进程重复 apply 时二次注册同名服务导致启动崩溃），跳过。
  try {
    ctx.provide('agyCollector', { mergeSnapshot })
  } catch (e) { /* already provided */ }

  // webServer 就绪后注册路由（用 ctx.inject 子纤维等待晚就绪服务，同 bot-gateway）
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      const ws = webCtx.get('webServer')
      if (!ws || typeof ws.register !== 'function') return
      webCtx.effect(() => ws.register({
        kind: 'exact',
        path: '/agy-indicator/status',
        handler: (req, res) => {
          try {
            // 先并入 MCP server 写盘的状态（若存在），再组装响应
            mergeLiveFile()
            const now = Date.now()
            // presetActive = 租约未到期（还有 agy preset 会话在心跳）
            const presetActive = now < presetActiveUntil
            // 过滤过期的项目：避免残留假数据。
            // ok/failed 统一短暂保留（8s）——任何会话（含 agy 优先）的常驻
            // 「就绪灯」由 client 端按本会话 preset 判定（readyShow）提供，
            // 不依赖旧 ok 项目在表里滞留；否则全局表跨会话共享时，一个
            // agy preset 会话的心跳（presetActive=true）会让所有普通会话的
            // ok 结果保留 10 分钟不消失。running/回退期间恒保留。
            const OK_HOLD_MS = 8000
            const STALE_MS = 10000
            const list = Object.keys(projects)
              .map((k) => projects[k])
              .filter((p) => {
                const age = now - (Number(p.updatedAt) || 0)
                if (p.running > 0 || p.fallbackActive) return true
                if (p.state === 'running') return true
                if (p.state === 'ok' || p.state === 'failed') return age < OK_HOLD_MS
                return age < STALE_MS
              })
              .sort((a, b) => b.updatedAt - a.updatedAt)
            const running = list.reduce((n, p) => n + p.running, 0)
            const state = running > 0 ? 'running' : (list.some((p) => p.fallbackActive) ? 'fallback' : (list.length ? 'ok' : 'idle'))
            const body = JSON.stringify({ state, running, projects: list, presetActive, lastModeAt })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
            res.end(body)
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: String(e && e.message || e) }))
          }
        }
      }), 'agy-indicator: status route')
    })
  }
}
