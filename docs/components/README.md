# Component reference

One document per architecture component. Each maps to a *lane* in `docs/scenario-01-unified.html` and to a zone in `docs/01-architecture-overview.md`. Read the overview first; these docs assume its vocabulary and principles.

## The shared template

Every component doc follows the same shape so the set is uniform and mineable:

- **Role** — the one sharp definition of what this component is.
- **Responsibilities (owns)** — what it is the source of truth for / does.
- **Interfaces** — *Receives* (from whom, what) and *Produces* (to whom, what); these mirror the component's arrows in the sequence diagram.
- **What it does NOT do** — the boundary. What belongs to the agent (cognition) or to a neighbouring component. This keeps the cognition-vs-enforcement line (overview §, and the boundary discussion) explicit per component.
- **Entities & data** — the entities, capabilities, and state it touches.
- **In scenario 01** — where it appears (by phase) and what it does there.
- **Failure modes** — how it fails and what contains the failure.
- **Invariants** — the rules it must uphold.
- **Open questions** — decisions still to settle (where relevant).
- **Related** — neighbouring components and docs.

## Index

| Component | Zone | File | Scenario-01 lane |
|---|---|---|---|
| Agent Bridge | Edge | [`agent-bridge.md`](agent-bridge.md) | Agent Bridge |
| Channel adapter | Edge | [`channel-adapter.md`](channel-adapter.md) | Telegram + channel |
| Access Gateway | Edge / Worker | [`access-gateway.md`](access-gateway.md) | Access Gateway |
| Identity + Auth | Config / Edge | [`identity-and-auth.md`](identity-and-auth.md) | Identity + Auth |
| Catalog | Config | [`catalog.md`](catalog.md) | *implicit (served via Bridge / checked in Admission)* |
| Admission + Policy | Control plane | [`admission-and-policy.md`](admission-and-policy.md) | Admission + Policy |
| Task service | Control plane | [`task-service.md`](task-service.md) | Task svc |
| Session service | Control plane | [`session-service.md`](session-service.md) | Session svc |
| Capability service | Control plane | [`capability-service.md`](capability-service.md) | Capability svc |
| Route controller | Control plane | [`route-controller.md`](route-controller.md) | Route ctrl |
| Completion service | Control plane | [`completion-service.md`](completion-service.md) | Completion svc |
| Worker plane | Worker | [`worker-plane.md`](worker-plane.md) | Worker spawner |
| Capsule | Worker | [`capsule.md`](capsule.md) | Capsule browser |
| Boundary actors & externals | — | [`boundary-actors.md`](boundary-actors.md) | User · Passkey · Telegram · Agent runtime · Website · Email |

## Deferred (intentionally not documented here yet)

These are real parts of the architecture but were **not lanes** in scenario 01, so they are flagged rather than invented:

- **Cross-cutting concerns** — Eventing & Audit, Telemetry, Secret handling. They appear in scenario 01 only as annotations (the audit trail, the agent-blind notes), riding inside the components that emit them. Each warrants its own doc; the security/secret-handling one is the highest priority.
- **Setup / Doctor** — operator-facing and install-time, and deliberately thin (see overview §8: the *acting* setup logic lives in `work-package-manager`; GLA keeps only a read-only doctor/probe + binding-ingest). Document it alongside the `wpm` integration, not as a runtime lane.

> **Catalog** is included even though it is not a dedicated scenario-01 lane, because it is a first-class component the lanes depend on (the Bridge serves catalog/skills from it; Admission validates against it).
