---
id: GLA-050
title: Plan the auth-reused-on-re-open delta
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:21'
labels:
  - plan
  - check
  - row
  - auth
dependencies:
  - GLA-002
documentation:
  - docs/components/identity-and-auth.md
priority: low
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on the second window the recipient's prior authentication is reused without a fresh prompt where the design allows; this reuses the auth capability and adds only the reuse behaviour. Confirm coverage and design the delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The auth architecture is confirmed to cover reusing a still-valid authentication, or the reuse delta is specified; nothing already covered is re-specified.
- [x] #2 The reuse experience is designed: when no re-prompt occurs and when re-auth is still required.
- [x] #3 Any change to the recipient's experience is designed; if none, that is recorded.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
