---
id: GLA-026
title: Plan the agent-drives-via-connector step
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:21'
labels:
  - plan
  - architecture
  - row
  - drive
dependencies:
  - GLA-002
documentation:
  - docs/components/capsule.md
  - docs/components/agent-bridge.md
  - docs/05-cli-and-entities.md
priority: medium
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: between handoffs the agent works autonomously by driving the capsule over the connector; this fixes that work-channel seam, distinct from the control CLI. Produces architecture and the build plan; no code. Use the architect skills and research control-protocol tunnelling-versus-direct exposure on the internet. Depends on the contracts plan. Out of scope: human windows; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Agent Bridge's part is specified: it surfaces the connector as data and does not proxy the work itself through control verbs.
- [x] #2 The Capsule's part is specified: the agent connector as a continuously-driveable surface separate from the human entrypoint.
- [x] #3 The operating experience is designed: how the agent drives the page and observes results, with control and work kept separable.
- [x] #4 An implementation plan for the build task exists, including whether connector traffic is tunnelled or a scoped route, and how driving is observed.
- [x] #5 Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog.
- [x] #6 The connector is specified at full capability as one connector family so other connector types reuse the same seam.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
