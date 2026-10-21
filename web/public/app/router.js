// Hash routes: #/create (default), #/gallery, #/settings. Each screen is a <section data-screen>.
export const ROUTES = ["create", "gallery", "settings"];

const listeners = new Set();

export function currentRoute() {
  const name = location.hash.replace(/^#\/?/, "").split("/")[0];
  return ROUTES.includes(name) ? name : "create";
}

export function onRoute(listener) {
  listeners.add(listener);
}

export function navigate(name) {
  if (currentRoute() === name && location.hash) return;
  location.hash = `#/${name}`;
}

export function startRouter() {
  const show = () => {
    const route = currentRoute();
    document.querySelectorAll("[data-screen]").forEach((screen) => (screen.hidden = screen.dataset.screen !== route));
    window.scrollTo(0, 0);
    listeners.forEach((listener) => listener(route));
  };
  window.addEventListener("hashchange", show);
  show();
}
