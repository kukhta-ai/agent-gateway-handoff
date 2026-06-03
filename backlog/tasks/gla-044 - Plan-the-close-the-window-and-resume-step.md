---
id: GLA-044
title: Plan the close-the-window-and-resume step
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - plan
  - architecture
  - row
  - close
dependencies:
  - GLA-002
documentation:
  - docs/components/session-service.md
  - docs/components/route-controller.md
  - docs/components/capability-service.md
  - docs/components/completion-service.md
priority: medium
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: when the human finishes, the window must close cleanly and the agent resume on the same capsule; this fixes the close, revoke, and unmount contract. Produces architecture and the build plan; no code. Use the architect skills and research revocation-on-close and clean-teardown patterns on the internet. Depends on the contracts plan. Out of scope: full task teardown; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The completion-to-close trigger is specified: a validated done-signal or expiry drives the window close, as a contract.
- [ ] #2 The Session service's close-window step is specified: it unmounts the route and revokes the grant and returns the session to active with the capsule still running.
- [ ] #3 The Capability service's part is specified: the grant no longer verifies after close and its live connection is force-closed.
- [ ] #4 The Route controller's part is specified: the route no longer resolves and the connection is severed.
- [ ] #5 The operating experience is designed: how the agent observes the window closed and itself resumed.
- [ ] #6 An implementation plan for the build task exists covering close-on-completion and close-on-expiry, with how window-closed, capsule-alive is observed.
- [ ] #7 Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog.
- [ ] #8 Close is specified at full capability as the reverse of open at the same seams, so it stays correct as gateways or channels are swapped.
<!-- AC:END -->
