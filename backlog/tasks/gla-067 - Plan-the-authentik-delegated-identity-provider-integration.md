---
id: GLA-067
title: Plan the authentik delegated-identity-provider integration
status: Done
assignee: []
created_date: '2026-06-03 15:40'
updated_date: '2026-06-03 16:02'
labels:
  - authentik
  - plan
dependencies:
  - GLA-002
priority: medium
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the MVP authenticates recipients with the in-tree WebAuthn provider behind the AuthProvider seam; a delegated identity provider (authentik) can cover both a phishing-resistant passkey and a typed-password fallback (and MFA) in one place, but it moves where credentials live and how a step-up is carried out. This task fixes the integration's shape so the implementation tasks conform to one design. Produces design artifacts, not code. Grounded in docs/components/identity-and-auth.md, docs/architecture/dependency-strategy.md, and docs/03-software-candidates.md §4. Out of scope: implementing the adapter, the enrollment change, the dual-method flow, or the installer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The integration is specified as a new auth provider that satisfies the existing AuthProvider seam, so selecting it changes no gateway or core code — only a new adapter and the composition that wires it.
- [x] #2 The step-up delegation is specified as a contract: the gateway hands the identity challenge to the external provider and receives back the same ok + auth-strength + resolved-identity fact the in-tree provider produces.
- [x] #3 The mapping from the provider's reported authentication method to GLA's auth-strength is specified, so a passkey result yields the strongest strength and a password result yields a lower one.
- [x] #4 The credential-authority shift is specified: with this provider the recipient's credential is held by the provider, and a recipient is bound to a stable provider subject rather than a GLA-held credential.
- [x] #5 The deployment boundary is specified — which parts are GLA runtime code versus an installer concern — and the provider service is named as a wpm-installer-package task in this backlog.
- [x] #6 The default-provider decision is specified: the in-tree provider stays the default and the delegated provider is opt-in, with the selection surface named.
- [x] #7 A build-order plan exists sequencing the adapter, the enrollment change, the dual-method flow, the installer, and the verification into a valid order.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design artifact: docs/architecture/authentik-integration.md (10 sections, AC-mapped in §0). DELEGATION = OIDC authorization-code + PKCE behind the UNCHANGED AuthProviderPort: challenge()->authorize redirect; adapter-owned callback re-POSTs {code,state} to the gateway's EXISTING /handoff/auth/verify as the opaque assertion (option i) so packages/gateway stays byte-for-byte unchanged (verified: gateway imports no concrete provider, calls injected IdentityStepUpPort only). verifyAssertion exchanges+validates id_token (iss/aud/JWKS/nonce/exp), checks sub==bound-subject, maps amr/acr->AuthStrength ({hwk,swk,webauthn,fido}->webauthn; {pwd}(+mfa)->password; never up-map). Credential authority -> authentik; recipient bound to stable sub carried by existing UserIdentity.enrolledCredentialId / EnrollmentRecord.credentialId (NO kernel change). Selection surface = GLA_AUTH_PROVIDER (default webauthn; opt-in authentik) at packages/app composition root (today hardcoded new AuthWebauthnProvider at index.ts:326/623) + GLA_AUTHENTIK_{ISSUER_URL,CLIENT_ID,CLIENT_SECRET[sensitive],REDIRECT_URI}. Installer concern = GLA-074 (extends wpm/bundles/identity-provider to stand authentik server+worker+Postgres+Redis up + flow/stages emitting amr/acr + DependencyBinding). Build order 068->070->072->074->076, each preceded by 069/071/073/075. Rule-3: bmad-create-architecture attempted (Winston) but step-01-init is hard-gated interactive ('NEVER generate content without user input') -> cannot run unattended -> docs-first fallback, recorded in the doc's Rule-3 note. Open risks (doc §9): redirect-vs-same-page tension (GLA-072 must keep page-completion provider-agnostic, else surface as scope), amr/acr fidelity (GLA-073/074 flow config), sub stability, callback edge routing via host Caddy, client-secret via secret seam, down-provider fail-closed.
<!-- SECTION:NOTES:END -->
