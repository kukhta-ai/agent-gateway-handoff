---
id: GLA-041
title: Let the human work in-window without the agent seeing secrets
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - row
  - fill
dependencies:
  - GLA-004
  - GLA-039
documentation:
  - docs/components/capsule.md
priority: medium
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the privacy-critical behaviour, the human entering secrets the agent cannot observe. Builds the step designed in its plan. Depends on the kernel and the reach step. Out of scope: detecting completion.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Inside an open window the human can interact with the live page and submit the form.
- [ ] #2 Secret keystrokes reach the website and are never delivered to the agent connector.
- [ ] #3 Nothing the human types in the window appears in any agent-readable channel or log.
- [ ] #4 The agent-blind guarantee holds regardless of which human entrypoint surface is used.
<!-- AC:END -->
