---
id: GLA-070
title: Enroll a recipient through authentik
status: To Do
assignee: []
created_date: '2026-06-03 15:41'
labels:
  - authentik
  - impl
dependencies:
  - GLA-068
  - GLA-069
priority: medium
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the precondition for a delegated-provider handoff — a recipient bound to the provider's subject so a later step-up can verify them. Builds the step designed in its plan. Depends on the adapter and the enrollment plan. Out of scope: per-handoff verification (the step-up).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After enrollment a recipient is bound to a stable provider subject and can be verified at a later handoff; an un-enrolled recipient cannot be verified.
- [ ] #2 Enrollment proceeds only when the single-use operator-discharge grant verifies; an absent, wrong-recipient, expired, or reused grant is refused.
- [ ] #3 A failed or abandoned enrollment leaves no half-bound recipient and is safely retryable.
- [ ] #4 The recipient binding is established without GLA storing the recipient's credential, which remains held by the provider.
- [ ] #5 Switching back to the in-tree provider leaves its enrollment path working unchanged.
<!-- AC:END -->
