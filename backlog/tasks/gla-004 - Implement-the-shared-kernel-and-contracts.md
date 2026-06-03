---
id: GLA-004
title: Implement the shared kernel and contracts
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - foundation
  - impl
dependencies:
  - GLA-002
  - GLA-003
documentation:
  - docs/04-capsule-assembly.md
  - docs/components/capability-service.md
  - docs/components/task-service.md
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: every module depends on the core entities, the capability primitive, the assembly contract, and the error taxonomy. Builds them as in-tree code behind the designed ports. Depends on the contracts plan and the scaffold. Out of scope: module-specific behaviour and any provider.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The core entities exist with their specified fields and state transitions, and an invalid transition surfaces a typed, machine-distinguishable error.
- [ ] #2 A capability can be minted, attenuated, and verified, and verification succeeds or fails purely from the capability and request without a central lookup.
- [ ] #3 A recipient-bound capability verifies only for its bound recipient and fails closed for any other.
- [ ] #4 An AssemblySpec is validated offline against its schema: a well-formed spec passes, and each distinct defect is reported with its location in a single pass.
- [ ] #5 A provider config-schema rejects a value that violates a declared constraint, naming the offending field, before anything runs.
- [ ] #6 Every taxonomy error carries a stable code mapping to the documented exit code, so callers branch without parsing prose.
- [ ] #7 The kernel has no dependency on any concrete adapter or external service.
<!-- AC:END -->
