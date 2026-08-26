---
id: GLA-086
title: Verify deployed authentik login method choices
status: Done
assignee: []
created_date: '2026-06-12 21:51'
updated_date: '2026-06-13 23:49'
labels:
  - authentik
  - deployment
  - auth-strength
  - hardening
  - e2e
dependencies:
  - GLA-074
  - GLA-078
  - GLA-085
  - GLA-091
references:
  - docs/architecture/authentik-dual-method-flow.md
  - docs/architecture/authentik-e2e-verification.md
  - docs/architecture/authentik-service-standup.md
  - >-
    https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/identification/
  - >-
    https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_webauthn/
  - 'https://docs.goauthentik.io/users-sources/sources/'
priority: high
ordinal: 86000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the design expects authentik to host credential and source choices, but a deployed flow can still present only password when passkey validation, passwordless links, sources, authenticator enrollment, or provider evidence emission are not configured. The operator needs observable evidence that the GLA authentik application exposes the intended login methods and emits provider evidence that GLA can map safely into its assurance policy.

Boundaries: GLA still consumes provider facts and gates by its provider-neutral assurance policy; this task does not make the gateway know authentik-specific flow internals or weaken the never-up-map rule.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The deployed authentik flow for the GLA application presents a password path and presents a passkey or WebAuthn path to a recipient with an enrolled compatible authenticator.
- [x] #2 A recipient without an enrolled passkey still has an observable password fallback path, and that path succeeds for handoff only when the selected GLA assurance policy permits the resulting evidence.
- [x] #3 Configured external, social, or enterprise sources for the GLA authentik application appear as login choices and return stable subject evidence that can be enrolled and later verified.
- [x] #4 Successful passkey, password, and configured source logins produce provider evidence that GLA maps to distinct assurance outcomes; missing or ambiguous evidence is surfaced as degraded or insufficient, never silently as stronger assurance.
- [x] #5 A deployment verification or doctor surface reports which authentik stages, passkey configuration, password path, configured sources, emitted evidence, and GLA assurance mapping are active for the GLA application.
- [x] #6 Operator-facing documentation explains what a password-only authentik screen means and which authentik flow, stage, source, authenticator, evidence-emission, and GLA assurance-policy settings control visible login options and handoff eligibility.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created from the authentik expectation review: GLA-078 controls whether password strength is acceptable, but it does not ensure authentik actually exposes passkey/source choices in the deployed hosted flow.

Aligned with GLA-078: deployed authentik verification must prove method/source evidence mapping into the provider-neutral assurance layer, not just the old password/webauthn string pair.

Review mapping update: deployed authentik verification should consume GLA-091. A passkey/WebAuthn option is not enough by itself; the verification surface must prove whether the deployed provider emits user-verification or equivalent evidence that maps to the selected GLA assurance policy.

Close-out evidence (2026-06-13): persistent worker Dirac invoked bmad-create-story and bmad-dev-story; persistent TEA Helmholtz invoked bmad-qa-generate-e2e-tests and security/test review; persistent architect Mill approved provider-extensible layering; persistent reviewer Wegener approved after proof false-green blockers were fixed. Full quality gate passed with pnpm run gate: typecheck, Biome CI, Vitest 63 files / 700 passed / 15 skipped. Story artifact: _bmad-output/implementation-artifacts/gla-086-authentik-login-method-choices-story.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented provider-extensible deployed login-method proof diagnostics for authentik, updated WPM receipt/templates and operator docs, added regression coverage for password/passkey/source evidence mapping, assurance overclaims, missing proof, deferred proof, stable-subject gaps, and redaction. Verified with pnpm run gate: typecheck, Biome CI, Vitest 63 files / 700 passed / 15 skipped.
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
