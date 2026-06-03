---
id: GLA-022
title: Plan the provision-the-capsule step
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 09:17'
labels:
  - plan
  - architecture
  - row
  - provision
dependencies:
  - GLA-002
documentation:
  - docs/components/session-service.md
  - docs/components/worker-plane.md
  - docs/components/capsule.md
priority: medium
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: this brings a live two-actor capsule into being for the whole task; it fixes the provisioning saga and the spawner seam. Produces architecture and the build plan; no code. Use the architect skills and research spawner and runtime-assembly models on the internet. The capsule is assembled from separate local layers, not one image. Depends on the contracts plan. Out of scope: the connector return and handoff; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Session service's create-saga is specified: the ordered steps to spawn a capsule and what is returned, reversible on failure, as a contract.
- [x] #2 The Worker and spawner seam is specified: the abstract launcher interface, its tiers, and the per-launcher mount capability, so runtimes are pluggable.
- [x] #3 The Capsule is specified as one shared state assembled from its separate layers, exposing surfaces over that state, with host paths mountable at the agent's authority.
- [x] #4 The operating experience is designed: how the operator's runtime, browser, and view packages are assembled into a live capsule.
- [x] #5 An implementation plan for the build task exists, with how a live, isolated capsule is observed.
- [x] #6 Dependencies are identified and classified; the isolation runtime, browser runtime, and view stack are named as wpm-installer-package tasks in this backlog.
- [x] #7 The spawner seam is specified at full capability so a new launcher tier is added with no change to session or capsule code.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: docs/architecture/slice-3-provision-connector.md §provision. Session create-saga (ordered, reversible on failure) as a contract; worker/spawner seam (abstract LauncherPort + tiers + per-launcher mount capability -> pluggable runtimes); capsule = one shared state assembled from isolation+browser+view layers, host paths mountable at agent's authority; operating experience (runtime/browser/view assemble into a live capsule); build/observation plan; deps isolation=GLA-009, browser=GLA-007, view=GLA-008 (wpm tasks); spawner seam full-capability (new tier = no session/capsule change). Rule-3 docs-driven fallback. Implemented+tested in GLA-023.
<!-- SECTION:NOTES:END -->
