// Render queue consumer: sends each job to ComfyUI and stores the image in R2.
import { ComfyClient, ComfyError } from "./comfy";
import { buildPrompt, buildWorkflow } from "./engine";
import type { Env, RenderJob, RenderRow } from "./types";

const MAX_ATTEMPTS = 3; // matches max_retries = 2 in wrangler.jsonc

export async function handleRenderBatch(batch: MessageBatch<RenderJob>, env: Env, comfy = comfyFor(env)): Promise<void> {
  for (const message of batch.messages) {
    const outcome = await processRender(message.body.renderId, env, comfy, message.attempts >= MAX_ATTEMPTS);
    if (outcome === "retry") message.retry({ delaySeconds: 30 * message.attempts });
    else message.ack();
  }
}

/** Render one job. Returns "retry" when ComfyUI failed and there are attempts left. */
export async function processRender(id: string, env: Env, comfy: ComfyClient, lastAttempt: boolean): Promise<"done" | "retry"> {
  const row = await env.DB.prepare("SELECT * FROM renders WHERE id = ?").bind(id).first<RenderRow>();
  if (!row || row.status === "done") return "done"; // deleted, or a duplicate delivery
  await setStatus(env, id, "running");
  try {
    const sketch = await env.BUCKET.get(row.sketch_key);
    if (!sketch) throw new Error("The sketch is missing from storage.");
    const sketchName = await comfy.uploadImage(await sketch.arrayBuffer(), `mullion-${id}-sketch${extension(sketch)}`);
    const mask = row.mask_key ? await env.BUCKET.get(row.mask_key) : null;
    const maskName = mask ? await comfy.uploadImage(await mask.arrayBuffer(), `mullion-${id}-mask${extension(mask)}`) : null;

    const [positive, negative] = buildPrompt(JSON.parse(row.brief));
    const image = await comfy.generate(buildWorkflow({
      sketch_image: sketchName, erase_mask: maskName, checkpoint: env.COMFY_CHECKPOINT, controlnet: env.COMFY_CONTROLNET,
      positive, negative, width: row.width, height: row.height, seed: row.seed,
      controlnet_strength: Number(env.CONTROLNET_STRENGTH), output_prefix: `mullion/${id}`,
    }));

    const resultKey = `renders/${id}.png`;
    await env.BUCKET.put(resultKey, image, { httpMetadata: { contentType: "image/png" } });
    await env.DB.prepare("UPDATE renders SET status = 'done', result_key = ?, error = NULL, updated_at = datetime('now') WHERE id = ?")
      .bind(resultKey, id).run();
    return "done";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Render ${id} failed: ${message}`);
    if (e instanceof ComfyError && !lastAttempt) {
      await setStatus(env, id, "queued", message);
      return "retry";
    }
    await setStatus(env, id, "failed", message);
    return "done";
  }
}

function extension(object: R2ObjectBody): string {
  return object.httpMetadata?.contentType === "image/png" ? ".png" : ".jpg";
}

function comfyFor(env: Env): ComfyClient {
  return new ComfyClient({ url: env.COMFY_URL, accessClientId: env.CF_ACCESS_CLIENT_ID, accessClientSecret: env.CF_ACCESS_CLIENT_SECRET });
}

async function setStatus(env: Env, id: string, status: RenderRow["status"], error: string | null = null): Promise<void> {
  await env.DB.prepare("UPDATE renders SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?").bind(status, error, id).run();
}
