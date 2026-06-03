---
id: GLA-047
title: Inspect after the first window without rebuilding
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:21'
labels:
  - impl
  - check
  - row
  - drive
dependencies:
  - GLA-027
  - GLA-045
documentation:
  - docs/components/capsule.md
priority: low
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the agent reads the post-submission page on the still-running capsule; reuse the drive build, do not rewrite. Builds only the delta. Depends on the drive and close steps. Out of scope: rebuilding drive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After the first window closes the agent inspects the live page using the existing drive capability, with no rewrite.
- [x] #2 The capsule's state from the first window is intact for the inspection.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
