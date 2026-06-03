---
id: GLA-064
title: Plan the tear-down-the-session step
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:43'
labels:
  - plan
  - architecture
  - row
  - teardown
dependencies:
  - GLA-002
documentation:
  - docs/components/session-service.md
  - docs/components/task-service.md
  - docs/components/worker-plane.md
  - docs/components/capability-service.md
priority: medium
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: completing the task must destroy the capsule and revoke every capability, leaving nothing live; this fixes the teardown contract and the cleanup guarantee. Produces architecture and the build plan; no code. Use the architect skills and research idempotent cleanup and reconciler patterns on the internet. Depends on the contracts plan. Out of scope: implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Task service's complete-or-revoke contract is specified: a terminal transition that drives teardown of its sessions and capsules and revokes descendant capabilities.
- [x] #2 The Session service's teardown is specified: session to completed and capsule reaped, as an ordered contract.
- [x] #3 The Capability service's part is specified: every descendant capability stops verifying after teardown.
- [x] #4 The Worker plane's part is specified: capsule and workspace destroyed and a reconciler confirms no orphans, distinguishing ephemeral state from persisted host paths.
- [x] #5 The Route controller's part is specified: no live route remains after completion.
- [x] #6 The operating experience is designed: how the agent and operator observe that nothing live remains.
- [x] #7 An implementation plan for the build task exists covering normal completion and abort, with how no-live-state-remains is observed.
- [x] #8 Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog.
- [x] #9 Cleanup is specified at full capability to reconcile by state regardless of launcher, so new runtimes are torn down by the same reconciler.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: docs/architecture/slice-7-teardown.md. Task complete/revoke terminal contract (drives session+capsule teardown + revokes descendant caps); session teardown ordered contract (session->completed, capsule reaped); capability part (every descendant stops verifying via lineage revoke); worker part (capsule+workspace destroyed, reconciler no-orphan, ephemeral-vs-persisted distinction); route part (no live route remains); operating experience (agent+operator observe nothing live remains); build/observation plan (normal completion + abort); deps (none new); cleanup full-capability (reconcile by state regardless of launcher). Rule-3 docs-driven fallback. Implemented+tested in GLA-065.
<!-- SECTION:NOTES:END -->
