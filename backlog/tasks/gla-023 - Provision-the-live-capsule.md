---
id: GLA-023
title: Provision the live capsule
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
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
- [ ] #1 Creating a session runs the saga and yields a live capsule under the task, assembled from the isolation, browser, and view layers.
- [ ] #2 The capsule runs isolated from the agent, and host paths the spec requested are present at their targets in the requested mode, only as the launcher's mount capability supports.
- [ ] #3 A saga failure midway leaves no orphaned capsule or workspace.
- [ ] #4 Swapping the launcher for another tier that satisfies the spawner seam changes no session or capsule code.
<!-- AC:END -->
