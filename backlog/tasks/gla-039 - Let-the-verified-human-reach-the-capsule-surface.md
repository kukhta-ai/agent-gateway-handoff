---
id: GLA-039
title: Let the verified human reach the capsule surface
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 10:52'
labels:
  - impl
  - row
  - reach
dependencies:
  - GLA-004
  - GLA-035
  - GLA-023
documentation:
  - docs/components/access-gateway.md
  - docs/components/capsule.md
priority: medium
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the verified human arriving at the live human entrypoint. Builds the step designed in its plan. Depends on the kernel, the auth step, and provisioning. Out of scope: the user's in-window actions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A verified, in-window request is proxied to the capsule's human entrypoint.
- [x] #2 The human entrypoint is reachable only within an open, authorized window and not otherwise.
- [x] #3 When the grant is revoked or expires, the live connection is severed and the surface is no longer reachable.
- [x] #4 Adding a different view surface that satisfies the entrypoint seam changes no gateway code.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
gateway WS proxy (node:net) to the capsule noVNC entrypoint. AC1 a verified, in-window request is proxied to the capsule human entrypoint (REAL WebAuthn step-up + proxy proven against a stub WS upstream; real noVNC gated to hermes-1); AC2 entrypoint reachable only within an open authorized window; AC3 grant revoke/expire -> the live WS is force-closed and the surface is unreachable (socket.destroyed asserted); AC4 different view surface via the entrypoint seam -> no gateway code change. Security-reviewed (crown jewel): SSRF/target-injection CLOSED (upstream is from the verified route only, never request data), residual-WS-after-revoke CLOSED (liveSockets registry keyed by grant id, force-closed), connect+idle timeouts (no fd leak), handshake headers stripped. 346 tests.
<!-- SECTION:NOTES:END -->
