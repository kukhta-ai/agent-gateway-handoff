---
id: GLA-023
title: Provision the live capsule
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 09:17'
labels:
  - impl
  - row
  - provision
dependencies:
  - GLA-004
  - GLA-009
  - GLA-007
  - GLA-008
  - GLA-021
documentation:
  - docs/components/session-service.md
  - docs/components/worker-plane.md
  - docs/components/capsule.md
priority: medium
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers a running, isolated capsule created under a task. Builds the step designed in its plan. Depends on the kernel, the isolation runtime, the browser runtime, the view stack, and admission. Out of scope: returning the connector to the agent; opening a human window.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Creating a session runs the saga and yields a live capsule under the task, assembled from the isolation, browser, and view layers.
- [x] #2 The capsule runs isolated from the agent, and host paths the spec requested are present at their targets in the requested mode, only as the launcher's mount capability supports.
- [x] #3 A saga failure midway leaves no orphaned capsule or workspace.
- [x] #4 Swapping the launcher for another tier that satisfies the spawner seam changes no session or capsule code.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
packages/worker (Spawner Registry + Lifecycle Mgr + Workspace Mgr + Cleanup Reconciler) + adapters/launcher-process (T2; REAL headless Chromium via Playwright tested for real; full Xvfb+x11vnc+websockify+noVNC when present, gated test runs in hermes-1) + workspace-profile + entrypoint-novnc + session.provision saga. AC1 session create runs saga -> live capsule under task, assembled from isolation/browser/view layers; AC2 capsule isolated from agent (binds 127.0.0.1 only), mounts realized at agent uid per launcher mount-capability; AC3 saga failure midway -> NO orphan capsule/workspace (real test: stop kills the process group, temp profile dir deleted; reconciler idempotent); AC4 swap launcher tier -> no session/capsule code change (spawner seam; session/worker import only kernel ports). Verified pnpm gate green 240 tests incl the REAL CDP test. Reviewed clean (2 cycles).
<!-- SECTION:NOTES:END -->
