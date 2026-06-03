---
id: GLA-049
title: Re-open a window onto the same capsule without rebuilding
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:21'
labels:
  - impl
  - check
  - row
  - handoff
dependencies:
  - GLA-033
documentation:
  - docs/components/session-service.md
priority: low
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a second window must open onto the same capsule with no re-spawn; reuse the handoff build, do not rewrite. Builds only the delta. Depends on the handoff step. Out of scope: rebuilding window open.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A second window re-opens onto the same live capsule with no re-spawn, using the existing handoff capability.
- [x] #2 The second link is bound to the recipient and short-TTL exactly as the first.
- [x] #3 The earlier window's closure left nothing that blocks the re-open.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
