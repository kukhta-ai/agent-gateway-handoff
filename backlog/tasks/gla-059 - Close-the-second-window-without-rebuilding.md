---
id: GLA-059
title: Close the second window without rebuilding
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:21'
labels:
  - impl
  - check
  - row
  - close
dependencies:
  - GLA-045
documentation:
  - docs/components/session-service.md
priority: low
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the second window must close, revoke, and unmount like the first; reuse the close build, do not rewrite. Builds only the delta. Depends on the close step. Out of scope: rebuilding close.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The second window closes, revoking its grant and unmounting its route, using the existing close capability.
- [x] #2 The session returns to active and the capsule keeps running after the second close.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
