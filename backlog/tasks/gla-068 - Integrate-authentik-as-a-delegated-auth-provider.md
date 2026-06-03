---
id: GLA-068
title: Integrate authentik as a delegated auth provider
status: To Do
assignee: []
created_date: '2026-06-03 15:41'
labels:
  - authentik
  - impl
dependencies:
  - GLA-067
priority: medium
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: with the integration shape fixed (GLA-067), this builds the provider adapter (today a stub) so the gateway's edge step-up is carried out by authentik behind the AuthProvider seam, returning the verified result as GLA's standard auth fact. Depends on the integration plan. Out of scope: the enrollment change (GLA-070), the dual-method flow content (GLA-072), and the installer standup (GLA-074).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A new auth provider satisfies the existing AuthProvider seam; the gateway and core packages import only the port, so selecting it changes no gateway or core code.
- [ ] #2 A recipient step-up is carried out against the external provider and, on success, the provider returns a verified identity and an auth-strength fact in the same shape the in-tree provider returns.
- [ ] #3 A result the provider does not vouch for — an invalid, expired, or not-for-this-relying-party assertion — is rejected as a not-ok result with a typed reason, and no identity or strength is asserted.
- [ ] #4 The verified identity resolves to a stable subject that the same recipient reproduces on a later step-up.
- [ ] #5 The provider's reported authentication method is mapped to GLA's auth-strength, distinguishing a passkey result from a password result.
- [ ] #6 With the delegated provider unselected, the existing in-tree provider path is unchanged.
<!-- AC:END -->
