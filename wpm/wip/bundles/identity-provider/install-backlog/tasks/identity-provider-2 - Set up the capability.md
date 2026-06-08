---
id: identity-provider-2
title: Configure the passkey relying party for GLA
status: To Do
assignee: []
created_date: '2026-01-01 00:00'
updated_date: '2026-06-08 15:43'
labels:
  - 'kind:state'
  - 'step:configure-rp'
milestone: 0.1.0
dependencies:
  - IDENTITY-PROVIDER-1
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SETUP step (kind:state). Configure the GLA daemon with a relying-party id (GLA_RP_ID) matching the host in its public base URL, so a passkey registered at enrollment can later be verified at handoff (the daemon also derives the expected ceremony origin from the public base URL). The in-tree provider is the selection unless the operator opts into the alternative, and choosing it stands up no separate service — it sets the RP configuration only. If authentik is selected, stand up the standalone service and point GLA at it, recorded as the alternative. Record the decision and the relying-party value with the inverse op, so the choice reverses without disturbing unrelated identity config. The in-tree-default decision is the load-bearing choice this bundle documents.
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
- [ ] #1 the GLA daemon is configured with a relying-party id that matches the host in its public base URL, so a passkey registered during enrollment can later be verified at handoff
- [ ] #2 the in-tree provider is the selection unless the operator explicitly opts into the alternative, and choosing the in-tree provider stands up no separate identity service
- [ ] #3 when the alternative provider is selected, the standalone identity service is stood up and GLA is pointed at it, and this is recorded as the alternative rather than the default
- [ ] #4 the configuration decision and any value placed (the relying-party setting, its rationale) are captured for the receipt with the inverse op, so the choice can be reversed without affecting unrelated identity configuration
<!-- AC:END -->
