---
id: GLA-017
title: Orient the agent against the install
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 07:16'
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
- [x] #1 Asking who am I returns the agent's identity and the operations its authority allows, as JSON.
- [x] #2 Showing a template returns its required parts and each backing dependency's binding status; an unknown id exits not-found.
- [x] #3 Listing the catalog returns only entities available in this install, with availability derived by the system, not asserted by the caller.
- [x] #4 Orientation operations change no server state.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
bridge read-surface + catalog (Store->Ingester->Index, browser-handoff template + 6 provider manifests + skill) + cli wiring. Verified pnpm gate green. AC#1 gla whoami -> JSON identity+allowed_ops; AC#2 gla template show -> requiredParts + each backing dependency binding status, unknown id -> exit 5; AC#3 gla catalog list -> only available, availability system-derived (probe flip drops entity); AC#4 orient ops change no server state. Working: whoami, template list/show, skill list/show, catalog list.
<!-- SECTION:NOTES:END -->
