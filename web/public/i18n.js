// UI language, shared by the login page and the app: the viewer's choice, then their account's
// language, then the browser's. Strings live in /i18n/<locale>.json.

export const LOCALES = ["en", "es"];

export function preferredLocale(accountLocale) {
  try {
    const saved = localStorage.getItem("locale");
    if (LOCALES.includes(saved)) return saved;
  } catch {}
  if (LOCALES.includes(accountLocale)) return accountLocale;
  return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
}

export function saveLocale(locale) {
  try { localStorage.setItem("locale", locale); } catch {}
}

/** Load a locale's strings and fill every [data-i18n] element. Returns [locale, strings]. */
export async function applyLocale(requested) {
  const locale = LOCALES.includes(requested) ? requested : "en";
  const strings = await (await fetch(`/i18n/${locale}.json`)).json();
  document.documentElement.lang = locale;
  const select = document.querySelector("#locale");
  if (select) select.value = locale;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = strings[el.dataset.i18n] ?? el.dataset.i18n));
  document.querySelectorAll("[data-i18n-label]").forEach((el) => el.setAttribute("aria-label", strings[el.dataset.i18nLabel] ?? ""));
  document.querySelectorAll('input[name="locale"]').forEach((radio) => (radio.checked = radio.value === locale));
  return [locale, strings];
}
