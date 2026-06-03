---
id: GLA-006
title: Integrate the Cedar policy engine
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 08:21'
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
- [x] #1 Policy decisions are evaluated through the policy port, and the core calls the port without referencing the engine directly.
- [x] #2 A request denied by any applicable policy is denied regardless of evaluation order.
- [x] #3 Evaluating the same inputs twice yields the same decision.
- [x] #4 A policy authoring or load error surfaces as a typed error and prevents evaluation rather than failing open.
- [x] #5 Swapping the policy engine for another implementation of the port changes no core code.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
adapters/policy-cedar implements kernel PolicyPort using REAL Cedar (@cedar-policy/cedar-wasm@4.11.0, in policy-cedar only; core/admission never reference the engine -> import boundary: only app imports policy-cedar). AC1 decisions via port; AC2 forbid-wins order-independent; AC3 deterministic; AC4 load/authoring error -> typed CedarPolicyLoadError, fails CLOSED (every non-allow incl parse/throw -> forbid, never permit); AC5 swappable (port substitution, no core change). Reviewed clean (2 cycles). 188 tests green.
<!-- SECTION:NOTES:END -->
