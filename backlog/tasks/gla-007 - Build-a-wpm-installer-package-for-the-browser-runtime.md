---
id: GLA-007
title: Build a wpm installer package for the browser runtime
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - dependency
  - wpm
  - impl
dependencies:
  - GLA-005
documentation:
  - docs/components/capsule.md
  - docs/components/worker-plane.md
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the capsule needs a browser and automation engine (Chromium plus Playwright) on the operator host, which touches the host and therefore ships as a wpm installer package, not in-tree code or a prebuilt monolithic image. Produces the package as a Backlog.md task graph the operator agent runs. Depends on the dependency strategy. Out of scope: the capsule runtime that assembles this layer; the view stack and isolation, which are their own packages. Follow the task conventions for the package's own tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A wpm installer package for the browser runtime exists in this project and is the unit that gets built, not an inline install.
- [ ] #2 The package detects whether a usable browser-plus-automation runtime is already present on the host before changing anything.
- [ ] #3 On completion the host can launch a headless browser driveable over a remote-control protocol.
- [ ] #4 An already-adequate runtime is left unchanged and recorded as such.
- [ ] #5 The package records a verifiable receipt of what it changed and is idempotent on re-run.
- [ ] #6 A host where the runtime cannot be installed surfaces a clear, catchable failure rather than a partial state.
<!-- AC:END -->
