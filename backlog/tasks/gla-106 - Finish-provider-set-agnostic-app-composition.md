---
id: GLA-106
title: Finish provider-set-agnostic app composition
status: Done
assignee: []
created_date: '2026-06-14 20:45'
updated_date: '2026-06-14 21:41'
labels:
  - architecture
  - provider-host
  - provider-set
  - composition
  - extensibility
dependencies:
  - GLA-100
  - GLA-101
  - GLA-105
references:
  - packages/app/src/index.ts
  - packages/provider-host/src/index.ts
  - packages/provider-set-reference/src/index.ts
documentation:
  - docs/01-architecture-overview.md
  - docs/architecture/provider-host-extension-architecture.md
priority: high
ordinal: 106000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the Provider Host migration removed concrete adapter construction from the app, but the generic app composition still knows the in-tree reference provider set and uses reference-specific helper names for default wiring metadata. The finished architecture should make the app a provider-set-agnostic composition engine: it receives a trusted provider set and selected profile at boot, registers those providers through Provider Host, and derives wiring/catalog/diagnostics from registered provider metadata.

Context: the intended extension model is boot-time/install-time provider-set extensibility, not untrusted runtime code loading. A selected provider set may be the in-tree reference set, a future distribution set, or a test/fake set. Runtime can select among already registered provider ids, but agents/users cannot register new provider code while the daemon is running. This preserves the narrow-waist design: core services receive kernel ports and provider-neutral descriptors; provider packages own concrete adapter construction, provider manifests, config/state schemas, probes, skills/docs, and dependency requirements.

Non-goals: no dynamic hot-loading of arbitrary provider code, no public marketplace/version solver, no policy-engine provider family, and no second access gateway or delegated auth decision point.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Generic app composition paths consume a provider-set-agnostic boundary; reference-set-specific imports are absent from those paths and confined to the reference provider set or an explicit distribution/default entrypoint.
- [x] #2 Provider module identity used by app wiring, diagnostics, and catalog views is derived from registered Provider Host metadata, not from app-maintained provider-id-to-module lookup tables.
- [x] #3 The default selected providers for the reference build are represented as provider profile/configuration data owned outside generic app composition.
- [x] #4 Changing the selected provider set or selected provider profile does not require source changes in gateway, session, identity, worker core, kernel, or generic app composition code.
- [x] #5 A non-reference fake provider set can be registered and selected through the same boot path, with catalog entries, wiring/read-model output, and runtime port creation reflecting the fake set's metadata.
- [x] #6 Unknown, wrong-family, invalid-config, missing-dependency, unavailable-probe, and provider-owned-state behaviours remain Provider Host outcomes with redacted diagnostics after app composition becomes provider-set agnostic.
- [x] #7 Reference helper functions for mapping provider ids to module markers are not required by generic app composition; any remaining compatibility helpers are local to provider-set-specific packages and do not determine runtime creation.
- [x] #8 Architecture and operator/developer documentation describe the finished boot-time provider-set model, including why it differs from ordinary DI and why runtime dynamic code loading is out of scope.
- [x] #9 The quality gate includes an automated boundary check that fails when generic app/core paths import concrete provider adapters or reference-set-only helpers.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SDLC initialization: persistent specialists initialized before implementation. Architect Mill loaded bmad-create-architecture; full workflow is interactive, so GLA-106 architecture review will be docs-driven fallback against Backlog.md + design docs. SM Hilbert loaded bmad-create-story and confirmed sprint-status.yaml is absent; Backlog.md is the story source. Worker Dirac loaded bmad-create-story/dev-story/qa-generate-e2e-tests and identified packages/app, provider-host, provider-set-reference, and boundary tests as likely ownership. Reviewer Wegener loaded story-automator-review and prepared review attack plan. TEA/security Helmholtz loaded testarch-test-review and testarch-nfr and listed closure evidence. Investigator Tesla loaded bmad-investigate for gate-failure root cause analysis.

