---
id: GLA-055
title: Let the human enter the code agent-blind without rebuilding
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:21'
labels:
  - impl
  - check
  - row
  - fill
dependencies:
  - GLA-041
documentation:
  - docs/components/capsule.md
priority: low
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the human enters the verification code in the second window without the agent seeing it; reuse the fill build, do not rewrite. Builds only the delta. Depends on the fill step. Out of scope: rebuilding the input path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 In the second window the human enters the code, which reaches the website and never the agent connector, using the existing agent-blind capability.
- [x] #2 The code does not appear in any agent-readable channel or log.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
