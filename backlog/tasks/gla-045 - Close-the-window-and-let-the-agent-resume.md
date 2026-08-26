---
id: GLA-045
title: Close the window and let the agent resume
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 11:47'
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
- [x] #1 On a validated completion the window closes: the route is unmounted and the grant is revoked.
- [x] #2 After close the recipient's link no longer reaches the capsule and any live connection is force-closed.
- [x] #3 The session returns to active and the capsule keeps running for the agent.
- [x] #4 A window that expires without completion closes the same way, releasing the route and grant.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
packages/session completion->close (the reverse of open at the same seams): on a validated completion OR expiry -> unmount route + revoke grant + force-close the live WS + return session to ACTIVE with the capsule still RUNNING; gla handoff wait RETURNS the envelope (exit 6 on expiry). AC1 completion closes (route unmounted, grant revoked); AC2 after close the recipient link no longer reaches the capsule + any live connection force-closed; AC3 session returns to active + capsule keeps running for the agent (connector resumes the same cdp_url); AC4 a window that expires without completion closes the same way (releases route+grant). Reviewed clean: idempotent, completion/TTL double-fire handled (abort-before-close). 373 tests green.
<!-- SECTION:NOTES:END -->
