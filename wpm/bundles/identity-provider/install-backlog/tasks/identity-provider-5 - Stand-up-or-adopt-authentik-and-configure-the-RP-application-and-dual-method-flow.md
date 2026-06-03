---
id: identity-provider-5
title: Stand up or adopt authentik and configure the RP application and dual-method flow
status: To Do
assignee: []
created_date: '2026-06-03 18:11'
updated_date: '2026-06-03 18:11'
labels:
  - 'kind:state'
  - 'step:setup'
dependencies:
  - identity-provider-4
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SETUP step (kind:state) for the authentik branch, gated on the GLA_AUTH_PROVIDER=authentik selection (no-op for the in-tree default — tasks 1–3 are unchanged). Acting on identity-provider-4's findings, bring an authentik into the state the delegated provider needs and point GLA at it, without duplicating an adequate existing instance and without attempting an install the host cannot support. Honoring the chosen ownership mode: adopt a host-level or off-box authentik over the network (the hermes-1 reference, since the GLA container cannot run a Compose stack), or stand a fresh stack up in-place only where container-nested virtualization works (carrying the inverse op for what was installed). Configure the integration's outcomes on whichever authentik is used: an OIDC relying-party application for GLA (a confidential client whose allowed redirect URI equals GLA's configured callback on GLA's own public origin, issuing an id_token that carries the subject and the authentication-method claims the adapter validates); an authentication flow that offers BOTH a passkey stage AND a password stage and emits an authentication-method claim (amr, or acr) that distinguishes the two so a passkey login maps to the strongest strength and a password login to the weaker one; and a stable, immutable subject so a recipient enrolled once stays verifiable. Wire the redirect-callback so it is served by GLA on GLA's own origin (same-origin with the gateway), so the OIDC code/state round-trip returns to GLA and the GLA grant never travels to authentik. Point GLA at the result by writing its connection configuration, holding the client secret as a secret reference rather than a literal. The standup stack must match the authentik version's actual composition (omit a cache/broker component a newer version no longer uses). On a host where an in-place standup cannot succeed and no authentik can be adopted, stop with a clear, recoverable failure that recommends a host-level or off-box authentik, leaving nothing half-built. Record the decisions, the connection, the ownership, and the inverse op.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 an authentik usable by GLA is in place at the recorded reachable issuer — either an adequate existing instance left unchanged and adopted, or one brought up under the chosen ownership mode — without a second, duplicate provider or application being created on re-run
- [ ] #2 an OIDC relying-party application for GLA exists as a confidential client whose single allowed redirect URI equals GLA's configured callback URL on GLA's own public origin, and whose issued id_token carries the subject and the claims the adapter validates
- [ ] #3 the authentication flow offers both a passkey stage and a password stage, and the issued id_token carries an authentication-method claim that distinguishes a passkey login from a password login, so the strength mapping yields the stronger strength for a passkey and the weaker one for a password
- [ ] #4 the subject the provider issues is stable and immutable across logins (derived from an immutable user identifier, not a mutable username or email), so a recipient enrolled against it stays verifiable on later step-ups
- [ ] #5 the redirect callback is served by GLA on GLA's own origin (same-origin with the gateway), so the OIDC code and state return to GLA and the GLA grant is never sent to authentik
- [ ] #6 GLA is pointed at the provider by its written connection configuration (issuer, client id, redirect URI), and the client secret is held as a secret reference, never written as a literal into the connection record, the receipt, or any log
- [ ] #7 the stood-up stack matches the running authentik version's actual composition, omitting a cache or broker component that the version no longer requires rather than hard-requiring one
- [ ] #8 on a host where no authentik can be stood up in place and none can be adopted, the step stops with a clear, recoverable failure that recommends a host-level or off-box authentik and leaves no half-built stack behind
- [ ] #9 the decisions, the connection, the ownership (adopted vs installed), and the inverse op (for an installed stack only) are captured for the receipt so the choice can be reversed without disturbing an authentik that was merely adopted
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
