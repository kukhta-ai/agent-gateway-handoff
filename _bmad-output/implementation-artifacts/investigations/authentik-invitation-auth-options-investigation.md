# Investigation: Authentik Invitation Auth Options for GLA-085

## Hand-off Brief

1. **What happened.** The user asked whether an authentik-invited recipient can set up several authentication options, whether the operator preselects them, and what GLA-085 should require.
2. **Where the case stands.** Concluded: authentik supports multiple setup/validation options, but the operator controls which stages/sources are present; the recipient can only choose among configured options.
3. **What's needed next.** Update GLA-085 so invitation enrollment explicitly covers operator-selected methods, recipient choice among configured options, and the GLA strength model boundary.

## Case Info

| Field | Value |
| --- | --- |
| Ticket | GLA-085 |
| Date opened | 2026-06-12 |
| Status | Concluded |
| System | Local repo plus current authentik docs |
| Evidence sources | `docs/architecture/authentik-enrollment.md`, `docs/architecture/authentik-service-standup.md`, authentik docs |

## Problem Statement

For invitation-based authentik recipient enrollment, determine whether the invited user can set up several auth options, whether the operator chooses those options, which options are realistic for GLA to offer, and what requirements should be added to GLA-085.

## Evidence Inventory

| Source | Status | Notes |
| --- | --- | --- |
| GLA authentik enrollment docs | Available | GLA records a stable authentik `sub`; authentik owns credentials. |
| GLA authentik standup docs | Available | Existing plan expects passkey and password flow plus `amr`/`acr` mapping. |
| authentik invitation docs | Available | Invitation-gated enrollment flows are operator-built from stages. |
| authentik flow/stage docs | Available | Stages, policies, setup stages, and sources determine visible options. |

## Confirmed Findings

### Finding 1: GLA delegated enrollment records a subject, not credentials.

**Evidence:** `docs/architecture/authentik-enrollment.md:47`, `docs/architecture/authentik-enrollment.md:49`, `docs/architecture/authentik-enrollment.md:50`

**Detail:** Under authentik, credentials live in authentik; GLA records only the stable OIDC subject that future step-up checks match.

### Finding 2: Authentik invitation enrollment is flow/stage-defined by the operator.

**Evidence:** authentik Invitations docs: an invitation flow is configured with an Invitation stage, Enrollment designation, and then explicitly bound stages such as Prompt, User Write, and User Login.

**Detail:** The invitation token gates entry, but the actual credential/account setup is whatever stages the operator put in that enrollment flow.

### Finding 3: Authentik can create users during enrollment.

**Evidence:** authentik User Write docs: the User Write stage updates a pending user or creates a new one when configured to do so.

**Detail:** This supports a recipient-owned first-run path instead of an operator-created password account.

### Finding 4: Authentik supports several authenticator setup stages.

**Evidence:** authentik Authenticator Validation docs list setup sources for Duo, Email, SMS, Static, TOTP, and WebAuthn; separate docs confirm WebAuthn/passkey, TOTP, email OTP, SMS OTP, and static backup-code setup stages.

**Detail:** Multiple methods are possible, but each must be present in the flow or available through user-settings/configuration flows.

### Finding 5: Recipient choice exists only inside operator-configured bounds.

**Evidence:** authentik Authenticator Validation docs state that if multiple configuration stages are selected on one validation stage, users can choose which authenticator to enroll for that requirement.

**Detail:** The operator picks allowed/required device classes and configuration stages. The user can choose among those, not invent unsupported methods.

### Finding 6: Passkey/WebAuthn is the only authentik method that should satisfy GLA `webauthn` strength.

**Evidence:** `docs/architecture/authentik-dual-method-flow.md:91`, `docs/architecture/authentik-dual-method-flow.md:97`, `docs/architecture/authentik-dual-method-flow.md:98`, `docs/architecture/authentik-dual-method-flow.md:104`

**Detail:** Password maps to `password`, passkey/WebAuthn maps to `webauthn`, and ambiguous method facts must never up-map.

## Deduced Conclusions

### Deduction 1: GLA-085 must not promise arbitrary user-selected auth methods.

**Based on:** Findings 2 and 5.

**Reasoning:** Since the authentik enrollment flow is assembled from operator-configured stages, the product contract should say the operator selects the offered/required methods, and the recipient chooses only among configured choices.

**Conclusion:** GLA-085 should require operator-visible enrollment profiles/options rather than open-ended user choice.

### Deduction 2: The useful GLA offer is a constrained set, not the whole authentik catalog.

**Based on:** Findings 4 and 6.

**Reasoning:** Authentik has many factors, but GLA currently gates only `none < password < webauthn`. Therefore GLA should first support password, passkey/WebAuthn, and external-source subject binding; TOTP/email/SMS/static are useful MFA/recovery under authentik but should not change GLA's `webauthn` strength unless authentik reports a WebAuthn/passkey method.

**Conclusion:** GLA-085 should require documentation/verification for supported enrollment outcomes and explicitly keep the strength boundary.

## Conclusion

**Confidence:** High

Authentik supports invitation-gated enrollment and multiple authenticator setup methods, but the operator controls which methods are available by configuring flows, stages, sources, policies, and validation stages. For GLA, the practical requirement is to offer clear operator-selected enrollment profiles that can produce password, passkey/WebAuthn, or external-source subject bindings, while preserving GLA's strength mapping and never treating generic MFA/password as `webauthn`.

## Recommended Next Steps

### Fix direction

Update GLA-085 with acceptance criteria that require:

- operator-controlled enrollment method policy;
- recipient choice only among configured options;
- password and WebAuthn/passkey setup outcomes;
- external OAuth/SAML source binding when configured;
- MFA/recovery methods documented as authentik-owned factors that do not widen GLA's strength model.

### Diagnostic

For implementation, verify the live authentik GLA application reports:

- the configured invitation enrollment flow;
- the selected prompt/user-write/authenticator/source stages;
- whether WebAuthn/passkey setup is configured;
- whether password setup is configured;
- whether selected OAuth/SAML sources are configured;
- whether `amr`/`acr` distinguishes later login methods.

## Source References

- `docs/architecture/authentik-enrollment.md`
- `docs/architecture/authentik-service-standup.md`
- `docs/architecture/authentik-dual-method-flow.md`
- https://docs.goauthentik.io/users-sources/user/invitations/
- https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/user_write/
- https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_validate/
- https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_webauthn/
- https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_totp/
- https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_email/
- https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_sms/
- https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_static/
- https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/identification/
- https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/source/
