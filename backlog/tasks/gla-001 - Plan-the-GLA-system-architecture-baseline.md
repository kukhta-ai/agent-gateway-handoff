---
id: GLA-001
title: Plan the GLA system-architecture baseline
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 05:43'
labels:
  - foundation
  - plan
dependencies: []
documentation:
  - docs/01-architecture-overview.md
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: every later task builds on one architectural shape; this fixes that shape and the invariants the whole MVP must preserve. Produces design artifacts, not code. Use the architect skills and research current real-world precedents (admission control, capability systems, spawner models) on the internet before fixing decisions. Out of scope: per-module design and any implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The macro decomposition is specified as a modular monolith with a narrow stable core (task, session, capability, route, completion, audit) and replaceable adapters around it, with the module list and boundaries named.
- [x] #2 The cognition-versus-enforcement split is specified as an invariant: what the agent decides versus what code enforces, with the agent untrusted at every enforcement seam.
- [x] #3 The two-actor capsule shape is specified: the agent enters unprivileged via the Agent Bridge, the human via the Access Gateway as the sole public entry, both meeting at one capsule.
- [x] #4 Capability is specified as the single authorization primitive, with recipient-bound grants and agent-blind secrets named as system-wide invariants.
- [x] #5 The deployment-profile model is specified, naming which enforcement seams are load-bearing in the local single-operator reference and which are deferred.
- [x] #6 The horizontal-extension principle is specified: a new dependency or provider is added by registering against an existing seam, changing no core code.
- [x] #7 A build-order plan exists that sequences the foundation, dependency, and per-step work into a valid order.
- [x] #8 The operating experience is designed at a high level: the agent's command ergonomics and the operator's setup path, not only the internal mechanism.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Artifact: docs/architecture/baseline.md. Skills run (Rule-3): bmad-create-architecture loaded in subagent but is an interactive/PRD-gated facilitator -> cannot run unattended; drove from committed docs/ as the stated fallback (recorded in artifact 'How produced' note). Concretized: TS/Node 22 pnpm-workspace modular monolith (core kernel/task/session/capability/route/completion/audit; core-adjacent admission/catalog/identity/worker/assembly; edges gateway/bridge/surfaces; adapters per provider family), import-boundary enforced by Biome AND package graph; build-order == backlog sequence in 6 waves. 3 refinements flagged for checkpoint: (1) process-tier T2 launcher default vs Docker reference (hermes-1 nested-docker storage broken), (2) in-tree WebAuthn default vs authentik, (3) host Caddy = TLS edge while GLA Access Gateway stays the grant-verifying PEP.
<!-- SECTION:NOTES:END -->
