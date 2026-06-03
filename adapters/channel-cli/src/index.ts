// @gla/channel-cli — adapter ring (baseline §1).
// FALLBACK ChannelAdapter: local/CLI for headless tests (stub).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const CHANNEL_CLI_MODULE = "@gla/channel-cli" as const;

/** Ring classification from the architecture baseline (informational). */
export const CHANNEL_CLI_RING = "adapter" as const;
