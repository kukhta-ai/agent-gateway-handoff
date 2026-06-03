---
id: GLA-055
title: Let the human enter the code agent-blind without rebuilding
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - check
  - row
  - fill
dependencies:
  - GLA-041
documentation:
  - docs/components/capsule.md
priority: low
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the human enters the verification code in the second window without the agent seeing it; reuse the fill build, do not rewrite. Builds only the delta. Depends on the fill step. Out of scope: rebuilding the input path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 In the second window the human enters the code, which reaches the website and never the agent connector, using the existing agent-blind capability.
- [ ] #2 The code does not appear in any agent-readable channel or log.
<!-- AC:END -->
