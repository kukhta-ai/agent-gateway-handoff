---
id: isolation-3
title: Verify a capsule can be isolated under the selected tier
status: To Do
assignee: []
created_date: '2026-01-01 00:00'
updated_date: '2026-06-08 15:39'
labels:
  - 'kind:state'
  - 'step:verify'
milestone: 0.1.0
dependencies:
  - ISOLATION-2
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
VERIFY step (kind:state). Prove the selected tier actually isolates and runs a capsule, not merely that a tier was named: under the selected tier a capsule spawns and tears down on this host. Process tier — a capsule process starts as the service user and is fully reaped on teardown (no orphan). Docker tier (if selected) — a container capsule starts and stops cleanly despite the recorded caveat, or the caveat is shown to block it and the selection is reconsidered rather than left silently broken. Re-read and confirm the recorded tier decision and receipt entries.
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
- [ ] #1 under the selected tier, a capsule can be spawned and torn down on this host, demonstrating the tier actually isolates and runs a capsule rather than merely being declared
- [ ] #2 for the process tier, a capsule process starts as the service user and is fully reaped on teardown, leaving no orphaned process
- [ ] #3 for the Docker tier when selected, a container capsule starts and stops cleanly despite the recorded nested-container caveat, or the caveat is shown to block it and the tier selection is reconsidered rather than left silently broken
- [ ] #4 the recorded tier decision and receipt entries are re-read and confirmed present and accurate
<!-- AC:END -->
