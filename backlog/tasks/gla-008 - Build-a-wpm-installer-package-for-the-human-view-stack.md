---
id: GLA-008
title: Build a wpm installer package for the human-view stack
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - dependency
  - wpm
  - impl
dependencies:
  - GLA-005
documentation:
  - docs/components/capsule.md
  - docs/components/access-gateway.md
priority: high
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the human entrypoint needs a view stack (noVNC plus websockify plus a VNC server plus a virtual display) on the operator host; it touches the host, so it ships as a wpm installer package, separate from the browser layer. Depends on the dependency strategy. Out of scope: the browser-stream HumanEntrypoint provider that wires this stack into the capsule.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A wpm installer package for the human-view stack exists in this project and is the unit that gets built, not an inline install.
- [ ] #2 The package detects an existing usable view stack before changing anything.
- [ ] #3 On completion the host can expose a running browser display as a browser-reachable stream.
- [ ] #4 An already-adequate stack is left unchanged and recorded.
- [ ] #5 The package records a verifiable receipt and is idempotent on re-run.
- [ ] #6 A host where the stack cannot be installed fails clearly without leaving it half-configured.
<!-- AC:END -->
