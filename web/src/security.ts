// Security rules shared by the routes: who may sign in, how much each user may upload,
// which requests may change state, and the response headers every page gets.

/** Sent on every response. public/_headers repeats them for static files (a test keeps both equal). */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: https://lh3.googleusercontent.com; connect-src 'self'; " +
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export const LIMITS = {
  maxUploadBytes: 10 * 1024 * 1024, // per image
  maxRequestBytes: 21 * 1024 * 1024, // sketch + mask + form fields
  maxSide: 8192, // px; larger headers are rejected before ComfyUI decodes anything
  minSide: 64,
  maxPending: 3, // queued or running renders per user
  maxPerDay: 20, // renders per user in 24 h (override with MAX_RENDERS_PER_DAY)
};

/**
 * Whether this email may use the app. ALLOWED_EMAILS is a comma-separated list of emails or
 * `@domain` entries; `*` lets every verified Google account in. Empty or unset lets nobody in.
 */
export function isAllowedEmail(email: string, allowed: string | undefined): boolean {
  const entries = (allowed ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const address = email.trim().toLowerCase();
  return entries.some((e) => e === "*" || e === address || (e.startsWith("@") && address.endsWith(e)));
}

/**
 * Requests that change state must come from our own pages. SameSite=Lax cookies already stop
 * most cross-site posts; this also covers older browsers and same-site subdomains.
 */
export function isSameOrigin(method: string, requestUrl: string, origin: string | null, fetchSite: string | null): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  if (origin) return origin === new URL(requestUrl).origin;
  return fetchSite === "same-origin"; // no Origin header: trust only the browser's own verdict
}

export function checkImageSides(width: number, height: number): void {
  if (Math.max(width, height) > LIMITS.maxSide || Math.min(width, height) < LIMITS.minSide) {
    throw new RangeError(`Images must be between ${LIMITS.minSide} and ${LIMITS.maxSide} px per side.`);
  }
}

/** What a user sees when a render fails; the detailed reason stays in the logs and the database. */
export const PUBLIC_RENDER_ERROR = "The render could not be completed. Please try again later.";
