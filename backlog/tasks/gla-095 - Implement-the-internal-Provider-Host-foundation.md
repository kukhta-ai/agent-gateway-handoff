---
id: GLA-095
title: Implement the internal Provider Host foundation
status: To Do
assignee: []
created_date: '2026-06-14 13:23'
labels:
  - architecture
  - provider-host
  - catalog
  - extension
dependencies:
  - GLA-078
  - GLA-082
  - GLA-088
references:
  - docs/01-architecture-overview.md
  - docs/02-provider-and-extension-model.md
  - docs/03-software-candidates.md
  - packages/kernel/src/ports.ts
  - packages/catalog/src/manifests.ts
  - packages/app/src/index.ts
documentation:
  - docs/architecture/provider-host-extension-architecture.md
priority: high
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the design set says providers register into GLA by inversion of control, but the runtime still relies on app-level concrete adapter wiring. This task establishes the internal Provider Host that turns trusted installed provider modules into manifests, factories, probes, state namespaces, diagnostics, skills, and runtime family registries.

Context: this is an incremental modular-monolith mechanism, not a public plugin ABI or dynamic hot-loading system. The runtime agent consumes the registry only; provider installation remains an operator/WPM concern. The task creates the shared host contract that later family migrations use, while preserving existing reference-slice behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A trusted provider module can register a manifest, family-specific factory, probe, skills, dependency requirements, compatibility relations, config schema, and state schema through one Provider Host boundary.
- [ ] #2 Catalog and runtime wiring consume the same provider-host registration data, so a provider's manifest, factory, probe, skills, dependency requirements, and compatibility metadata cannot drift into separate app-maintained tables.
- [ ] #3 Provider-specific config and durable state are addressed by provider id and provider-owned schemas, while app-level code persists only opaque provider-host namespaces and redacted diagnostics.
- [ ] #4 Unknown provider ids, duplicate registrations, invalid config, missing dependency evidence, unavailable probes, and unsupported families produce stable machine-readable diagnostics.
- [ ] #5 A reference provider set can load today's in-tree providers through the host while preserving the current default app behavior.
- [ ] #6 The architecture and developer docs state that this foundation is trusted install-time registration, not runtime-agent registration, dynamic code loading, or a public plugin ABI.
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
