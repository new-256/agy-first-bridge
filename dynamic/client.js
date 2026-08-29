// dynamic/client.js
//
// code.client body for the in-session (dynamic) Cordis plugin variant.
// Paste this verbatim into cordis_define({ code: { client: <this file> }, ... }).
//
// This is the CLIENT half (browser): live status lights registered in the
// session header. Every 1.2s it polls the Host's agy_status RPC (see host.js)
// and paints **one coloured pill per project** (working directory), each with
// its own dot + project name reflecting that project's agy activity:
//
//   running  → brand-colour pulsing dot, "⟳ 项目名"
//   ok       → green dot, "✓ 项目名"
//   failed   → red dot, "✗ 项目名"
//   fallback → amber dot, "↩ 项目名"
//   idle     → grey dot, "项目名" (only shown while the project is still listed)
//
// When the host has no project data yet (never ran), a single global pill
// "AGY 就绪" is shown as a placeholder.
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
      return styles.insert('@keyframes agy-pulse{0%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.72)}100%{opacity:1;transform:scale(1)}} .agy-ind{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1;color:var(--dsw-alias-label-secondary);white-space:nowrap;user-select:none} .agy-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-label-secondary)} .agy-run .agy-dot{background:var(--dsw-alias-brand-primary);animation:agy-pulse 1s ease-in-out infinite} .agy-ok .agy-dot{background:var(--dsw-alias-state-success-primary)} .agy-fail .agy-dot{background:var(--dsw-alias-state-error-primary)} .agy-fb .agy-dot{background:var(--dsw-alias-state-warn-primary)} .agy-run{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)} .agy-fb{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)} .agy-ind b{font-weight:600}')
    })

    function pillClass(state) {
      if (state === 'running') return ' agy-run'
      if (state === 'ok') return ' agy-ok'
      if (state === 'failed') return ' agy-fail'
      if (state === 'fallback') return ' agy-fb'
      return ''
    }
    function pillText(state, name, running) {
      if (state === 'running') return '⟳ ' + name + (running > 1 ? ' ×' + running : '')
      if (state === 'ok') return '✓ ' + name
      if (state === 'failed') return '✗ ' + name
      if (state === 'fallback') return '↩ ' + name
      return name
    }
    function pillTitle(p) {
      const parts = []
      if (p.current) { const c = p.current; parts.push('step ' + c.stepIndex + ' → ' + c.tool + (c.args ? ' ' + JSON.stringify(c.args) : '')) }
      else if (p.running > 0) parts.push('(starting / thinking)')
      if (p.trail && p.trail.length) parts.push('recent: ' + p.trail.slice(-3).map(function (e) { return e.state + ' ' + e.tool }).join(' | '))
      if (p.lastStatus) parts.push('last=' + p.lastStatus + (p.lastConversationId ? ' ' + p.lastConversationId.slice(0, 8) : ''))
      return 'agy [' + p.state + (p.running > 0 ? ' ×' + p.running : '') + '] ' + p.cwd + (parts.length ? '\n' + parts.join('\n') : '')
    }

    function Pill(p) {
      return React.createElement('div', { className: 'agy-ind' + pillClass(p.state), title: pillTitle(p) },
        React.createElement('span', { className: 'agy-dot' }),
        React.createElement('span', null, React.createElement('b', null, pillText(p.state, p.name, p.running))))
    }

    function Indicator() {
      const st = React.useState(null)
      const s = st[0]
      const setS = st[1]
      React.useEffect(function () {
        let alive = true
        const tick = function () {
          host.call('agy_status').then(function (v) {
            if (!alive) return
            // host.call resolves to the invoke envelope { ok, value } (host-runner
            // invoke()), not the raw handler result; unwrap it defensively.
            const snap = v && typeof v === 'object' && v.ok === true && 'value' in v ? v.value : v
            setS(snap)
          }).catch(function () {})
        }
        tick()
        const dispose = ctx.interval(tick, 1200)
        return function () { alive = false; dispose() }
      }, [])
      if (s && Array.isArray(s.projects) && s.projects.length) {
        return React.createElement('div', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
          s.projects.map(function (p, i) { return React.createElement(Pill, { key: p.cwd || ('p' + i), p: p }) }))
      }
      // fallback placeholder: single global pill
      const state = s ? s.state : 'idle'
      let text = 'AGY 就绪'
      if (state === 'running') text = 'AGY 工作中' + (s && s.running > 1 ? ' ×' + s.running : '')
      else if (state === 'ok') text = 'AGY'
      else if (state === 'failed') text = 'AGY 失败'
      else if (state === 'fallback') text = '本地回退'
      let detail = ''
      if (s) {
        const parts = []
        if (s.current) { const c = s.current; parts.push('step ' + c.stepIndex + ' → ' + c.tool + (c.args ? ' ' + JSON.stringify(c.args) : '')) }
        else if (s.state === 'running') parts.push('(starting / thinking)')
        if (s.trail && s.trail.length) parts.push('recent: ' + s.trail.slice(-3).map(function (e) { return e.state + ' ' + e.tool }).join(' | '))
        if (s.lastStatus) parts.push('last=' + s.lastStatus + (s.lastConversationId ? ' ' + s.lastConversationId.slice(0, 8) : ''))
        detail = parts.join(' — ')
      }
      const title = s ? ('agy state=' + s.state + ' running=' + s.running + (detail ? '\n' + detail : '')) : 'agy status'
      return React.createElement('div', { className: 'agy-ind' + pillClass(state), title: title }, React.createElement('span', { className: 'agy-dot' }), React.createElement('span', null, text))
    }

    slots.inject('conversation.session.header.utilities', function () {
      return slots.register({ name: 'conversation.session.header.utilities', id: 'agy-indicator', order: 50 }, function () { return React.createElement(Indicator) })
    })
  }
}
