---
id: identity-provider-1
title: Detect the WebAuthn relying-party configuration
status: To Do
assignee: []
created_date: '2026-01-01 00:00'
updated_date: '2026-06-08 15:43'
labels:
  - 'kind:state'
  - 'step:detect-rp'
milestone: 0.1.0
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DETECT step (kind:state, idempotent / Repair). identity-provider configures the WebAuthn/passkey provider that proves the recipient before any handoff (docs/03 §4). GLA's default is the in-tree @simplewebauthn provider — passkey verification runs in-process, so no separate identity service is required; the bundle's job for the default is to set the relying-party id (GLA_RP_ID). authentik is the heavyweight alternative this bundle would stand up only if explicitly selected. Recognize the in-tree provider as available by default; derive the intended relying-party id from the operator's public URL (it must match that host; a bare IP is a valid RP id) and assess whether it is already configured; and determine whether the operator intends the alternative. requires gla-core. Record findings.
<!-- SECTION:DESCRIPTION:END -->


## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Effect verified against the task acceptance criteria (verify before record)
- [ ] #2 Files placed or modified are recorded via --ref and their checksum journaled in the notes
- [ ] #3 Ownership recorded in the notes: installed by us vs adopted from the user's machine
- [ ] #4 Inverse op recorded in the notes: the uninstall step plus the condition under which it runs
- [ ] #5 Decisions and their rationale recorded (notes, or --final for a pinned decision)
- [ ] #6 Non-file effects recorded in the notes: services started, registrations made, artifacts built
<!-- DOD:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the in-tree WebAuthn provider is recognized as available by default, since GLA ships its passkey verification in-process and no separate identity service is required for it
- [ ] #2 the relying-party identity the passkey will bind to is determined from the operator's public URL, and whether it is already configured for the running daemon is assessed
- [ ] #3 whether the operator intends the heavyweight alternative (a standalone identity provider such as authentik) instead of the in-tree provider is determined, so the alternative path runs only when explicitly selected
- [ ] #4 the findings (in-tree provider available, the intended relying-party id, whether the alternative was selected) are recorded for the receipt before setup runs
<!-- AC:END -->
