---
id: browser-runtime-3
title: Verify Chromium launches headless under automation
status: To Do
assignee: []
created_date: '2026-01-01 00:00'
updated_date: '2026-06-08 15:35'
labels:
  - 'kind:state'
  - 'step:verify'
milestone: 0.1.0
dependencies:
  - BROWSER-RUNTIME-2
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
VERIFY step (kind:state). Prove the browser is functional, not merely installed: a headless Chromium launches under Playwright/CDP and reports its version, and a trivial navigation (open a page, read its title) succeeds. The launch must work for the same OS user that runs the GLA service (that user is recorded in gla-core's receipt — the dependency this bundle requires — so the capsule the daemon spawns can use the browser; a browser installed only for a different user would not be reachable by the service). Re-read and confirm the setup receipt entries. On failure return to setup; contain failure to this bundle.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a headless Chromium launches successfully on the host under Playwright/CDP control and reports its version, demonstrating the agent can drive a real browser
- [ ] #2 a trivial automated navigation (opening a page and reading its title) succeeds, confirming the browser is functional, not merely present
- [ ] #3 the launch works for the same OS user that runs the GLA service, so the capsule the daemon spawns can use it
- [ ] #4 the receipt entries written during setup (browser source and revision, Playwright, OS packages, inverse op) are re-read and confirmed present and accurate
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
