---
id: GLA-052
title: Plan any change for reaching the capsule on the reused-auth window
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - plan
  - check
  - row
  - reach
dependencies:
  - GLA-002
documentation:
  - docs/components/access-gateway.md
priority: low
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after reused auth the recipient reaches the same capsule entrypoint; this is the reach capability again. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting reach.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The reach architecture is confirmed to cover the reused-auth window, or the delta is specified; nothing already covered is re-specified.
- [ ] #2 Any change to the recipient's experience here is designed; if none, that is recorded.
<!-- AC:END -->
