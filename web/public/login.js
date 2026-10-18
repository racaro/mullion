// Login page: already signed in -> the app; otherwise show why the last sign-in failed, if it did.
import { applyLocale, preferredLocale, saveLocale } from "/i18n.js";

const me = await fetch("/api/me");
if (me.ok) location.replace("/");

const signin = new URLSearchParams(location.search).get("signin");
document.querySelector("#signin-failed").hidden = signin !== "failed";
document.querySelector("#not-invited").hidden = signin !== "not_invited" && me.status !== 403;

window.MullionTheme.bind(document);
await applyLocale(preferredLocale());
document.querySelector("#locale").addEventListener("change", async (e) => {
  const [locale] = await applyLocale(e.target.value);
  saveLocale(locale);
});
