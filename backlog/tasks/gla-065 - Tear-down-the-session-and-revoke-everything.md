---
id: GLA-065
title: Tear down the session and revoke everything
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - row
  - teardown
dependencies:
  - GLA-004
  - GLA-023
  - GLA-019
  - GLA-033
  - GLA-045
documentation:
  - docs/components/session-service.md
  - docs/components/task-service.md
  - docs/components/worker-plane.md
priority: medium
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the closing guarantee, completing the task leaves no live capsule, route, grant, or runtime. Builds the step designed in its plan. Depends on the kernel, provisioning, the propose step, the handoff step, and the close step. Out of scope: the end-to-end pass.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Completing the task transitions the session to completed and reaps its capsule and workspace.
- [ ] #2 Every capability descended from the task no longer verifies after teardown.
- [ ] #3 No live route or grant remains for the torn-down session.
- [ ] #4 Ephemeral capsule state is destroyed while host paths the agent mounted and persisted outputs survive on the host.
- [ ] #5 A cleanup reconciler confirms no orphaned runtime remains, and re-running teardown is idempotent.
- [ ] #6 Aborting instead of completing performs the same teardown to a non-success terminal state.
<!-- AC:END -->
