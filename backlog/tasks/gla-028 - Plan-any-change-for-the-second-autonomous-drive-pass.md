---
id: GLA-028
title: Plan any change for the second autonomous-drive pass
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:21'
labels:
  - plan
  - check
  - row
  - drive
dependencies:
  - GLA-002
documentation:
  - docs/components/capsule.md
priority: low
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a later phase drives the same capsule again to a different page; this is the same connector capability as the drive step. Confirm the existing architecture covers it and design only any delta; no production code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting the drive capability.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The drive-step architecture is confirmed to cover a second pass to a different page, or the specific delta is specified; nothing already covered is re-specified.
- [x] #2 Any change to the operating experience for this pass is designed; if none, that is recorded.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
