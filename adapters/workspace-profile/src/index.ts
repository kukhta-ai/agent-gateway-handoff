// @gla/workspace-profile — adapter ring (baseline §1).
// Workspace: browser-profile-temp (ephemeral) (stub).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const WORKSPACE_PROFILE_MODULE = "@gla/workspace-profile" as const;

/** Ring classification from the architecture baseline (informational). */
export const WORKSPACE_PROFILE_RING = "adapter" as const;
