// Light, dark or system theme. A classic script loaded in <head> so the theme is set before the
// first paint (a module would run too late and the page would flash). "system" sets nothing and
// lets prefers-color-scheme decide.
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

  /** Wire the name="theme" radios inside root to the saved theme. */
  function bind(root) {
    const radios = root.querySelectorAll('input[name="theme"]');
    radios.forEach((radio) => {
      radio.checked = radio.value === get();
      radio.addEventListener("change", () => radio.checked && set(radio.value));
    });
  }

  apply(get());
  window.MullionTheme = { THEMES, get, set, bind };
})();
