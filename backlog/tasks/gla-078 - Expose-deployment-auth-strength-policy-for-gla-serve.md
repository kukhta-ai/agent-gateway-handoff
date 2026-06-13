---
id: GLA-078
title: Architect provider-extensible auth assurance policy
status: Done
assignee: []
created_date: '2026-06-12 20:01'
updated_date: '2026-06-13 00:22'
labels:
  - hardening
  - authentik
  - deployment
  - auth-strength
  - wpm
  - auth-provider
  - architecture
dependencies:
  - GLA-072
  - GLA-074
  - GLA-076
references:
  - >-
    _bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md
  - docs/components/identity-and-auth.md
  - docs/architecture/kernel-contracts.md
  - docs/architecture/authentik-integration.md
  - docs/architecture/authentik-dual-method-flow.md
  - docs/architecture/authentik-e2e-verification.md
  - docs/architecture/dependency-strategy.md
  - packages/kernel/src/ports.ts
  - packages/app/src/index.ts
  - packages/app/src/daemon.ts
  - packages/gateway/src/index.ts
  - adapters/auth-authentik/src/strength.ts
  - wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl
priority: high
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the current deployment policy is shaped like a two-value app enum (password vs webauthn), but GLA needs to integrate multiple auth providers and many provider-specific authentication methods without teaching the gateway each provider's vocabulary. Authentik already exposes richer evidence through flows, stages, sources, amr/acr, passkeys, passwords, MFA, and external identity sources; future providers will have different evidence names.

This task establishes a provider-neutral auth-assurance layer: AuthProvider adapters report verified authentication evidence into a common GLA contract, deployment policy names required assurance outcomes, and the Access Gateway evaluates that contract without depending on concrete provider names or method strings. The existing password-permitted and phishing-resistant/passkey-required behaviours remain the initial profiles, not the architectural limit.

Boundaries: GLA remains the grant-checking enforcement point; AuthProvider adapters report facts, not allow/deny decisions; authentik-specific amr/acr/stage semantics stay in the adapter, installer verification, and diagnostics; ambiguous provider evidence must never be silently upgraded to a stronger assurance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A provider-neutral auth-assurance contract is available at the GLA boundary and can represent verified evidence from different AuthProvider adapters without requiring core or gateway code to depend on provider-specific method names.
- [x] #2 Deployment policy selects required assurance by a stable GLA policy/profile contract rather than by an app-local enum tied to today's provider methods.
- [x] #3 The shipped policy profiles preserve the current secure default and current password-permitted behaviour: unset policy demands phishing-resistant/passkey-grade assurance, and password-grade evidence is accepted only by a policy that explicitly permits it.
- [x] #4 AuthProvider adapters can map provider evidence into the common assurance contract, including authentik amr/acr/factor/source evidence and future provider-specific claims, while unmapped or ambiguous evidence fails closed or degrades only to the lowest safe assurance.
- [x] #5 The Access Gateway authorizes handoff and auth-reuse decisions from the common assurance contract plus grant and recipient facts, with no provider-specific route logic, raw amr/acr checks, or concrete provider names in gateway authorization decisions.
- [x] #6 CLI, environment, WPM templates, and operator diagnostics expose the selected assurance policy and report whether the configured provider can satisfy it before a deployment relies on handoff.
- [x] #7 Invalid policy values, unknown policy profiles, and provider evidence that cannot satisfy the selected policy produce stable actionable diagnostics rather than silent fallback.
- [x] #8 Developer documentation explains how to add a new auth provider: which port to implement, how verified provider evidence maps into GLA assurance, how installer/doctor verification proves the mapping, and what tests demonstrate gateway independence.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
BMAD evidence: create-story ran via worker using spec-exists fallback into _bmad-output/implementation-artifacts/gla-078-provider-extensible-auth-assurance-policy.md; dev-story ran via worker; story-automator-review ran via separate reviewer and applied fixes. Final pnpm gate passed twice after review/final JSDoc fix (54 test files, 563 passed, 12 skipped); only pre-existing wpm/CLAUDE.md broken-symlink warning remains.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [x] #7 Architecture and developer-integration docs are updated to define the auth-assurance layer, provider evidence mapping boundary, deployment policy profiles, diagnostics, and the process for adding a new AuthProvider adapter.
- [x] #8 Security review notes cover assurance ordering, fail-closed/degrade-only behavior, authentik amr/acr ambiguity, auth-reuse safety, and why provider-specific evidence does not enter gateway authorization logic.
<!-- DOD:END -->
