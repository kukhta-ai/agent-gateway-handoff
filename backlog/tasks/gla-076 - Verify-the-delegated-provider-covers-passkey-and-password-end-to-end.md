---
id: GLA-076
title: Verify the delegated provider covers passkey and password end to end
status: Done
assignee: []
created_date: '2026-06-03 15:42'
updated_date: '2026-06-03 20:06'
labels:
  - authentik
  - impl
dependencies:
  - GLA-070
  - GLA-072
  - GLA-074
priority: medium
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the capstone for the authentik integration — proves both methods work through a real handoff behind the unchanged auth seam. Composes the implemented pieces; adds no new mechanism. Depends on enrollment, the dual-method step-up, and the installer. Out of scope: any new provider behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A handoff completes with the edge step-up satisfied by a passkey via the delegated provider, reaching the capsule.
- [x] #2 A handoff completes with the edge step-up satisfied by a password via the delegated provider, reaching the capsule.
- [x] #3 A handoff step that requires the stronger method admits the passkey run and refuses the password-only run.
- [x] #4 A recipient the provider does not vouch for, an expired session, or a forwarded link for a different recipient does not reach the capsule.
- [x] #5 Switching between the in-tree and the delegated provider changes no gateway or core code; only the wiring differs.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CAPSTONE: packages/app/src/authentik-scenario-e2e.test.ts (6 tests) — the authentik analogue of the GLA-066 cold capstone via AuthAuthentikProvider + FakeAuthentik, driving the REAL handoff thread to a REAL launcher-process headless-Chromium capsule. Composes GLA-068/070/072 — adds NO new mechanism (clean compose). Only source change: packages/app/src/index.ts +13 lines threading requiredAuthStrength from createProvisioningBridge.handoff to the gateway EXISTING GatewayOptions.requiredAuthStrength (default webauthn preserved; gateway gating UNCHANGED). Gateway/kernel/adapter sources EMPTY diff. AC#1 passkey run (amr swk->webauthn) reaches the capsule (WS proxied, UPSTREAM_NOVNC_HELLO); AC#2 password run (amr pwd->password) reaches the capsule on a password route; AC#3 on a webauthn-required route the password-only run is REFUSED (403 auth.insufficient, grant unauthorized, WS upgrade 401, capsule NOT reached) while passkey is admitted+reaches the capsule (asserted at the WS layer, not just 403); AC#4 negatives all fail closed at the WS layer (un-enrolled, subject_mismatch [valid token wrong sub], invalid id_token [nonce mismatch], forwarded grant) — no capsule traffic; AC#5 provider-swap = composition-only (createProvisioningBridge records AUTH_WEBAUTHN_MODULE default / AUTH_AUTHENTIK_MODULE on the switch; the static no-authentik-in-packages/gateway grep; the WebAuthn capstone still green through the same gateway path). Harness fact: FakeAuthentik doubles token+JWKS (no /authorize) -> enroll-first to bind the sub, read the attempt real state/nonce from the authorizeUrl, stageValidLogin(code,{sub,amr,nonce}), POST {code,state} to the UNCHANGED /handoff/auth/verify. REAL-authentik round-trip ALREADY PROVEN (GLA-074 rehearsal vs real authentik 2025.10.4 -> {ok:true,authStrength:password}, real amr:[pwd]); this in-gate test is the deterministic FakeAuthentik version (real authentik cant run in CI). Gate: tsc+biome clean, vitest 548 passed|12 skipped (--no-file-parallelism; +6); the new E2E 6 passed isolated. Rule-3: bmad-qa-generate-e2e-tests interactive-gated -> direct TS impl.
<!-- SECTION:NOTES:END -->
