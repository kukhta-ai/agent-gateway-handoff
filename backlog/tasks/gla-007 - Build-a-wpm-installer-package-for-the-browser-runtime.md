---
id: GLA-007
title: Build a wpm installer package for the browser runtime
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 13:49'
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
- [x] #1 A wpm installer package for the browser runtime exists in this project and is the unit that gets built, not an inline install.
- [x] #2 The package detects whether a usable browser-plus-automation runtime is already present on the host before changing anything.
- [x] #3 On completion the host can launch a headless browser driveable over a remote-control protocol.
- [x] #4 An already-adequate runtime is left unchanged and recorded as such.
- [x] #5 The package records a verifiable receipt of what it changed and is idempotent on re-run.
- [x] #6 A host where the runtime cannot be installed surfaces a clear, catchable failure rather than a partial state.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
wpm bundle 'browser-runtime' authored in wpm/ (GLA's agent-native installer bundle-project; wpm v0.1.0 via npm link from /workspace/active/work-package-manager). It IS the build unit (not an inline install) with a real install-backlog detect->setup->verify->record per the wpm install contract: detects an existing usable runtime before changing anything; leaves an adequate one unchanged (recorded as adopted); records a verifiable receipt (installed-vs-adopted + inverse op + checksum); idempotent on re-run; surfaces a clear catchable failure rather than a partial state. Ownership mode + the hermes-1 mapping (Ubuntu 24.04 LXD, host Caddy -> :3000) are in the bundle. wpm project validate + wpm build dry-run PASS (6 bundles, 98 files).
<!-- SECTION:NOTES:END -->
