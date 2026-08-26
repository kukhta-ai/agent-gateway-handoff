---
id: GLA-068
title: Integrate authentik as a delegated auth provider
status: Done
assignee: []
created_date: '2026-06-03 15:41'
updated_date: '2026-06-03 17:04'
labels:
  - authentik
  - impl
dependencies:
  - GLA-067
priority: medium
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: with the integration shape fixed (GLA-067), this builds the provider adapter (today a stub) so the gateway's edge step-up is carried out by authentik behind the AuthProvider seam, returning the verified result as GLA's standard auth fact. Depends on the integration plan. Out of scope: the enrollment change (GLA-070), the dual-method flow content (GLA-072), and the installer standup (GLA-074).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new auth provider satisfies the existing AuthProvider seam; the gateway and core packages import only the port, so selecting it changes no gateway or core code.
- [x] #2 A recipient step-up is carried out against the external provider and, on success, the provider returns a verified identity and an auth-strength fact in the same shape the in-tree provider returns.
- [x] #3 A result the provider does not vouch for — an invalid, expired, or not-for-this-relying-party assertion — is rejected as a not-ok result with a typed reason, and no identity or strength is asserted.
- [x] #4 The verified identity resolves to a stable subject that the same recipient reproduces on a later step-up.
- [x] #5 The provider's reported authentication method is mapped to GLA's auth-strength, distinguishing a passkey result from a password result.
- [x] #6 With the delegated provider unselected, the existing in-tree provider path is unchanged.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built @gla/auth-authentik: an OIDC authorization-code+PKCE relying-party adapter implementing the UNCHANGED AuthProviderPort (challenge->authorize redirect {kind:redirect,authorizeUrl}; verifyAssertion({code,state})->exchange+validate id_token->{ok,authStrength}). Modules: oidc.ts (PKCE/S256, authorize-URL, discovery, token exchange, id_token validation), strength.ts (amr/acr->AuthStrength), stores.ts (injectable subjects userId->sub + attempts state->pending, like auth-webauthn), index.ts (AuthAuthentikProvider), fake-authentik.ts (controllable OIDC test double). Dep: jose@6.2.3 (pnpm add). Selection surface wired in packages/app: GLA_AUTH_PROVIDER (default webauthn; opt-in authentik) + GLA_AUTHENTIK_{ISSUER_URL,CLIENT_ID,CLIENT_SECRET,REDIRECT_URI,SCOPES} in daemon.ts; branched in createProvisioningBridge/createEnrollmentStack via buildAuthProvider; both impl AuthProviderPort so the IdentityService injection is identical. Gateway+kernel BYTE-FOR-BYTE untouched (AC#1/#6, structural test + import-boundary lint). verifyAssertion checks in order: state one-time-claim (delete-on-claim) -> userId match -> kind -> TTL -> token exchange -> id_token (JWKS sig pinned ES256/RS256, iss, aud, azp-for-multi-aud, exp/nbf/iat+-skew, nonce, sub present) -> sub==bound.sub -> strength; each failure a typed AuthFailReason, all {ok:false,authStrength:none}, nothing bound. SECURITY REVIEW (separate lane, opus, adversarial w/ passing probes): PASS-WITH-FIXES, NO bypass/fail-open/secret-leak; confirmed solid: alg-confusion/attacker-key/attacker-iss-SSRF/cross-attempt-nonce/strength-inflation all defeated. 3 fixes applied + regression-tested (cycle 1): (1) azp_mismatch guard for multi-aud id_tokens [OIDC Core 3.1.3.7], (2) one-time-use TOCTOU closed via delete-on-claim before the network round-trip [concurrent verify -> exactly 1 ok], (3) algorithms pinned ES256/RS256 + JOSENotSupported/JOSEAlgNotAllowed->bad_signature. Rule-3: bmad-dev-story interactive/sprint-gated -> direct TS impl (recorded). DEFERRED (behind the adapter, noted in code): browser callback-listener+step-up-page redirect+dual-method UX->GLA-072; enrollment subject-linking on identity-service->GLA-070; authentik standup+flow/stages emitting amr/acr->GLA-074. GATE: tsc -b clean, biome clean (169 files), vitest 509 passed|12 skipped (adapter 66, app wiring 15). KNOWN ENV FLAKE (not a regression, pre-existing): the GLA-066 cold-capstone browser E2E (DEFAULT webauthn path) times out under full-suite parallel browser contention (CPU starvation expires a short-TTL handoff grant) but passes ISOLATED in ~3s; a test-infra parallelism concern to revisit at the epic gate, not a code defect.
<!-- SECTION:NOTES:END -->
