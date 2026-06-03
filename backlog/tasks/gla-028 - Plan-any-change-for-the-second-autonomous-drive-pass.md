---
id: GLA-028
title: Plan any change for the second autonomous-drive pass
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - plan
  - check
  - row
  - drive
dependencies:
  - GLA-002
documentation:
  - docs/components/capsule.md
priority: low
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a later phase drives the same capsule again to a different page; this is the same connector capability as the drive step. Confirm the existing architecture covers it and design only any delta; no production code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting the drive capability.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The drive-step architecture is confirmed to cover a second pass to a different page, or the specific delta is specified; nothing already covered is re-specified.
- [ ] #2 Any change to the operating experience for this pass is designed; if none, that is recorded.
<!-- AC:END -->
