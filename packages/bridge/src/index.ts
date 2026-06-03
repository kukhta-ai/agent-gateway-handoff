// @gla/bridge — edge ring (baseline §1).
// Agent Bridge core: routes ops → admission/task/session (placeholder).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const BRIDGE_MODULE = "@gla/bridge" as const;

/** Ring classification from the architecture baseline (informational). */
export const BRIDGE_RING = "edge" as const;
