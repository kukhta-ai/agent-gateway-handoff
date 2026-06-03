---
id: GLA-008
title: Build a wpm installer package for the human-view stack
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 13:49'
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
- [x] #1 A wpm installer package for the human-view stack exists in this project and is the unit that gets built, not an inline install.
- [x] #2 The package detects an existing usable view stack before changing anything.
- [x] #3 On completion the host can expose a running browser display as a browser-reachable stream.
- [x] #4 An already-adequate stack is left unchanged and recorded.
- [x] #5 The package records a verifiable receipt and is idempotent on re-run.
- [x] #6 A host where the stack cannot be installed fails clearly without leaving it half-configured.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
wpm bundle 'human-view' authored in wpm/ (GLA's agent-native installer bundle-project; wpm v0.1.0 via npm link from /workspace/active/work-package-manager). It IS the build unit (not an inline install) with a real install-backlog detect->setup->verify->record per the wpm install contract: detects an existing usable runtime before changing anything; leaves an adequate one unchanged (recorded as adopted); records a verifiable receipt (installed-vs-adopted + inverse op + checksum); idempotent on re-run; surfaces a clear catchable failure rather than a partial state. Ownership mode + the hermes-1 mapping (Ubuntu 24.04 LXD, host Caddy -> :3000) are in the bundle. wpm project validate + wpm build dry-run PASS (6 bundles, 98 files).
<!-- SECTION:NOTES:END -->
