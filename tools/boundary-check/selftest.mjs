#!/usr/bin/env node
// Boundary-guard SELFTEST (GLA-003 AC#6) — run via `pnpm gate:selftest`.
//
// It points the import-boundary lint at the deliberately-bad fixture (a "core" module importing a
// concrete adapter) and asserts the result is NON-ZERO. This proves a deliberately-failing example
// in the quality gate is observable — the gate cannot be silently bypassed.
//
//   • If the bad sample is correctly REJECTED (biome exits non-zero) → guard healthy → this prints
//     PASS and exits 0 (so it is green in CI).
//   • If the bad sample is somehow ACCEPTED (biome exits 0) → the guard has regressed → this prints
//     FAIL and exits 1 (loudly red).
import { checkBoundary } from "./check-boundary.mjs";

const { status, output, rejected, namedTheRule } = checkBoundary();

if (rejected && namedTheRule) {
  console.log(
    `PASS: boundary guard rejected the deliberately-bad fixture (biome exit ${status}). The deliberate failure is observable as a non-zero result — the gate cannot be silently bypassed.`,
  );
  process.exit(0);
} else {
  console.error(
    `FAIL: boundary guard did NOT reject the bad fixture (biome exit ${status}, matched-rule=${namedTheRule}). The module-boundary enforcement has regressed.`,
  );
  if (output.trim()) console.error(`--- biome output ---\n${output.trim()}`);
  process.exit(1);
}
