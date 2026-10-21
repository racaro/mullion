// Mullion web app. Signed-out visitors go to /login; everyone else gets the shell and the
// screen in the URL hash.
import { initCreate } from "/features/create/create.js";
import { initGallery } from "/features/gallery/gallery.js";
import { initSettings } from "/features/settings/settings.js";
import { api } from "/lib/api.js";
import { $$, icon } from "/lib/dom.js";
import { preferredLocale } from "/lib/i18n.js";
import { startRouter } from "./router.js";
import { initShell } from "./shell.js";
import { setLocale, state } from "./state.js";

const me = await api.me();
if (!me.user) {
  location.replace(me.status === 403 ? "/login?signin=not_invited" : "/login"); // 403: removed from the pilot
} else {
  state.user = me.user;
  $$("[data-icon]").forEach((el) => el.prepend(icon(el.dataset.icon)));
  initShell();
  initCreate();
  initGallery();
  initSettings();
  await setLocale(preferredLocale(me.user.locale));
  document.body.hidden = false;
  startRouter();
}
