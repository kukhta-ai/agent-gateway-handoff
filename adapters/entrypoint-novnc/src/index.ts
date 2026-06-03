// @gla/entrypoint-novnc — adapter ring (baseline §1).
// HumanEntrypoint: noVNC stream (stub).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const ENTRYPOINT_NOVNC_MODULE = "@gla/entrypoint-novnc" as const;

/** Ring classification from the architecture baseline (informational). */
export const ENTRYPOINT_NOVNC_RING = "adapter" as const;
