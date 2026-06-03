---
id: GLA-040
title: Plan the user-works-in-window-agent-blind step
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 11:47'
labels:
  - plan
  - architecture
  - row
  - fill
dependencies:
  - GLA-002
documentation:
  - docs/components/capsule.md
priority: medium
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: inside the window the human acts on the live page, entering secrets the agent must never see; this fixes the agent-blind input path. Produces architecture and the build plan; no code. Use the architect skills and research input-isolation patterns on the internet. Depends on the contracts plan. Out of scope: completion detection; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Capsule's agent-blind input path is specified as an invariant: human keystrokes inside the window reach the website but never the agent connector.
- [x] #2 The recipient's experience of working in the live page is designed, including that the agent cannot observe their secret entry.
- [x] #3 An implementation plan for the build task exists, with how agent-blind human input is observed from outside.
- [x] #4 Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog.
- [x] #5 The input path is specified at full capability so any human entrypoint upholds the same agent-blind guarantee.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: docs/architecture/slice-5-completion.md §agent-blind. The capsule agent-blind input-path invariant (human keystrokes inside the window reach the website but never the agent connector — enforced by GLA-side CDP brokering with window-scoped severance); recipient UX (the agent cannot observe their secret entry); build/observation plan (agent-blind observed from outside = secret in zero agent-readable outputs + a live agent socket cut during the window); deps (none non-traditional); the input path full-capability so any human entrypoint upholds the same guarantee (human path non-brokered). Rule-3 docs-driven fallback. Implemented+tested in GLA-041.
<!-- SECTION:NOTES:END -->
