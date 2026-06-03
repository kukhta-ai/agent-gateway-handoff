---
id: GLA-006
title: Integrate the Cedar policy engine
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - dependency
  - trad
  - impl
dependencies:
  - GLA-005
  - GLA-004
documentation:
  - docs/components/admission-and-policy.md
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: admission needs deterministic, forbid-wins policy evaluation, which Cedar provides as an in-tree library. Builds the integration behind the policy port. Depends on the dependency strategy and the kernel. Out of scope: the admission pipeline itself; authoring policies beyond what tests need.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Policy decisions are evaluated through the policy port, and the core calls the port without referencing the engine directly.
- [ ] #2 A request denied by any applicable policy is denied regardless of evaluation order.
- [ ] #3 Evaluating the same inputs twice yields the same decision.
- [ ] #4 A policy authoring or load error surfaces as a typed error and prevents evaluation rather than failing open.
- [ ] #5 Swapping the policy engine for another implementation of the port changes no core code.
<!-- AC:END -->
