// Login page: already signed in -> the app; otherwise show why the last sign-in failed, if it did.
import { applyLocale, mountLanguagePicker, preferredLocale, saveLocale } from "/i18n.js";

const me = await fetch("/api/me");
if (me.ok) location.replace("/");

const signin = new URLSearchParams(location.search).get("signin");
document.querySelector("#signin-failed").hidden = signin !== "failed";
document.querySelector("#not-invited").hidden = signin !== "not_invited" && me.status !== 403;

window.MullionTheme.bindToggle(document.querySelector("#theme-toggle"));
mountLanguagePicker(document.querySelector("#login-lang"), async (choice) => {
  const [locale] = await applyLocale(choice);
  saveLocale(locale);
});
await applyLocale(preferredLocale());
