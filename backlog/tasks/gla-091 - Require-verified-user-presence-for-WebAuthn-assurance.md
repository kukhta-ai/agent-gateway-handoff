---
id: GLA-091
title: Require user verification for WebAuthn assurance
status: Done
assignee: []
created_date: '2026-06-12 22:59'
updated_date: '2026-06-13 22:59'
labels:
  - security
  - webauthn
  - auth-assurance
  - auth-provider
  - hardening
dependencies:
  - GLA-013
  - GLA-078
references:
  - docs/components/identity-and-auth.md
  - docs/architecture/authentik-dual-method-flow.md
  - adapters/auth-webauthn/src/index.ts
  - adapters/auth-authentik/src/strength.ts
priority: high
ordinal: 91000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: independent security review found that WebAuthn-related evidence can be classified too coarsely. A successful WebAuthn ceremony does not automatically prove the same assurance level unless the assertion includes the required user verification or equivalent phishing-resistant evidence. The auth-assurance layer must avoid silently treating weaker authenticator events as strongest assurance.

Architectural context: GLA should compare provider evidence against provider-neutral assurance requirements. WebAuthn, passkeys, authentik stages, and future provider factors may expose different evidence fields, but ambiguous or missing evidence must degrade or fail closed rather than up-map.

Boundaries: this task concerns assurance classification and diagnostics. It does not prescribe a specific authenticator vendor, authentik flow layout, or enrollment UX.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 WebAuthn and passkey evidence that lacks required user verification or equivalent configured proof is not classified as the strongest phishing-resistant assurance outcome.
- [x] #2 Provider evidence with explicit user verification, recipient binding, and replay-resistant challenge validation can satisfy the strongest shipped assurance profile.
- [x] #3 Missing, ambiguous, downgraded, or provider-specific authenticator evidence produces a degraded or insufficient assurance result with actionable diagnostics.
- [x] #4 The in-tree WebAuthn adapter and authentik evidence mapping report assurance facts through the common auth-assurance contract without gateway code checking provider-specific flags.
- [x] #5 Password-permitted policies continue to accept password-grade evidence only when explicitly selected and do not cause non-UV WebAuthn evidence to be upgraded.
- [x] #6 Tests cover UV-required success, UV-missing refusal or downgrade, authentik mapped evidence, replayed assertions, and diagnostics for ambiguous authenticator evidence.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented provider-neutral UV/binding/replay auth-assurance evidence; WebAuthn now requires UV; authentik passkey mapping requires explicit gla_uv/userVerified plus binding/replay proof; legacy string-only webauthn is rejected for phishing-resistant policy. Persistent reviews: Wegener bmad-story-automator-review APPROVE; Helmholtz bmad-testarch-test-review PASS; Mill architecture conformance APPROVE. Verification: pnpm run gate passed on 2026-06-13 with 63 files, 694 passed, 15 skipped.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [x] #7 Auth-assurance documentation defines the difference among presence, verification, phishing-resistant evidence, and password-grade evidence.
- [x] #8 Security review notes explain downgrade/fail-closed behavior and why ambiguous authenticator evidence cannot satisfy strongest assurance.
<!-- DOD:END -->
