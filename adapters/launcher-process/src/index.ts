// @gla/launcher-process — adapter ring (baseline §1).
// DEFAULT Launcher: local-process T2 (stub).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const LAUNCHER_PROCESS_MODULE = "@gla/launcher-process" as const;

/** Ring classification from the architecture baseline (informational). */
export const LAUNCHER_PROCESS_RING = "adapter" as const;
