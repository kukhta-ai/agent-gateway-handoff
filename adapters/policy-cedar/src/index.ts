// @gla/policy-cedar — adapter ring (baseline §1).
// In-tree Cedar (forbid-wins) behind the policy port (stub).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const POLICY_CEDAR_MODULE = "@gla/policy-cedar" as const;

/** Ring classification from the architecture baseline (informational). */
export const POLICY_CEDAR_RING = "adapter" as const;
