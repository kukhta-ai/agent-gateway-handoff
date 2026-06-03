---
id: GLA-035
title: Verify the bound recipient at the edge
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
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
- [ ] #1 Opening a valid link prompts for the required identity proof and verifies it against the recipient's enrolled credential.
- [ ] #2 A request without the required identity proof is refused at the edge.
- [ ] #3 A grant for a different recipient, or an expired or revoked grant, is refused and does not resolve onward.
- [ ] #4 An un-enrolled recipient cannot pass, with a catchable result rather than a crash.
- [ ] #5 Swapping the identity provider for another that satisfies the auth seam changes no gateway code.
<!-- AC:END -->
