---
id: GLA-043
title: Detect completion of the human step
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 11:46'
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
- [x] #1 A configured detector fires when its observable condition is met, and the service validates the done-signal against its contract.
- [x] #2 The capsule emits completion signals but does not itself decide completion.
- [x] #3 A detector that never fires leads to window expiry rather than a false completion.
- [x] #4 Adding a new detector type that satisfies the seam changes no capsule code.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
packages/completion (validate a done-signal vs the detector contract + normalize to a CompletionEnvelope; an out-of-contract signal is REJECTED, S-8) + adapters/detector-url (url-watcher fires on complete_on/intermediate observed via CDP; the capsule EMITS, does not decide). AC1 a configured detector fires on its observable condition + the service validates the signal; AC2 the capsule emits but does not decide completion; AC3 a non-firing detector -> window TTL expiry, not a false completion; AC4 a new detector type -> no capsule change (CompletionDetectorPort seam). REAL url-watcher over real CDP fires on /verify then /dashboard. 373 tests green.
<!-- SECTION:NOTES:END -->
