---
id: identity-provider-4
title: Detect an authentik identity provider and its ownership mode
status: To Do
assignee: []
created_date: '2026-06-03 18:11'
updated_date: '2026-06-03 18:11'
labels:
  - 'kind:state'
  - 'step:detect'
dependencies:
  - identity-provider-1
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DETECT step (kind:state, idempotent / Repair) for the authentik branch of the identity provider. This branch runs ONLY when the operator selected the heavyweight delegated provider (GLA_AUTH_PROVIDER=authentik) in identity-provider-1; for the in-tree WebAuthn default it is a no-op and the default path (tasks 1–3) is untouched. authentik is reached by GLA over the network via OIDC (the adapter is an OIDC relying-party client needing only an issuer URL + the token/JWKS endpoints — docs/architecture/authentik-integration.md §2–§3, authentik-service-standup.md §1), so this step looks for an authentik that already answers and decides WHERE it can run before anything is changed. It detects whether an authentik satisfying the integration's outcomes already answers (the discovery document is reachable, a relying-party application for GLA is registered, the authentication flow emits an amr/acr that separates passkey from password, the subject is stable); it assesses the host environment to choose an ownership mode (Local-External at the VPS host is the hermes-1 reference because nested Docker inside the GLA container has a broken storage driver and cannot run a Compose stack; Remote-External when authentik is off-box; Managed only where nested Docker is proven working); and it records these findings so the setup step adopts an adequate instance rather than duplicating it and never attempts an in-container standup on a host that cannot support one. Record findings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 this branch is recognized as in scope only when the delegated authentik provider was selected (GLA_AUTH_PROVIDER=authentik); when the in-tree WebAuthn default is selected the step is a no-op and records nothing to set up
- [ ] #2 whether an authentik that already satisfies the integration's outcomes answers (its OIDC discovery document is reachable and the relying-party application and passkey-or-password flow are present) is determined before any change, so an adequate existing instance is adopted rather than duplicated
- [ ] #3 the ownership mode for this host is determined from the environment — adopting a host-level or off-box authentik over the network where an in-container Compose stack cannot run, and standing one up in-place only where container-nested virtualization is proven to work — and recorded
- [ ] #4 a host on which an in-container standup would fail (the nested-virtualization storage driver is broken) is identified as such, so the setup step does not attempt an in-place install that would fail partway and instead drives an adopt-or-remote path
- [ ] #5 the reachable issuer address that the GLA container can actually dial is established (not a host-only loopback the container cannot resolve), so the recorded connection works from where GLA runs
- [ ] #6 the findings (selection in effect, whether an adequate authentik already answers, the chosen ownership mode, the reachable issuer address) are recorded for the receipt before setup runs
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Effect verified against the task acceptance criteria (verify before record)
- [ ] #2 Files placed or modified are recorded via --ref and their checksum journaled in the notes
- [ ] #3 Ownership recorded in the notes: installed by us vs adopted from the user's machine
- [ ] #4 Inverse op recorded in the notes: the uninstall step plus the condition under which it runs
- [ ] #5 Decisions and their rationale recorded (notes, or --final for a pinned decision)
- [ ] #6 Non-file effects recorded in the notes: services started, registrations made, artifacts built
<!-- DOD:END -->
