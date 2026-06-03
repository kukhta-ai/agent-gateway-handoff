---
id: GLA-042
title: Plan the detect-completion step
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - plan
  - architecture
  - row
  - detect
dependencies:
  - GLA-002
documentation:
  - docs/components/completion-service.md
  - docs/components/capsule.md
  - docs/components/session-service.md
priority: medium
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the system must know when the human step is done; this fixes the completion-detection seam. Produces architecture and the build plan; no code. Use the architect skills and research completion-signal and detector-contract patterns on the internet. Depends on the contracts plan. Out of scope: closing the window; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Capsule's part is specified: it emits completion signals per its declared detectors and does not itself decide completion.
- [ ] #2 The Completion service's contract is specified: it validates a human done-signal against the detector contract and normalizes it to an envelope.
- [ ] #3 The Session service's part is specified: how a validated completion is received and routed to close the window.
- [ ] #4 The operating experience is designed: how the agent learns the step completed without seeing the secret.
- [ ] #5 An implementation plan for the build task exists, with how a validated done-signal and a non-firing detector are observed.
- [ ] #6 Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog.
- [ ] #7 The detector seam is specified at full capability so a new detector type is added with no capsule change.
<!-- AC:END -->
