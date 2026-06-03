---
id: GLA-063
title: Keep the session active through configuration without rebuilding
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
  - GLA-025
documentation:
  - docs/components/session-service.md
priority: low
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the session must remain active while the agent configures; reuse the existing builds, do not rewrite. Builds only the delta. Depends on the drive and connector steps. Out of scope: rebuilding drive or the connector.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The session stays active and the capsule keeps running through configuration, using the existing capability with no rewrite.
- [ ] #2 Only the delta, if any, is added.
<!-- AC:END -->
