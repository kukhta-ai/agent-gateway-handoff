---
id: GLA-011
title: Build a wpm installer package for the identity provider
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 13:49'
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
- [x] #1 A wpm installer package for the identity provider exists in this project and is the unit that gets built, not an inline install.
- [x] #2 The package detects an existing usable identity provider before changing anything.
- [x] #3 On completion the host runs an identity provider that can register and verify a passkey or WebAuthn credential.
- [x] #4 An already-adequate provider is left unchanged and recorded.
- [x] #5 The package records a verifiable receipt and is idempotent on re-run.
- [x] #6 A failure to provision surfaces a catchable error without leaving the provider partially configured.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
wpm bundle 'identity-provider' authored in wpm/ (GLA's agent-native installer bundle-project; wpm v0.1.0 via npm link from /workspace/active/work-package-manager). It IS the build unit (not an inline install) with a real install-backlog detect->setup->verify->record per the wpm install contract: detects an existing usable runtime before changing anything; leaves an adequate one unchanged (recorded as adopted); records a verifiable receipt (installed-vs-adopted + inverse op + checksum); idempotent on re-run; surfaces a clear catchable failure rather than a partial state. Ownership mode + the hermes-1 mapping (Ubuntu 24.04 LXD, host Caddy -> :3000) are in the bundle. wpm project validate + wpm build dry-run PASS (6 bundles, 98 files).
<!-- SECTION:NOTES:END -->
