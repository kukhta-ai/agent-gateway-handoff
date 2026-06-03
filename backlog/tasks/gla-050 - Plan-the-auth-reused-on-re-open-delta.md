---
id: GLA-050
title: Plan the auth-reused-on-re-open delta
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
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on the second window the recipient's prior authentication is reused without a fresh prompt where the design allows; this reuses the auth capability and adds only the reuse behaviour. Confirm coverage and design the delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The auth architecture is confirmed to cover reusing a still-valid authentication, or the reuse delta is specified; nothing already covered is re-specified.
- [ ] #2 The reuse experience is designed: when no re-prompt occurs and when re-auth is still required.
- [ ] #3 Any change to the recipient's experience is designed; if none, that is recorded.
<!-- AC:END -->
