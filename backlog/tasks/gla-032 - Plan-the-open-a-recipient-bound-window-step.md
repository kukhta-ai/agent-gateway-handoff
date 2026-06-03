---
id: GLA-032
title: Plan the open-a-recipient-bound-window step
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 10:52'
labels:
  - plan
  - architecture
  - row
  - handoff
dependencies:
  - GLA-002
documentation:
  - docs/components/session-service.md
  - docs/components/route-controller.md
  - docs/components/access-gateway.md
  - docs/components/capability-service.md
priority: medium
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: this is the defining act, exposing the same live capsule to a bound human through a temporary window; it fixes the grant, route, gateway, and link-delivery seams. Produces architecture and the build plan; no code. Use the architect skills and research capability-grant and programmable-edge-routing patterns on the internet. Depends on the contracts plan. Out of scope: the user's authentication; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Agent Bridge's handoff-open operation is specified: its inputs (session, recipient, reason, TTL) and output (window id, link, expiry), as a contract.
- [x] #2 The Session service's open-window orchestration is specified: mint a recipient-bound grant, program a route, deliver the link, as an ordered contract reversible on close.
- [x] #3 The Capability service's part is specified: a short-TTL, single-recipient grant that narrows the connector and is never widened.
- [x] #4 The Route controller's part is specified: programming a grant-bound route onto the gateway and reconciling it to session state.
- [x] #5 The Access Gateway's part is specified as the sole public entry the route attaches to, with no agent path through it.
- [x] #6 The Channel adapter's part is specified: delivering the recipient-bound link to exactly the bound recipient.
- [x] #7 The recipient's user experience of receiving and opening the link is designed, including a forwarded or expired link.
- [x] #8 An implementation plan for the build task exists covering first-open and re-open onto the same capsule, with how a reachable bound window is observed.
- [x] #9 Dependencies are identified and classified; the edge proxy is named as a wpm-installer-package task in this backlog.
- [x] #10 The route and grant seams are specified at full capability so a new gateway or channel is added with no change to session code.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: docs/architecture/slice-4b-handoff.md §open. Bridge handoff-open contract (inputs session/recipient/reason/TTL -> window id/link/expiry); session open-window saga (mint grant -> program route -> deliver, reversible on close); short-TTL single-recipient grant never widened; route controller programming a grant-bound route + reconcile; gateway = sole public entry, no agent path; channel delivers recipient-bound link to exactly the bound recipient; recipient UX (receive/open incl forwarded/expired link); first-open + re-open onto the same capsule; deps edge-proxy=wpm GLA-010; route+grant seams full-capability. Rule-3 docs-driven fallback. Implemented in GLA-033.
<!-- SECTION:NOTES:END -->
