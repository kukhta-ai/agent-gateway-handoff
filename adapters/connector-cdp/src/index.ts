// @gla/connector-cdp — adapter ring (baseline §1).
// AgentConnector: CDP via Playwright (stub).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const CONNECTOR_CDP_MODULE = "@gla/connector-cdp" as const;

/** Ring classification from the architecture baseline (informational). */
export const CONNECTOR_CDP_RING = "adapter" as const;
