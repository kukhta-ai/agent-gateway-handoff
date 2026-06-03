// @gla/admission — core-adjacent ring (baseline §1).
// Mutate→validate pipeline; policy PORT (placeholder).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const ADMISSION_MODULE = "@gla/admission" as const;

/** Ring classification from the architecture baseline (informational). */
export const ADMISSION_RING = "core-adjacent" as const;
