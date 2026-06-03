---
id: GLA-027
title: Drive the capsule autonomously over the connector
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
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
- [ ] #1 Given a live session, the agent can drive the capsule's browser (navigate, act, inspect) through the connector.
- [ ] #2 Driving occurs over the connector, not through control verbs, so control and work remain separable.
- [ ] #3 Driving works whether or not a human window is open.
- [ ] #4 A connector request against a session with no live capsule surfaces a catchable conflict, not a crash.
<!-- AC:END -->
