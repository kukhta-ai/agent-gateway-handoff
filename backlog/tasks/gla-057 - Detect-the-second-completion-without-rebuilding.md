---
id: GLA-057
title: Detect the second completion without rebuilding
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - check
  - row
  - detect
dependencies:
  - GLA-043
documentation:
  - docs/components/completion-service.md
priority: low
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the second human step must be detected as done; reuse the detect build, do not rewrite. Builds only the delta. Depends on the detect step. Out of scope: rebuilding detection.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The second completion is detected and validated using the existing detection capability, with no rewrite.
- [ ] #2 A non-firing detector leads to expiry, not a false completion.
<!-- AC:END -->
