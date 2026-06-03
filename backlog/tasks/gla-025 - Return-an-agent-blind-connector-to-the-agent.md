---
id: GLA-025
title: Return an agent-blind connector to the agent
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 09:17'
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
- [x] #1 After provisioning, the session returns a connector reference for the live capsule.
- [x] #2 The connector reference is agent-blind: it lets the agent drive the capsule without exposing any operator secret.
- [x] #3 The connector stays attached across the session's life, independent of any human window.
- [x] #4 Requesting the connector of a session with no live capsule surfaces a catchable conflict, not a crash.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
adapters/connector-cdp + capability mintConnector + session.connector(). AC1 after provisioning, session returns a connector reference for the live capsule (cdp_url + secret_ref); AC2 agent-blind: secret_ref is a capability REFERENCE (the bearer token is dropped at the app boundary; never raw secret/signing material) — drives the capsule without exposing an operator secret; AC3 connector stays attached across the session's life, independent of any human window; AC4 connector of a session with no live capsule -> catchable state.conflict exit 7, not a crash. Security-reviewed (2 cycles): connector cap now DESCENDS from the task cap via ONE shared signer (lineage revoke CASCADES — real test), terminal teardown REVOKES the connector + unbinds secret_ref (no residual). 240 tests green.
<!-- SECTION:NOTES:END -->
