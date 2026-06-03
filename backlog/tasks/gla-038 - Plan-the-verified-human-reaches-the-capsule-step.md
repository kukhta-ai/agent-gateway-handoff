---
id: GLA-038
title: Plan the verified-human-reaches-the-capsule step
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
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
- [ ] #1 The Access Gateway's part is specified: how a verified, in-window request is proxied to the capsule's human entrypoint and nothing else.
- [ ] #2 The Capsule's part is specified: the human entrypoint as a surface exposed only within an open, authorized window.
- [ ] #3 The Route controller's part is specified: resolving the verified request to the correct capsule entrypoint.
- [ ] #4 The recipient's experience of arriving at the live surface is designed, including a connection that drops or a window that expires.
- [ ] #5 An implementation plan for the build task exists, with how a verified human reaching the live surface is observed.
- [ ] #6 Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog.
- [ ] #7 The human-entrypoint seam is specified at full capability so a different view surface is added with no gateway-code change.
<!-- AC:END -->
