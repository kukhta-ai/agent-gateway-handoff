---
id: GLA-019
title: Open a task and submit a session proposal
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 08:21'
labels:
  - impl
  - row
  - propose
dependencies:
  - GLA-004
  - GLA-017
documentation:
  - docs/components/task-service.md
  - docs/components/capability-service.md
priority: medium
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers a durable task and an agent-authored proposal ready for admission. Builds the step designed in its plan. Depends on the kernel and orientation. Out of scope: admitting or provisioning.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Creating a task returns a task id and mints a task capability whose scope is no broader than the agent-authority it descends from.
- [x] #2 A single-capsule goal needs no explicit task: one is created implicitly.
- [x] #3 A concrete assembly proposal can be submitted under a task and is acknowledged with a reference.
- [x] #4 A proposal that does not conform to the assembly contract is rejected at submission with a typed error, before admission.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
packages/task (TaskService) + packages/assembly (resolver) + capability mintTask. AC1 task create -> task id + task cap whose scope <= agent-authority (kernel attenuation predicate, child subset of parent); AC2 single-capsule goal -> implicit task; AC3 concrete proposal submitted under a task, acknowledged with a reference; AC4 proposal not conforming to assembly contract -> typed error at SUBMISSION, before admission. gla task create + session create --dry-run working. Reviewed clean.
<!-- SECTION:NOTES:END -->
