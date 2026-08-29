// agy-indicator — browser half.
//
// 会话标题栏右侧的状态灯：每 1.2s 轮询 /agy-indicator/status（家级 host 半经
// webServer 暴露的 HTTP 路由），按项目（工作目录 cwd）分别渲染一盏灯。
//
//   running  → 品牌色呼吸圆点, "⟳ 项目名 [×N]"
//   ok       → 绿色圆点, "✓ 项目名"
//   failed   → 红色圆点, "✗ 项目名"
//   fallback → 琥珀色圆点, "↩ 项目名"
//   idle     → 灰色圆点, "项目名"（仅当该项目仍在表中）
//
// 无任何项目数据时显示单个占位 pill "AGY 就绪"。
//
// 本文件为家级 client 模块：window.__ModuleLoader__.load({ id, factory }) 格式，
// factory 内 require("react")，exports.apply/inject。样式用 document.head 注入
// （家级 client 不是动态沙箱，可直接操作 DOM），颜色用 --dsw-alias-* 主题变量
// 以跟随亮/暗主题。

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
      ".agy-run .agy-dot{background:var(--dsw-alias-brand-primary);animation:agy-pulse 1s ease-in-out infinite}",
      ".agy-ok .agy-dot{background:var(--dsw-alias-state-success-primary)}",
      ".agy-fail .agy-dot{background:var(--dsw-alias-state-error-primary)}",
      ".agy-fb .agy-dot{background:var(--dsw-alias-state-warn-primary)}",
      ".agy-run{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}",
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

    const NS = "agy-indicator";
    const zh = {
      ready: "AGY 就绪",
      running: "AGY 工作中",
      ok: "AGY",
      failed: "AGY 失败",
      fallback: "本地回退",
      aria: "agy 状态：{status}"
    };
    const en = {
      ready: "AGY ready",
      running: "AGY working",
      ok: "AGY",
      failed: "AGY failed",
      fallback: "fallback",
      aria: "agy status: {status}"
    };

    function pillClass(state) {
      if (state === "running") return " agy-run";
      if (state === "ok") return " agy-ok";
      if (state === "failed") return " agy-fail";
      if (state === "fallback") return " agy-fb";
      return "";
    }
    function pillText(state, name, running) {
      if (state === "running") return "\u27F3 " + name + (running > 1 ? " \u00D7" + running : "");
      if (state === "ok") return "\u2713 " + name;
      if (state === "failed") return "\u2717 " + name;
      if (state === "fallback") return "\u21A9 " + name;
      return name;
    }
    function pillTitle(p) {
      const parts = [];
      if (p.current) { const c = p.current; parts.push("step " + c.stepIndex + " \u2192 " + c.tool + (c.args ? " " + JSON.stringify(c.args) : "")); }
      else if (p.running > 0) parts.push("(starting / thinking)");
      if (p.trail && p.trail.length) parts.push("recent: " + p.trail.slice(-3).map(function (e) { return e.state + " " + e.tool; }).join(" | "));
      if (p.lastStatus) parts.push("last=" + p.lastStatus + (p.lastConversationId ? " " + p.lastConversationId.slice(0, 8) : ""));
      return "agy [" + p.state + (p.running > 0 ? " \u00D7" + p.running : "") + "] " + p.cwd + (parts.length ? "\n" + parts.join("\n") : "");
    }

    function Pill(p) {
      return react.createElement("div", { className: "agy-ind" + pillClass(p.state), title: pillTitle(p) },
        react.createElement("span", { className: "agy-dot" }),
        react.createElement("span", null, react.createElement("b", null, pillText(p.state, p.name, p.running))));
    }

    function Indicator() {
      const st = react.useState(null);
      const s = st[0];
      const setS = st[1];
      react.useEffect(function () {
        let alive = true;
        const tick = function () {
          fetch("/agy-indicator/status", { cache: "no-store" })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (v) { if (alive) setS(v); })
            .catch(function () {});
        };
        tick();
        const dispose = (typeof ctx !== "undefined" && ctx && typeof ctx.interval === "function")
          ? ctx.interval(tick, 1200)
          : setInterval(tick, 1200);
        return function () { alive = false; if (dispose) dispose(); };
      }, []);
      if (s && Array.isArray(s.projects) && s.projects.length) {
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

    const inject = ["slots", "timer"];

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (slots === undefined) return;
      slots.inject("conversation.session.header.utilities", function () {
        return slots.register({ name: "conversation.session.header.utilities", id: "agy-indicator", order: 50 }, function () { return react.createElement(Indicator); });
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
