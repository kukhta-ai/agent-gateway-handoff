---
id: GLA-002
title: Plan the shared kernel and cross-module contracts
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - foundation
  - plan
dependencies:
  - GLA-001
documentation:
  - docs/04-capsule-assembly.md
  - docs/components/capability-service.md
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the core vocabulary and seams are shared by every module; designing them once prevents drift. Produces the contract specification (entities, ports, schemas, taxonomies), not code. Use the architect skills and research contract precedents (Terraform provider schema, K8s admission shapes, macaroon caveats) on the internet. Depends on the architecture baseline. Out of scope: implementing the kernel; per-step behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The core entities are specified with fields and lifecycles: task, session, capability, route, completion, audit event.
- [ ] #2 The capability primitive is specified as a contract: its caveat classes (including operator-discharge and recipient-binding), attenuation, and stateless edge-verifiability, independent of any signing mechanism.
- [ ] #3 The AssemblySpec is specified as a versioned, schema-validated contract (apiVersion, kind, metadata, spec) including the mounts shape, sufficient for offline validation.
- [ ] #4 The typed config-schema vocabulary providers use to declare parameters is specified (types, required/optional, defaults, enum, min/max/pattern, conflicts/requires, sensitive).
- [ ] #5 The stable error and exit-code taxonomy is specified as a contract other programs branch on, including the mount error namespace and its exit-code mapping.
- [ ] #6 Each module's port (the seam the core depends on) is specified by its method shape and guarantees, with no concrete adapter named.
- [ ] #7 The recipient-identity and enrollment model is specified as part of the identity contract, so a recipient can be established before any handoff verifies them.
- [ ] #8 An implementation plan for the kernel build task exists, ordered so contracts can be built before any module that depends on them.
- [ ] #9 Every external dependency the kernel itself needs is identified and classified traditional-code versus not; any non-traditional one has a wpm-installer-package task in this backlog.
<!-- AC:END -->
