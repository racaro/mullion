// ComfyUI API client for the Worker; same routes and error messages as engine/client.py.
// In production ComfyUI sits behind Cloudflare Tunnel + Access, so every request carries
// the Access service token.

export class ComfyError extends Error {}

export interface ComfyConfig {
  url: string;
  accessClientId?: string;
  accessClientSecret?: string;
  fetch?: typeof fetch; // injectable for tests
  sleep?: (ms: number) => Promise<void>;
}

interface HistoryEntry {
  status?: { status_str?: string; messages?: [string, Record<string, string>][] };
  outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }>;
}

export class ComfyClient {
  private readonly url: string;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: ComfyConfig) {
    this.url = config.url.replace(/\/+$/, "");
    this.fetch = config.fetch ?? fetch.bind(globalThis);
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.config.accessClientId && this.config.accessClientSecret) {
      headers.set("CF-Access-Client-Id", this.config.accessClientId);
      headers.set("CF-Access-Client-Secret", this.config.accessClientSecret);
    }
    let response: Response;
    try {
      response = await this.fetch(this.url + path, { ...init, headers });
    } catch (e) {
      throw new ComfyError(`Cannot reach ComfyUI at ${this.url}. Is it running and is the Tunnel up? Details: ${e}`);
    }
    if (response.redirected && new URL(response.url).hostname.endsWith("cloudflareaccess.com")) {
      throw new ComfyError("Cloudflare Access rejected the request: check CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET.");
    }
    if (!response.ok) throw new ComfyError(explainHttpError(response.status, await response.text()));
    return response;
  }

  private async json<T>(path: string, body?: unknown): Promise<T> {
    const init: RequestInit = body === undefined ? {} : {
      method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
    };
    const text = await (await this.request(path, init)).text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Upload an image to ComfyUI's input folder and return the name to reference it by. */
  async uploadImage(data: ArrayBuffer | Uint8Array, filename: string): Promise<string> {
    const form = new FormData();
    form.append("overwrite", "true");
    form.append("image", new Blob([data]), filename);
    const uploaded = (await (await this.request("/upload/image", { method: "POST", body: form })).json()) as {
      name: string;
      subfolder?: string;
    };
    return uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
  }

  async queue(workflow: unknown): Promise<string> {
    return (await this.json<{ prompt_id: string }>("/prompt", { prompt: workflow, client_id: "mullion" })).prompt_id;
  }

  async wait(promptId: string, timeoutMs = 600_000, pollMs = 2_000): Promise<HistoryEntry> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const history = await this.json<Record<string, HistoryEntry>>(`/history/${promptId}`);
      const entry = history[promptId];
      if (entry) {
        if (entry.status?.status_str === "error") throw new ComfyError(`ComfyUI failed while generating: ${executionMessage(entry)}`);
        return entry;
      }
      await this.sleep(pollMs);
    }
    throw new ComfyError(`Generation did not finish within ${Math.round(timeoutMs / 1000)} s.`);
  }

  /** The first image a finished generation produced. */
  async firstImage(entry: HistoryEntry): Promise<ArrayBuffer> {
    for (const output of Object.values(entry.outputs ?? {})) {
      const img = output.images?.[0];
      if (img) {
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? "", type: img.type ?? "output" });
        return (await this.request(`/view?${q}`)).arrayBuffer();
      }
    }
    throw new ComfyError("Generation finished but returned no image.");
  }

  async generate(workflow: unknown): Promise<ArrayBuffer> {
    return this.firstImage(await this.wait(await this.queue(workflow)));
  }
}

function explainHttpError(code: number, body: string): string {
  let data: { error?: { message?: string }; node_errors?: Record<string, { class_type?: string; errors?: { message?: string; details?: string }[] }> };
  try {
    data = JSON.parse(body);
  } catch {
    return `ComfyUI returned ${code}: ${body.slice(0, 300)}`;
  }
  const lines = [`ComfyUI rejected the request (${code}): ${data.error?.message ?? ""}`.trim()];
  for (const [node, info] of Object.entries(data.node_errors ?? {})) {
    for (const err of info.errors ?? []) lines.push(`  · Node ${node} (${info.class_type ?? "?"}): ${err.details || err.message}`);
  }
  if (lines.some((line) => line.includes("not in"))) {
    lines.push("  Hint: COMFY_CHECKPOINT or COMFY_CONTROLNET does not match a file installed in ComfyUI.");
  }
  return lines.join("\n");
}

function executionMessage(entry: HistoryEntry): string {
  for (const [kind, data] of entry.status?.messages ?? []) {
    if (kind === "execution_error") return `${data.node_type ?? "?"}: ${(data.exception_message ?? "").trim()}`;
  }
  return "unknown error";
}
