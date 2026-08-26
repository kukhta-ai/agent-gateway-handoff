---
id: isolation-1
title: Detect available capsule isolation tiers
status: To Do
assignee: []
created_date: '2026-01-01 00:00'
updated_date: '2026-06-08 15:39'
labels:
  - 'kind:state'
  - 'step:detect'
milestone: 0.1.0
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DETECT step (kind:state, idempotent / Repair). isolation chooses the capsule isolation tier — the Spawner/Launcher tier that runs a capsule (docs/01 §7, docs/04 §5). The process tier is GLA's default and needs no isolation runtime beyond the browser and view layers (those are the browser-runtime and human-view bundles); Docker is the stronger alternative tier (docs/03 §5). Recognize the process tier as available by default; determine whether a usable Docker daemon is present (so Docker is offered only when usable); and identify any constraint that would make Docker unreliable here — notably the nested-container storage-driver limitation inside an unprivileged LXD container (the hermes-1 environment). requires gla-core. Record findings.
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
- [ ] #1 the process tier is recognized as available by default, since it requires no isolation runtime beyond the browser and view layers already provided by their own bundles
- [ ] #2 whether a container runtime (a running Docker daemon the service user can reach) is present is determined by inspection, so the stronger Docker tier can be offered when and only when it is actually usable
- [ ] #3 any constraint that would make the Docker tier unreliable in this environment — notably nested-container storage-driver limitations inside an unprivileged LXD container — is identified and recorded rather than discovered at first capsule spawn
- [ ] #4 the findings (process tier available; Docker present or absent and any caveat) are recorded for the receipt before setup runs
<!-- AC:END -->
