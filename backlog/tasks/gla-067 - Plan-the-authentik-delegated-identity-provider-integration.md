---
id: GLA-067
title: Plan the authentik delegated-identity-provider integration
status: To Do
assignee: []
created_date: '2026-06-03 15:40'
labels:
  - authentik
  - plan
dependencies:
  - GLA-002
priority: medium
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the MVP authenticates recipients with the in-tree WebAuthn provider behind the AuthProvider seam; a delegated identity provider (authentik) can cover both a phishing-resistant passkey and a typed-password fallback (and MFA) in one place, but it moves where credentials live and how a step-up is carried out. This task fixes the integration's shape so the implementation tasks conform to one design. Produces design artifacts, not code. Grounded in docs/components/identity-and-auth.md, docs/architecture/dependency-strategy.md, and docs/03-software-candidates.md §4. Out of scope: implementing the adapter, the enrollment change, the dual-method flow, or the installer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The integration is specified as a new auth provider that satisfies the existing AuthProvider seam, so selecting it changes no gateway or core code — only a new adapter and the composition that wires it.
- [ ] #2 The step-up delegation is specified as a contract: the gateway hands the identity challenge to the external provider and receives back the same ok + auth-strength + resolved-identity fact the in-tree provider produces.
- [ ] #3 The mapping from the provider's reported authentication method to GLA's auth-strength is specified, so a passkey result yields the strongest strength and a password result yields a lower one.
- [ ] #4 The credential-authority shift is specified: with this provider the recipient's credential is held by the provider, and a recipient is bound to a stable provider subject rather than a GLA-held credential.
- [ ] #5 The deployment boundary is specified — which parts are GLA runtime code versus an installer concern — and the provider service is named as a wpm-installer-package task in this backlog.
- [ ] #6 The default-provider decision is specified: the in-tree provider stays the default and the delegated provider is opt-in, with the selection surface named.
- [ ] #7 A build-order plan exists sequencing the adapter, the enrollment change, the dual-method flow, the installer, and the verification into a valid order.
<!-- AC:END -->
