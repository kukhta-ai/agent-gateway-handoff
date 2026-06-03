---
id: GLA-049
title: Re-open a window onto the same capsule without rebuilding
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - check
  - row
  - handoff
dependencies:
  - GLA-033
documentation:
  - docs/components/session-service.md
priority: low
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a second window must open onto the same capsule with no re-spawn; reuse the handoff build, do not rewrite. Builds only the delta. Depends on the handoff step. Out of scope: rebuilding window open.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A second window re-opens onto the same live capsule with no re-spawn, using the existing handoff capability.
- [ ] #2 The second link is bound to the recipient and short-TTL exactly as the first.
- [ ] #3 The earlier window's closure left nothing that blocks the re-open.
<!-- AC:END -->
