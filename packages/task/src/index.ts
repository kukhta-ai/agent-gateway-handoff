// @gla/task — core ring (baseline §1).
// Task aggregate + state machine (placeholder).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const TASK_MODULE = "@gla/task" as const;

/** Ring classification from the architecture baseline (informational). */
export const TASK_RING = "core" as const;
