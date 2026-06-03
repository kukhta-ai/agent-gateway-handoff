// @gla/session — core ring (baseline §1).
// Session aggregate + issue→mount→spawn saga (placeholder).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const SESSION_MODULE = "@gla/session" as const;

/** Ring classification from the architecture baseline (informational). */
export const SESSION_RING = "core" as const;
