import { Hono } from "hono";
import { api } from "./api";
import { auth } from "./auth";
import { handleRenderBatch } from "./queue";
import { SECURITY_HEADERS, isSameOrigin } from "./security";
import type { AppEnv, Env, RenderJob } from "./types";

const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  if (!isSameOrigin(c.req.method, c.req.url, c.req.header("Origin") ?? null, c.req.header("Sec-Fetch-Site") ?? null)) {
    return c.json({ error: "Cross-site request refused." }, 403);
  }
  await next();
  c.res = new Response(c.res.body, c.res); // responses from fetch() have immutable headers
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
});
app.route("/auth", auth);
app.route("/api", api);
app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "Not found." }, 404) : c.env.ASSETS.fetch(c.req.raw)));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong." }, 500);
});

export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<RenderJob>, env: Env) => handleRenderBatch(batch, env),
} satisfies ExportedHandler<Env, RenderJob>;
