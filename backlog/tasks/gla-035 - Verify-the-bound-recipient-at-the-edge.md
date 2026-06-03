---
id: GLA-035
title: Verify the bound recipient at the edge
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 10:52'
labels:
  - impl
  - row
  - auth
dependencies:
  - GLA-004
  - GLA-011
  - GLA-033
  - GLA-013
documentation:
  - docs/components/access-gateway.md
  - docs/components/identity-and-auth.md
priority: medium
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers edge enforcement, the right human proving identity before reaching anything. Builds the step designed in its plan. Depends on the kernel, the identity provider, the handoff step, and enrollment. Out of scope: the in-window work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Opening a valid link prompts for the required identity proof and verifies it against the recipient's enrolled credential.
- [x] #2 A request without the required identity proof is refused at the edge.
- [x] #3 A grant for a different recipient, or an expired or revoked grant, is refused and does not resolve onward.
- [x] #4 An un-enrolled recipient cannot pass, with a catchable result rather than a crash.
- [x] #5 Swapping the identity provider for another that satisfies the auth seam changes no gateway code.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
gateway grant-verify + WebAuthn step-up at the edge. AC1 opening a valid link prompts for the required identity proof and verifies it against the recipient's ENROLLED credential (REAL Playwright virtual authenticator); AC2 a request without identity proof -> refused at the edge; AC3 a grant for a different recipient, or expired/revoked -> refused, does not resolve onward; AC4 un-enrolled recipient -> catchable result, not a crash; AC5 swap IdP -> no gateway code change (AuthProviderPort). Security-reviewed: stateless edge verify, only the bound recipient passes, step-up no-bypass (proxy gated on authorizedGrants set only after verifyAuthentication+strength). 346 tests.
<!-- SECTION:NOTES:END -->
