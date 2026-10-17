import { Hono } from "hono";
import { api } from "./api";
import { auth } from "./auth";
import { handleRenderBatch } from "./queue";
import type { AppEnv, Env, RenderJob } from "./types";

const app = new Hono<AppEnv>();
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
