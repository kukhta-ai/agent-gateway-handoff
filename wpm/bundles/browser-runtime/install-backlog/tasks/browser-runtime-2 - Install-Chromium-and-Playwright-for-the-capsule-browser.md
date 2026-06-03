---
id: browser-runtime-2
title: Install Chromium and Playwright for the capsule browser
status: To Do
assignee: []
created_date: '2026-06-03 13:38'
updated_date: '2026-06-03 13:41'
labels:
  - 'kind:state'
  - 'step:setup'
dependencies:
  - browser-runtime-1
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SETUP step (kind:state, idempotent). Make a Playwright-launchable Chromium available on the host — the typical path is the host's cached Chromium, or npx playwright install --with-deps chromium where it is absent — adopting an existing browser rather than reinstalling when one is present. Ensure the OS libraries Chromium needs are present so it launches cleanly. Honor the confirmation level and surface any system-level package changes first. Record what was installed (browser revision, Playwright, any OS packages) with the inverse op, and record an adopted pre-existing browser as adopted so uninstall leaves it. Managed ownership where we install; adopted where we reuse.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a Chromium browser that Playwright can launch is available on the host, whether installed by us or adopted from an existing one, and which case occurred is recorded
- [ ] #2 the operating-system libraries Chromium requires to run are present, so the browser launches without missing-shared-library errors
- [ ] #3 the installation honors the bundle's confirmation level, and any system-level package changes are surfaced before they are made
- [ ] #4 what was installed (the browser revision, Playwright, any OS packages) is captured for the receipt with the inverse op, and an adopted pre-existing browser is recorded as adopted so it is not removed on uninstall
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
