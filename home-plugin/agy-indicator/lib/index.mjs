// agy-indicator — host half.
//
// 收集各会话 agy-first-bridge 插件（preset 或动态形态）通过 ctx.emit('agy/status')
// 推送的 agy 运行快照，维护一张按项目（工作目录 cwd）索引的全局表，并通过
// webServer 注册 GET /agy-indicator/status 路由暴露给浏览器。
//
// 家级（cordis.patch.yml）插件运行在 host 组合的 root realm；会话内插件的
// ctx.emit 事件是 app 级广播，不受 isolate realm（只隔离服务）影响。
//
// 路由 handler 是标准 Node http (req, res)；返回 JSON：{ state, running, projects[] }。
// 客户端（lib/client.js）每 1.2s 轮询一次并按项目渲染状态灯。

export const name = 'agy-indicator'
export const inject = []
export function apply(ctx) {
  // cwd -> project record（全局视角：项目按工作目录唯一）
  const projects = Object.create(null)
  const MAX_PROJECTS = 24

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

  // 监听会话内 agy-first-bridge 的推送
  ctx.on('agy/status', (payload) => {
    try {
      const snap = payload && typeof payload === 'object' && payload.snapshot ? payload.snapshot : payload
      mergeSnapshot(snap)
    } catch (e) {
      // 快照合并失败不应影响宿主；忽略单次坏负载
    }
  })

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
            // 过滤过期的 idle 项目：超过 10 分钟未更新的非运行项目不再展示，
            // 避免残留假数据（同时保证灯只反映近期 agy 活动）。
            const STALE_MS = 10 * 60 * 1000
            const list = Object.keys(projects)
              .map((k) => projects[k])
              .filter((p) => p.running > 0 || p.fallbackActive || (now - (Number(p.updatedAt) || 0)) < STALE_MS)
              .sort((a, b) => b.updatedAt - a.updatedAt)
            const running = list.reduce((n, p) => n + p.running, 0)
            const state = running > 0 ? 'running' : (list.some((p) => p.fallbackActive) ? 'fallback' : (list.length ? 'ok' : 'idle'))
            const body = JSON.stringify({ state, running, projects: list })
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
