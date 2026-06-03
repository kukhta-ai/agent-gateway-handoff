---
id: GLA-053
title: Reach the capsule on the reused-auth window without rebuilding
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - check
  - row
  - reach
dependencies:
  - GLA-039
  - GLA-051
documentation:
  - docs/components/access-gateway.md
priority: low
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the returning recipient reaches the same live entrypoint; reuse the reach build, do not rewrite. Builds only the delta. Depends on the reach step and the reused-auth delta. Out of scope: rebuilding reach.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The reused-auth request is proxied to the same capsule human entrypoint using the existing reach capability.
- [ ] #2 Outside the open second window the entrypoint remains unreachable.
<!-- AC:END -->
