// ⛔ DELIBERATELY-BAD FIXTURE — this file is SUPPOSED to fail the boundary lint. Do not "fix" it.
//
// It stands in for a CORE/EDGE module that illegally reaches for a concrete adapter. The
// module-boundary rule (baseline §1: only packages/app may import an adapter) must REJECT this
// import. The normal `biome ci .` / `tsc -b` gate ignores this path (see biome.json files.ignore and
// the fact that it belongs to no tsconfig project); the boundary selftest targets it on purpose and
// asserts a non-zero result, proving the gate cannot be silently bypassed (GLA-003 AC#6).

// This import is the violation: a non-app module pulling in a concrete adapter package.
import { CONNECTOR_CDP_MODULE } from "@gla/connector-cdp";

export const illegal = CONNECTOR_CDP_MODULE;
