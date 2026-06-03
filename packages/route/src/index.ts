// @gla/route — core ring (baseline §1).
// Route controller: program/unmount/reconcile (placeholder).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const ROUTE_MODULE = "@gla/route" as const;

/** Ring classification from the architecture baseline (informational). */
export const ROUTE_RING = "core" as const;
