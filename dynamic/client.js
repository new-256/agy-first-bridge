// dynamic/client.js
//
// code.client body for the in-session (dynamic) Cordis plugin variant.
// Paste this verbatim into cordis_define({ code: { client: <this file> }, ... }).
//
// This is the CLIENT half (browser): a live status light registered in the
// session header. Every 1.2s it polls the Host's agy_status RPC (see host.js)
// and paints a coloured dot + label reflecting agy activity:
//
//   running  → brand-colour pulsing dot, "AGY 工作中" (×N when several run)
//   ok       → green dot, "AGY"
//   failed   → red dot, "AGY 失败"
//   fallback → amber dot, "本地回退"
//   idle     → grey dot, "AGY 就绪"
//
// Sandbox notes: no JSX (use React.createElement), colours come from theme
// tokens so the light follows light/dark automatically. The client half needs
// a one-time approval in the DSH GUI when the package first runs.

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    ctx.effect(function () {
      return styles.insert('@keyframes agy-pulse{0%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.72)}100%{opacity:1;transform:scale(1)}} .agy-ind{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1;color:var(--dsw-alias-label-secondary);white-space:nowrap;user-select:none} .agy-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-label-secondary)} .agy-run .agy-dot{background:var(--dsw-alias-brand-primary);animation:agy-pulse 1s ease-in-out infinite} .agy-ok .agy-dot{background:var(--dsw-alias-state-success-primary)} .agy-fail .agy-dot{background:var(--dsw-alias-state-error-primary)} .agy-fb .agy-dot{background:var(--dsw-alias-state-warn-primary)} .agy-run{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)} .agy-fb{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}')
    })

    function Indicator() {
      const st = React.useState(null)
      const s = st[0]
      const setS = st[1]
      React.useEffect(function () {
        let alive = true
        const tick = function () { host.call('agy_status').then(function (v) { if (alive) setS(v) }).catch(function () {}) }
        tick()
        const dispose = ctx.interval(tick, 1200)
        return function () { alive = false; dispose() }
      }, [])
      const state = s ? s.state : 'idle'
      let cls = 'agy-ind'
      let text = 'AGY 就绪'
      if (state === 'running') { cls += ' agy-run'; text = 'AGY 工作中' + (s && s.running > 1 ? ' ×' + s.running : '') }
      else if (state === 'ok') { cls += ' agy-ok'; text = 'AGY' }
      else if (state === 'failed') { cls += ' agy-fail'; text = 'AGY 失败' }
      else if (state === 'fallback') { cls += ' agy-fb'; text = '本地回退' }
      const title = s ? ('agy state=' + s.state + ' running=' + s.running + (s.lastStatus ? ' last=' + s.lastStatus : '') + (s.lastConversationId ? ' conv=' + s.lastConversationId : '')) : 'agy status'
      return React.createElement('div', { className: cls, title: title }, React.createElement('span', { className: 'agy-dot' }), React.createElement('span', null, text))
    }

    slots.inject('conversation.session.header.utilities', function () {
      return slots.register({ name: 'conversation.session.header.utilities', id: 'agy-indicator', order: 50 }, function () { return React.createElement(Indicator) })
    })
  }
}
