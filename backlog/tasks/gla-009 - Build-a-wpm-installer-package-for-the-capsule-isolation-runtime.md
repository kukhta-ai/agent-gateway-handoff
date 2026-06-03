---
id: GLA-009
title: Build a wpm installer package for the capsule isolation runtime
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
- [ ] #1 A wpm installer package for the isolation runtime exists in this project and is the unit that gets built, not an inline install.
- [ ] #2 The package detects whether a supported isolation runtime is already present and usable.
- [ ] #3 On completion the host can start an isolated capsule process the agent does not run as.
- [ ] #4 An already-present adequate runtime is left unchanged and recorded.
- [ ] #5 The package records a verifiable receipt and is idempotent on re-run.
- [ ] #6 A host where the runtime cannot be installed surfaces a catchable failure without partial state.
<!-- AC:END -->
