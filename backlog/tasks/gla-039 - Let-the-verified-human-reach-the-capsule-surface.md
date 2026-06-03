---
id: GLA-039
title: Let the verified human reach the capsule surface
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - row
  - reach
dependencies:
  - GLA-004
  - GLA-035
  - GLA-023
documentation:
  - docs/components/access-gateway.md
  - docs/components/capsule.md
priority: medium
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the verified human arriving at the live human entrypoint. Builds the step designed in its plan. Depends on the kernel, the auth step, and provisioning. Out of scope: the user's in-window actions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A verified, in-window request is proxied to the capsule's human entrypoint.
- [ ] #2 The human entrypoint is reachable only within an open, authorized window and not otherwise.
- [ ] #3 When the grant is revoked or expires, the live connection is severed and the surface is no longer reachable.
- [ ] #4 Adding a different view surface that satisfies the entrypoint seam changes no gateway code.
<!-- AC:END -->
