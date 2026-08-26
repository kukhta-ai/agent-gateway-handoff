---
id: GLA-053
title: Reach the capsule on the reused-auth window without rebuilding
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:21'
labels:
  - impl
  - check
  - row
  - reach
dependencies:
  - GLA-039
  - GLA-051
documentation:
  - docs/components/access-gateway.md
priority: low
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the returning recipient reaches the same live entrypoint; reuse the reach build, do not rewrite. Builds only the delta. Depends on the reach step and the reused-auth delta. Out of scope: rebuilding reach.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The reused-auth request is proxied to the same capsule human entrypoint using the existing reach capability.
- [x] #2 Outside the open second window the entrypoint remains unreachable.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
