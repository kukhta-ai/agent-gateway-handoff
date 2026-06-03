---
id: GLA-009
title: Build a wpm installer package for the capsule isolation runtime
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
  - docs/components/worker-plane.md
priority: high
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: capsules need an isolation runtime (a container or rootless runtime) on the operator host, which touches the host and ships as a wpm installer package. Depends on the dependency strategy. Out of scope: the GLA worker plane that uses the runtime; the launcher provider.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A wpm installer package for the isolation runtime exists in this project and is the unit that gets built, not an inline install.
- [x] #2 The package detects whether a supported isolation runtime is already present and usable.
- [x] #3 On completion the host can start an isolated capsule process the agent does not run as.
- [x] #4 An already-present adequate runtime is left unchanged and recorded.
- [x] #5 The package records a verifiable receipt and is idempotent on re-run.
- [x] #6 A host where the runtime cannot be installed surfaces a catchable failure without partial state.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
wpm bundle 'isolation' authored in wpm/ (GLA's agent-native installer bundle-project; wpm v0.1.0 via npm link from /workspace/active/work-package-manager). It IS the build unit (not an inline install) with a real install-backlog detect->setup->verify->record per the wpm install contract: detects an existing usable runtime before changing anything; leaves an adequate one unchanged (recorded as adopted); records a verifiable receipt (installed-vs-adopted + inverse op + checksum); idempotent on re-run; surfaces a clear catchable failure rather than a partial state. Ownership mode + the hermes-1 mapping (Ubuntu 24.04 LXD, host Caddy -> :3000) are in the bundle. wpm project validate + wpm build dry-run PASS (6 bundles, 98 files).
<!-- SECTION:NOTES:END -->
