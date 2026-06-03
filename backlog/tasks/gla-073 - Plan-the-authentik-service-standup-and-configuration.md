---
id: GLA-073
title: Plan the authentik service standup and configuration
status: To Do
assignee: []
created_date: '2026-06-03 15:41'
labels:
  - authentik
  - plan
dependencies:
  - GLA-067
priority: medium
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the delegated provider is an external service (an identity-provider server plus its datastores) that must be stood up and configured (a relying-party application GLA authenticates against, and a passkey-or-password flow) on the operator host; this slots into the existing identity-provider wpm bundle as its authentik alternative. Produces design artifacts and the bundle plan, not code. Grounded in docs/01-architecture-overview.md §7-§8 and docs/architecture/dependency-strategy.md. Out of scope: the runtime adapter.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The provider's host footprint is enumerated (the service and its datastores) and classified by ownership mode for the reference profile.
- [ ] #2 The configuration the integration needs is specified as outcomes: a relying-party application GLA authenticates against, and a flow offering a passkey and a password.
- [ ] #3 The standup is specified to live in a wpm installer package that detects an existing provider before changing anything, records a receipt, and is idempotent on re-run.
- [ ] #4 The configuration ties the provider's relying-party identity to the operator's public URL, so the provider and GLA agree on the same origin.
- [ ] #5 The standup is specified so the in-tree default needs none of it, and the provider is only required when the delegated provider is selected.
- [ ] #6 An implementation plan exists for the installer-build task, with how the-provider-answers-and-the-relying-party-application-and-flow-exist is observed.
<!-- AC:END -->
