---
id: identity-provider-3
title: Verify a passkey can be registered and verified
status: To Do
assignee: []
created_date: '2026-01-01 00:00'
updated_date: '2026-06-08 15:43'
labels:
  - 'kind:state'
  - 'step:verify-rp'
milestone: 0.1.0
dependencies:
  - IDENTITY-PROVIDER-2
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
VERIFY step (kind:state). Prove the provider works end to end, not merely that it is configured: the RP id the daemon uses matches the host of its public base URL (so the browser accepts the ceremony rather than rejecting an origin mismatch); an enrollment of a recipient passkey through the gateway succeeds and that passkey is subsequently accepted to verify the recipient; and an un-enrolled or mismatched credential is refused (the provider actually gates access). Re-read and confirm the setup receipt entries (provider choice, RP setting, inverse op). On failure return to setup.
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
- [ ] #1 the relying-party id the daemon uses matches the host of its public base URL, so the browser will accept the WebAuthn ceremony rather than rejecting an origin mismatch
- [ ] #2 an enrollment of a recipient passkey through the gateway succeeds and that passkey is subsequently accepted to verify the recipient, demonstrating the provider works end to end rather than merely being configured
- [ ] #3 an un-enrolled or mismatched credential is refused, confirming the provider actually gates access rather than admitting anyone
- [ ] #4 the receipt entries written during setup (the provider choice, the relying-party setting, the inverse op) are re-read and confirmed present and accurate
<!-- AC:END -->
