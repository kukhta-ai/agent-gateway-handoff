---
id: GLA-047
title: Inspect after the first window without rebuilding
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - check
  - row
  - drive
dependencies:
  - GLA-027
  - GLA-045
documentation:
  - docs/components/capsule.md
priority: low
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the agent reads the post-submission page on the still-running capsule; reuse the drive build, do not rewrite. Builds only the delta. Depends on the drive and close steps. Out of scope: rebuilding drive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After the first window closes the agent inspects the live page using the existing drive capability, with no rewrite.
- [ ] #2 The capsule's state from the first window is intact for the inspection.
<!-- AC:END -->
