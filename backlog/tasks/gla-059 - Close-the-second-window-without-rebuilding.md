---
id: GLA-059
title: Close the second window without rebuilding
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - check
  - row
  - close
dependencies:
  - GLA-045
documentation:
  - docs/components/session-service.md
priority: low
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the second window must close, revoke, and unmount like the first; reuse the close build, do not rewrite. Builds only the delta. Depends on the close step. Out of scope: rebuilding close.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The second window closes, revoking its grant and unmounting its route, using the existing close capability.
- [ ] #2 The session returns to active and the capsule keeps running after the second close.
<!-- AC:END -->
