---
id: GLA-018
title: Plan the propose-task-and-session step
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - plan
  - architecture
  - row
  - propose
dependencies:
  - GLA-002
documentation:
  - docs/components/task-service.md
  - docs/components/capability-service.md
  - docs/04-capsule-assembly.md
priority: medium
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the agent turns intent into a concrete proposal under a durable task; this fixes the task root and the proposal contract. Produces architecture and the build plan; no code. Use the architect skills and research durable-task and assembly-authoring patterns on the internet. Depends on the contracts plan. Out of scope: admission; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Task service's part is specified: how a task (explicit or implicit) is opened as the revocation, budget, and audit root, with its lifecycle.
- [ ] #2 The Capability service's part is specified: how a task capability is minted with the agent-authority as parent and narrower scope.
- [ ] #3 The Agent Bridge's part is specified: how a concrete assembly proposal plus the task capability is submitted, and what id is returned.
- [ ] #4 The operating experience is designed: how the agent composes a proposal from a template and learns of a malformed one before provisioning.
- [ ] #5 An implementation plan for the build task exists, with how an opened task and a submitted proposal are observed.
- [ ] #6 Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog.
- [ ] #7 The task and proposal seams are specified at full capability so multi-session and other intents need no seam change.
<!-- AC:END -->
