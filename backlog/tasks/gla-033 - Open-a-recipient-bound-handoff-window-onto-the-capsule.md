---
id: GLA-033
title: Open a recipient-bound handoff window onto the capsule
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - row
  - handoff
dependencies:
  - GLA-004
  - GLA-010
  - GLA-023
  - GLA-015
documentation:
  - docs/components/session-service.md
  - docs/components/route-controller.md
priority: medium
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers a temporary, recipient-bound surface onto the live capsule, and the ability to re-open one. Builds the step designed in its plan. Depends on the kernel, the edge proxy, provisioning, and the channel. Out of scope: the user proving identity.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Opening a window mints a recipient-bound grant, programs a grant-bound route, and delivers a link to the bound recipient.
- [ ] #2 The window exposes the capsule's human entrypoint only while open; outside an open window there is nothing to reach.
- [ ] #3 The grant narrows authority to a single recipient and a short TTL and cannot be widened by the request.
- [ ] #4 A programming failure surfaces a typed error and the window does not open, leaving no partial route.
- [ ] #5 Adding a different edge gateway that satisfies the route seam changes no session code.
<!-- AC:END -->
