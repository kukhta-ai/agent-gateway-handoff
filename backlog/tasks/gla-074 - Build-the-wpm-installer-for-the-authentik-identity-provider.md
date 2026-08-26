---
id: GLA-074
title: Build the wpm installer for the authentik identity provider
status: Done
assignee: []
created_date: '2026-06-03 15:42'
updated_date: '2026-06-03 19:44'
labels:
  - authentik
  - impl
dependencies:
  - GLA-073
  - GLA-068
priority: medium
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a delegated provider only works once its service is stood up and configured on the operator host; this extends the identity-provider wpm bundle to stand authentik up and configure it when that provider is selected. Builds the standup designed in its plan. Depends on the standup plan and the adapter it verifies against. Out of scope: the runtime adapter code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A wpm installer package stands the provider up on the host and is the unit that gets built, not an inline install.
- [x] #2 The package detects an existing usable provider before changing anything and leaves an adequate one unchanged, recorded as adopted.
- [x] #3 On completion the provider answers, a relying-party application for GLA exists, and a flow offering a passkey and a password is configured.
- [x] #4 The package records a verifiable receipt of what it changed and is idempotent on re-run.
- [x] #5 A host where the provider cannot be installed surfaces a clear, catchable failure rather than a partial state.
- [x] #6 With the delegated provider not selected, installing GLA requires none of this package.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RE-OPEN HARDENING (real-authentik rehearsal, 2026-06-03): the bundle was operationally incomplete; 3 gaps fixed + verified against LIVE authentik 2025.10.4. (1) The amr property-mapping recipe (AC#3 distinguishing-amr) was MISSING, and the naive request.context auth_method is EMPTY on 2025.10 (= why amr defaulted to []). Captured the PROVEN live expression (payload/templates/amr-scope-mapping.py + .md): a scope-mapping reading the user latest LOGIN Event context auth_method (authentik.events.models.Event) -> password to [pwd], webauthn/fido/passkey to [swk]; BYTE-MATCHES the live gla-amr-claim mapping that produced a real amr [pwd]; matches the adapter DEFAULT_METHOD_MAPS (no override, no adapter change). Referenced as REQUIRED in identity-provider-5 + the authentik-standup skill + oidc-app-and-flow.outcomes.md. (2) Added a first-boot bootstrap seam (AUTHENTIK_BOOTSTRAP_PASSWORD/_TOKEN, env-sourced with empty default, on server+worker) so the installer configures unattended; docker compose config passes. (3) Comment fix: the header no longer contains literal section-marker tokens a mustache renderer would strip. identity-provider-6 carries the rehearsal evidence; AC#8 honest-deferral for the passkey->webauthn real round-trip preserved (same amr expression covers it; needs authentik passwordless-flow config at deploy). wpm project validate clean; build dry-run ships the 2 new templates; pnpm gate unaffected. The amr expression is authentik-VERSION-specific -> the verify step re-confirms it against the target version (already mandated).
<!-- SECTION:NOTES:END -->
