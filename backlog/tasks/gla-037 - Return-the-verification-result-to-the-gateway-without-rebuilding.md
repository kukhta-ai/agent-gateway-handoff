---
id: GLA-037
title: Return the verification result to the gateway without rebuilding
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
documentation:
  - docs/components/identity-and-auth.md
priority: low
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the gateway must act on the verifier's result; reuse the auth build, do not rewrite. Builds only the delta. Depends on the auth step. Out of scope: rebuilding verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The verifier's result and auth strength reach the gateway and gate the entrypoint, using the existing auth build with no rewrite.
- [ ] #2 A failure result is conveyed as a refusal, not an unstructured error.
<!-- AC:END -->
