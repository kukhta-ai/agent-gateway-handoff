---
id: GLA-054
title: Plan any change for the human entering the verification code
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - plan
  - check
  - row
  - fill
dependencies:
  - GLA-002
documentation:
  - docs/components/capsule.md
priority: low
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: in the second window the human enters a code agent-blind; this is the in-window agent-blind capability again. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting the input path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The agent-blind input architecture is confirmed to cover entering a code, or the delta is specified; nothing already covered is re-specified.
- [ ] #2 Any change to the recipient's experience here is designed; if none, that is recorded.
<!-- AC:END -->
