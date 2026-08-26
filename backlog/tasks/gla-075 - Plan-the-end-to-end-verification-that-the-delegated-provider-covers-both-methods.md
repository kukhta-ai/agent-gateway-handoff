---
id: GLA-075
title: >-
  Plan the end-to-end verification that the delegated provider covers both
  methods
status: Done
assignee: []
created_date: '2026-06-03 15:42'
updated_date: '2026-06-03 18:33'
labels:
  - authentik
  - plan
dependencies:
  - GLA-067
priority: medium
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the integration's value claim is that authentik covers both a passkey and a password behind the auth seam with no gateway change; this fixes what proves it end to end so the verification task has a clear target. Produces a verification design, not code. Grounded in docs/architecture/test-strategy.md (S-1, S-10) and docs/scenario-01-unified.html (Phase 6). Out of scope: the runtime.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The verification is specified to drive a full handoff whose edge step-up is satisfied by a passkey through the delegated provider, and another satisfied by a password.
- [x] #2 The seam invariant is specified as observable: the same gateway code path serves both the in-tree and the delegated provider, selected only by composition.
- [x] #3 The strength-gating is specified as observable end to end: a step requiring the stronger method admits the passkey run and rejects the password-only run.
- [x] #4 The verification covers the negative: a recipient the provider does not vouch for does not reach the capsule.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design artifact: docs/architecture/authentik-e2e-verification.md. The GLA-076 harness = the authentik analogue of the GLA-066 cold capstone: the SAME full handoff thread via createProvisioningBridge but wired with AuthAuthentikProvider + FakeAuthentik (the seam-table delta is ONE row; every other actor real). Passkey-run (amr swk->webauthn) + password-run (amr pwd->password) each reach the real capsule. AC#1 two full handoffs (passkey+password); AC#2 seam invariant observable (same harness under GLA_AUTH_PROVIDER=webauthn|authentik + the static no-authentik-in-packages/gateway check + byte-identical /handoff/auth/verify); AC#3 strength-gating E2E (webauthn-route admits passkey/refuses password->WS refused capsule-not-reached; password-route admits both); AC#4 negatives (un-enrolled/subject_mismatch/invalid-or-expired/forwarded-link all fail closed at the WS layer). HARNESS FACT: FakeAuthentik doubles the token endpoint+JWKS but NO /authorize server -> the harness intercepts the page redirect + synthesizes the callback (read state/nonce/redirect_uri from authorizeUrl, stageValidLogin(code,{sub,amr,nonce}), drive {code,state} into the unchanged verify route); thread nonce/sub from the real attempt (mirror auth-authentik.test.ts). IN-DEV (the substance, in pnpm gate): both methods reach the capsule via the delegated provider, the seam invariant, strength-gating, negatives fail-closed, agent-blind. DEPLOY-DEFERRED (per GLA-074 task-6 AC#8): the LIVE real-authentik round-trip (real passkey+password->real amr, real handoff on hermes-1) confirming the amr-emission config + same-origin redirect_uri/no-grant-leak that FakeAuthentik ASSUMES. Risks: composing FakeAuthentik with the real thread (nonce/sub binding), proving the seam invariant rigorously (not two divergent tests), asserting WS-refusal not just 403, cold/hermetic capsule reaping, negatives reaching the WS layer. Rule-3: bmad-create-architecture interactive-gated -> docs-first fallback. COMPLETES the authentik plan set (067/069/071/073/075).
<!-- SECTION:NOTES:END -->
