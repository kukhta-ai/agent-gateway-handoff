---
id: GLA-036
title: Plan any change for returning the auth result to the gateway
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - plan
  - check
  - row
  - auth
dependencies:
  - GLA-002
documentation:
  - docs/components/identity-and-auth.md
priority: low
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the verification result returns to the gateway as the leg that authorizes the entrypoint; this is part of the auth capability. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The auth-step architecture is confirmed to cover returning the result and auth strength to the gateway, or the delta is specified; nothing already covered is re-specified.
- [ ] #2 Any change to the recipient's experience at this leg is designed; if none, that is recorded.
<!-- AC:END -->
