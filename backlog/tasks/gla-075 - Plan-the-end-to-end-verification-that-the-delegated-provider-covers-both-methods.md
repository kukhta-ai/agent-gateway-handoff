---
id: GLA-075
title: >-
  Plan the end-to-end verification that the delegated provider covers both
  methods
status: To Do
assignee: []
created_date: '2026-06-03 15:42'
labels:
  - authentik
  - plan
dependencies:
  - GLA-067
priority: medium
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the integration's value claim is that authentik covers both a passkey and a password behind the auth seam with no gateway change; this fixes what proves it end to end so the verification task has a clear target. Produces a verification design, not code. Grounded in docs/architecture/test-strategy.md (S-1, S-10) and docs/scenario-01-unified.html (Phase 6). Out of scope: the runtime.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The verification is specified to drive a full handoff whose edge step-up is satisfied by a passkey through the delegated provider, and another satisfied by a password.
- [ ] #2 The seam invariant is specified as observable: the same gateway code path serves both the in-tree and the delegated provider, selected only by composition.
- [ ] #3 The strength-gating is specified as observable end to end: a step requiring the stronger method admits the passkey run and rejects the password-only run.
- [ ] #4 The verification covers the negative: a recipient the provider does not vouch for does not reach the capsule.
<!-- AC:END -->
