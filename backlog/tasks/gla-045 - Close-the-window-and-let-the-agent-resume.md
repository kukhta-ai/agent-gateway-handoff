---
id: GLA-045
title: Close the window and let the agent resume
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - row
  - close
dependencies:
  - GLA-004
  - GLA-043
  - GLA-033
documentation:
  - docs/components/session-service.md
  - docs/components/route-controller.md
priority: medium
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers a clean window close that revokes access while keeping the capsule for the agent. Builds the step designed in its plan. Depends on the kernel, the detect step, and the handoff step. Out of scope: tearing down the whole task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a validated completion the window closes: the route is unmounted and the grant is revoked.
- [ ] #2 After close the recipient's link no longer reaches the capsule and any live connection is force-closed.
- [ ] #3 The session returns to active and the capsule keeps running for the agent.
- [ ] #4 A window that expires without completion closes the same way, releasing the route and grant.
<!-- AC:END -->
