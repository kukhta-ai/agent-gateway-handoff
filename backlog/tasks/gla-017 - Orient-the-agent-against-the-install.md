---
id: GLA-017
title: Orient the agent against the install
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - row
  - orient
dependencies:
  - GLA-004
  - GLA-015
documentation:
  - docs/components/agent-bridge.md
  - docs/05-cli-and-entities.md
priority: medium
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the agent's discovery of what this install can assemble. Builds the step designed in its plan. Depends on the kernel and the connect step. Out of scope: proposing a session.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Asking who am I returns the agent's identity and the operations its authority allows, as JSON.
- [ ] #2 Showing a template returns its required parts and each backing dependency's binding status; an unknown id exits not-found.
- [ ] #3 Listing the catalog returns only entities available in this install, with availability derived by the system, not asserted by the caller.
- [ ] #4 Orientation operations change no server state.
<!-- AC:END -->
