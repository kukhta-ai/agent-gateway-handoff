---
id: GLA-048
title: Plan the re-open-onto-the-same-capsule delta
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - plan
  - check
  - row
  - handoff
dependencies:
  - GLA-002
documentation:
  - docs/components/session-service.md
priority: low
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the second handoff re-opens a window on the same live capsule; this reuses the handoff-open capability and adds only the re-open-without-respawn behaviour. Confirm coverage and design the delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting handoff open.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The handoff-open architecture is confirmed to cover re-opening onto the same capsule, or the re-open delta is specified; nothing already covered is re-specified.
- [ ] #2 Any change to the recipient's experience for the second link is designed; if none, that is recorded.
<!-- AC:END -->
