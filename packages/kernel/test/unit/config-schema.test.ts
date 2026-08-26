// AC#5 (task) — config_schema validator: given a provider's typed config_schema and a params
// object, REJECT a violating value NAMING the offending field, offline, before anything runs.
// Covers type/required/optional/default/enum/min/max/pattern/conflicts_with/required_with.
import { describe, expect, it } from "vitest";
import type { ConfigSchema } from "../../src/config-schema.js";
import { validateConfig, validateSchemaShape } from "../../src/config-schema.js";

const SCHEMA: ConfigSchema = {
  complete_on: { type: "string", required: true, pattern: "^/" },
  viewport: { type: "string", enum: ["1280x800", "1920x1080"] },
  memory: { type: "number", min: 1, max: 8 },
  retries: { type: "number", min: 0 },
  insecure: { type: "bool", conflicts_with: ["secure_token"] },
  secure_token: { type: "string", sensitive: true, required_with: ["audience"] },
  audience: { type: "string" },
  tags: { type: "list", items: { type: "string" }, max: 3 },
};

describe("validateConfig — happy path", () => {
  it("accepts a conforming params object", () => {
    const r = validateConfig(SCHEMA, {
      complete_on: "/dashboard",
      viewport: "1280x800",
      memory: 2,
      tags: ["a", "b"],
    });
    expect(r.ok).toBe(true);
  });
});

describe("validateConfig — rejects a violating value NAMING the field (offline)", () => {
  it("names a missing required field", () => {
    const r = validateConfig(SCHEMA, { viewport: "1280x800" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.defects.some((d) => d.field === "complete_on")).toBe(true);
    }
  });

  it("names a wrong-typed field", () => {
    const r = validateConfig(SCHEMA, { complete_on: "/x", memory: "lots" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const d = r.defects.find((x) => x.field === "memory");
      expect(d).toBeDefined();
      expect(d?.message).toContain("memory");
    }
  });

  it("names an out-of-range and an out-of-enum field", () => {
    const r = validateConfig(SCHEMA, { complete_on: "/x", memory: 99, viewport: "3000x2000" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.defects.map((d) => d.field);
      expect(fields).toContain("memory"); // > max
      expect(fields).toContain("viewport"); // not in enum
    }
  });

  it("names a pattern violation", () => {
    const r = validateConfig(SCHEMA, { complete_on: "no-leading-slash" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.defects.some((d) => d.field === "complete_on" && d.message.includes("pattern")),
      ).toBe(true);
    }
  });

  it("names an UNKNOWN (off-schema) field — allowlist-by-construction", () => {
    const r = validateConfig(SCHEMA, { complete_on: "/x", bogus: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.defects.some((d) => d.field === "bogus")).toBe(true);
    }
  });

  it("enforces conflicts_with and required_with cross-field rules", () => {
    // conflict: insecure + secure_token together
    const conflict = validateConfig(SCHEMA, {
      complete_on: "/x",
      insecure: true,
      secure_token: "s",
      audience: "a",
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(
        conflict.defects.some((d) => d.field === "insecure" && d.message.includes("conflicts")),
      ).toBe(true);
    }
    // required_with: secure_token set but audience missing
    const missingReq = validateConfig(SCHEMA, { complete_on: "/x", secure_token: "s" });
    expect(missingReq.ok).toBe(false);
    if (!missingReq.ok) {
      expect(
        missingReq.defects.some(
          (d) => d.field === "secure_token" && d.message.includes("requires"),
        ),
      ).toBe(true);
    }
  });

  it("validates list length and element type", () => {
    const r = validateConfig(SCHEMA, { complete_on: "/x", tags: ["a", "b", "c", "d"] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.defects.some((d) => d.field === "tags")).toBe(true);
    }
    const badEl = validateConfig(SCHEMA, { complete_on: "/x", tags: ["a", 2] });
    expect(badEl.ok).toBe(false);
    if (!badEl.ok) {
      expect(badEl.defects.some((d) => d.field === "tags[1]")).toBe(true);
    }
  });
});

describe("validateSchemaShape — the schema must itself be well-formed (§4)", () => {
  it("accepts a valid schema and rejects a malformed one (unknown type, empty enum)", () => {
    expect(validateSchemaShape(SCHEMA).ok).toBe(true);
    const bad = validateSchemaShape({
      a: { type: "weird" as never },
      b: { type: "enum", enum: [] },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const fields = bad.defects.map((d) => d.field);
      expect(fields).toContain("a");
      expect(fields).toContain("b");
    }
  });
});
