// Settings screen: profile (from Google), appearance, usage against the limits, and session.
import { onRoute } from "/app/router.js";
import { onLocaleChange, state } from "/app/state.js";
import { api } from "/lib/api.js";
import { $, $$, h } from "/lib/dom.js";

let usage = null;

export function initSettings() {
  initAppearance();
  onRoute(async (route) => {
    if (route !== "settings") return;
    syncAppearance();
    try {
      usage = await api.usage();
      drawUsage();
    } catch {}
  });
  onLocaleChange(() => usage && drawUsage());
}

// The sun/moon button and these radios change the same setting, so read it each time.
function initAppearance() {
  for (const radio of $$('input[name="theme"]')) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      window.MullionTheme.set(radio.value);
      $("#theme-toggle").setAttribute("aria-pressed", String(window.MullionTheme.effective() === "dark"));
    });
  }
}

function syncAppearance() {
  const theme = window.MullionTheme.get();
  for (const radio of $$('input[name="theme"]')) radio.checked = radio.value === theme;
}

function drawUsage() {
  const { strings } = state;
  const meters = [
    { label: strings.usageToday, value: usage.today, max: usage.perDay },
    { label: strings.usagePending, value: usage.pending, max: usage.maxPending },
  ];
  $("#usage-meters").replaceChildren(...meters.map((m) => {
    const fill = h("span", { className: "meter-fill" });
    fill.style.width = `${Math.min(100, (m.value / m.max) * 100)}%`; // CSSOM: allowed by the CSP, unlike a style attribute
    return h("div", { className: "meter" },
      h("div", { className: "meter-head" }, h("span", {}, m.label), h("strong", {}, `${m.value} / ${m.max}`)),
      h("div", { className: `meter-track${m.value >= m.max ? " full" : ""}`, role: "img", "aria-label": `${m.label}: ${m.value} / ${m.max}` }, fill));
  }));
}
