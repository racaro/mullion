import { describe, expect, it } from "vitest";
import { InvalidBrief, buildPrompt, buildWorkflow, catalog, fitSize, imageSize, type RenderParams } from "../src/engine";
import cases from "./engine-cases.json";

// Reference cases computed by the Python engine (engine/export.py).
describe("matches the Python engine", () => {
  it.each(cases.prompts)("prompt for $brief.room", ({ brief, positive, negative }) => {
    expect(buildPrompt(brief)).toEqual([positive, negative]);
  });

  it.each(cases.workflows)("workflow %#", ({ params, workflow }) => {
    expect(buildWorkflow(params as RenderParams)).toEqual(workflow);
  });

  it.each(cases.fitSize)("fitSize($size)", ({ size, fit }) => {
    expect(fitSize(size[0], size[1])).toEqual(fit);
  });
});

describe("brief", () => {
  it("lists valid values for unknown options", () => {
    expect(() => buildPrompt({ room: "garage", style: "classic" })).toThrow(InvalidBrief);
    expect(() => buildPrompt({ room: "garage", style: "classic" })).toThrow(/Valid values: .*kitchen/);
  });

  it("rejects details that are too long", () => {
    expect(() => buildPrompt({ room: "kitchen", style: "classic", details: "x".repeat(301) })).toThrow(/300/);
  });

  it("labels options per locale and falls back to English", () => {
    expect(catalog("es").rooms.find((r) => r.id === "kitchen")?.label).toBe("Cocina");
    expect(catalog("fr").rooms.find((r) => r.id === "kitchen")?.label).toBe("Kitchen");
  });
});

describe("imageSize", () => {
  it("reads PNG", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 1600);
    new DataView(png.buffer).setUint32(20, 1200);
    expect(imageSize(png)).toEqual([1600, 1200]);
  });

  it("reads JPEG, skipping segments before the frame header", () => {
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
    const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0xd1, 0x08, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(imageSize(new Uint8Array([0xff, 0xd8, ...app0, ...sof0]))).toEqual([2048, 1489]);
  });

  it("rejects other formats", () => {
    expect(() => imageSize(new TextEncoder().encode("GIF89a........"))).toThrow(/PNG or JPG/);
  });
});
