# Task service

**Zone:** Control plane
**Kind:** GLA component (traditional code)
**Scenario-01 lane:** Task svc

> The source of truth for the Task aggregate — the multi-step chain that gives a user coherent progress and an agent durable resume across several sessions.

## Role

A Task is the whole goal ("register on acme and set it up") expressed as an ordered chain of sessions. The Task service owns that aggregate: its lifecycle, its state machine, its session chain, and the `task` capability minted from the agent's authority. It exists so multi-step flows stay coherent — one thing the user is told about, one thing the agent resumes, one thing the operator audits and revokes.

## Responsibilities (owns)

- Own the `Task` aggregate: id, recipient, intent label, state, ordered session list, step counters.
- Mint the `task` capability (parent = `agent-authority`) and orchestrate the session chain.
- Drive the task state machine and expose status.

## Interfaces

**Receives** — from Admission (on accept) / the Bridge: create-task, get-task, revoke-task; completion signals that advance the chain.
**Produces** — `task_id` and status to the Bridge; session creation requests to the Session service; a `task` capability via the Capability service.

## What it does NOT do

It does **not** host runtimes or program routes — it delegates per-step work to the Session service. It does **not** model what the user *wants* beyond an opaque intent label; the reasoning is the agent's.

## Entities & data

`Task` (id, recipient, intent_label, state, sessions[], step counters, `task_capability_ref`, timestamps); `task` capability.

## In scenario 01

Phase 2 — creates the Task and mints the `task` capability. The whole flow is one Task spanning both handoffs. Phase 15 — marks the Task completed.

## Failure modes

A step (session) failing leaves the Task `active`; repair resumes from recorded state rather than restarting. A revoked task cascades revocation to its sessions.

## Invariants

A `task` capability descends from `agent-authority`. The session chain belongs to exactly one Task. Task state reflects the aggregate of its sessions, not a parallel source of truth.

## Decisions (settled)

- **The task entity stays.** Retained as the durable goal handle even though many flows won't need it — kept for likely later use (multi-session goals, budgets, policy).
- **Optional and implicit for single-session flows.** The agent works in sessions + handoffs; `gla session create` without a task auto-creates (or attaches to) an **implicit single-session task** — a real object with an id, so audit and resume still work. The agent names an **explicit** task only to thread **multiple independent sessions**. (In scenario-01, single-session, the task is the implicit one.)
- **The task is the enforcement/durability spine, not a planner.** Across sessions it provides a revocation/budget root (revoke the task → its sessions die), a durable cross-session audit/resume anchor, and a data conduit between sessions. *"What's the goal, what's next"* stays the agent's cognition — do not rebuild a workflow planner inside the task.

## Related

`session-service.md` (per-step unit), `capability-service.md` (the `task` capability), `admission-and-policy.md` (dispatches here), `completion-service.md` (advances the chain).
