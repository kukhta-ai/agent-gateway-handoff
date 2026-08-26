# Channel adapter

**Zone:** Edge
**Kind:** GLA component (traditional code), ships as a plugin
**Scenario-01 lane:** Telegram + channel

> Per-channel inbound/outbound translation: the GLA-side adapter that fronts an external channel (Telegram, Slack, Email, CLI) and carries links and progress to the bound recipient.

## Role

A channel adapter is the bilingual edge between GLA and one external channel. It translates inbound user messages into GLA terms (with the recipient binding attached) and renders outbound handoff links and progress in the channel's idiom — a Telegram Mini App button here, a plain link elsewhere. One adapter per channel; each is a plugin.

## Responsibilities (owns)

- Inbound: deliver the user's message to the agent with recipient + chat context.
- Outbound: select the channel-appropriate transport (Mini App vs. plain link) and deliver handoff links to the bound recipient.
- Render bundle/task-level progress in conversation.
- Verify a `channel-delegation` capability on outbound sends.

## Interfaces

**Receives** — from the external channel: user messages; from the Bridge/Session: handoff links and progress to send.
**Produces** — to the agent: inbound messages + recipient binding; to the user (via the channel): links and progress.

Runtime integration goes through ProviderRegistry, with current factory execution hidden behind internal ProviderHost
mechanics. A channel package supplies a `ChannelAdapter` manifest, config schema, probe, docs/skills, and a
`registerChannel` factory. The app selects an opaque provider id such as `channel-cli`; it does not construct
Telegram/Slack/email/CLI adapters directly. Channel secrets such as bot tokens must enter as secret refs or resolver
inputs and must not appear in catalog output or diagnostics.

## What it does NOT do

It does **not** model user intent (that is the agent). It does **not** authenticate the user — identity proof happens when the link is opened, at the Access Gateway via Identity + Auth. It does **not** decide *what* to say; the agent composes content, the adapter transports it.

## Entities & data

`RecipientBinding` (consulted/produced), `channel-delegation` capability, `ChannelAdapter` catalog entity.

## In scenario 01

Phase 0 — deliver the inbound request with recipient context. Phases 5 / 11 — send the handoff link (Mini App button + plain-link fallback). Phases 8 / 13 — relay progress. Phase 15 — deliver the closing how-to message.

## Failure modes

Channel API outage → links/progress undeliverable; the handoff window will TTL-expire and the agent is notified. A `channel-delegation` check failure blocks an unauthorized outbound send.

## Invariants

Handoff links are delivered only to the bound recipient. Outbound sends are gated by a `channel-delegation` capability. The adapter never widens the recipient binding established upstream.

## Related

`agent-bridge.md`, `session-service.md` (handoff links), `identity-and-auth.md` (recipient identity), `boundary-actors.md` (Telegram transport).
