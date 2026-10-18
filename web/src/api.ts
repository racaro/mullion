// JSON API for the web app. Every route except the catalog needs a signed-in user.
import { Hono } from "hono";
import { currentUser } from "./auth";
import { InvalidBrief, LOCALES, catalog, fitSize, imageSize, parseBrief } from "./engine";
import { LIMITS, PUBLIC_RENDER_ERROR, checkImageSides, isAllowedEmail } from "./security";
import type { AppEnv, RenderRow } from "./types";

export const api = new Hono<AppEnv>();

api.get("/catalog", (c) => c.json(catalog(c.req.query("locale") ?? "en")));

api.use("*", async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Sign in first." }, 401);
  // Checked on every request, so removing someone from ALLOWED_EMAILS takes effect at once.
  if (!isAllowedEmail(user.email, c.env.ALLOWED_EMAILS)) return c.json({ error: "This account is not invited." }, 403);
  c.set("user", user);
  await next();
});

api.get("/me", (c) => c.json(c.get("user")));

api.put("/me/locale", async (c) => {
  const { locale } = await c.req.json<{ locale: string }>();
  if (!LOCALES.includes(locale as never)) return c.json({ error: `Locale must be one of: ${LOCALES.join(", ")}.` }, 400);
  await c.env.DB.prepare("UPDATE users SET locale = ? WHERE id = ?").bind(locale, c.get("user").id).run();
  return c.json({ locale });
});

/** Upload a sketch (and optionally an erase mask) with a brief, and queue its render. */
api.post("/renders", async (c) => {
  const length = Number(c.req.header("Content-Length") ?? NaN);
  if (!(length <= LIMITS.maxRequestBytes)) return c.json({ error: "Images must be 10 MB or smaller." }, 413);
  const usage = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(status IN ('queued', 'running')), 0) AS pending,
            COALESCE(SUM(created_at > datetime('now', '-1 day')), 0) AS today
     FROM renders WHERE user_id = ?`,
  ).bind(c.get("user").id).first<{ pending: number; today: number }>();
  const perDay = Number(c.env.MAX_RENDERS_PER_DAY ?? LIMITS.maxPerDay);
  if (usage && usage.pending >= LIMITS.maxPending) {
    return c.json({ error: `Wait until one of your ${LIMITS.maxPending} pending renders finishes.` }, 429);
  }
  if (usage && usage.today >= perDay) return c.json({ error: `You can make ${perDay} renders a day. Try again tomorrow.` }, 429);

  const form = await c.req.formData();
  const sketch = form.get("sketch");
  const mask = form.get("mask");
  if (!(sketch instanceof File)) return c.json({ error: "Attach the sketch as 'sketch'." }, 400);

  let brief, size: [number, number], sketchBytes: Uint8Array, maskBytes: Uint8Array | null = null;
  try {
    brief = parseBrief(JSON.parse(String(form.get("brief") ?? "{}")));
    for (const file of [sketch, mask]) {
      if (file instanceof File && file.size > LIMITS.maxUploadBytes) throw new InvalidBrief("Images must be 10 MB or smaller.");
    }
    sketchBytes = new Uint8Array(await sketch.arrayBuffer());
    const sides = imageSize(sketchBytes);
    checkImageSides(...sides);
    size = fitSize(...sides);
    if (mask instanceof File) {
      maskBytes = new Uint8Array(await mask.arrayBuffer());
      checkImageSides(...imageSize(maskBytes)); // must be a PNG or JPEG too
    }
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Invalid request." }, 400);
  }

  const id = crypto.randomUUID();
  const sketchKey = `sketches/${id}`;
  const maskKey = maskBytes ? `masks/${id}` : null;
  await c.env.BUCKET.put(sketchKey, sketchBytes, { httpMetadata: { contentType: imageType(sketchBytes) } });
  if (maskKey && maskBytes) await c.env.BUCKET.put(maskKey, maskBytes, { httpMetadata: { contentType: imageType(maskBytes) } });

  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  await c.env.DB.prepare(
    `INSERT INTO renders (id, user_id, brief, sketch_key, mask_key, width, height, seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, c.get("user").id, JSON.stringify(brief), sketchKey, maskKey, size[0], size[1], seed).run();
  await c.env.RENDER_QUEUE.send({ renderId: id });
  return c.json(await findRender(c.env.DB, id, c.get("user").id), 201);
});

api.get("/renders", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM renders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50")
    .bind(c.get("user").id).all<RenderRow>();
  return c.json(results.map(publicRender));
});

api.get("/renders/:id", async (c) => {
  const render = await findRender(c.env.DB, c.req.param("id"), c.get("user").id);
  return render ? c.json(render) : c.json({ error: "Not found." }, 404);
});

/** The sketch, mask or finished image of one of the user's renders. */
api.get("/renders/:id/:file{sketch|mask|result}", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM renders WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("user").id).first<RenderRow>();
  const key = row && { sketch: row.sketch_key, mask: row.mask_key, result: row.result_key }[c.req.param("file")];
  const object = key ? await c.env.BUCKET.get(key) : null;
  if (!object) return c.json({ error: "Not found." }, 404);
  return new Response(object.body, {
    headers: { "Content-Type": object.httpMetadata?.contentType ?? "image/png", "Cache-Control": "private, max-age=3600" },
  });
});

function imageType(bytes: Uint8Array): string {
  return bytes[0] === 0x89 ? "image/png" : "image/jpeg"; // imageSize() already accepted it as one of the two
}

async function findRender(db: D1Database, id: string, userId: string) {
  const row = await db.prepare("SELECT * FROM renders WHERE id = ? AND user_id = ?").bind(id, userId).first<RenderRow>();
  return row ? publicRender(row) : null;
}

function publicRender(row: RenderRow) {
  const base = `/api/renders/${row.id}`;
  return {
    id: row.id,
    status: row.status,
    brief: JSON.parse(row.brief),
    width: row.width,
    height: row.height,
    error: row.status === "failed" ? PUBLIC_RENDER_ERROR : null,
    createdAt: row.created_at,
    sketchUrl: `${base}/sketch`,
    maskUrl: row.mask_key ? `${base}/mask` : null,
    resultUrl: row.result_key ? `${base}/result` : null,
  };
}
