---
id: GLA-074
title: Build the wpm installer for the authentik identity provider
status: To Do
assignee: []
created_date: '2026-06-03 15:42'
labels:
  - authentik
  - impl
dependencies:
  - GLA-073
  - GLA-068
priority: medium
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a delegated provider only works once its service is stood up and configured on the operator host; this extends the identity-provider wpm bundle to stand authentik up and configure it when that provider is selected. Builds the standup designed in its plan. Depends on the standup plan and the adapter it verifies against. Out of scope: the runtime adapter code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A wpm installer package stands the provider up on the host and is the unit that gets built, not an inline install.
- [ ] #2 The package detects an existing usable provider before changing anything and leaves an adequate one unchanged, recorded as adopted.
- [ ] #3 On completion the provider answers, a relying-party application for GLA exists, and a flow offering a passkey and a password is configured.
- [ ] #4 The package records a verifiable receipt of what it changed and is idempotent on re-run.
- [ ] #5 A host where the provider cannot be installed surfaces a clear, catchable failure rather than a partial state.
- [ ] #6 With the delegated provider not selected, installing GLA requires none of this package.
<!-- AC:END -->
