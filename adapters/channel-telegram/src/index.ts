// @gla/channel-telegram — adapter ring (baseline §1).
// DEFAULT ChannelAdapter: Telegram Bot + Mini App (stub).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const CHANNEL_TELEGRAM_MODULE = "@gla/channel-telegram" as const;

/** Ring classification from the architecture baseline (informational). */
export const CHANNEL_TELEGRAM_RING = "adapter" as const;