DoD refined per user direction on 2026-06-14: GLA-106 is treated as an architecture task, so closure requires architecture documentation, enforced boundaries, fake-provider proof, reference compatibility, security/non-hot-loading guarantees, developer/operator instructions, and independent architect plus TEA/security review evidence.

Closure evidence 2026-06-14: implementation moved generic app composition to packages/app/src/composition.ts, made packages/app/src/index.ts the explicit reference/default provider-set entrypoint, added Provider Host descriptors/strict requireProviderDescriptor lookup, added provider.state_unavailable fail-closed redaction, added fake non-reference provider-set app tests, extended boundary scanner to reject concrete provider adapters, direct reference-set imports, and relative imports of the provider-set entrypoint from generic runtime files. Reference CLI/server startup remains compatible through index.ts serve/runServe/main wrappers that pass referenceProviderSet into the generic daemon. Independent specialists: architect Mill ran GLA-106 docs-driven bmad-create-architecture review and APPROVED after the daemon -> index transitive leak was fixed; TEA/security Helmholtz reran bmad-testarch-test-review/NFR lane and returned PASS after strict provider lookup and redacted state diagnostics; reviewer Wegener reran story-automator-review lane and APPROVED. Verification: focused provider-host/provider-set-composition/boundary/daemon tests passed; full pnpm gate passed after final fixes with 790 tests, 15 skipped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
GLA-106 completed provider-set-agnostic app composition: generic composition now consumes trusted provider sets/profiles, Provider Host descriptors are the module-identity authority, the reference distribution is isolated to the default entrypoint, fake provider-set contract tests prove extensibility, boundary checks enforce the layer, docs capture the model, and pnpm gate is green.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Architecture documentation records the finished provider-set composition model, including the provider-set boundary, selected-profile ownership, Provider Host metadata ownership, reference/default entrypoint role, boot-time extension lifecycle, and rejected alternatives such as app lookup tables, DI-only wiring, and runtime hot-loading.
- [x] #2 Generic app/core composition paths have no imports from concrete provider adapters or reference-set-only helpers; those imports are confined to provider-set packages or an explicit reference/default distribution entrypoint, and an automated boundary check enforces the rule.
- [x] #3 Provider module identity used in app wiring, catalog/read-model output, and diagnostics is sourced from Provider Host descriptors; no generic app lookup table remains as an authority for provider-id-to-module mapping.
- [x] #4 The in-tree reference distribution is represented as provider-set/profile/config data outside generic composition, and existing reference behaviour remains compatible for CLI/server startup, enrollment, handoff, catalog defaults, and diagnostics.
- [x] #5 A non-reference fake provider set proves the same boot path covers registration, selected profile override, catalog projection, wiring/read-model output, runtime port creation, provider config/services, dependency evidence, and provider-owned assets without generic app source edits.
- [x] #6 Negative tests prove Provider Host fail-closed behaviour and redaction for unknown providers, wrong-family providers, invalid config, missing dependencies, unavailable probes, and provider-owned state namespace failures after the app becomes provider-set agnostic.
- [x] #7 No public API allows users, agents, request-time inputs, or untrusted runtime code to register executable provider modules after daemon boot; provider executable registration is limited to trusted boot/install-time composition.
- [x] #8 Developer and operator documentation explains how to add or select a provider set, including required manifest, factory, config/schema, dependency, probe, state-schema, asset, and validation evidence for a provider module.
- [x] #9 Provider-owned secrets, dependency evidence, public asset exposure, logs, and state namespaces remain behind Provider Host redaction and namespace boundaries; generic app code exposes no raw provider-specific secret or state internals.
- [x] #10 Compatibility and migration review confirms no duplicate shim or compatibility helper remains that could be mistaken for the future extension seam; any remaining reference helper is documented as reference-local only.
- [x] #11 Independent architect, TEA/security, and reviewer outcomes are recorded in task notes, and all blocking concerns about layering, extensibility, test evidence, compatibility, or security posture are resolved before closure.
- [x] #12 The full project quality gate (pnpm gate) passes, including boundary/source-layout checks and the new provider-set contract tests.
<!-- DOD:END -->
