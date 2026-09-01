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
// 路由返回 JSON：{ state, running, projects[], presetActive }。
// presetActive=true 表示当前有 agy 优先会话在线 → 家级灯常驻显示（idle 也
// 显示 "AGY 就绪"）；presetActive=false 时家级灯仅在有项目数据时显示
// （调用 agy 时临时出现：运行/回退期间显示，ok/failed 结果短暂保留 8 秒后
// 隐藏，空闲时标题栏无灯）。
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
  // 是否有 agy 优先会话在线（preset 挂载时 emit 'agy/mode' 置真）
  let presetActive = false

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

  // preset 形态挂载时宣告 agy 优先模式（常驻灯依据）
  ctx.on('agy/mode', (payload) => {
    try {
      presetActive = !!(payload && payload.active)
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
            const now = Date.now()
            // 过滤过期的 idle 项目：避免残留假数据。
            // - presetActive（agy 优先模式）：ok/idle 项目保留展示，常驻灯
            //   反映最近活动（10 分钟 TTL）。
            // - 非 presetActive（普通模式）：用户要求「调用 agy 时显示即可」——
            //   灯只在运行/回退时出现；ok/failed 项目短暂保留 8 秒让用户
            //   看到结果后消失，空闲时标题栏无灯。
            const OK_HOLD_MS = presetActive ? 10 * 60 * 1000 : 8000
            const STALE_MS = 10 * 60 * 1000
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
            const body = JSON.stringify({ state, running, projects: list, presetActive })
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
