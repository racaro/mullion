import { describe, expect, it } from "vitest";
import { ComfyClient, ComfyError } from "../src/comfy";

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function client(handler: Handler, extra: Partial<ConstructorParameters<typeof ComfyClient>[0]> = {}) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fake = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { comfy: new ComfyClient({ url: "http://comfy.test/", fetch: fake, sleep: async () => {}, ...extra }), calls };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe("ComfyClient", () => {
  it("runs a full generation: queue, poll history, download the image", async () => {
    let polls = 0;
    const { comfy, calls } = client((url) => {
      if (url.pathname === "/prompt") return json({ prompt_id: "p1" });
      if (url.pathname === "/history/p1") {
        return json(++polls < 3 ? {} : { p1: { status: { status_str: "success" }, outputs: { "12": { images: [{ filename: "x.png", subfolder: "mullion", type: "output" }] } } } });
      }
      if (url.pathname === "/view") return new Response(new Uint8Array([1, 2, 3]));
      return json({}, 404);
    });
    const image = await comfy.generate({ "1": {} });
    expect(new Uint8Array(image)).toEqual(new Uint8Array([1, 2, 3]));
    expect(polls).toBe(3);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ prompt: { "1": {} }, client_id: "mullion" });
    expect(calls.at(-1)!.url.searchParams.get("subfolder")).toBe("mullion");
  });

  it("uploads as multipart and returns the name with its subfolder", async () => {
    const { comfy, calls } = client(() => json({ name: "s.png", subfolder: "in" }));
    expect(await comfy.uploadImage(new Uint8Array([1]), "s.png")).toBe("in/s.png");
    const form = calls[0].init.body as FormData;
    expect((form.get("image") as File).name).toBe("s.png");
    expect(form.get("overwrite")).toBe("true");
  });

  it("sends the Access service token on every request", async () => {
    const { comfy, calls } = client(() => json({ prompt_id: "p" }), { accessClientId: "id", accessClientSecret: "secret" });
    await comfy.queue({});
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("CF-Access-Client-Id")).toBe("id");
    expect(headers.get("CF-Access-Client-Secret")).toBe("secret");
  });

  it("explains validation errors per node", async () => {
    const { comfy } = client(() => json({
      error: { message: "Prompt outputs failed validation" },
      node_errors: { "1": { class_type: "CheckpointLoaderSimple", errors: [{ details: "ckpt_name: 'x' not in list" }] } },
    }, 400));
    await expect(comfy.queue({})).rejects.toThrow(/Node 1 \(CheckpointLoaderSimple\).*\n.*COMFY_CHECKPOINT/s);
  });

  it("reports execution errors", async () => {
    const { comfy } = client(() => json({ p: { status: { status_str: "error", messages: [["execution_error", { node_type: "KSampler", exception_message: "out of memory " }]] } } }));
    await expect(comfy.wait("p")).rejects.toThrow("ComfyUI failed while generating: KSampler: out of memory");
  });

  it("gives up after the timeout", async () => {
    const { comfy } = client(() => json({}));
    await expect(comfy.wait("p", 0)).rejects.toThrow(ComfyError);
  });

  it("explains an unreachable server", async () => {
    const { comfy } = client(() => { throw new TypeError("fetch failed"); });
    await expect(comfy.queue({})).rejects.toThrow(/Cannot reach ComfyUI at http:\/\/comfy.test/);
  });
});
