// Google sign-in (OAuth 2.0 authorization code flow with PKCE) and cookie sessions in D1.
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env, User } from "./types";

const SESSION_COOKIE = "mullion_session";
const FLOW_COOKIE = "mullion_oauth"; // state + PKCE verifier while the user is at Google
const SESSION_DAYS = 30;
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

export const auth = new Hono<AppEnv>();

auth.get("/google", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.text("Google sign-in is not configured (GOOGLE_CLIENT_ID).", 500);
  const state = randomToken();
  const verifier = randomToken();
  setCookie(c, FLOW_COOKIE, `${state}.${verifier}`, { httpOnly: true, secure: true, sameSite: "Lax", path: "/auth", maxAge: 600 });
  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(c.req.url),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: await sha256(verifier, "base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return c.redirect(url.toString());
});

auth.get("/google/callback", async (c) => {
  const [state, verifier] = (getCookie(c, FLOW_COOKIE) ?? "").split(".");
  deleteCookie(c, FLOW_COOKIE, { path: "/auth" });
  const code = c.req.query("code");
  if (!state || !verifier || !code || c.req.query("state") !== state) return c.redirect("/?signin=failed");

  const token = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(c.req.url),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!token.ok) return c.redirect("/?signin=failed");
  // The ID token comes straight from Google over TLS, so its claims can be read without
  // checking the signature (OpenID Connect Core, section 3.1.3.7); we still check who it is for.
  const claims = decodeJwtPayload(((await token.json()) as { id_token: string }).id_token);
  const issuers = ["https://accounts.google.com", "accounts.google.com"];
  if (claims.aud !== c.env.GOOGLE_CLIENT_ID || !issuers.includes(claims.iss) || !claims.email_verified) {
    return c.redirect("/?signin=failed");
  }
  const user = await upsertUser(c.env, {
    googleSub: claims.sub, email: claims.email, name: claims.name ?? "", picture: claims.picture ?? "",
    locale: String(claims.locale ?? "").startsWith("es") ? "es" : "en",
  });
  await startSession(c, user.id);
  return c.redirect("/");
});

// Local development only: sign in without Google. Needs DEV_LOGIN=true and a localhost address.
auth.get("/dev", async (c) => {
  if (c.env.DEV_LOGIN !== "true" || !["localhost", "127.0.0.1"].includes(new URL(c.req.url).hostname)) return c.notFound();
  const user = await upsertUser(c.env, { googleSub: "dev", email: "dev@localhost", name: "Developer", picture: "", locale: "es" });
  await startSession(c, user.id);
  return c.redirect("/");
});

auth.post("/logout", async (c) => {
  const value = getCookie(c, SESSION_COOKIE);
  if (value) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(value, "hex")).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.redirect("/");
});

/** The signed-in user, or null. */
export async function currentUser(c: { env: Env; req: { raw: Request } }): Promise<User | null> {
  const value = cookieValue(c.req.raw, SESSION_COOKIE);
  if (!value) return null;
  return c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture, u.locale FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now')`,
  ).bind(await sha256(value, "hex")).first<User>();
}

async function upsertUser(env: Env, u: { googleSub: string; email: string; name: string; picture: string; locale: string }): Promise<User> {
  return (await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, picture, locale) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture
     RETURNING id, email, name, picture, locale`,
  ).bind(crypto.randomUUID(), u.googleSub, u.email, u.name, u.picture, u.locale).first<User>())!;
}

async function startSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const value = randomToken();
  await c.env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`)
    .bind(await sha256(value, "hex"), userId, `+${SESSION_DAYS} days`).run();
  setCookie(c, SESSION_COOKIE, value, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86400 });
}

function redirectUri(requestUrl: string): string {
  return new URL("/auth/google/callback", requestUrl).toString();
}

function cookieValue(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(text: string, encoding: "hex" | "base64url"): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return encoding === "hex" ? [...digest].map((b) => b.toString(16).padStart(2, "0")).join("") : toBase64Url(digest);
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeJwtPayload(jwt: string): Record<string, any> {
  const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")), (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
