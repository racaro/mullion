// What every screen needs to know: who is signed in, the language and its strings, and the
// brief options in that language. Screens subscribe to redraw their labels on a language change.
import { api } from "/lib/api.js";
import { applyLocale, saveLocale } from "/lib/i18n.js";

export const state = { user: null, locale: "en", strings: {}, catalog: null };

const listeners = new Set();

export function onLocaleChange(listener) {
  listeners.add(listener);
}

export async function setLocale(requested, { save = false } = {}) {
  const [locale, strings] = await applyLocale(requested);
  const catalog = await api.catalog(locale);
  Object.assign(state, { locale, strings, catalog });
  if (save) {
    saveLocale(locale);
    api.saveLocale(locale).catch(() => {}); // the local choice already applies
  }
  listeners.forEach((listener) => listener(state));
}

/** "Living room · Contemporary", in the current language. */
export function briefTitle(brief) {
  const label = (group, id) => state.catalog?.[group].find((o) => o.id === id)?.label ?? id;
  return `${label("rooms", brief.room)} · ${label("styles", brief.style)}`;
}

export function optionLabel(group, id) {
  return state.catalog?.[group].find((o) => o.id === id)?.label ?? id;
}

/** D1 stores UTC as "YYYY-MM-DD HH:MM:SS". */
export function formatDate(sqlDate) {
  const date = new Date(`${sqlDate.replace(" ", "T")}Z`);
  return new Intl.DateTimeFormat(state.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
