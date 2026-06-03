---
id: GLA-026
title: Plan the agent-drives-via-connector step
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
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
- [ ] #1 The Agent Bridge's part is specified: it surfaces the connector as data and does not proxy the work itself through control verbs.
- [ ] #2 The Capsule's part is specified: the agent connector as a continuously-driveable surface separate from the human entrypoint.
- [ ] #3 The operating experience is designed: how the agent drives the page and observes results, with control and work kept separable.
- [ ] #4 An implementation plan for the build task exists, including whether connector traffic is tunnelled or a scoped route, and how driving is observed.
- [ ] #5 Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog.
- [ ] #6 The connector is specified at full capability as one connector family so other connector types reuse the same seam.
<!-- AC:END -->
