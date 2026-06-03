---
id: GLA-069
title: Plan recipient enrollment with a delegated identity provider
status: To Do
assignee: []
created_date: '2026-06-03 15:41'
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
- [ ] #1 The enrollment contract for a delegated provider is specified: what establishes that a recipient can later be verified when the provider owns the credential.
- [ ] #2 The binding between a channel recipient and the provider's stable subject is specified, so a later step-up resolves to the same recipient.
- [ ] #3 The single-use operator-discharge grant's role is specified for the delegated case, so enrollment still cannot be initiated without it and the gateway remains the only public entry.
- [ ] #4 The first-run experience is designed: how a not-yet-provisioned recipient reaches a verifiable state, and what such a recipient sees before then.
- [ ] #5 The model preserves the invariant that a recipient is verifiable only after enrollment, and that enrollment is one-time and operator-initiated, never a per-handoff step.
- [ ] #6 An implementation plan exists for the enrollment-build task, with how enrolled-versus-not is observable from outside.
<!-- AC:END -->
