/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, checkImageSides, isAllowedEmail, isSameOrigin } from "../src/security";
import headersFile from "../public/_headers?raw";

describe("isAllowedEmail", () => {
  it("lets nobody in when the list is empty or unset", () => {
    expect(isAllowedEmail("ana@example.com", "")).toBe(false);
    expect(isAllowedEmail("ana@example.com", undefined)).toBe(false);
  });

  it("matches emails and @domains, ignoring case and spaces", () => {
    const list = " Ana@Example.com , @studio.es";
    expect(isAllowedEmail("ana@example.com", list)).toBe(true);
    expect(isAllowedEmail("luis@studio.es", list)).toBe(true);
    expect(isAllowedEmail("luis@notstudio.es", list)).toBe(false);
    expect(isAllowedEmail("eve@example.com", list)).toBe(false);
  });

  it("lets everyone in with *", () => {
    expect(isAllowedEmail("anyone@example.com", "*")).toBe(true);
  });
});

describe("isSameOrigin", () => {
  const url = "https://mullion.example.workers.dev/api/renders";

  it("allows safe methods from anywhere", () => {
    expect(isSameOrigin("GET", url, "https://evil.test", "cross-site")).toBe(true);
  });

  it("refuses state changes from another origin", () => {
    expect(isSameOrigin("POST", url, "https://mullion.example.workers.dev", null)).toBe(true);
    expect(isSameOrigin("POST", url, "https://evil.test", null)).toBe(false);
    expect(isSameOrigin("POST", url, "null", null)).toBe(false);
  });

  it("without Origin, trusts only Sec-Fetch-Site: same-origin", () => {
    expect(isSameOrigin("PUT", url, null, "same-origin")).toBe(true);
    expect(isSameOrigin("PUT", url, null, "same-site")).toBe(false);
    expect(isSameOrigin("PUT", url, null, null)).toBe(false);
  });
});

describe("checkImageSides", () => {
  it("accepts normal sketches and rejects huge or tiny ones", () => {
    expect(() => checkImageSides(2048, 1489)).not.toThrow();
    expect(() => checkImageSides(60000, 60000)).toThrow(/8192/);
    expect(() => checkImageSides(10, 500)).toThrow(/64/);
  });
});

it("public/_headers sends the same headers as the Worker", () => {
  const lines = headersFile.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
  const fromFile = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 2)]));
  expect(fromFile).toEqual(SECURITY_HEADERS);
});
