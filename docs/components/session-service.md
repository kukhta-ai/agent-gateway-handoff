# Session service

**Zone:** Control plane
**Kind:** GLA component (traditional code)
**Scenario-01 lane:** Session svc

> The source of truth for the Session aggregate — the per-handoff unit — and the orchestrator of the issue → mount → spawn saga. It opens and closes handoff windows; it does not itself mint, route, or run.

## Role

A Session is one handoff: a scoped, recipient-bound window onto a capsule, plus the saga that stands that window up and tears it down. The Session service owns the aggregate and its state machine, runs the TTL timer wheel, and coordinates the Capability service (mint the grant), the Route controller (mount the route), and the Worker plane (spawn/attach the capsule). It is the conductor; the instruments are other components.

## Responsibilities (owns)

- Own the `Session` aggregate and drive its state machine.
- Coordinate the saga: mint grant → mount route → spawn/attach capsule; and the inverse on completion/expiry.
- Open and close handoff windows (re-opening for a second handoff on the same capsule).
- Run the TTL timer wheel for windows and grants.

## Interfaces

**Receives** — from Task/Bridge: create-session, open-handoff, revoke; from Completion: completion signals.
**Produces** — to Capability: mint/revoke grant; to Route: mount/unmount; to Worker: spawn/stop; status + handoff links to the Bridge/Channel.

## What it does NOT do

It does **not** mint capabilities (Capability), program the gateway (Route), or run the capsule (Worker) — it orchestrates them. It does **not** verify requests (Gateway) or judge completion (Completion validates the signal).

## Entities & data

`Session` (id, task_id, step_name, spec [immutable after admission], state, `grant_token`, `route`, `runtime` handle, recipient, completion, timestamps).

## In scenario 01

Phase 3 — creates Session-1 and runs the spawn saga. Phases 5 / 11 — opens handoff windows (mint grant, mount route). Phases 8 / 13 — on completion, closes windows (unmount, revoke) and returns the session to `active`. Phase 15 — completes the session and triggers teardown. (One Session re-opened for both handoffs — see overview modeling notes.)

## Failure modes

Spawn failure → session `failed`, contained to this step. Window TTL expiry → grant revoked, route unmounted, agent notified. A saga step failing mid-way is reconciled toward the recorded intent.

## Invariants

The spec is immutable after admission. A window's grant is recipient-bound and short-lived. Closing a handoff window does **not** kill the capsule (it returns to `active`). State transitions: `proposed → issued → opened → active → completed | revoked | expired | failed`.

## Decisions (settled)

- **One capsule per session.** A session owns exactly one capsule (which may carry several surfaces). The session is the unit of one capsule's lifecycle; the *goal* is the task (see `task-service.md`).
- **One capsule vs separate sessions — the rule.** Put every surface a goal needs in **one capsule / one session by default**. Reach for **separate sessions** only when surfaces are genuinely independent — a *different recipient, trust domain, or failure domain* — and only by the agent's choice, **never forced for resource reasons**. Shared live state ⇒ one capsule with multiple handoff windows; independent surfaces that only pass data ⇒ separate sessions threaded by a task.
- **Multiple human pauses are re-opened windows, not extra sessions.** Scenario-01's two handoffs are one session re-opening its window twice on the same capsule.

## Related

`task-service.md` (parent), `capability-service.md` (grants), `route-controller.md` (routes), `worker-plane.md` (runtime), `completion-service.md` (closes windows), `capsule.md` (the target).
