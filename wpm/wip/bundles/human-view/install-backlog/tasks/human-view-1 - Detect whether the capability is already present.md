---
id: human-view-1
title: Detect the noVNC human-view stack on the host
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
DETECT step (kind:state, idempotent / Repair). human-view delivers the noVNC view stack so a person can watch and drive the live browser inside their own tab: a virtual X display (Xvfb), a VNC server (x11vnc), the websockify bridge, and the noVNC web client (docs/03 §6). GLA's launcher selects the full (noVNC) view path only when this stack is complete, else it degrades to headless (the daemon's launcher mode is auto/full/headless). Inspect each component independently so a partially-present stack is completed rather than reinstalled or skipped. requires gla-core and browser-runtime (the stack views the browser that bundle provides). Record per-component findings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 whether each component of the human-view stack — a virtual X display (Xvfb), a VNC server (x11vnc), the websockify bridge, and the noVNC web client assets — is already present on the host is determined by inspection, component by component
- [ ] #2 a partially-present stack (some components installed, others missing) is recognized as such, so setup completes the gap rather than reinstalling everything or skipping
- [ ] #3 whether GLA's launcher would select the full (noVNC) view path versus headless on this host is determined from which components are present, since the full path activates only when the stack is complete
- [ ] #4 the per-component findings are recorded for the receipt before setup runs
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
