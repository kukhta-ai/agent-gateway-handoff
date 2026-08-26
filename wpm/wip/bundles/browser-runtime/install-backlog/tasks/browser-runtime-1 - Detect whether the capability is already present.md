---
id: browser-runtime-1
title: Detect an existing Chromium and Playwright on the host
status: To Do
assignee: []
created_date: '2026-01-01 00:00'
updated_date: '2026-06-08 15:35'
labels:
  - 'kind:state'
  - 'step:detect'
milestone: 0.1.0
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DETECT step (kind:state, idempotent / Repair). browser-runtime delivers the in-capsule browser the human and agent jointly act on, plus the automation engine the agent drives it with: Chromium driven over CDP via Playwright (docs/03 §7, §10). Before installing, inspect what the host already has: an adoptable Chromium/Chrome usable by Playwright; an existing Playwright install and any cached browser revision; and whether the OS libraries Chromium needs to launch are present (so a missing-shared-library failure is anticipated, not discovered at first launch). requires gla-core. Record findings; a pure-detection pass that places nothing may opt out of the recording defaults. Never touch a sibling bundle's state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 whether a Chromium (or Chrome) browser binary usable by Playwright is already present on the host is determined by inspection, and an adoptable existing browser is distinguished from none
- [ ] #2 whether Playwright and a Playwright-managed browser revision are already installed is determined, including any cached browser download, so a prior install is reconciled rather than duplicated
- [ ] #3 whether the host has the shared libraries Chromium needs to launch is assessed, so a missing-dependency failure is anticipated before setup rather than discovered at first launch
- [ ] #4 whether the target filesystem has room for a Playwright browser download (on the order of 1 GB) is determined, so an out-of-disk failure during install is anticipated rather than discovered
- [ ] #5 the findings (browser present/absent and source, Playwright present/absent, missing OS libraries) are recorded for the receipt before setup runs
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
