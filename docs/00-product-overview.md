# 00 · Product overview

> **Gateway Live Access (GLA) is a self-hostable control plane between an AI agent and a human, for temporary, scoped, recipient-bound interaction surfaces.** It exists for the moment an agent hits a step it cannot, or should not, do alone.

## What it's for

An autonomous agent can carry most of a task, then reach a wall that is the human's to clear — a credential, a confirmation, a judgement call, an out-of-band code. GLA is the layer that opens a **temporary, scoped surface** for exactly that moment and closes it after. The moments it is built for:

- a same-session **OAuth / 2FA login**
- an **agent-blind secret entry** — a password or key the agent must never see
- a **document last-mile edit** before something is sent
- a **file-pick-by-content** — the human chooses the right file
- a **destructive-action approval**
- a **live app-preview review**
- a **group-to-private handoff** — moving a thread from a shared channel to one person

## The single loop

The product is one loop:

> The agent assembles a temporary, scoped surface — a **session** — and GLA **validates, enforces, hosts, and tears it down**. The user opens a link from a chat and finds a browser session, a form, a document editor, or a confirmation dialog; the agent works alongside the user or waits; the session completes; GLA returns structured **completion**; the agent resumes its task.

End to end that loop runs in eight steps, preceded by a one-time enrollment:

- **Enrollment (one-time, not per task).** The operator registers the recipient and they register a passkey bound to their identity, carried by a single-use *operator-discharge* grant the gateway still verifies. Without it, step 6 cannot verify them.

1. **Connect & orient** — the agent connects to the Bridge, receives an `agent-authority` capability, and reads which templates, launchers, and entrypoints *this* install offers.
2. **Propose** — it assembles one concrete session (workspace + launcher + human entrypoint + agent connector + detector) and submits it.
3. **Admit** — GLA applies defaults, then validates policy, capability scope, availability, and identity strength, and accepts or rejects with a stable reason.
4. **Provision** — on accept it mints a recipient-bound grant, programs a gateway route, and spawns the capsule.
5. **Deliver** — the channel sends the link to the bound recipient.
6. **Act** — the user opens the link; the gateway verifies the grant and proxies to the human entrypoint; the agent drives the connector if it participates live.
7. **Complete** — the detector fires; GLA validates its shape and normalizes it to a completion envelope.
8. **Resume & reap** — the agent resumes; the session reaches a terminal state; route, capsule, and workspace are torn down and the audit trail closes.

The shape is a durable signal-await: the agent works, **durably waits for a human, and resumes**. Partial failure is contained per session, and resume is the same loop pointed at a later step.

## What a surface can be — the capsule

Both actors meet at one object: the **capsule**, a lightweight, temporary shell around whatever must be acted on. It has **two doors**. The agent enters, *unprivileged*, through the **Agent Bridge**; the human enters, by tapping a link, through the **Access Gateway** — the only public entry. A capsule exposes the same underlying state two ways: a **Human Entrypoint** the user sees and an **Agent Connector** the agent drives.

The Human Entrypoint is whatever the moment needs — a **noVNC browser stream** (the reference: a live browser the human and agent share), a **static page**, a **web form**, a **file browser**, a **document editor**, or a **terminal**. A capsule is *not* a container; a container is only one way to isolate one. (Full treatment in `01-architecture-overview.md` §2; the live-browser case end to end in `scenario-01-unified.html`.)

## How it feels to build against — the UX stance

GLA's agent surface is **agents-first, humans-welcome**:

- **Structured by default.** JSON is the default output; a human-readable mode appears only at a terminal. The agent never has to opt in to machine output.
- **No prompts — a handoff is a first-class concept.** The interface never blocks an agent on an interactive prompt. If a step genuinely needs a person, that *is* a handoff (a GLA primitive), not a terminal prompt.
- **Agent-blind at the interface.** Secrets are never accepted on argv or printed back; the agent receives a `secret_ref`, never the value.
- **Errors carry a recovery pointer, not advice.** An error names a stable code and the *skill* the agent should load to reason about recovery — cognition stays in the agent, not the tool.

(Full design stance in `05-cli-and-entities.md` §1.)

## Where it sits — and what it is not

The framing that keeps scope honest: **GLA is to agent↔human handoffs what MCP is to tool calls, OIDC is to identity, and LSP is to editor↔language** — a thin standard layer the surrounding ecosystem can converge on.

GLA **is not** a planner of intent, a chatbot framework, a workflow engine, an identity provider, or an agent runtime. It mediates between those things and owns none of them.

The reference slice is **Telegram + a Hermes agent** registering a user on a website through a same-session browser handoff — but it is a *slice*, not the center. Other channels (Slack, WhatsApp, Email, CLI) and runtimes are first-class peers, added one at a time. Every concrete piece in the slice is swappable: changing one is *install a different provider plugin*, with **no change to the agent's commands and no core change** (the per-layer choices and alternatives are in `03-software-candidates.md`; the mechanism is `02-provider-and-extension-model.md`).

## Who's involved

GLA has a small, fixed cast: an **operator** who self-hosts it, a **recipient** who taps the link, an **agent** that drives it, optional **provider authors** who extend it, and the **external systems** at the edges — the channel, the authenticator, the target site, and the user's inbox. Each, with its trust posture and role, is in `actors-and-personas.md`.

## Read next

`actors-and-personas.md` (who is involved) · `01-architecture-overview.md` (how it is built) · `03-software-candidates.md` (the concrete software per layer) · `scenario-01-unified.html` (the reference flow end to end).

## Provenance

**Grounded in the source docs:** the positioning statement, the use-case list, the single-loop description, the eight-step runtime loop, the MCP/OIDC/LSP analogy, the is-not scoping, and the surface palette are lifted from `01-architecture-overview.md` §1–§2 and §5; the UX stance from `05-cli-and-entities.md` §1. **Synthesized here:** only the consolidation of that material into a product-facing front door — no claim is new.
