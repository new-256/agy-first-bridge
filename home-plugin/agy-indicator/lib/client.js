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
// 显示策略（v1.5.4）：
// - presetActive=true（当前有 agy 优先会话在线）→ 常驻显示：无项目数据时
//   显示单个占位 pill "AGY 就绪"。
// - presetActive=false（普通模式会话）→ 仅在有项目数据时显示（调用 agy 时
//   临时出现，空闲时隐藏），不渲染占位。
//
// 动态形态（无 ctx.emit 的沙箱插件）不再自己注册标题栏灯；它通过家级 host
// 暴露的 agyCollector 服务把状态推入同一张表，由本灯统一显示。因此全软件
// 只会有这一个 agy 状态灯。
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
      ".agy-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-label-secondary)}",
      ".agy-ind b{font-weight:600}",
      ".agy-run .agy-dot{background:var(--dsw-static-blue-500,#3b82f6);animation:agy-pulse 1s ease-in-out infinite}",
      ".agy-ok .agy-dot{background:var(--dsw-static-green-500,#22c55e)}",
      ".agy-fail .agy-dot{background:var(--dsw-alias-state-error-primary)}",
      ".agy-fb .agy-dot{background:var(--dsw-alias-state-warn-primary)}",
      ".agy-run{color:var(--dsw-static-blue-500,#3b82f6);border-color:var(--dsw-static-blue-500,#3b82f6)}",
      ".agy-ok{color:var(--dsw-static-green-500,#22c55e);border-color:var(--dsw-static-green-500,#22c55e)}",
      ".agy-fb{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}",
      "@keyframes agy-pulse{0%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.72)}100%{opacity:1;transform:scale(1)}}"
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

    // 单项目 pill。
    function Pill(props) {
      const p = props.p;
      return react.createElement("div", { className: "agy-ind" + pillClass(p.state), title: pillTitle(p) },
        react.createElement("span", { className: "agy-dot" }),
        react.createElement("span", null, react.createElement("b", null, pillText(p.state, p.running))));
    }

    // 每 1.2s 拉一次 /agy-indicator/status，按项目渲染灯。
    // 组件不引用 ctx：轮询用原生 setInterval，卸载用 clearInterval（必成功）。
    function Indicator() {
      const st = react.useState(null);
      const s = st[0];
      const setS = st[1];
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
      const hasProjects = s && Array.isArray(s.projects) && s.projects.length;
      // 非 agy 优先模式且无项目数据：不渲染（普通模式调用 agy 时才显示）。
      if (!hasProjects && !(s && s.presetActive)) {
        return null;
      }
      if (hasProjects) {
        return react.createElement("div", { style: { display: "inline-flex", alignItems: "center", gap: "6px" } },
          s.projects.map(function (p, i) { return react.createElement(Pill, { key: p.cwd || ("p" + i), p: p }); }));
      }
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
      return react.createElement("div", { className: "agy-ind" + pillClass(state), title: title },
        react.createElement("span", { className: "agy-dot" }), react.createElement("span", null, text));
    }

    function apply(ctx) {
      // 等 slots 服务就绪后再注册（产品插件同款模式；ctx.inject 子纤维在
      // 服务可用时执行，scope 的 effect 随插件生命周期回收）。
      if (typeof ctx.inject !== "function") return;
      ctx.inject(["slots"], function (scope) {
        const slots = scope.get("slots");
        if (slots === undefined) return;
        scope.slots.inject("conversation.session.header.utilities", function () {
          return slots.register({ name: "conversation.session.header.utilities", id: "agy-indicator-home", order: 50 }, function () { return react.createElement(Indicator); });
        });
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
