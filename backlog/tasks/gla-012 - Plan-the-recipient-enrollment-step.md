---
id: GLA-012
title: Plan the recipient-enrollment step
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 10:03'
labels:
  - plan
  - architecture
  - row
  - enrollment
dependencies:
  - GLA-002
documentation:
  - docs/components/identity-and-auth.md
  - docs/components/access-gateway.md
  - docs/components/capability-service.md
priority: medium
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: every handoff assumes the recipient is already registered; this one-time, operator-run step establishes the credential and the recipient-identity binding before any handoff. Produces architecture and the build plan; no production code. Use the architect skills and research WebAuthn registration and invite flows on the internet. Depends on the contracts plan. Out of scope: implementing the step; the per-handoff verification, which is the auth step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Identity and Auth's part is specified: how a credential is registered and stored bound to a recipient identity, establishing the initial auth strength, as a contract.
- [x] #2 The Access Gateway's part is specified: how it fronts enrollment and admits the flow only on a verified single-use enrollment grant, so no public path bypasses grant verification.
- [x] #3 The Capability service's part is specified: a single-use operator-discharge enrollment grant bound to the recipient, distinct from a handoff grant.
- [x] #4 The Channel adapter's part is specified: how the enrollment invite reaches exactly the intended recipient.
- [x] #5 The enrollment user experience is designed end to end: the invite, first-time registration, what the user sees on failure, and how recovery or re-enrollment is handled.
- [x] #6 An implementation plan for the build task exists, with how enrolled-versus-not is observed from outside.
- [x] #7 Dependencies are identified and classified; the identity provider is named, and any non-traditional one has a wpm-installer-package task in this backlog.
- [x] #8 The enrollment seam is specified at full capability so a different identity provider is added against it with no core change.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: docs/architecture/slice-4a-enrollment.md. Identity+Auth credential registration+storage+auth_strength as a contract; the gateway fronts enrollment, admitting only on a verified single-use grant (no public path bypasses grant verification); single-use operator-discharge grant distinct from a handoff grant; channel invite to exactly the intended recipient; enrollment UX end-to-end (invite -> first-time registration -> failure -> recovery/re-enrollment); build/observation plan (enrolled-vs-not observed from outside); deps named (in-tree WebAuthn default; authentik alt -> wpm GLA-011); enrollment seam full-capability (different IdP, no core change). Rule-3 docs-driven fallback. Implemented+tested in GLA-013.
<!-- SECTION:NOTES:END -->
