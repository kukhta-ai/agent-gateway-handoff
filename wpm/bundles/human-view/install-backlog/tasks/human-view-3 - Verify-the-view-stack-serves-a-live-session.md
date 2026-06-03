---
id: human-view-3
title: Verify the view stack serves a live session
status: To Do
assignee: []
created_date: '2026-06-03 13:39'
updated_date: '2026-06-03 13:41'
labels:
  - 'kind:state'
  - 'step:verify'
dependencies:
  - human-view-2
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
VERIFY step (kind:state). Prove the view stack works end to end: each binary (virtual display, VNC server, websockify) is runnable, and a websockify-fronted endpoint accepts a connection with the noVNC client assets served — the browser-native remote view is reachable. It must operate for the same OS user that runs the GLA service (that user is recorded in gla-core's receipt — the required dependency), so a daemon-spawned capsule can expose its display through it. Re-read and confirm the setup receipt entries. On failure return to setup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 each installed binary (the virtual display, the VNC server, the websockify bridge) is present and runnable, reporting itself rather than failing to execute
- [ ] #2 a websockify-fronted endpoint accepts a connection and the noVNC client assets are served, demonstrating the browser-native remote view is reachable end to end
- [ ] #3 the human-view path operates for the same OS user that runs the GLA service, so a capsule the daemon spawns can expose its display through this stack
- [ ] #4 the receipt entries written during setup (per-component source, inverse op, any service started) are re-read and confirmed present and accurate
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
