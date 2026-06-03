---
id: GLA-031
title: Resume driving on an active session without rebuilding
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
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after a window closes the agent keeps driving the still-running capsule; reuse the existing builds, do not rewrite. Builds only the delta. Depends on the drive and connector steps. Out of scope: rebuilding drive or the connector.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With the session active and the capsule still running, the agent resumes driving using the existing capability, with no rewrite.
- [ ] #2 The capsule's state carries across the resume; only the delta, if any, is added.
<!-- AC:END -->
