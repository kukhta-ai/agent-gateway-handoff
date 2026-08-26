---
id: GLA-071
title: Plan the passkey-and-password authentication flow
status: Done
assignee: []
created_date: '2026-06-03 15:41'
updated_date: '2026-06-03 17:30'
labels:
  - authentik
  - plan
dependencies:
  - GLA-067
priority: medium
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the reason to adopt the delegated provider is to offer both a phishing-resistant passkey and a typed-password fallback at a lower strength, and let policy decide which suffices where. This fixes the dual-method flow and the strength-gating contract so a step can demand the stronger method. Produces design artifacts, not code. Grounded in docs/components/identity-and-auth.md (auth_strength) and docs/01-architecture-overview.md §6. Out of scope: implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The authentication flow is specified to offer the recipient a passkey and a password fallback, such that either can satisfy a step-up.
- [x] #2 The auth-strength each method yields is specified, with the passkey ranked stronger than the password.
- [x] #3 The strength-gating contract is specified: an enforcement point can require a minimum strength, so a step demanding the stronger method rejects a password-only result.
- [x] #4 The recipient experience is designed for choosing a method, for a recipient with no passkey, and for a failed attempt.
- [x] #5 An implementation plan exists, with how both-methods-independently-satisfy-a-step-up and a-too-weak-result-is-rejected-where-a-stronger-one-is-required are observed.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design artifact: docs/architecture/authentik-dual-method-flow.md (AC-mapped in §0). DUAL-METHOD (§2): both passkey+password are HOSTED BY authentik; GLA always REDIRECTS to authentik's flow -> human chooses -> id_token.amr names the method -> GLA reads strength + gates. Either method independently satisfies a step-up; the gateway only ever sees {ok,authStrength}, never the method. STRENGTH (§3): passkey {hwk,swk,webauthn,fido}->webauthn; password {pwd}(+mfa)->password; valid-unresolvable->password floor; never up-map; order none<password<webauthn. GATING (§4): the EXISTING gateway mechanism UNCHANGED — requiredAuthStrength (default webauthn, set at packages/app composition) + strengthSufficient (rank 0/1/2); a password-only result -> 403 auth.insufficient, grant NOT in authorizedGrants, WS upgrade refused; passkey -> authorized. Provider-agnostic (reads only the AuthStrength fact). FINALIZED PAGE MECHANISM (§5, the load-bearing decision): option (i) + minimal generic (ii). GLA-072 touches EXACTLY: handoff-page.ts + enroll-page.ts (a GENERIC branch on the opaque options' shape: if kind===redirect -> location.assign(authorizeUrl); else the existing in-page credentials.{get,create}) — provider-agnostic, WebAuthn flows the else arm, NO 'authentik'/issuer/method string in packages/gateway; + an adapter-owned callback (in @gla/auth-authentik + packages/app, behind same Caddy, NOT a gateway route, NOT the bridge) that re-POSTs {code,state} to the UNCHANGED /handoff/auth/verify and /enroll/verify as the opaque assertion; + the /enroll/verify strength-echo fix (index.ts:592, carried from GLA-070; :752 handoff response already correct). The verify path is byte-for-byte unchanged (already takes opaque assertion). FRAMING (§5.4): this edits 2 gateway PAGE files -> 'selecting authentik changes no gateway code' holds only AFTER a one-time provider-agnostic generalization, SANCTIONED (the page is realization, not fixed core); the 072 security review MUST verify the branch is genuinely generic (else stop-and-surface). Security invariants preserved (§5.3): sole public entry, grant-verify-every-request, SSRF-closed WS proxy, agent-blind, recipient-binding all untouched. 072 REVIEW RISK SET (§8): provider-agnostic branch [central gate], verify-path-empty-diff, open-redirect-closed (authorizeUrl from operator config + fixed redirectUri, no request param influences target), state/nonce/PKCE binding across redirect, the callback as a NEW public surface, reuse honors requirement on 2nd window, amr fidelity/never-up-map. Rule-3: bmad-create-architecture interactive-gated -> docs-first fallback (recorded in doc).
<!-- SECTION:NOTES:END -->
