---
id: GLA-069
title: Plan recipient enrollment with a delegated identity provider
status: Done
assignee: []
created_date: '2026-06-03 15:41'
updated_date: '2026-06-03 17:10'
labels:
  - authentik
  - plan
dependencies:
  - GLA-067
priority: medium
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: today GLA owns enrollment (an operator-discharge grant registers a passkey GLA holds); with a delegated provider the credential lives in the provider, so enrollment must establish that a recipient can later be verified and bind GLA's recipient identity to the provider's subject, without weakening the verified-only-if-enrolled precondition or the single-public-entry rule. Produces design artifacts, not code. Grounded in docs/components/identity-and-auth.md and docs/components/access-gateway.md. Out of scope: implementing it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The enrollment contract for a delegated provider is specified: what establishes that a recipient can later be verified when the provider owns the credential.
- [x] #2 The binding between a channel recipient and the provider's stable subject is specified, so a later step-up resolves to the same recipient.
- [x] #3 The single-use operator-discharge grant's role is specified for the delegated case, so enrollment still cannot be initiated without it and the gateway remains the only public entry.
- [x] #4 The first-run experience is designed: how a not-yet-provisioned recipient reaches a verifiable state, and what such a recipient sees before then.
- [x] #5 The model preserves the invariant that a recipient is verifiable only after enrollment, and that enrollment is one-time and operator-initiated, never a per-handoff step.
- [x] #6 An implementation plan exists for the enrollment-build task, with how enrolled-versus-not is observable from outside.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design artifact: docs/architecture/authentik-enrollment.md (sub-doc of the master; AC-mapped in §0). CONTRACT (§2): enrollmentOptions->beginEnrollment (->authorize redirect, register attempt) -> one-time authentik login -> enrollComplete->finishEnrollment({code,state}) (validate id_token -> ATOMIC subjects.set(userId,{sub})) -> IdentityService records EnrollmentRecord (the enrolled fact). BINDING (§3, 3 layers): RecipientBinding recipient->userId | EnrollmentRecord userId->{credentialId:sub,...} (the FACT isEnrolled reads) | adapter subjects userId->{sub} (the cryptographic binding verifyAssertion's subject_mismatch checks). Two stores, distinct jobs. OPERATOR-DISCHARGE (§4): unchanged — gateway /enroll routes are provider-agnostic, tryConsumeEnrollmentGrantToken atomic verify+spend + unspend-on-failure; OIDC adds an authentik round-trip but NO second public entry (callback is adapter-owned behind same Caddy = GLA-072's). FIRST-RUN (§5): enrollInvite->channel->authentik->bound (isEnrolled true); un-enrolled denied at gateway(catchable refusal/auth.insufficient)+identity(throws)+adapter(challenge throws). INVARIANTS (§6): all preserved (verifiable-only-after-enrollment via subject binding; one-time+operator-initiated via same grant; never-a-handoff-step via distinct register vs authenticate attempt kinds; agent-blind). GLA-070 PLAN (§7): wire AuthAuthentikProvider into the enrollment composition (same IdentityService injection line); confirm enrollComplete records the sub-fact (service path is attestation-shape-agnostic); prove no-half-bind; deterministic E2E via fake-authentik. KEY DECISION/RISK (§8): the enrollComplete<->finishEnrollment {code,state} assertion needs the browser redirect+callback that GLA-072 owns -> 070 builds the SERVICE slice + tests (no browser), 072 owns the shared browser callback; 070's browser-enroll E2E lands on 072's callback. Backlog edge 070<-{068,069} not 070<-072 is acceptable (070's acceptance = service-layer observables). Do NOT edit the gateway to special-case OIDC (fixed core). Rule-3: bmad-create-architecture interactive-gated -> docs-first fallback (recorded in doc).
<!-- SECTION:NOTES:END -->
