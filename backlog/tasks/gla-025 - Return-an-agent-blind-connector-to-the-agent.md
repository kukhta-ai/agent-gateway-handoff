---
id: GLA-025
title: Return an agent-blind connector to the agent
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - row
  - connector
dependencies:
  - GLA-004
  - GLA-023
documentation:
  - docs/components/capsule.md
  - docs/components/capability-service.md
priority: medium
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the agent's handle to drive the capsule without seeing secrets. Builds the step designed in its plan. Depends on the kernel and provisioning. Out of scope: the agent's driving actions; human windows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After provisioning, the session returns a connector reference for the live capsule.
- [ ] #2 The connector reference is agent-blind: it lets the agent drive the capsule without exposing any operator secret.
- [ ] #3 The connector stays attached across the session's life, independent of any human window.
- [ ] #4 Requesting the connector of a session with no live capsule surfaces a catchable conflict, not a crash.
<!-- AC:END -->
