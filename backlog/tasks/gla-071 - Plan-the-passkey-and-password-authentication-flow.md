---
id: GLA-071
title: Plan the passkey-and-password authentication flow
status: To Do
assignee: []
created_date: '2026-06-03 15:41'
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
- [ ] #1 The authentication flow is specified to offer the recipient a passkey and a password fallback, such that either can satisfy a step-up.
- [ ] #2 The auth-strength each method yields is specified, with the passkey ranked stronger than the password.
- [ ] #3 The strength-gating contract is specified: an enforcement point can require a minimum strength, so a step demanding the stronger method rejects a password-only result.
- [ ] #4 The recipient experience is designed for choosing a method, for a recipient with no passkey, and for a failed attempt.
- [ ] #5 An implementation plan exists, with how both-methods-independently-satisfy-a-step-up and a-too-weak-result-is-rejected-where-a-stronger-one-is-required are observed.
<!-- AC:END -->
