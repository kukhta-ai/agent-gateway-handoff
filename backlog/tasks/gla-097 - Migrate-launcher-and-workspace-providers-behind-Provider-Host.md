---
id: GLA-097
title: Migrate launcher and workspace providers behind Provider Host
status: To Do
assignee: []
created_date: '2026-06-14 13:24'
labels:
  - architecture
  - provider-host
  - launcher
  - workspace
  - worker
  - catalog
dependencies:
  - GLA-095
  - GLA-088
  - GLA-082
references:
  - docs/components/worker-plane.md
  - docs/04-capsule-assembly.md
  - packages/worker/src/index.ts
  - packages/catalog/src/manifests.ts
  - adapters/launcher-process/src/index.ts
  - adapters/workspace-profile/src/index.ts
documentation:
  - docs/architecture/provider-host-extension-architecture.md
priority: high
ordinal: 97000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: launcher and workspace are runtime substrate layers, but today the process launcher and profile workspace are constructed directly in app. The SpawnerRegistry proves the seam exists; the missing step is driving it from provider-host registration and catalog availability.

Context: this task keeps the worker plane as traditional code and keeps launcher/workspace adapters behind kernel ports. It does not introduce a new isolation backend. It makes the existing reference providers register through the same mechanism future Docker, Podman, Firecracker, remote-worker, staged-copy, or persistent workspace providers will use.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The default launcher and workspace are registered through Provider Host modules and remain behaviorally compatible with today's local-process and browser-profile-temp behavior.
- [ ] #2 The worker SpawnerRegistry and WorkspaceManager receive launcher and workspace ports from provider-host selection rather than app-level concrete adapter construction.
- [ ] #3 Launcher and workspace availability is derived from provider manifests, WPM dependency binding evidence, and current probes, with host-touching providers unavailable when required evidence is absent or degraded.
- [ ] #4 Launcher mount capability, workspace lifecycle semantics, and cleanup/reap behavior remain provider-neutral and enforce the agent-authority and no-orphan invariants already documented for the worker plane.
- [ ] #5 A fake launcher and fake workspace provider can be registered and selected without changes to kernel, session, gateway, identity, route, or completion packages.
- [ ] #6 Operator and agent-facing catalog/schema output shows launcher and workspace provider ids, capabilities, dependency status, and diagnostics from provider-host state rather than duplicated static wiring tables.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
