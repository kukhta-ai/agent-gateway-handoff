---
id: GLA-095
title: Implement the internal Provider Host foundation
status: Done
assignee: []
created_date: '2026-06-14 13:23'
updated_date: '2026-06-14 14:06'
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
- [x] #1 A trusted provider module can register a manifest, family-specific factory, probe, skills, dependency requirements, compatibility relations, config schema, and state schema through one Provider Host boundary.
- [x] #2 Catalog and runtime wiring consume the same provider-host registration data, so a provider's manifest, factory, probe, skills, dependency requirements, and compatibility metadata cannot drift into separate app-maintained tables.
- [x] #3 Provider-specific config and durable state are addressed by provider id and provider-owned schemas, while app-level code persists only opaque provider-host namespaces and redacted diagnostics.
- [x] #4 Unknown provider ids, duplicate registrations, invalid config, missing dependency evidence, unavailable probes, and unsupported families produce stable machine-readable diagnostics.
- [x] #5 A reference provider set can load today's in-tree providers through the host while preserving the current default app behavior.
- [x] #6 The architecture and developer docs state that this foundation is trusted install-time registration, not runtime-agent registration, dynamic code loading, or a public plugin ABI.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GLA-095 claimed for Phase 5 story work on feature/provider-host-task-095. Persistent specialist lanes initialized: architect Mill, worker Dirac, reviewer Wegener, TEA Helmholtz, SM Hilbert, investigator Tesla. Rule-3 note: bmad-create-story/dev-story skills load; full create-story auto-discovery requires missing sprint-status.yaml, so story prep will use explicit backlog task target and docs-driven fallback unless sprint-status is produced.

GLA-095 implementation evidence: added @gla/provider-host and @gla/provider-set-reference; app CatalogService now consumes referenceProviderStoreContent() derived from ProviderHost registrations; reference provider set includes WebAuthn, authentik, launcher-process, entrypoint-novnc, connector-cdp, workspace-profile, url-watcher, user-done, and channel-cli. Provider Host validates config/schema, fails closed on unknown/duplicate/family/config/dependency/probe/factory errors, uses transactional registration, redacts host and provider-emitted diagnostics, namespaces provider state, and exposes manifests/state schemas from one registration boundary. Focused tests passed for provider-host/reference-set/app; full quality gate passed: pnpm gate, 66 files, 739 passed, 15 skipped. Specialist evidence: architect APPROVE; TEA APPROVE after redacting caller-supplied diagnostic sink; independent reviewer APPROVE after user-done and host-derived catalog-content fixes. Rule-3 note: bmad architecture/test/review skills loaded in persistent lanes; full interactive workflows remained docs-driven/read-only fallback as recorded.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the internal Provider Host foundation and trusted reference provider set. The app catalog now consumes ProviderHost-derived provider manifests, while full runtime factory migration is explicitly deferred to GLA-096..GLA-100. Full gate passed: pnpm gate, 739 passed, 15 skipped.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
