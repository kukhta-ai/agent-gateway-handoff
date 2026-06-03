---
id: GLA-016
title: Plan the agent-orientation step
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - plan
  - architecture
  - row
  - orient
dependencies:
  - GLA-002
documentation:
  - docs/components/agent-bridge.md
  - docs/components/catalog.md
  - docs/05-cli-and-entities.md
priority: medium
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: before proposing anything the agent must discover what this install offers; this fixes the read surface. Produces architecture and the build plan; no code. Use the architect skills and research agent-CLI discovery and read-model patterns on the internet. Depends on the contracts plan. Out of scope: proposing a session; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Agent Bridge's read surface is specified: the whoami, template-show, and skill-show operations and their stable output shapes, as the single interface the agent reads through.
- [ ] #2 The Catalog's part is specified: how templates and skills available in this install are listed with system-derived availability, as a read contract.
- [ ] #3 The operating experience of orientation is designed: how the agent learns the holes it must fill without guessing them.
- [ ] #4 An implementation plan for the build task exists, with how orientation is observed end to end.
- [ ] #5 Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog.
- [ ] #6 The catalog read seam is specified at full capability so a new template or skill source is added with no seam change.
<!-- AC:END -->
