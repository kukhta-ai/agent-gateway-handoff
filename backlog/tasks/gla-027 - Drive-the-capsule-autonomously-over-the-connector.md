---
id: GLA-027
title: Drive the capsule autonomously over the connector
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:21'
labels:
  - impl
  - row
  - drive
dependencies:
  - GLA-004
  - GLA-025
documentation:
  - docs/components/capsule.md
  - docs/05-cli-and-entities.md
priority: medium
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the agent's autonomous work between handoffs. Builds the step designed in its plan. Depends on the kernel and the connector. Out of scope: opening or closing a human window.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Given a live session, the agent can drive the capsule's browser (navigate, act, inspect) through the connector.
- [x] #2 Driving occurs over the connector, not through control verbs, so control and work remain separable.
- [x] #3 Driving works whether or not a human window is open.
- [x] #4 A connector request against a session with no live capsule surfaces a catchable conflict, not a crash.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
