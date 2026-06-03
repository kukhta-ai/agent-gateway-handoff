---
id: GLA-038
title: Plan the verified-human-reaches-the-capsule step
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 10:52'
labels:
  - plan
  - architecture
  - row
  - reach
dependencies:
  - GLA-002
documentation:
  - docs/components/access-gateway.md
  - docs/components/capsule.md
  - docs/components/route-controller.md
priority: medium
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after verification the human must reach the capsule's human entrypoint over a proxied connection; this fixes exposing the human surface in-window. Produces architecture and the build plan; no code. Use the architect skills and research authorized reverse-proxy upgrade patterns on the internet. Depends on the contracts plan. Out of scope: what the user does in-window; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Access Gateway's part is specified: how a verified, in-window request is proxied to the capsule's human entrypoint and nothing else.
- [x] #2 The Capsule's part is specified: the human entrypoint as a surface exposed only within an open, authorized window.
- [x] #3 The Route controller's part is specified: resolving the verified request to the correct capsule entrypoint.
- [x] #4 The recipient's experience of arriving at the live surface is designed, including a connection that drops or a window that expires.
- [x] #5 An implementation plan for the build task exists, with how a verified human reaching the live surface is observed.
- [x] #6 Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog.
- [x] #7 The human-entrypoint seam is specified at full capability so a different view surface is added with no gateway-code change.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: docs/architecture/slice-4b-handoff.md §reach. Gateway proxies a verified in-window request to the capsule human entrypoint and nothing else; capsule human entrypoint exposed only within an open authorized window; route controller resolves the verified request to the correct entrypoint; recipient UX of arriving at the live surface (connection drop / window expiry); build/observation plan; deps (view stack = wpm GLA-008); human-entrypoint seam full-capability (different view surface, no gateway-code change). Rule-3 docs-driven fallback. Implemented in GLA-039.
<!-- SECTION:NOTES:END -->
