---
id: GLA-046
title: Plan any change for the agent inspecting after the first window
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
  - docs/components/capsule.md
priority: low
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after the first window the agent inspects the page again via the connector; this is the drive capability resumed on an active session. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting drive or resume.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The drive and resume architecture is confirmed to cover inspecting after a window closes, or the delta is specified; nothing already covered is re-specified.
- [ ] #2 Any change to the operating experience here is designed; if none, that is recorded.
<!-- AC:END -->
