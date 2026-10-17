// TypeScript port of engine/brief.py and engine/workflow.py. The options come from
// engine/export.py and test/engine.test.ts checks the output against the Python reference cases.
import engine from "./generated/engine.json";

type Group = "rooms" | "styles" | "materials" | "lighting";
type Options = Record<string, { prompt: string; label: Record<string, string> }>;

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export interface Brief {
  room: string;
  style: string;
  lighting: string;
  materials: string[];
  details: string; // optional free text, in English
}

export class InvalidBrief extends Error {}

function options(group: Group): Options {
  return engine[group] as Options;
}

function check(name: string, value: string, group: Group): void {
  if (!(value in options(group))) {
    throw new InvalidBrief(`Unknown ${name} '${value}'. Valid values: ${Object.keys(options(group)).sort().join(", ")}.`);
  }
}

/** Fill the defaults and validate an untrusted brief (for example, from the API). */
export function parseBrief(input: Partial<Brief>): Brief {
  const brief: Brief = {
    room: String(input.room ?? ""),
    style: String(input.style ?? ""),
    lighting: String(input.lighting || "morning"),
    materials: Array.isArray(input.materials) ? input.materials.map(String) : [],
    details: String(input.details ?? ""),
  };
  check("room", brief.room, "rooms");
  check("style", brief.style, "styles");
  check("lighting", brief.lighting, "lighting");
  brief.materials.forEach((m) => check("material", m, "materials"));
  if (brief.details.length > engine.maxDetails) throw new InvalidBrief(`Details cannot exceed ${engine.maxDetails} characters.`);
  return brief;
}

/** Return [positive, negative]. Order matters: earlier terms weigh more in the model. */
export function buildPrompt(input: Partial<Brief>): [string, string] {
  const brief = parseBrief(input);
  const parts = [
    engine.quality,
    options("rooms")[brief.room].prompt,
    options("styles")[brief.style].prompt,
    ...[...new Set(brief.materials)].map((m) => options("materials")[m].prompt), // de-duplicated, order kept
    options("lighting")[brief.lighting].prompt,
  ];
  if (brief.details.trim()) parts.push(brief.details.trim());
  parts.push(engine.camera);
  return [parts.join(", "), engine.negative];
}

/** Options with labels in one locale, ready for the web app. Falls back to English. */
export function catalog(locale: string): Record<Group, { id: string; label: string }[]> {
  const items = (group: Group) =>
    Object.entries(options(group)).map(([id, o]) => ({ id, label: o.label[locale] ?? o.label.en }));
  return { rooms: items("rooms"), styles: items("styles"), materials: items("materials"), lighting: items("lighting") };
}

// ---------- workflow -----------------------------------------------------------------

export interface RenderParams {
  sketch_image: string; // name returned by /upload/image
  checkpoint: string;
  controlnet: string;
  positive: string;
  negative: string;
  width: number;
  height: number;
  seed?: number;
  controlnet_strength?: number;
  controlnet_end?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  invert_sketch?: boolean;
  erase_mask?: string | null; // uploaded image, white where the sketch must be ignored
  output_prefix?: string;
}

type Link = [string, number];
type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export function buildWorkflow(params: RenderParams): Workflow {
  const p = {
    seed: 42, controlnet_strength: 0.9, controlnet_end: 1.0, steps: 25, cfg: 7.0, sampler: "dpmpp_2m",
    scheduler: "karras", invert_sketch: true, erase_mask: null, output_prefix: "mullion", ...params,
  };
  if (p.width % 8 || p.height % 8) throw new Error("Width and height must be multiples of 8.");
  const workflow: Workflow = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: p.checkpoint } },
    "2": { class_type: "LoadImage", inputs: { image: p.sketch_image } },
    "3": {
      class_type: "ImageScale",
      inputs: { image: ["2", 0], upscale_method: "lanczos", width: p.width, height: p.height, crop: "disabled" },
    },
  };
  let control: Link = ["3", 0];
  if (p.invert_sketch) {
    workflow["4"] = { class_type: "ImageInvert", inputs: { image: ["3", 0] } };
    control = ["4", 0];
  }
  if (p.erase_mask) {
    // Paint the masked areas black (no lines) so ControlNet does not force a shape there.
    workflow["13"] = { class_type: "LoadImage", inputs: { image: p.erase_mask } };
    workflow["14"] = {
      class_type: "ImageScale",
      inputs: { image: ["13", 0], upscale_method: "nearest-exact", width: p.width, height: p.height, crop: "disabled" },
    };
    workflow["15"] = { class_type: "ImageToMask", inputs: { image: ["14", 0], channel: "red" } };
    workflow["16"] = { class_type: "EmptyImage", inputs: { width: p.width, height: p.height, batch_size: 1, color: 0 } };
    workflow["17"] = {
      class_type: "ImageCompositeMasked",
      inputs: { destination: control, source: ["16", 0], x: 0, y: 0, resize_source: false, mask: ["15", 0] },
    };
    control = ["17", 0];
  }
  Object.assign(workflow, {
    "5": { class_type: "CLIPTextEncode", inputs: { text: p.positive, clip: ["1", 1] } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: p.negative, clip: ["1", 1] } },
    "7": { class_type: "ControlNetLoader", inputs: { control_net_name: p.controlnet } },
    "8": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: ["5", 0], negative: ["6", 0], control_net: ["7", 0], image: control,
        strength: p.controlnet_strength, start_percent: 0.0, end_percent: p.controlnet_end, vae: ["1", 2],
      },
    },
    "9": { class_type: "EmptyLatentImage", inputs: { width: p.width, height: p.height, batch_size: 1 } },
    "10": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler,
        positive: ["8", 0], negative: ["8", 1], latent_image: ["9", 0], denoise: 1.0,
      },
    },
    "11": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["1", 2] } },
    "12": { class_type: "SaveImage", inputs: { images: ["11", 0], filename_prefix: p.output_prefix } },
  });
  return workflow;
}

/** Keep the sketch's aspect ratio, with a fixed long side and both sides multiples of 8. */
export function fitSize(width: number, height: number, longSide = 768): [number, number] {
  if (width <= 0 || height <= 0) throw new Error("Invalid sketch dimensions.");
  const scale = longSide / Math.max(width, height);
  const snap = (v: number) => Math.max(256, roundHalfEven((v * scale) / 8) * 8);
  return [snap(width), snap(height)];
}

// Python's round() rounds halves to even; match it so both sides give the same size.
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Width and height of a PNG or JPEG, read from its header. */
export function imageSize(data: Uint8Array): [number, number] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= 24 && png.every((b, i) => data[i] === b)) return [view.getUint32(16), view.getUint32(20)];
  if (data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = data[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return [view.getUint16(i + 7), view.getUint16(i + 5)];
      }
      i += 2 + view.getUint16(i + 2);
    }
  }
  throw new Error("Unsupported format. Use PNG or JPG.");
}
