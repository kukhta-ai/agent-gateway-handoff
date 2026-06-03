---
id: human-view-2
title: 'Install the Xvfb, x11vnc, websockify and noVNC stack'
status: To Do
assignee: []
created_date: '2026-06-03 13:39'
updated_date: '2026-06-03 13:41'
labels:
  - 'kind:state'
  - 'step:setup'
dependencies:
  - human-view-1
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SETUP step (kind:state, idempotent), confirmation-level dangerous because it installs system packages (the validated path is apt-installing xvfb, x11vnc, websockify, and the noVNC client assets — on Debian/Ubuntu the `novnc` package, or the upstream assets where it is unavailable). Surface the plan and get consent before installing anything. After setup the full stack is present so the launcher can select the full noVNC path rather than headless.

Shared-memory caveat: Chromium rendering heavy pages can exhaust the default /dev/shm (often only 64 MB in a container), crashing tabs. Where the host or capsule runtime allows it, raise the shared-memory size (e.g. a larger --shm-size for a container, or mounting a bigger /dev/shm) so the live view stays stable under real pages; record the choice. This is a tuning decision, not a hard requirement for bring-up.

Record what was installed per component with the inverse op; record any component adopted from the host as adopted so uninstall leaves it. Never touch a sibling bundle's state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the full human-view stack — a virtual X display, a VNC server, the websockify bridge, and the noVNC client assets — is present on the host after setup, whether installed by us or adopted where already present
- [ ] #2 because installing system packages is a dangerous action, the plan is surfaced and consent obtained before any package is installed
- [ ] #3 the launcher is able to select the full noVNC view path after install, so the human can watch and drive the live browser in their own tab rather than being limited to headless
- [ ] #4 what was installed per component is captured for the receipt with the inverse op, and any component adopted from the host is recorded as adopted so it is not removed on uninstall
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
