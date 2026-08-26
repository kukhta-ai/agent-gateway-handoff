---
id: GLA-051
title: Reuse valid authentication on the second window without rebuilding
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:21'
labels:
  - impl
  - check
  - row
  - auth
dependencies:
  - GLA-035
  - GLA-049
documentation:
  - docs/components/identity-and-auth.md
priority: low
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a returning recipient with valid auth should not be re-prompted; reuse the auth build, do not rewrite. Builds only the delta. Depends on the auth step and the re-open delta. Out of scope: rebuilding verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On the second window a recipient whose authentication is still valid reaches the capsule with no fresh prompt.
- [x] #2 If the authentication is no longer valid, a re-prompt occurs rather than silent access.
- [x] #3 Reuse is confined to the bound recipient and does not widen access.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
