---
id: GLA-003
title: Scaffold the modular-monolith skeleton and quality gate
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 03:33'
labels:
  - foundation
  - impl
dependencies:
  - GLA-001
documentation:
  - docs/01-architecture-overview.md
  - docs/05-cli-and-entities.md
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the rest of the backlog needs a repository with enforced module boundaries and a runnable CLI entrypoint. Builds the empty skeleton and the quality gate every task's completion depends on. Depends on the architecture baseline. Out of scope: any module behaviour; the kernel contracts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The repository builds and typechecks from a clean checkout.
- [ ] #2 The module boundaries from the architecture baseline exist as separate units, and a check fails the build if a core module imports a concrete adapter.
- [ ] #3 A single CLI binary named gla is present and runs, returning the documented exit codes (0 success, 2 usage) for trivial invocations.
- [ ] #4 The gla binary emits JSON to stdout by default and human-readable text only when stdout is a TTY.
- [ ] #5 Lint, typecheck, and test all run through one documented entrypoint.
- [ ] #6 A deliberately failing example in any quality gate is observable as a non-zero result, so the gate cannot be silently bypassed.
<!-- AC:END -->
