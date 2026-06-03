// @gla/auth-authentik — adapter ring (baseline §1).
// ALT AuthProvider: managed IdP behind the same seam (stub).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const AUTH_AUTHENTIK_MODULE = "@gla/auth-authentik" as const;

/** Ring classification from the architecture baseline (informational). */
export const AUTH_AUTHENTIK_RING = "adapter" as const;
