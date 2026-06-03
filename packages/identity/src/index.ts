// @gla/identity — core-adjacent ring (baseline §1).
// UserIdentity, RecipientBinding, auth_strength; AuthProvider PORT (placeholder).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const IDENTITY_MODULE = "@gla/identity" as const;

/** Ring classification from the architecture baseline (informational). */
export const IDENTITY_RING = "core-adjacent" as const;
