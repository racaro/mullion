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
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = strings[el.dataset.i18n] ?? el.dataset.i18n));
  document.querySelectorAll("[data-i18n-label]").forEach((el) => el.setAttribute("aria-label", strings[el.dataset.i18nLabel] ?? ""));
  document.querySelectorAll("[data-lang-picker]").forEach((el) => renderPicker(el, locale, strings));
  return [locale, strings];
}

// ---------- language picker ------------------------------------------------------------
// Closed, it greets in the current language ("Hola"); open, it lists the languages by name.
const OPTION_LABEL = { en: "languageEnglish", es: "languageSpanish" };
const GLOBE = '<svg class="globe" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';
const CHEVRON = '<svg class="chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Make el (marked data-lang-picker) a language picker; onSelect(locale) runs on a choice. */
export function mountLanguagePicker(el, onSelect) {
  el._onSelect = onSelect;
  document.addEventListener("click", (e) => !el.contains(e.target) && close(el));
}

function renderPicker(el, locale, strings) {
  const id = el.id || "lang";
  const hadFocus = el.contains(document.activeElement); // redrawn on every language change
  el.innerHTML = `
    <button type="button" class="lang-button" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list">
      ${GLOBE}<span class="lang-greeting"></span>${CHEVRON}
    </button>
    <ul class="lang-list" id="${id}-list" role="listbox" tabindex="-1" hidden></ul>`;
  const button = el.querySelector("button");
  const list = el.querySelector("ul");
  button.setAttribute("aria-label", `${strings.language}: ${strings[OPTION_LABEL[locale]]}`);
  Object.assign(el.querySelector(".lang-greeting"), { textContent: strings.greeting, lang: locale });
  list.setAttribute("aria-label", strings.language);
  for (const code of LOCALES) {
    const li = Object.assign(document.createElement("li"), { id: `${id}-${code}`, textContent: strings[OPTION_LABEL[code]] });
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(code === locale));
    li.dataset.value = code;
    li.addEventListener("click", () => choose(el, code));
    list.append(li);
  }

  button.addEventListener("click", () => (list.hidden ? open(el, locale) : close(el)));
  button.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      open(el, locale);
    }
  });
  list.addEventListener("keydown", (e) => {
    const options = [...list.children];
    const current = options.findIndex((o) => o.id === list.getAttribute("aria-activedescendant"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (current + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      highlight(list, options[next]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(el, options[current].dataset.value);
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.stopPropagation(); // Escape closes this list, not the account menu around it
      close(el, e.key === "Escape");
    }
  });
  if (hadFocus) button.focus();
}

function open(el, locale) {
  const list = el.querySelector("ul");
  list.hidden = false;
  el.querySelector("button").setAttribute("aria-expanded", "true");
  highlight(list, list.querySelector(`[data-value="${locale}"]`));
  list.focus();
}

function close(el, refocus = false) {
  const list = el.querySelector("ul");
  if (!list || list.hidden) return;
  list.hidden = true;
  el.querySelector("button").setAttribute("aria-expanded", "false");
  if (refocus) el.querySelector("button").focus();
}

function highlight(list, option) {
  [...list.children].forEach((o) => o.classList.toggle("active", o === option));
  list.setAttribute("aria-activedescendant", option.id);
}

function choose(el, code) {
  close(el, true);
  el._onSelect?.(code);
}
