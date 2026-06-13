---
id: GLA-085
title: Provide invitation-based authentik recipient enrollment
status: Done
assignee: []
created_date: '2026-06-12 21:51'
updated_date: '2026-06-13 18:07'
labels:
  - authentik
  - enrollment
  - deployment
  - hardening
dependencies:
  - GLA-070
  - GLA-074
  - GLA-078
  - GLA-080
references:
  - docs/architecture/authentik-enrollment.md
  - docs/architecture/authentik-service-standup.md
  - docs/architecture/authentik-dual-method-flow.md
  - >-
    _bmad-output/implementation-artifacts/investigations/authentik-invitation-auth-options-investigation.md
  - 'https://docs.goauthentik.io/users-sources/user/invitations/'
  - 'https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/user_write/'
  - >-
    https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_validate/
  - >-
    https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_webauthn/
  - >-
    https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/identification/
  - 'https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/source/'
priority: high
ordinal: 85000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: authentik owns delegated credentials, but the deployed recipient path must not rely on an operator-created account or a generated password handed to the recipient. A GLA enrollment invite should let the recipient establish or link their authentik identity and leave GLA with only the stable subject binding needed for later handoffs.

Authentik mechanics: available auth options are operator-selected through authentik flows, stages, sources, policies, and authenticator validation settings. An invited recipient can set up only the methods that the configured enrollment/authentication flow exposes; if the operator configures multiple setup choices for a requirement, authentik can let the recipient choose among those choices.

Supported offer for GLA: invitation enrollment should support recipient-owned password setup, WebAuthn/passkey setup, and external OAuth/SAML source binding when those are configured. Other authentik factors such as TOTP, email OTP, SMS OTP, static backup codes, Duo, or similar methods are provider evidence, MFA, or recovery factors that map through GLA-078's assurance policy; they do not silently satisfy a stronger GLA assurance requirement just because authentik login succeeded. The initial shipped profiles preserve today's password-vs-passkey semantics, but the enrollment architecture must not make those two strings the long-term integration limit.

Boundaries: this does not change GLA grant semantics, does not add agent-initiated enrollment, and does not store authentik passwords or credential material in GLA, WPM receipts, logs, or operator output.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An operator-issued GLA enrollment invite lets an unregistered recipient complete an authentik enrollment flow and leaves the recipient bound in GLA to a stable authentik subject.
- [x] #2 The recipient establishes or uses their own authentik credential without any generated password being shown in GLA output, WPM output, receipts, logs, or documentation examples.
- [x] #3 Missing, expired, reused, forged, or wrong-recipient enrollment invites cannot create a GLA subject binding or make the recipient verifiable for handoff.
- [x] #4 A failed or abandoned authentik enrollment leaves no half-bound GLA recipient and no reusable GLA enrollment grant.
- [x] #5 Re-enrollment or recovery replaces a prior bound subject only after a fresh invite-backed authentik round trip verifies successfully.
- [x] #6 Operator-facing diagnostics distinguish an authentik account that exists from a GLA recipient that is enrolled and bound for handoff.
- [x] #7 The active authentik enrollment method policy is observable to the operator, including the selected enrollment flow, credential setup stages, external sources, required methods, and optional recipient choices.
- [x] #8 When password and WebAuthn/passkey setup are configured, an invited recipient can establish their own password and register their own WebAuthn/passkey credential without receiving an operator-generated password.
- [x] #9 When multiple authenticator setup choices are configured for one authentik requirement, the invited recipient can choose among those configured choices and cannot select unsupported methods outside the operator-defined policy.
- [x] #10 When OAuth or SAML sources are configured for the GLA authentik application, an invited recipient can enroll by linking through one of those sources and GLA records only the resulting stable authentik subject binding.
- [x] #11 Configured MFA, recovery, source, and authenticator methods are reported as provider evidence and mapped through the GLA assurance policy; no method silently satisfies a stronger GLA assurance requirement merely because authentik login succeeded.
- [x] #12 If the configured authentik enrollment and login methods cannot satisfy the selected GLA assurance policy, the operator sees an actionable diagnostic before relying on the invite for handoff.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented via BMAD create-story/dev-story context. Added provider-extensible auth enrollment policy diagnostics, recipient-scoped GLA binding diagnostics, delegated redirect grant consumption before provider navigation, one-shot pending consumed callback verification, enrollment-page grant/referrer hardening, docs/WPM/operator guidance, and tests for password/passkey/source/MFA policy evidence and grant failure semantics. Persistent reviewer Wegener approved after blocker fixes; TEA/security Helmholtz found no blockers. Final gate: pnpm run gate passed (59 files, 641 passed, 12 skipped; known wpm/CLAUDE.md broken symlink warning).
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [x] #7 Architecture and deployment design completed: the implementation preserves the GLA/authentik boundary where authentik owns credentials and GLA records only the subject binding, documents the operator-selected enrollment-method model, and identifies the owning package for flow verification, invite generation, subject binding, diagnostics, docs, and WPM installer/template changes.
- [x] #8 Docs, operator instructions, and installer assets are updated together: authentik enrollment options, supported credential/MFA/source choices, required flow/stage/source settings, assurance-policy implications, recovery/re-enrollment behavior, and WPM/env/template verification steps are accurate and tested against the task outcomes.
<!-- DOD:END -->
