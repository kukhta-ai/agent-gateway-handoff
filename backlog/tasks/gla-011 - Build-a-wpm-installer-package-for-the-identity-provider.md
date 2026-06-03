---
id: GLA-011
title: Build a wpm installer package for the identity provider
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - dependency
  - wpm
  - impl
dependencies:
  - GLA-005
documentation:
  - docs/components/identity-and-auth.md
priority: high
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: enforcing recipient identity relies on a WebAuthn or passkey provider running as a host service, so it ships as a wpm installer package. Depends on the dependency strategy. Out of scope: the GLA Identity and Auth component that delegates to it; recipient enrollment, which uses it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A wpm installer package for the identity provider exists in this project and is the unit that gets built, not an inline install.
- [ ] #2 The package detects an existing usable identity provider before changing anything.
- [ ] #3 On completion the host runs an identity provider that can register and verify a passkey or WebAuthn credential.
- [ ] #4 An already-adequate provider is left unchanged and recorded.
- [ ] #5 The package records a verifiable receipt and is idempotent on re-run.
- [ ] #6 A failure to provision surfaces a catchable error without leaving the provider partially configured.
<!-- AC:END -->
