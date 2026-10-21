// Calls to the Mullion API. Errors carry the server's own message when it sent one.

async function request(path, init) {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || response.statusText), { status: response.status });
  return data;
}

const catalogs = new Map();

export const api = {
  /** The signed-in user, or the Response when there is none (401) or they were removed (403). */
  async me() {
    const response = await fetch("/api/me");
    return response.ok ? { user: await response.json() } : { status: response.status };
  },
  catalog(locale) {
    if (!catalogs.has(locale)) catalogs.set(locale, request(`/api/catalog?locale=${locale}`));
    return catalogs.get(locale);
  },
  renders: () => request("/api/renders"),
  usage: () => request("/api/usage"),
  createRender: (body) => request("/api/renders", { method: "POST", body }),
  saveLocale: (locale) =>
    request("/api/me/locale", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale }) }),
};
