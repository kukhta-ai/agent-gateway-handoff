---
id: GLA-021
title: Admit a session proposal
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - row
  - admit
dependencies:
  - GLA-004
  - GLA-006
  - GLA-019
documentation:
  - docs/components/admission-and-policy.md
  - docs/04-capsule-assembly.md
priority: medium
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers deterministic accept-or-reject from proposal to provisioning. Builds the step designed in its plan. Depends on the kernel, the policy engine, and the propose step. Out of scope: provisioning.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A proposal passing policy, capability scope, catalog availability, recipient and identity, and every per-mount check is accepted and dispatched to its task.
- [ ] #2 A proposal failing any one of those is rejected with a stable namespaced code and the documented exit code, and nothing is minted or run.
- [ ] #3 Mutation fills defaults and canonicalizes mount paths but never invents missing semantics; a missing required detail is a rejection, not a guess.
- [ ] #4 Mount and policy validation run offline, so a dry-run accept-or-reject matches the real run for the same spec.
- [ ] #5 Adding a new policy check changes no caller of admission.
<!-- AC:END -->
