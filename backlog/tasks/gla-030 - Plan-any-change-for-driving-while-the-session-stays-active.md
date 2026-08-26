---
id: GLA-030
title: Plan any change for driving while the session stays active
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
  - docs/components/session-service.md
  - docs/components/capsule.md
priority: low
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the agent resumes driving after a window closes while the session is active; this reuses the drive capability and the active-session state. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting drive or session state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The drive and session-active architecture is confirmed to cover resumed driving, or the specific delta is specified; nothing already covered is re-specified.
- [x] #2 Any change to the operating experience while resuming is designed; if none, that is recorded.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
