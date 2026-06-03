---
id: GLA-061
title: Configure the account over the connector without rebuilding
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
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the agent sets up the fresh account on the still-running capsule; reuse the drive build, do not rewrite. Builds only the delta. Depends on the drive step. Out of scope: rebuilding drive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The agent configures the account on the live capsule using the existing drive capability, with no rewrite.
- [ ] #2 The session's logged-in state from the handoffs is intact for the configuration.
<!-- AC:END -->
