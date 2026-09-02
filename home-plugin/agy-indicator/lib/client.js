// agy-indicator — browser half (home-level plugin).
//
// 会话标题栏右侧的状态灯：每 1.2s 轮询 /agy-indicator/status（家级 host 半经
// webServer 暴露的 HTTP 路由），按项目（工作目录 cwd）分别渲染一盏灯。
//
//   running  → 蓝色呼吸圆点, "⟳ AGY [×N]"
//   ok       → 绿色圆点, "✓ AGY"
//   failed   → 红色圆点, "✗ AGY"
//   fallback → 琥珀色圆点, "↩ AGY"
//   idle     → 灰色圆点, "AGY"（仅当该项目仍在表中）
//
// 颜色说明（v1.5.5）：--dsw-alias-brand-primary 实际解析为近黑色
// (var(--dsw-static-neutral-bluish-1000) = #0f1115)，与灰点辨识度低；
// running 改用静态蓝 --dsw-static-blue-500 (#3b82f6)，ok 用
// --dsw-static-green-500 (#22c55e)。文字统一显示 "AGY"（非项目名），
// 项目名/当前步骤在 tooltip 里。
//
// 显示策略（v1.5.4 + v1.5.12 修复）：
// - 本会话是 agy preset（agentPreset ∈ cordis-agy/agy-first，经 sessions.list
//   快照判定）→ 常驻显示：无项目数据时显示单个占位 pill "AGY 就绪"。
// - 普通模式会话（已确认非 agy preset）→ 仅在有项目数据时显示（调用 agy 时
//   临时出现，空闲时隐藏），不渲染占位。per-session 判定避免一个 agy preset
//   会话的全局租约让所有会话都常驻灯。
//
// 动态形态（无 ctx.emit 的沙箱插件）不再自己注册标题栏灯；它通过家级 host
// 暴露的 agyCollector 服务把状态推入同一张表，由本灯统一显示。因此全软件
// 只会有这一个 agy 状态灯。
//
// 点击弹窗（v1.5.6）：点击任意状态灯打开详情面板，实时显示每个项目的
// 当前步骤（step → tool + 参数）、最近轨迹与上次状态；数据跟随 1.2s 轮询
// 自动刷新，无需手动操作。关闭方式：× 按钮 / 点击遮罩 / Esc。
//
// 实现纪律（对齐产品 dsh-model-status 的成熟模式）：
// - 轮询只用浏览器原生 setInterval/clearInterval，组件内不引用任何 Cordis ctx，
//   切换会话（组件卸载）时 clearInterval 必成功，不会因 ctx.interval 的 disposer
//   形态差异而抛错导致对话窗口空白。
// - apply 用 ctx.inject(['slots'], (scope) => {...}) 等待 slots 服务就绪后再注册。
// - id 用 'agy-indicator-home'，避免与动态插件形态的 'agy-indicator' 在同 slot 撞 id。

