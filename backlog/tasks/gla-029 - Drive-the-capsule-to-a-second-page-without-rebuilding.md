---
id: GLA-029
title: Drive the capsule to a second page without rebuilding
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
documentation:
  - docs/components/capsule.md
priority: low
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the agent must reach a different page on the same live capsule; reuse the drive build, do not rewrite it. Builds only the delta. Depends on the drive step. Out of scope: rebuilding the connector or drive capability.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The agent reaches and acts on a second page on the same live capsule using the existing drive capability, with no rewrite of it.
- [ ] #2 Only the delta, if any, is added; the connector and capsule behave as in the first drive.
<!-- AC:END -->
