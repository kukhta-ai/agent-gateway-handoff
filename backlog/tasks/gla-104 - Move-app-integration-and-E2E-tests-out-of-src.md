---
id: GLA-104
title: Move app integration and E2E tests out of src
status: Done
assignee: []
created_date: '2026-06-14 13:35'
updated_date: '2026-06-14 18:22'
labels:
  - test-architecture
  - source-layout
  - e2e
  - app
  - composition-root
dependencies:
  - GLA-102
references:
  - packages/app/src
  - packages/app/tsconfig.json
  - vitest.config.ts
  - tools/browser-e2e-preflight.mjs
documentation:
  - docs/architecture/test-strategy.md
priority: high
ordinal: 104000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/app is the composition root and currently holds many integration and E2E tests inside src. The test strategy already treats packages/app as E2E-oriented rather than normal runtime logic, so its tests should be visibly separate from the daemon/application source.

Context: app tests should continue to prove the full reference slice, authentik paths, noVNC handoff client, daemon state, grant transport, and browser-backed E2E availability. The migration is layout and gate clarity, not a reduction in E2E proof strength.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/app runtime source is separated from app integration and E2E tests by moving those tests to documented app-local test directories outside src.
- [x] #2 Scenario, handoff, authentik, daemon-state, noVNC client, teardown, completion, and grant-canary tests remain discoverable by the quality gate from their new app test locations.
- [x] #3 Browser-backed E2E preflight remains a hard gate for tests that require it, and skip/optional paths do not become easier to trigger because of the layout migration.
- [x] #4 App test helpers, fake external actors, and fixtures live outside runtime src and are not exported by packages/app production entrypoints.
- [x] #5 The app package build emits only runtime code and does not copy E2E tests or fixtures into dist.
- [x] #6 The docs explain why packages/app owns composition-root integration and E2E tests while package/provider unit and contract tests stay package-local.
<!-- AC:END -->













## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GLA-104 evidence: SM loaded bmad-create-story and used explicit Backlog.md/docs fallback because sprint-status.yaml is absent; worker loaded bmad-create-story/dev-story/qa-generate-e2e-tests and used the same fallback against backlog task GLA-104 and docs/architecture/test-strategy.md. Moved all packages/app tests from runtime src into packages/app/test/integration and packages/app/test/e2e; runtime packages/app/src now contains only production source. Updated relative imports, repo-root helpers, browser E2E preflight required fixture paths, e2e proof canary path, and architecture docs. Independent reviewer APPROVE, architect APPROVE, TEA PASS. Verification: typecheck:tests passed; focused packages/app/test plus preflight suite passed with 18 files, 160 passed / 11 skipped; pnpm gate passed with 70 files, 779 passed / 15 skipped; no app src test/spec files remain; old app src test paths remain only as intentional negative preflight assertions.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
