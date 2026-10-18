// Light or dark theme. A classic script loaded in <head> so the theme is set before the first
// paint (a module would run too late and the page would flash). Until the viewer picks one with
// the sun/moon button, "system" sets nothing and lets prefers-color-scheme decide.
(() => {
  const THEMES = ["system", "light", "dark"];

  function get() {
    try {
      const saved = localStorage.getItem("theme");
      if (THEMES.includes(saved)) return saved;
    } catch {}
    return "system";
  }

  function apply(theme) {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }

  function set(theme) {
    const next = THEMES.includes(theme) ? theme : "system";
    try { localStorage.setItem("theme", next); } catch {}
    apply(next);
    return next;
  }

  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  /** The theme on screen: the viewer's choice, or the system's. */
  function effective() {
    const theme = get();
    return theme === "system" ? (darkQuery.matches ? "dark" : "light") : theme;
  }

  /** The sun/moon button: a toggle named "Dark mode", pressed while the page is dark. */
  function bindToggle(button) {
    const update = () => button.setAttribute("aria-pressed", String(effective() === "dark"));
    button.addEventListener("click", () => {
      set(effective() === "dark" ? "light" : "dark");
      update();
    });
    darkQuery.addEventListener("change", update);
    update();
  }

  apply(get());
  window.MullionTheme = { THEMES, get, set, effective, bindToggle };
})();
