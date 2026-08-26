---
id: GLA-061
title: Configure the account over the connector without rebuilding
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
documentation:
  - docs/components/capsule.md
priority: low
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the agent sets up the fresh account on the still-running capsule; reuse the drive build, do not rewrite. Builds only the delta. Depends on the drive step. Out of scope: rebuilding drive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The agent configures the account on the live capsule using the existing drive capability, with no rewrite.
- [x] #2 The session's logged-in state from the handoffs is intact for the configuration.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
