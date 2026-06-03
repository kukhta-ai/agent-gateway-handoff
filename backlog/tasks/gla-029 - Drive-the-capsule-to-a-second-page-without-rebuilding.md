---
id: GLA-029
title: Drive the capsule to a second page without rebuilding
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
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the agent must reach a different page on the same live capsule; reuse the drive build, do not rewrite it. Builds only the delta. Depends on the drive step. Out of scope: rebuilding the connector or drive capability.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The agent reaches and acts on a second page on the same live capsule using the existing drive capability, with no rewrite of it.
- [x] #2 Only the delta, if any, is added; the connector and capsule behave as in the first drive.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
