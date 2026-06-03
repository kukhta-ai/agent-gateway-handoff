// Proves the module-boundary enforcement (baseline §1) is real and demonstrable (GLA-003 AC#2/#6):
// running Biome's import-boundary rule against the deliberately-bad fixture must REJECT it
// (non-zero exit) and name the offending import. If this ever passes silently, the boundary guard
// has regressed and the gate would be bypassable.
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM helper shared with the .mjs selftest (no .d.ts; runtime-only).
import { checkBoundary } from "../check-boundary.mjs";

describe("module boundary (biome import-boundary rule)", () => {
  it("rejects a core/edge module that imports a concrete adapter", () => {
    const { rejected, status, namedTheRule } = checkBoundary();
    // The whole point: a forbidden import is a NON-ZERO result.
    expect(rejected, `expected non-zero exit, got ${status}`).toBe(true);
    // And the diagnostic must actually be the boundary rule firing on the adapter import.
    expect(namedTheRule).toBe(true);
  });
});
