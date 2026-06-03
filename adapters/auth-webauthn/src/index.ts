// @gla/auth-webauthn — adapter ring (baseline §1).
// DEFAULT AuthProvider: @simplewebauthn/server in-tree (stub).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const AUTH_WEBAUTHN_MODULE = "@gla/auth-webauthn" as const;

/** Ring classification from the architecture baseline (informational). */
export const AUTH_WEBAUTHN_RING = "adapter" as const;
