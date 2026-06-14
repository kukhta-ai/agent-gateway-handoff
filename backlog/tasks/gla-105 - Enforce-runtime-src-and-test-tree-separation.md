---
id: GLA-105
title: Enforce runtime src and test tree separation
status: Done
assignee: []
created_date: '2026-06-14 13:35'
updated_date: '2026-06-14 18:39'
labels:
  - test-architecture
  - source-layout
  - boundary
  - quality-gate
  - lint
dependencies:
  - GLA-103
  - GLA-104
references:
  - vitest.config.ts
  - tsconfig.json
  - biome.json
  - package.json
  - tools/boundary-check/src/boundary.test.ts
documentation:
  - docs/architecture/test-strategy.md
priority: high
ordinal: 105000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: moving tests out of src is only durable if the quality gate rejects regressions. Otherwise new unit, contract, or E2E tests will gradually drift back into runtime source directories because that was the historical pattern.

Context: enforcement should be lightweight and aligned with the project style: checks in the same gate developers already run, not a heavy new framework. The rule is not that all tests live top-level; the rule is that runtime src contains runtime code, while package-local and app-local tests live in their documented test trees.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The quality gate fails when new test files are placed under runtime src directories except for explicitly documented temporary exceptions.
- [x] #2 The repository has a machine-checkable allowlist or convention for package-local test directories, app E2E directories, fixtures, and top-level cross-cutting test harnesses.
- [x] #3 Production build configuration, package exports, and emitted artifacts exclude test directories, fixtures, and test-only helpers.
- [x] #4 Test-only imports are constrained so production runtime code cannot import package-local tests, fixtures, or fake providers.
- [x] #5 The source/test separation check is documented with the quality gate and produces actionable diagnostics naming the misplaced file and expected location.
- [x] #6 Existing provider-host boundary and browser-E2E checks continue to run under the same gate after source/test separation enforcement is enabled.
<!-- AC:END -->













## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GLA-105 evidence: SM loaded bmad-create-story and used explicit Backlog.md/docs fallback because sprint-status.yaml is absent; worker loaded bmad-create-story/dev-story/qa-generate-e2e-tests and used the same fallback against backlog task GLA-105, docs/architecture/test-strategy.md, CONTRIBUTING.md, and the current diff. Added tools/source-layout.mjs as a lightweight machine-checkable source/test layout convention and checker; wired check:source-layout into pnpm run typecheck and therefore pnpm gate; extended boundary/preflight tests for misplaced src tests, runtime imports from fixtures/testing/fake providers, broad production manifest test/fake exports, and gate/docs alignment; updated CONTRIBUTING.md and docs/architecture/test-strategy.md. Reviewer initially found manifest/fake-provider bypasses; fixed broader manifest fields and fake-* import/export paths with regression coverage. Final independent reviewer APPROVE, architect APPROVE, TEA PASS. Verification: pnpm run check:source-layout passed; focused boundary/preflight tests passed with 13 tests; pnpm run typecheck passed; pnpm gate passed after final fixes with 70 files, 783 passed / 15 skipped; local audits found no runtime src test/spec files and no production imports from test/fixture/testing paths.
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
