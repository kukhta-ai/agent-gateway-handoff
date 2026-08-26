---
id: GLA-065
title: Tear down the session and revoke everything
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:43'
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
- [x] #1 Completing the task transitions the session to completed and reaps its capsule and workspace.
- [x] #2 Every capability descended from the task no longer verifies after teardown.
- [x] #3 No live route or grant remains for the torn-down session.
- [x] #4 Ephemeral capsule state is destroyed while host paths the agent mounted and persisted outputs survive on the host.
- [x] #5 A cleanup reconciler confirms no orphaned runtime remains, and re-running teardown is idempotent.
- [x] #6 Aborting instead of completing performs the same teardown to a non-success terminal state.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
packages/task complete/revoke (terminal) + session teardownSession (distinct from close-window: STOPS the capsule). Verified by a REAL teardown E2E: gla task complete -> capsule pid GONE, temp profile DELETED, launcher health down, grant+connector+task caps all fail verify (auth.revoked) via a SINGLE revoke(taskCap) lineage cascade, session completed, the host mount file SURVIVES, idempotent re-run (no throw), reconciler orphan scan empty. AC1 task complete -> session completed + capsule/workspace reaped; AC2 every task-descendant cap no-longer-verifies (cascade); AC3 no live route/grant; AC4 ephemeral capsule state destroyed while host mounts/persisted outputs survive on host; AC5 reconciler confirms no orphan + teardown idempotent; AC6 task revoke = same teardown to a non-success terminal. Reuses Slice 3 reconciler + Slice 5 close + kernel cascade; no new deps. 407 tests green.
<!-- SECTION:NOTES:END -->
