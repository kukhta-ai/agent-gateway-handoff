---
id: GLA-066
title: Pass the scenario-01 through-case end to end
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - e2e
  - impl
dependencies:
  - GLA-013
  - GLA-015
  - GLA-017
  - GLA-019
  - GLA-021
  - GLA-023
  - GLA-025
  - GLA-027
  - GLA-033
  - GLA-035
  - GLA-039
  - GLA-041
  - GLA-043
  - GLA-045
  - GLA-065
documentation:
  - docs/01-architecture-overview.md
  - docs/05-cli-and-entities.md
  - docs/scenario-01-unified.html
priority: high
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the MVP is defined by the full scenario-01 thread working through the real modules, proving the slice and the horizontal-extension property. Composes the implemented steps; adds no new module behaviour. Depends on every full-build step. Out of scope: any second provider per family, which is the later horizontal extension this MVP enables.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 From a single channel request, given an enrolled recipient, the agent orients, proposes, and provisions a live capsule under a task.
- [ ] #2 The agent drives the capsule to the form, opens a recipient-bound window, and the bound human authenticates and completes the form without the agent seeing the secret.
- [ ] #3 A second window re-opens onto the same capsule, the human's auth is reused, and the verification-code step completes.
- [ ] #4 Completing the task tears everything down, leaving no live capsule, route, grant, or runtime.
- [ ] #5 Throughout, every cross-module call goes over the designed seams: no core module imports a concrete adapter.
- [ ] #6 Swapping any single provider the slice uses (channel, launcher, gateway, identity, view, detector) for a compatible one needs no core code change.
<!-- AC:END -->
