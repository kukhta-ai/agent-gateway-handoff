---
id: GLA-096
title: Migrate AuthProvider wiring behind Provider Host
status: To Do
assignee: []
created_date: '2026-06-14 13:24'
labels:
  - architecture
  - provider-host
  - auth-provider
  - authentik
  - webauthn
  - security
dependencies:
  - GLA-095
  - GLA-078
  - GLA-085
  - GLA-086
references:
  - docs/architecture/authentik-integration.md
  - docs/architecture/authentik-dual-method-flow.md
  - docs/components/identity-and-auth.md
  - packages/app/src/index.ts
  - adapters/auth-authentik/src/index.ts
  - adapters/auth-webauthn/src/index.ts
documentation:
  - docs/architecture/provider-host-extension-architecture.md
priority: high
ordinal: 96000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: app currently owns auth provider selection and imports authentik-specific config and durable-state types. That makes the composition root a provider switchboard and weakens the provider-extensible auth architecture established by GLA-078.

Context: AuthProvider is the first migration because authentik and WebAuthn already prove that provider-specific evidence, state, and enrollment semantics multiply quickly. Gateway and identity must continue to consume provider-neutral facts only; authentik-specific OIDC, subject binding, and attempt state remain adapter-owned.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 WebAuthn and authentik are selectable by opaque provider id through the Provider Host, with both preserving their existing enrollment, verification, assurance, and default-selection behavior.
- [ ] #2 packages/app contains no authentik-specific config interfaces, state-store types, provider construction branches, or imports of authentik adapter implementation types.
- [ ] #3 Auth provider config from environment, CLI, WPM dependency bindings, and tests is normalized into provider-owned config schemas with secret-bearing values redacted or represented as secret references.
- [ ] #4 Auth provider durable state is stored under provider-host namespaces, and provider-owned state schemas prevent app code from naming authentik subject or pending-attempt types.
- [ ] #5 Gateway, identity, session, and kernel authorization paths continue to evaluate provider-neutral assurance evidence and never branch on concrete provider names, amr/acr values, OIDC details, or WebAuthn implementation details.
- [ ] #6 Invalid selected auth providers, missing auth config, unavailable identity-provider dependency evidence, and ambiguous provider evidence produce stable actionable diagnostics without silently falling back to a weaker provider.
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
