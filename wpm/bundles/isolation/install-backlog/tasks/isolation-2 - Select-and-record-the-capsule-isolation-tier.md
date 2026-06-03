---
id: isolation-2
title: Select and record the capsule isolation tier
status: To Do
assignee: []
created_date: '2026-06-03 13:39'
updated_date: '2026-06-03 13:41'
labels:
  - 'kind:state'
  - 'step:setup'
dependencies:
  - isolation-1
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SETUP step (kind:state). This bundle's primary effect is a recorded decision, not an install. Record the selected tier as a pinned decision with rationale; the process tier is the selection unless the operator explicitly opts into Docker. Process tier installs no isolation runtime and the launcher runs a process-tier capsule. If Docker is selected, confirm the daemon is usable for spawning a capsule and acknowledge the nested-container storage caveat in the decision — Docker is the alternative, not the default. Record an adopted Docker daemon as adopted so uninstall leaves it. The process-tier-default decision is the load-bearing choice this bundle documents.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the selected isolation tier is recorded as a pinned decision with its rationale, and the process tier is the selection unless the operator explicitly opts into Docker
- [ ] #2 when the process tier is selected, no isolation runtime is installed and the launcher mode reflects a process-tier capsule, since the tier needs nothing beyond the browser and view layers
- [ ] #3 when Docker is selected, the container runtime is confirmed usable for spawning a capsule and the nested-container storage caveat is acknowledged in the decision; selecting Docker is treated as the alternative, not the default
- [ ] #4 the decision and anything changed are captured for the receipt with an inverse op, and an adopted Docker daemon already on the host is recorded as adopted so it is not removed on uninstall
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
