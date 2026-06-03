---
id: GLA-013
title: Enroll a recipient so they can later be verified
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - row
  - enrollment
dependencies:
  - GLA-004
  - GLA-011
  - GLA-010
documentation:
  - docs/components/identity-and-auth.md
  - docs/components/access-gateway.md
priority: medium
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the precondition for every handoff, a recipient with a registered credential bound to their identity. Builds the step designed in its plan. Depends on the kernel, the identity provider, and the edge proxy. Out of scope: per-handoff verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An invited recipient can register a credential, after which their identity carries a recorded auth strength.
- [ ] #2 Enrollment proceeds only when the single-use enrollment grant verifies; an absent, wrong-recipient, expired, or reused grant is refused.
- [ ] #3 After enrollment the recipient can be verified at a later handoff, and an un-enrolled recipient cannot.
- [ ] #4 A failed or abandoned registration leaves no half-bound identity and is safely retryable.
- [ ] #5 Swapping the identity provider for another that satisfies the seam changes no core code.
<!-- AC:END -->
