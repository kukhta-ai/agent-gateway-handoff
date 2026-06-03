---
id: GLA-043
title: Detect completion of the human step
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - row
  - detect
dependencies:
  - GLA-004
  - GLA-041
documentation:
  - docs/components/completion-service.md
  - docs/components/capsule.md
priority: medium
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers a validated done-signal the agent can act on. Builds the step designed in its plan. Depends on the kernel and the fill step. Out of scope: closing the window and revoking.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A configured detector fires when its observable condition is met, and the service validates the done-signal against its contract.
- [ ] #2 The capsule emits completion signals but does not itself decide completion.
- [ ] #3 A detector that never fires leads to window expiry rather than a false completion.
- [ ] #4 Adding a new detector type that satisfies the seam changes no capsule code.
<!-- AC:END -->