window.__ModuleLoader__.load({
  id: "agy-indicator",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let react = require("react");

    const CSS = [
      ".agy-ind{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1;color:var(--dsw-alias-label-secondary);white-space:nowrap;user-select:none}",
      ".agy-ind:hover{border-color:var(--dsw-alias-border-l2);cursor:pointer}",
      ".agy-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-label-secondary)}",
      ".agy-ind b{font-weight:600}",
      ".agy-run .agy-dot{background:var(--dsw-static-blue-500,#3b82f6);animation:agy-pulse 1s ease-in-out infinite}",
      ".agy-ok .agy-dot{background:var(--dsw-static-green-500,#22c55e)}",
      ".agy-fail .agy-dot{background:var(--dsw-alias-state-error-primary)}",
      ".agy-fb .agy-dot{background:var(--dsw-alias-state-warn-primary)}",
      ".agy-run{color:var(--dsw-static-blue-500,#3b82f6);border-color:var(--dsw-static-blue-500,#3b82f6)}",
      ".agy-ok{color:var(--dsw-static-green-500,#22c55e);border-color:var(--dsw-static-green-500,#22c55e)}",
      ".agy-fb{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}",
      "@keyframes agy-pulse{0%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.72)}100%{opacity:1;transform:scale(1)}}",
      // ── 点击灯弹出的 agy 活动详情面板 ──────────────────────────────
      ".agy-pop-overlay{position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:10000;display:flex;align-items:center;justify-content:center}",
      ".agy-pop-panel{width:520px;max-width:92vw;max-height:76vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);overflow:hidden}",
      ".agy-pop-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);font-weight:600}",
      ".agy-pop-close{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;width:22px;height:22px;line-height:1;font-size:13px;cursor:pointer}",
      ".agy-pop-close:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}",
      ".agy-pop-body{overflow:auto;padding:12px 14px}",
      ".agy-pop-empty{color:var(--dsw-alias-label-secondary);text-align:center;padding:18px 0}",
      ".agy-pop-proj{margin-bottom:12px;padding-bottom:12px;border-bottom:1px dashed var(--dsw-alias-border-l1)}",
      ".agy-pop-proj:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}",
      ".agy-pop-proj-head{font-weight:600;margin-bottom:4px}",
      ".agy-pop-mono{font-family:Consolas,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".agy-pop-line{padding:1px 0}",
      ".agy-pop-cur{background:rgba(59,130,246,.12);border-radius:4px;padding:3px 6px;margin:4px 0}",
      ".agy-pop-cur .agy-pop-mono{color:var(--dsw-alias-label-primary)}"
    ].join("");
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"agy-indicator\"]") === null) {
      const tag = document.createElement("style");
      tag.setAttribute("data-plugin", "agy-indicator");
      tag.setAttribute("data-plugin-css", "agy-indicator");
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    function pillClass(state) {
      if (state === "running") return " agy-run";
      if (state === "ok") return " agy-ok";
      if (state === "failed") return " agy-fail";
      if (state === "fallback") return " agy-fb";
      return "";
    }
    function pillText(state, running) {
      // 灯文字统一显示 "AGY"（而非项目名，避免 "⟳ DSH" 的歧义）；
      // 项目名/步骤在 tooltip 里。
      if (state === "running") return "\u27F3 AGY" + (running > 1 ? " \u00D7" + running : "");
      if (state === "ok") return "\u2713 AGY";
      if (state === "failed") return "\u2717 AGY";
      if (state === "fallback") return "\u21A9 AGY";
      return "AGY";
    }
    function pillTitle(p) {
      const parts = [];
      parts.push(p.name ? ("project: " + p.name) : "project: " + p.cwd);
      if (p.current) { const c = p.current; parts.push("step " + c.stepIndex + " \u2192 " + c.tool + (c.args ? " " + JSON.stringify(c.args) : "")); }
      else if (p.running > 0) parts.push("(starting / thinking)");
      if (p.trail && p.trail.length) parts.push("recent: " + p.trail.slice(-3).map(function (e) { return e.state + " " + e.tool; }).join(" | "));
      if (p.lastStatus) parts.push("last=" + p.lastStatus + (p.lastConversationId ? " " + p.lastConversationId.slice(0, 8) : ""));
      return "agy [" + p.state + (p.running > 0 ? " \u00D7" + p.running : "") + "] " + p.cwd + (parts.length ? "\n" + parts.join("\n") : "");
    }

    // 单项目 pill（点击打开详情弹窗）。
    function Pill(props) {
      const p = props.p;
      return react.createElement("div", { className: "agy-ind" + pillClass(p.state), title: pillTitle(p), onClick: props.onClick },
        react.createElement("span", { className: "agy-dot" }),
        react.createElement("span", null, react.createElement("b", null, pillText(p.state, p.running))));
    }

    function argText(a) {
      if (a === undefined || a === null) return "";
      try { const j = JSON.stringify(a); return j.length > 140 ? j.slice(0, 137) + "…" : j; } catch (e) { return String(a); }
    }

    // 详情弹窗：实时显示各项目当前步骤/最近轨迹（数据随 Indicator 轮询刷新）。
    function Popup(props) {
      const s = props.s;
      const onClose = props.onClose;
      const quota = props.quota;
      const mode = props.mode || "";
      const rows = [];
      // 额度区（可选增强）：显示周套餐余量（来自 /agy-indicator/quota）。
      if (quota && quota.ok && Array.isArray(quota.weekly) && quota.weekly.length) {
        const low = quota.weekly.some(function (w) { return w.pct < 20; });
        rows.push(react.createElement("div", { key: "quota", className: "agy-pop-proj", style: { background: "rgba(59,130,246,.06)", border: "1px solid rgba(59,130,246,.25)" } },
          react.createElement("div", { className: "agy-pop-proj-head" }, "额度（套餐池子）"),
          quota.weekly.map(function (w, i) {
            return react.createElement("div", { key: "q" + i, className: "agy-pop-line agy-pop-mono", style: { color: (w.pct < 20 ? "var(--dsw-alias-state-warn-primary)" : undefined) } },
              (w.id || w.g) + " 周余量 " + w.pct + "%" + (w.reset ? " (reset " + w.reset.slice(0, 16).replace("T", " ") + ")" : ""));
          }),
          low ? react.createElement("div", { className: "agy-pop-line", style: { marginTop: "4px", color: "var(--dsw-alias-state-warn-primary)" } },
            "⚠ 周额度偏低：大任务请谨慎（可用 agy_quota 查看模型池子明细）") : null));
      }
      if (s && Array.isArray(s.projects) && s.projects.length) {
        s.projects.forEach(function (p, i) {
          const head = (p.state === "running" ? "\u27F3 " : p.state === "ok" ? "\u2713 " : p.state === "failed" ? "\u2717 " : p.state === "fallback" ? "\u21A9 " : "") + (p.name || p.cwd);
          const badge = "[" + p.state + (p.running > 0 ? " \u00D7" + p.running : "") + "]";
          rows.push(react.createElement("div", { key: "p" + i, className: "agy-pop-proj" },
            react.createElement("div", { className: "agy-pop-proj-head" }, head, " ", react.createElement("span", { className: "agy-pop-mono" }, badge)),
            react.createElement("div", { className: "agy-pop-line agy-pop-mono" }, p.cwd),
            (function () {
              if (p.current) {
                const c = p.current;
                return react.createElement("div", { className: "agy-pop-cur" },
                  react.createElement("div", null, "当前: step " + c.stepIndex + " \u2192 " + c.tool),
                  react.createElement("div", { className: "agy-pop-mono" }, c.args ? argText(c.args) : ""));
              }
              if (p.running > 0) {
                return react.createElement("div", { className: "agy-pop-cur" }, "(starting / thinking…)");
              }
              return null;
            })(),
            (p.trail && p.trail.length) ? react.createElement("div", null,
              react.createElement("div", { className: "agy-pop-line", style: { marginTop: "6px", color: "var(--dsw-alias-label-secondary)" } }, "最近步骤:"),
              p.trail.slice(-6).map(function (e, j) {
                return react.createElement("div", { key: "t" + j, className: "agy-pop-line agy-pop-mono" },
                  "[" + e.state + "] step " + e.stepIndex + " " + e.tool + (e.args ? " " + argText(e.args) : ""));
              })) : null,
            (p.running > 0 && p.updatedAt) ? react.createElement("div", { className: "agy-pop-line", style: { marginTop: "6px", color: (Date.now() - p.updatedAt > 90000 ? "var(--dsw-alias-state-warn-primary)" : "var(--dsw-alias-label-secondary)") } },
              "无活动 " + Math.max(0, Math.round((Date.now() - p.updatedAt) / 1000)) + "s" + (Date.now() - p.updatedAt > 90000 ? "（若长任务请耐心；若疑似卡住可取消重试）" : "")) : null,
            (p.lastStatus) ? react.createElement("div", { className: "agy-pop-line agy-pop-mono", style: { marginTop: "6px" } },
              "last=" + p.lastStatus + (p.lastConversationId ? " " + p.lastConversationId.slice(0, 8) : "")) : null));
        });
      } else {
        rows.push(react.createElement("div", { key: "empty", className: "agy-pop-empty" }, "暂无 agy 活动"));
      }
      const headText = "agy 状态" + (s && s.state ? " · " + s.state + (s.running > 0 ? " (" + s.running + " running)" : "") : "") + mode;
      return react.createElement("div", { className: "agy-pop-overlay", onClick: onClose },
        react.createElement("div", { className: "agy-pop-panel", onClick: function (e) { e.stopPropagation(); } },
          react.createElement("div", { className: "agy-pop-head" },
            react.createElement("span", null, headText),
            react.createElement("button", { className: "agy-pop-close", title: "关闭 (Esc)", onClick: onClose }, "\u2715")),
          react.createElement("div", { className: "agy-pop-body" }, rows)));
    }

    // per-session preset 判定（对齐 codebuddy-indicator v1.1.2 的双通道实现）：
    // 家级 host 的 presetActive 是全局租约——任何一个 agy preset 会话在线都会
    // 续租，普通会话若只看 presetActive 就会误以为自己是 agy 模式而常驻灯。
    // 真正的常驻资格是「本会话的 agentPreset 就是 agy preset」。两条读取通道：
    //   a) 框架标准 props（DSH ≥ 0.3.14 / dsh 0.1.2-alpha.5）：sessionId 与
    //      useSessions 选择器钩子由会话作用域槽位框架注入，读
    //      byId[sessionId].projectionValues.agentPreset（alpha.5 起 preset 字段移入投影值）；
    //   b) 旧式注入（更早版本）：inject(sessionId) 收到会话 id + sessions 服务的
    //      list 快照（byId[sessionId].agentPreset，旧 summary 字段）。
    // 两条通道的读取函数同时认新旧两种 summary 形状。都不可用 → UNKNOWN →
    // 回退端点的全局心跳租约（host 半）。
    // UNKNOWN 哨兵必须是稳定原始值（getSnapshot 契约）。
    const PRESET_UNKNOWN = "\u0000unknown";
    // agy 优先 preset 的 id（roster 目录名）。默认 cordis-agy；兼容仓库原装 agy-first。
    function isAgyPreset(id) {
      return id === "cordis-agy" || id === "agy-first" || id === "cordis-agy-first";
    }
    function subscribeNoop() { return function () { }; }
    function presetOfSummary(sum) {
      if (!sum) return PRESET_UNKNOWN;
      if (sum.projectionValues && typeof sum.projectionValues.agentPreset === "string") return sum.projectionValues.agentPreset;
      if (typeof sum.agentPreset === "string") return sum.agentPreset;
      return PRESET_UNKNOWN;
    }
    function presetOfState(state, sessionId) {
      try {
        if (!state || !sessionId || !state.byId) return PRESET_UNKNOWN;
        return presetOfSummary(state.byId[sessionId]);
      } catch (e) { return PRESET_UNKNOWN; }
    }

    function Indicator(props) {
      const p = props || {};
      // 标准属性（新框架）优先；老框架经 inject(sessionId) 提供 injectedSessionId。
      const sessionId = (typeof p.sessionId === "string" && p.sessionId) || (typeof p.injectedSessionId === "string" && p.injectedSessionId) || undefined;
      const useSess = typeof p.useSessions === "function" ? p.useSessions : null;
      const sessionsSvc = p.sessionsSvc;
      const st = react.useState(null);
      const s = st[0];
      const setS = st[1];
      const ot = react.useState(false);
      const open = ot[0];
      const setOpen = ot[1];
      const qt = react.useState(null);
      const quota = qt[0];
      const setQuota = qt[1];
      // 本会话的 agent preset（三态：已知 agy / 已知其他 / UNKNOWN）。
      // 恰好一条钩子通道；useSessions 的有无在同一挂载期内恒定，满足 hooks 规则。
      let myPreset;
      if (useSess) {
        myPreset = useSess(function (state) { return presetOfState(state, sessionId); });
      } else {
        myPreset = react.useSyncExternalStore(
          (sessionsSvc && sessionsSvc.list) ? sessionsSvc.list.subscribe : subscribeNoop,
          function () {
            try {
              if (!sessionsSvc || !sessionsSvc.list) return PRESET_UNKNOWN;
              return presetOfState(sessionsSvc.list.getSnapshot(), sessionId);
            } catch (e) { return PRESET_UNKNOWN; }
          });
      }
      const presetKnown = myPreset !== PRESET_UNKNOWN;
      const iAmAgy = presetKnown ? isAgyPreset(myPreset) : null;
      // 弹窗打开时拉一次额度（带模块级 5 分钟缓存，避免每次打开都跑脚本）。
      react.useEffect(function () {
        if (!open) return;
        let alive = true;
        if (Indicator._quotaCache && Date.now() - Indicator._quotaCache.at < 5 * 60 * 1000) {
          setQuota(Indicator._quotaCache.data);
        } else {
          fetch("/agy-indicator/quota", { cache: "no-store" })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (v) {
              if (!alive) return;
              Indicator._quotaCache = { at: Date.now(), data: v };
              setQuota(v);
            })
            .catch(function () { /* 静默 */ });
        }
        return function () { alive = false; };
      }, [open]);
      react.useEffect(function () {
        let alive = true;
        let timerId = null;
        const tick = function () {
          fetch("/agy-indicator/status", { cache: "no-store" })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (v) { if (alive) setS(v); })
            .catch(function () { /* 轮询失败静默，灯保持上次状态 */ });
        };
        tick();
        timerId = setInterval(tick, 1200);
        return function () {
          alive = false;
          if (timerId !== null) clearInterval(timerId);
        };
      }, []);
      // Esc 关闭弹窗。
      react.useEffect(function () {
        if (!open) return;
        const h = function (e) { if (e.key === "Escape") setOpen(false); };
        window.addEventListener("keydown", h);
        return function () { window.removeEventListener("keydown", h); };
      }, [open]);
      const hasProjects = s && Array.isArray(s.projects) && s.projects.length;
      // 空转「就绪」灯的显示资格：本会话是 agy preset（cordis-agy/agy-first）。
      // 判定不可用（UNKNOWN）时回退全局租约 s.presetActive（可能短暂显示，
      // 快照就绪后立即收敛到本会话真实资格）。
      const readyShow = iAmAgy === true || (iAmAgy === null && !!(s && s.presetActive));
      // 普通模式会话（已确认不是 agy preset）：无项目数据就不渲染——
      // 只有调用 agy 产生项目快照时才显示（按需），空闲时标题栏无灯。
      if (!hasProjects && !readyShow) {
        return null;
      }
      const openDetail = function () { setOpen(true); };
      let light;
      if (hasProjects) {
        light = react.createElement("div", { style: { display: "inline-flex", alignItems: "center", gap: "6px" } },
          s.projects.map(function (p, i) { return react.createElement(Pill, { key: p.cwd || ("p" + i), p: p, onClick: openDetail }); }));
      } else {
        const state = s ? s.state : "idle";
        let text = "AGY 就绪";
        if (state === "running") text = "AGY 工作中" + (s && s.running > 1 ? " \u00D7" + s.running : "");
        else if (state === "ok") text = "AGY";
        else if (state === "failed") text = "AGY 失败";
        else if (state === "fallback") text = "本地回退";
        let detail = "";
        if (s) {
          const parts = [];
          if (s.current) { const c = s.current; parts.push("step " + c.stepIndex + " \u2192 " + c.tool + (c.args ? " " + JSON.stringify(c.args) : "")); }
          else if (s.state === "running") parts.push("(starting / thinking)");
          if (s.trail && s.trail.length) parts.push("recent: " + s.trail.slice(-3).map(function (e) { return e.state + " " + e.tool; }).join(" | "));
          if (s.lastStatus) parts.push("last=" + s.lastStatus + (s.lastConversationId ? " " + s.lastConversationId.slice(0, 8) : ""));
          detail = parts.join(" \u2014 ");
        }
        const title = s ? ("agy state=" + s.state + " running=" + s.running + (detail ? "\n" + detail : "")) : "agy status";
        light = react.createElement("div", { className: "agy-ind" + pillClass(state), title: title, onClick: openDetail },
          react.createElement("span", { className: "agy-dot" }), react.createElement("span", null, text));
      }
      if (!open) return light;
      const modeText = iAmAgy === true ? " · 本会话 agy 优先"
        : (iAmAgy === false ? " · 普通模式"
          : (s && s.presetActive ? " · agy 优先（其他会话）" : " · 普通模式"));
      return react.createElement(react.Fragment, null,
        light,
        react.createElement(Popup, { s: s, quota: quota, mode: modeText, onClose: function () { setOpen(false); } }));
    }

    function apply(ctx) {
      // 等 slots 服务就绪后再注册（产品插件同款模式；ctx.inject 子纤维在
      // 服务可用时执行，scope 的 effect 随插件生命周期回收）。
      if (typeof ctx.inject !== "function") return;
      ctx.inject(["slots"], function (scope) {
        const slots = scope.get("slots");
        if (slots === undefined) return;
        scope.slots.inject("conversation.session.header.utilities", function () {
          // inject 兼容两层：新框架（≥0.3.14）以零参调用本函数、标准 props 由框架
          // 合入（sessionId + useSessions）；旧框架以 sessionId 调用——改名
          // injectedSessionId 避免与标准 props 冲突。sessionsSvc 两代通用（sessions
          // 服务的 list 快照至今保留）。
          return slots.register({ name: "conversation.session.header.utilities", id: "agy-indicator-home", order: 50, inject: function (injectedSessionId) { return { injectedSessionId: injectedSessionId, sessionsSvc: scope.get("sessions") }; } }, function (props) { return react.createElement(Indicator, props); });
        });
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
