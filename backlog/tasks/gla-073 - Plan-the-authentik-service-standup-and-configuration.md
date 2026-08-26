---
id: GLA-073
title: Plan the authentik service standup and configuration
status: Done
assignee: []
created_date: '2026-06-03 15:41'
updated_date: '2026-06-03 18:06'
labels:
  - authentik
  - plan
dependencies:
  - GLA-067
priority: medium
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the delegated provider is an external service (an identity-provider server plus its datastores) that must be stood up and configured (a relying-party application GLA authenticates against, and a passkey-or-password flow) on the operator host; this slots into the existing identity-provider wpm bundle as its authentik alternative. Produces design artifacts and the bundle plan, not code. Grounded in docs/01-architecture-overview.md §7-§8 and docs/architecture/dependency-strategy.md. Out of scope: the runtime adapter.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The provider's host footprint is enumerated (the service and its datastores) and classified by ownership mode for the reference profile.
- [x] #2 The configuration the integration needs is specified as outcomes: a relying-party application GLA authenticates against, and a flow offering a passkey and a password.
- [x] #3 The standup is specified to live in a wpm installer package that detects an existing provider before changing anything, records a receipt, and is idempotent on re-run.
- [x] #4 The configuration ties the provider's relying-party identity to the operator's public URL, so the provider and GLA agree on the same origin.
- [x] #5 The standup is specified so the in-tree default needs none of it, and the provider is only required when the delegated provider is selected.
- [x] #6 An implementation plan exists for the installer-build task, with how the-provider-answers-and-the-relying-party-application-and-flow-exist is observed.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design artifact: docs/architecture/authentik-service-standup.md (AC-mapped in §0). LOAD-BEARING DEPLOYMENT DECISION (§1): nested Docker in hermes-1 has BROKEN overlayfs storage (same constraint that forced the process-tier launcher) + authentik is a multi-container Compose stack needing working Docker -> Managed-compose-IN-container is NON-VIABLE in the hermes-1 reference. Reference = LOCAL-EXTERNAL: authentik runs at the VPS-HOST level (outside hermes-1, where Docker/LXD work, beside the host Caddy), GLA-in-hermes-1 reaches it over the LXD/host network via OIDC; the bundle ADOPTS (guide+verify) rather than installs-in-container. Remote-External = clean alternative; Managed-in-container only where nested Docker works (non-reference). FOOTPRINT (§2): server+worker+PostgreSQL[+Redis], one GLA identity-provider Dependency (GLA dials only A1's OIDC endpoints); NOTE authentik 2025.10 REMOVED Redis (version-branch the stack). CONFIG OUTCOMES (§3): OIDC RP app (confidential client id/secret, redirect URI, issuer, claims-in-id_token) — endpoints CONFIRMED to match the adapter oidc.ts discovery exactly; an auth flow offering passkey AND password EMITTING a distinguishing amr/acr via a custom property mapping (passkey->{hwk,swk,webauthn,fido}, password->{pwd}, feeding strength.ts); stable IMMUTABLE sub (subject mode = UUID/hashed-id). WPM PACKAGE (§4): the authentik branch of the existing identity-provider bundle, detect-before-change, records a DependencyBinding (issuer/clientId/redirectUri/ownershipMode/installed/inverseOp; clientSecret as a secret-ref NOT in the receipt), idempotent detect->setup->verify->record; availability system-derived (down authentik -> unavailable -> fail closed). PUBLIC-URL TIE (§5): redirect_uri served by GLA on GLA's OWN origin (same-origin so sessionStorage/state work; the GLA grant NEVER reaches authentik); issuer/iss agree with GLA_AUTHENTIK_ISSUER_URL; all agree with GLA_PUBLIC_BASE_URL. DEFAULT (§6): entirely gated on GLA_AUTH_PROVIDER=authentik; the in-tree WebAuthn default needs NONE of A1-A4 (just sets GLA_RP_ID). GLA-074 PLAN (§7): extend detect->setup(guide+verify host standup/adopt for Local-External; connection-only for Remote; Compose-up+inverseOp for Managed where Docker works)->wire same-origin callback->verify(probe-driven)->record binding. OBSERVABILITY: discovery doc 200 + token/JWKS answer; /authorize accepts GLA's client+redirect; E2E passkey->webauthn / password->password (FakeAuthentik for the deterministic layer); enroll->reauth same sub; GLA doctor reads binding available. RISKS (§8): where-it-runs (don't attempt Managed-in-container where nested Docker broken -> guided pause), amr emission (VERIFY against the running instance + tune GLA_AUTHENTIK_AMR_MAP; safe-degrade to password-only never up-map), Redis version drift, stable-sub, client-secret-as-secret-ref, redirect_uri/no-grant-leak, LXD/host-network reachability (record a container-resolvable issuer addr), heavyweight footprint lands on host. Rule-3: bmad-create-architecture interactive-gated -> docs-first fallback (recorded). Grounded in authentik's real docs (Sources listed).
<!-- SECTION:NOTES:END -->
