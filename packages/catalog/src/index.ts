// @gla/catalog — core-adjacent ring (baseline §1).
// Store→Ingester→Index; registry of all families (placeholder).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const CATALOG_MODULE = "@gla/catalog" as const;

/** Ring classification from the architecture baseline (informational). */
export const CATALOG_RING = "core-adjacent" as const;
