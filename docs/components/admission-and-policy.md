# Admission + Policy

**Zone:** Control plane
**Kind:** GLA component (traditional code)
**Scenario-01 lane:** Admission + Policy

> The gate from a concrete agent proposal to provisioning: it fills defaults, then validates against policy, capability scope, catalog availability, and identity — and accepts or rejects.

## Role

Admission is the only path from "the agent proposed a session" to "the system will build one." It runs a two-stage pipeline borrowed from Kubernetes admission control: a *mutating* stage that applies defaults, then a *validating* stage that says yes or no. Policy evaluation inside it is Cedar-style PARC — deterministic, order-independent, forbid-wins. It embodies the "agent assembles, GLA validates" split: the agent brings the intent, Admission brings the judgment of whether that intent is allowed.

## Responsibilities (owns)

- **Mutate** — apply defaults (TTL, isolation tier, missing-but-derivable settings); canonicalize each mount's host path (resolve symlinks, collapse `..`) so the allowed-set check runs on the real path. Stages are pluggable.
- **Validate** — evaluate Cedar policy, check the proposal against the presented capability's scope, confirm catalog availability, confirm recipient/identity, and check each mount against the host-mount allowed-set + catastrophic denylist (Cedar, forbid-wins), its mode, target collisions, and the chosen launcher's declared mount capability — all offline. Reject with a stable namespaced reason, or accept.
- On acceptance, dispatch to the Task service.

## Interfaces

**Receives** — from the Bridge: a concrete assembly proposal + the agent's `task`/`agent-authority` capability.
**Produces** — accept (→ dispatch to Task) or reject (→ stable reason back to the Bridge); reads the catalog index, the policy profile, capability scope, and identity.

## What it does NOT do

It does **not** infer or repair the proposal — defaults yes, *inference no*. A missing completion detector is a rejection, not a guess; the agent fixes it. It does **not** plan or match intent (that was the discarded planner). It does **not** mint capabilities or run anything.

## Entities & data

`PolicyProfile` (Cedar — including the host-mount allowed-set + catastrophic denylist, operator config set at install-time, permissive by default for the single-operator profile), the assembly proposal (incl. its `mounts`), the presented capability, the catalog index, `RecipientBinding`.

## In scenario 01

Phase 2 — admits the `browser-handoff` proposal: mutate (TTL + isolation defaults) → validate (policy, capability scope, catalog availability, recipient) → accepted → dispatched to Task.

## Failure modes

A proposal outside policy or capability scope → deny with a reason code (the agent's skill interprets it). A reference to an unavailable catalog entity → deny. A malformed assembly → deny at validation.

## Invariants

It is the only path from proposal to provisioning. Mutation fills defaults but never invents missing *semantics*. Policy is deterministic, order-independent, and forbid-wins. Rejections are stable namespaced codes (facts), never prose advice. Mount validation is **policy only** (allowed-set + denylist + launcher capability), offline; the agent's *actual* file access is enforced at spawn by the capsule running as the agent's uid (the confused-deputy bound), not by Admission.

## Related

`agent-bridge.md` (source of proposals), `catalog.md` (availability), `capability-service.md` (scope it checks), `task-service.md` (dispatch target), `identity-and-auth.md` (recipient check), `worker-plane.md` (realizes mounts as the agent's uid), `../04-capsule-assembly.md` (§6 the mount model the agent composes against).
