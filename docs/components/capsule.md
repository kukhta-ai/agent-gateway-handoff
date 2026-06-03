# Capsule

**Zone:** Worker
**Kind:** GLA-managed runtime (assembled from plugin parts)
**Scenario-01 lane:** Capsule browser

> The two-actor shell around the thing being acted on. It exposes one or more Human Entrypoints and an Agent Connector over one shared state — and that asymmetry is the heart of the architecture.

## Role

A capsule is a lightweight, temporary, scoped working shell — here, a browser — around whatever must be worked on. It is *not* "a Docker container"; a container is merely one way to isolate one. What makes it a capsule is that it presents two interfaces onto the same live state: a **Human Entrypoint** (the user-facing protocol — a noVNC stream, a form, a document editor) and an **Agent Connector** (the agent-side handle — a CDP endpoint, a filesystem path, a `secret_ref`). The agent connector is attached continuously; the human entrypoint is opened only inside recipient-bound handoff windows.

## Responsibilities (owns)

- Hold the live working state (here, the browser, its tab, its cookies) for the duration of the task.
- Expose a Human Entrypoint for the user and an Agent Connector for the agent over that one state.
- Emit completion signals to the Completion service per its declared detectors.

## Interfaces

**Receives** — agent automation over the Agent Connector (continuous); proxied user traffic over the Human Entrypoint (during windows, via the Access Gateway).
**Produces** — completion signals to the Completion service; interacts with external systems (the website) on the user's/agent's behalf.

## What it does NOT do

It does **not** authorize access — the grant + the Access Gateway do that for the human side, and the agent-connector capability for the agent side. It does **not** itself decide completion — it *emits* a signal that the Completion service validates against a contract.

## Entities & data

The `CapsuleTemplate` it was assembled from; its Human Entrypoint and Agent Connector handles; its `Workspace` (here a temp browser profile, plus any host paths the agent mounted, `ro`/`rw`).

## In scenario 01

Spawned once in Phase 3 and lives through Phase 15 — both handoffs and all autonomous agent work share this single capsule. The agent drives it over CDP in Phases 4, 9, 14; the user drives it over noVNC in Phases 7 and 12; it emits completion in Phases 8 and 13; it is reaped in Phase 15.

## Failure modes

Browser/process crash → the lifecycle manager detects it (health probe) and the session may re-spawn or fail. A handoff window closing does not affect the capsule; only teardown stops it.

## Invariants

**Agent-blind on secret fields** — keystrokes the user enters in the human stream (a chosen password) reach the website, never the agent. One capsule per session (a session owns exactly one capsule). At teardown the capsule's **own ephemeral** state — its scratch workspace, cookies — is destroyed; any **host paths the agent mounted** and any **persisted outputs** live on the host and survive by design (see `../04-capsule-assembly.md` §6).

## Decisions (settled)

- **A capsule may host several surfaces at once.** A capsule is one workspace + one launcher + **one or more** `HumanEntrypoint`s + its `AgentConnector`(s) + helper `Sidecar`s. Surfaces coexist live over the shared workspace, and we do **not** isolate surfaces from each other within a capsule — the broader active footprint / trust surface is an accepted cost for the self-hosted, single-operator target.
- **`Sidecar` stays the narrow helper kind** (health-prober, completion detector, audit-emitter, egress-guard) — not a surface. A surface is a `HumanEntrypoint`; a container-level sidecar is only a *packaging* detail of how an entrypoint's process runs.
- **No suspend/resume, no hibernation, no on-demand attach/detach.** Lifecycle stays spawn → live → reap with idle/TTL **expiry** (an idle capsule is torn down, not snapshotted). These optimizations were considered and deliberately dropped as over-engineering for now.
- **Host paths may be mounted in — the agent's choice of path and mode.** The agent runs outside the capsule and can already reach them, so this grants it nothing new; the trusted bounds are only that a mount runs with the agent's *own* authority (never GLA-blind secrets) and within the operator's allowed-set (permissive by default for the single-operator profile). Full model in `../04-capsule-assembly.md` §6.

## Related

`worker-plane.md` (spawns/reaps it), `access-gateway.md` (proxies the human side), `completion-service.md` (validates its signals), `capability-service.md` (the agent-connector + grant capabilities), `catalog.md` (`CapsuleTemplate`/`HumanEntrypoint`/`AgentConnector` kinds), `../02-provider-and-extension-model.md` (how those kinds self-register and are consumed registry-driven).
