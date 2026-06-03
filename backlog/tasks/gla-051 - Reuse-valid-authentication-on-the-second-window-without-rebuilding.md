---
id: GLA-051
title: Reuse valid authentication on the second window without rebuilding
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - check
  - row
  - auth
dependencies:
  - GLA-035
  - GLA-049
documentation:
  - docs/components/identity-and-auth.md
priority: low
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a returning recipient with valid auth should not be re-prompted; reuse the auth build, do not rewrite. Builds only the delta. Depends on the auth step and the re-open delta. Out of scope: rebuilding verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On the second window a recipient whose authentication is still valid reaches the capsule with no fresh prompt.
- [ ] #2 If the authentication is no longer valid, a re-prompt occurs rather than silent access.
- [ ] #3 Reuse is confined to the bound recipient and does not widen access.
<!-- AC:END -->
