import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("top-level cross-cutting test layout", () => {
  it("is reserved for repository-wide boundary or scenario harnesses", () => {
    expect(existsSync(resolve("vitest.config.ts"))).toBe(true);
  });
});
