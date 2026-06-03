---
id: GLA-030
title: Plan any change for driving while the session stays active
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - plan
  - check
  - row
  - drive
dependencies:
  - GLA-002
documentation:
  - docs/components/session-service.md
  - docs/components/capsule.md
priority: low
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the agent resumes driving after a window closes while the session is active; this reuses the drive capability and the active-session state. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting drive or session state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The drive and session-active architecture is confirmed to cover resumed driving, or the specific delta is specified; nothing already covered is re-specified.
- [ ] #2 Any change to the operating experience while resuming is designed; if none, that is recorded.
<!-- AC:END -->
