// Page chrome: the user's menu in the header, the sidebar (collapsible) / tab bar, and the
// active-route highlight.
import { $, $$ } from "/lib/dom.js";
import { mountLanguagePicker } from "/lib/i18n.js";
import { onRoute } from "./router.js";
import { setLocale, state } from "./state.js";

// Google profile photos come from this host only (it is allowed in the CSP); anything else shows initials.
const AVATAR_HOST = "https://lh3.googleusercontent.com/";
const COLLAPSED_KEY = "navCollapsed";

export function initShell() {
  const { user } = state;
  for (const id of ["#user-name", "#menu-name", "#settings-name"]) $(id).textContent = user.name || user.email;
  for (const id of ["#menu-email", "#settings-email"]) $(id).textContent = user.email;
  for (const id of ["#avatar", "#avatar-large", "#settings-avatar"]) fillAvatar($(id), user);

  initAccountMenu();
  initNav();
  window.MullionTheme.bindToggle($("#theme-toggle"));
  mountLanguagePicker($("#header-lang"), (choice) => setLocale(choice, { save: true }));
}

function initials(user) {
  const words = (user.name || user.email).split(/[\s@.]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function fillAvatar(el, user) {
  el.textContent = initials(user);
  if (!user.picture?.startsWith(AVATAR_HOST)) return;
  const img = Object.assign(document.createElement("img"), { src: user.picture, alt: "", referrerPolicy: "no-referrer" });
  img.addEventListener("load", () => el.replaceChildren(img));
}

/** "Raúl Carrasco ▾" opens Settings and Log out. */
function initAccountMenu() {
  const button = $("#account-button");
  const menu = $("#account-menu");
  const items = () => $$('[role="menuitem"]', menu);
  const open = (next, focusFirst = false) => {
    menu.hidden = !next;
    button.setAttribute("aria-expanded", String(next));
    if (next && focusFirst) items()[0].focus();
  };
  button.addEventListener("click", () => open(menu.hidden));
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      open(true, true);
    }
  });
  menu.addEventListener("keydown", (e) => {
    const list = items();
    const index = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      list[(index + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length].focus();
    }
  });
  menu.addEventListener("click", (e) => e.target.closest('a[role="menuitem"]') && open(false));
  document.addEventListener("click", (e) => !menu.hidden && !e.target.closest(".account") && open(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      open(false);
      button.focus();
    }
  });
}

function initNav() {
  const toggle = $("#nav-collapse");
  const setCollapsed = (collapsed) => {
    document.body.classList.toggle("nav-collapsed", collapsed);
    toggle.setAttribute("aria-pressed", String(collapsed));
    try { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); } catch {}
  };
  let saved = false;
  try { saved = localStorage.getItem(COLLAPSED_KEY) === "true"; } catch {}
  setCollapsed(saved);
  toggle.addEventListener("click", () => setCollapsed(!document.body.classList.contains("nav-collapsed")));

  onRoute((route) => {
    for (const link of $$("[data-route]")) {
      if (link.dataset.route === route) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  });
}
