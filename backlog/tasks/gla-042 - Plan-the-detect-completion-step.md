---
id: GLA-042
title: Plan the detect-completion step
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 11:47'
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
- [x] #1 The Capsule's part is specified: it emits completion signals per its declared detectors and does not itself decide completion.
- [x] #2 The Completion service's contract is specified: it validates a human done-signal against the detector contract and normalizes it to an envelope.
- [x] #3 The Session service's part is specified: how a validated completion is received and routed to close the window.
- [x] #4 The operating experience is designed: how the agent learns the step completed without seeing the secret.
- [x] #5 An implementation plan for the build task exists, with how a validated done-signal and a non-firing detector are observed.
- [x] #6 Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog.
- [x] #7 The detector seam is specified at full capability so a new detector type is added with no capsule change.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: docs/architecture/slice-5-completion.md §detect. Capsule emits per declared detectors + does not decide completion; Completion service contract (validate a done-signal vs the detector contract + normalize to an envelope; out-of-contract rejected); session receives a validated completion + routes it to close the window; operating experience (the agent learns the step completed without seeing the secret); build/observation plan (validated done-signal + a non-firing detector observed); deps (none non-traditional); the detector seam full-capability (new detector type, no capsule change). Rule-3 docs-driven fallback. Implemented+tested in GLA-043.
<!-- SECTION:NOTES:END -->
