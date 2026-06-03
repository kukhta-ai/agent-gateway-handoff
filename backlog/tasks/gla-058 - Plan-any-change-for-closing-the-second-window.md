---
id: GLA-058
title: Plan any change for closing the second window
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:21'
labels:
  - plan
  - check
  - row
  - close
dependencies:
  - GLA-002
documentation:
  - docs/components/session-service.md
priority: low
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the second window closes the same way as the first; this is the close capability again. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting close.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The close architecture is confirmed to cover the second window, or the delta is specified; nothing already covered is re-specified.
- [x] #2 Any change to the operating experience here is designed; if none, that is recorded.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
