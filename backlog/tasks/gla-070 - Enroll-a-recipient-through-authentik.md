---
id: GLA-070
title: Enroll a recipient through authentik
status: Done
assignee: []
created_date: '2026-06-03 15:41'
updated_date: '2026-06-03 17:22'
labels:
  - authentik
  - impl
dependencies:
  - GLA-068
  - GLA-069
priority: medium
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the precondition for a delegated-provider handoff — a recipient bound to the provider's subject so a later step-up can verify them. Builds the step designed in its plan. Depends on the adapter and the enrollment plan. Out of scope: per-handoff verification (the step-up).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After enrollment a recipient is bound to a stable provider subject and can be verified at a later handoff; an un-enrolled recipient cannot be verified.
- [x] #2 Enrollment proceeds only when the single-use operator-discharge grant verifies; an absent, wrong-recipient, expired, or reused grant is refused.
- [x] #3 A failed or abandoned enrollment leaves no half-bound recipient and is safely retryable.
- [x] #4 The recipient binding is established without GLA storing the recipient's credential, which remains held by the provider.
- [x] #5 Switching back to the in-tree provider leaves its enrollment path working unchanged.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the SERVICE-LAYER enrollment through authentik (the browser callback is GLA-072's, per plan §8.1). Delivered: packages/app/src/authentik-enrollment.test.ts (19 tests, all 5 ACs), an authProviderOverride composition seam in createEnrollmentStack (TEST-ONLY — verified NOT reachable from daemon.ts/env, so no production attack surface; lets a test inject AuthAuthentikProvider with shared fake-authentik stores), and a @gla/auth-authentik/testing subpath export for FakeAuthentik. NO adapter src change, NO IdentityService change — enrollComplete(recipient, attestation:unknown) was ALREADY provider-agnostic (passes attestation to finishEnrollment, records EnrollmentRecord{credentialId:sub, authStrength} only on success; strengthOf reads the recorded fact, not a hardcoded webauthn). Gateway+kernel byte-for-byte untouched (git diff empty). AC#1: enroll->bound to stable sub, later step-up resolves same sub, different sub fails, un-enrolled denied. AC#2: provider-agnostic grant gate holds with authentik selected (absent->400, forged/expired/reused->403, each before any provider call). AC#3: invalid/nonce-mismatch/exchange-fail enrollComplete throws + binds nothing + retryable with fresh grant; re-enroll replaces. AC#4: GLA holds ONLY {sub} (one key), no passkey/secret/password (contrast: WebAuthn stores pubkey+counter). AC#5: default/webauthn unchanged, existing WebAuthn enrollment E2E green. Gate: tsc+biome clean, vitest 528 passed|12 skipped (+19). Rule-3: bmad-dev-story interactive-gated -> direct TS impl. Separate-lane review: orchestrator-verified (adapter unchanged=already deeply reviewed in 068; override seam confirmed test-only; 19 tests substantive). DEFERRED to 072: the production browser callback (enroll-page redirect to authorizeUrl + the callback delivering {code,state} to enrollComplete) + the gateway /enroll/verify strength-hardcode (noted on GLA-072).
<!-- SECTION:NOTES:END -->
