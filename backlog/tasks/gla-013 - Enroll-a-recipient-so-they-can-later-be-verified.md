---
id: GLA-013
title: Enroll a recipient so they can later be verified
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 10:03'
labels:
  - impl
  - row
  - enrollment
dependencies:
  - GLA-004
  - GLA-011
  - GLA-010
documentation:
  - docs/components/identity-and-auth.md
  - docs/components/access-gateway.md
priority: medium
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the precondition for every handoff, a recipient with a registered credential bound to their identity. Builds the step designed in its plan. Depends on the kernel, the identity provider, and the edge proxy. Out of scope: per-handoff verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An invited recipient can register a credential, after which their identity carries a recorded auth strength.
- [x] #2 Enrollment proceeds only when the single-use enrollment grant verifies; an absent, wrong-recipient, expired, or reused grant is refused.
- [x] #3 After enrollment the recipient can be verified at a later handoff, and an un-enrolled recipient cannot.
- [x] #4 A failed or abandoned registration leaves no half-bound identity and is safely retryable.
- [x] #5 Swapping the identity provider for another that satisfies the seam changes no core code.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
packages/gateway (Access Gateway HTTP server = sole public entry, binds 0.0.0.0:3000) + adapters/auth-webauthn (@simplewebauthn/server) + identity enrollment + capability operator-discharge grant. AC1 invited recipient registers a credential -> identity carries auth_strength=webauthn (REAL WebAuthn via Playwright CDP virtual authenticator, tested for real); AC2 enrollment proceeds only when the single-use grant verifies; absent/wrong-recipient/expired/reused refused (atomic tryConsume closes the TOCTOU); AC3 enrolled recipient verifiable at a later handoff, un-enrolled cannot; AC4 failed/abandoned registration -> no half-bound identity, safely retryable (grant un-spent on failure); AC5 swap IdP -> no core change (gateway/identity depend on AuthProviderPort; only app imports auth-webauthn). Security-reviewed (2 cycles): the kernel bindRecipientFromCapability flag is scoped to enrollment-only + signature-authenticated (clean, no handoff regression); no public bypass; WebAuthn verify correct (challenge bound, origin/rpID checked, verified gates storage, counter compared); single-use atomic. 280 tests green. Dep: @simplewebauthn/server@13.
<!-- SECTION:NOTES:END -->
