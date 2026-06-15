import { describe, expect, it } from "vitest";
import type { ConfigSchema } from "../../src/config-schema.js";
import { validateConfig, validateSchemaShape } from "../../src/config-schema.js";

const SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  required: ["complete_on"],
  properties: {
    complete_on: { type: "string", pattern: "^/" },
    viewport: { type: "string", enum: ["1280x800", "1920x1080"] },
    memory: { type: "number", minimum: 1, maximum: 8 },
    retries: { type: "integer", minimum: 0 },
    secure_token: { type: "string", "x-gla-sensitive": true },
    audience: { type: "string" },
    limits: {
      type: "object",
      additionalProperties: false,
      required: ["cpu"],
      properties: {
        cpu: { type: "number", minimum: 1 },
        mode: { type: "string", enum: ["burst", "steady"] },
      },
    },
    tags: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  dependencies: {
    secure_token: ["audience"],
  },
};

describe("validateConfig", () => {
  it("accepts a conforming params object", () => {
    const result = validateConfig(SCHEMA, {
      complete_on: "/dashboard",
      viewport: "1280x800",
      memory: 2,
      retries: 0,
      limits: { cpu: 2, mode: "burst" },
      tags: ["a", "b"],
    });

    expect(result.ok).toBe(true);
  });

  it("reports every discoverable field-level defect in the stable diagnostic shape", () => {
    const result = validateConfig(SCHEMA, {
      complete_on: "no-leading-slash",
      viewport: "3000x2000",
      memory: 99,
      retries: 1.5,
      bogus: 1,
      limits: { extra: true, mode: "unknown" },
      tags: ["a", 2, "c", "d"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.defects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "bogus", code: "policy.denied" }),
          expect.objectContaining({ field: "complete_on", code: "policy.denied" }),
          expect.objectContaining({ field: "viewport", code: "policy.denied" }),
          expect.objectContaining({ field: "memory", code: "policy.denied" }),
          expect.objectContaining({ field: "retries", code: "policy.denied" }),
          expect.objectContaining({ field: "limits.cpu", code: "policy.denied" }),
          expect.objectContaining({ field: "limits.extra", code: "policy.denied" }),
          expect.objectContaining({ field: "limits.mode", code: "policy.denied" }),
          expect.objectContaining({ field: "tags", code: "policy.denied" }),
          expect.objectContaining({ field: "tags[1]", code: "policy.denied" }),
        ]),
      );
      expect(result.defects.every((defect) => defect.message.length > 0)).toBe(true);
    }
  });

  it("names missing required fields and dependency-required fields", () => {
    const result = validateConfig(SCHEMA, { secure_token: "secret" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.defects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "complete_on" }),
          expect.objectContaining({
            field: "secure_token",
            message: expect.stringContaining("audience"),
          }),
        ]),
      );
    }
  });

  it("does not mutate config values with defaults, coercion, or unknown-field removal", () => {
    const schema: ConfigSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", default: "safe" },
        count: { type: "number" },
      },
    };
    const input: Record<string, unknown> = { count: "2", extra: "kept" };
    const before = structuredClone(input);

    const result = validateConfig(schema, input);

    expect(result.ok).toBe(false);
    expect(input).toEqual(before);
  });
});

describe("validateSchemaShape", () => {
  it("accepts a valid conservative JSON Schema object profile", () => {
    expect(validateSchemaShape(SCHEMA).ok).toBe(true);
  });

  it("rejects malformed or out-of-profile schemas with typed diagnostics", () => {
    const result = validateSchemaShape({
      type: "object",
      additionalProperties: true as never,
      properties: {
        value: { type: "weird" as never },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.defects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "additionalProperties", code: "policy.denied" }),
        ]),
      );
    }
  });

  it("rejects oversized schemas before Ajv compilation", () => {
    const properties: Record<string, { type: "string" }> = {};
    for (let i = 0; i < 1_200; i++) {
      properties[`field${i}`] = { type: "string" };
    }

    const result = validateSchemaShape({
      type: "object",
      additionalProperties: false,
      properties,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.defects.some((defect) => defect.message.includes("too many nodes"))).toBe(true);
    }
  });
});
