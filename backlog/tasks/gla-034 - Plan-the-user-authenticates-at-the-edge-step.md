---
id: GLA-034
title: Plan the user-authenticates-at-the-edge step
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 10:52'
labels:
  - plan
  - architecture
  - row
  - auth
dependencies:
  - GLA-002
documentation:
  - docs/components/access-gateway.md
  - docs/components/identity-and-auth.md
  - docs/components/capability-service.md
  - docs/components/route-controller.md
priority: medium
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the bound human opens the link and proves identity to GLA before reaching the capsule; this fixes the edge auth-and-verify seam. Produces architecture and the build plan; no code. Use the architect skills and research WebAuthn verification and edge authorization on the internet. Depends on the contracts plan. Out of scope: the in-window work; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Access Gateway's entry contract is specified: it verifies the grant and requires the bound identity before forwarding anywhere.
- [x] #2 Identity and Auth's verification contract is specified: how an auth strength is required and checked against the credential the recipient enrolled, delegating to the provider.
- [x] #3 The Capability service's part is specified: the grant is verified statelessly at the edge and only the bound recipient passes.
- [x] #4 The Route controller's part is specified: a verified request resolves to the capsule's human entrypoint; an unverified or expired one does not.
- [x] #5 The recipient's authentication experience is designed, including that it depends on prior enrollment and what an un-enrolled or failed recipient sees.
- [x] #6 An implementation plan for the build task exists, with how only-the-bound-authenticated-recipient-passes is observed.
- [x] #7 Dependencies are identified and classified; the identity provider is named as a wpm-installer-package task in this backlog.
- [x] #8 The auth seam is specified at full capability so a different identity provider or auth strength is added with no gateway-code change.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: docs/architecture/slice-4b-handoff.md §verify. Gateway entry contract (verify grant + require bound identity before forwarding); Identity+Auth verification contract (auth-strength required + checked against the enrolled credential, delegated to provider); capability grant verified statelessly at the edge, only the bound recipient passes; route controller resolves a verified request to the capsule human entrypoint (unverified/expired does not); recipient auth UX (depends on prior enrollment; un-enrolled/failed); build/observation plan; identity provider named (wpm GLA-011); auth seam full-capability. Rule-3 docs-driven fallback. Implemented in GLA-035.
<!-- SECTION:NOTES:END -->
