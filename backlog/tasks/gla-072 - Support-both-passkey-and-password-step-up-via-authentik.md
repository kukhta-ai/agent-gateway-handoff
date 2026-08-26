---
id: GLA-072
title: Support both passkey and password step-up via authentik
status: Done
assignee: []
created_date: '2026-06-03 15:41'
updated_date: '2026-06-03 17:57'
labels:
  - authentik
  - impl
dependencies:
  - GLA-068
  - GLA-071
priority: medium
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the dual-method capability — the whole point of the delegated provider — so a recipient can authenticate with a passkey or, lacking one, a password, and the gateway gates by required strength. Builds the step designed in its plan. Depends on the adapter and the flow plan. Out of scope: the installer standup (GLA-074).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A recipient completes a step-up with a passkey, and the result carries the strongest auth-strength.
- [x] #2 A recipient with no passkey completes a step-up with a password, and the result carries the password-level auth-strength.
- [x] #3 A step that requires the stronger method admits the passkey result and rejects the password-only result.
- [x] #4 A wrong password or otherwise failed assertion is refused with a typed reason and admits no one.
- [x] #5 Which method a recipient used is reported as part of the auth fact, so an enforcement point can branch on it.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the dual-method step-up. GATEWAY PAGES generalized PROVIDER-AGNOSTICALLY (the sanctioned one-time refinement from GLA-071 §5): handoff-page.ts + enroll-page.ts branch on the opaque options' shape — if options.kind===redirect -> stash {grant,path} in SAME-ORIGIN sessionStorage + location.assign(options.authorizeUrl); on a later load carrying ?code&state -> restore grant from sessionStorage + POST {code,state} to the UNCHANGED /handoff/auth/verify (resp /enroll/verify) as the opaque assertion; else -> the existing in-page credentials.get/create UNCHANGED. Realization = approach (a): redirect_uri is operator-config, the page completes on return; NO new public listener (the redirect_uri landing + Caddy route = GLA-074; the full browser round-trip E2E = GLA-076). CENTRAL GATE HELD: ZERO provider/OIDC LOGIC in packages/gateway (a static grep test enforces it in CI: no authentik/issuer/amr/acr/jwks/id_token/... string; the discriminant is a generic options.kind; WebAuthn flows the else arm unchanged). /handoff/auth/verify handler BYTE-FOR-BYTE unchanged; only /enroll/verify response changed (echoes the recorded strength via readEnrolledStrength, fixing the GLA-070-carried hardcode). DEEP SECURITY REVIEW (separate lane, opus, 7 adversarial probes): PASS, delta clean — provider-agnostic gate held, verify-path-unchanged, strength gating undowngradeable incl. via auth-reuse (recordRecipientAuth only after the gate, recipientAuthValid re-applies strengthSufficient), return-detection CSRF/forced-login CLOSED (forged code/state->403; attacker-sub->subject_mismatch->403; replay->one-time-state 403; cross-flow->wrong_attempt_kind 403), sessionStorage same-origin/cleared-before-POST/grant-never-sent-to-authentik/distinct-keys-per-flow, NO open-redirect (location.assign only to server-built authorizeUrl), NO reflected XSS, fail-closed. 1 NICE applied: readEnrolledStrength fallback flipped webauthn->none (fail-to-WEAKEST on an auth surface; +made the gateway.test.ts stub faithful by returning authStrength). AC#1 passkey amr->webauthn->authorized; AC#2 password amr->password->authorized where permitted; AC#3 webauthn-route rejects password (403 auth.insufficient, grant unauthorized, WS refused) admits passkey; AC#4 nonce/subject-mismatch->{ok:false} typed reason->403, nothing authorized; AC#5 auth_strength carries the method (webauthn vs password). Gate: tsc+biome clean, vitest 542 passed|12 skipped (+14); only full-suite failure = the known capstone browser-E2E flake under parallelism (passes ISOLATED 3.0s; default-webauthn path; not a regression). Rule-3: bmad-dev-story interactive-gated -> direct TS impl.
<!-- SECTION:NOTES:END -->
