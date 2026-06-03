---
id: GLA-001
title: Plan the GLA system-architecture baseline
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
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
- [ ] #1 The macro decomposition is specified as a modular monolith with a narrow stable core (task, session, capability, route, completion, audit) and replaceable adapters around it, with the module list and boundaries named.
- [ ] #2 The cognition-versus-enforcement split is specified as an invariant: what the agent decides versus what code enforces, with the agent untrusted at every enforcement seam.
- [ ] #3 The two-actor capsule shape is specified: the agent enters unprivileged via the Agent Bridge, the human via the Access Gateway as the sole public entry, both meeting at one capsule.
- [ ] #4 Capability is specified as the single authorization primitive, with recipient-bound grants and agent-blind secrets named as system-wide invariants.
- [ ] #5 The deployment-profile model is specified, naming which enforcement seams are load-bearing in the local single-operator reference and which are deferred.
- [ ] #6 The horizontal-extension principle is specified: a new dependency or provider is added by registering against an existing seam, changing no core code.
- [ ] #7 A build-order plan exists that sequences the foundation, dependency, and per-step work into a valid order.
- [ ] #8 The operating experience is designed at a high level: the agent's command ergonomics and the operator's setup path, not only the internal mechanism.
<!-- AC:END -->
