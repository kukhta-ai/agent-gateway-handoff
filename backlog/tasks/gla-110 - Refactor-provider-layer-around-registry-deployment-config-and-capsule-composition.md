---
id: GLA-110
title: >-
  Refactor provider layer around registry, deployment config, and capsule
  composition
status: Done
assignee: []
created_date: '2026-06-16 09:45'
updated_date: '2026-06-17 00:04'
labels:
  - provider-refactor
  - architecture
dependencies: []
references:
  - docs/architecture/provider-layer-refactor-as-is-to-be.html
priority: high
ordinal: 123000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Plan and execute the provider-layer simplification approved by the AS IS / TO BE diagram. Scope covers provider registration, app deployment selection, capsule composition, catalog/admission resolution, runtime provisioning, CLI/UX diagnostics, compatibility/migration docs, and regression coverage.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The app exposes a single provider-layer model where executable providers are discoverable through a registry, app infrastructure selection is separate from capsule composition, and legacy ProviderSet/Profile nouns are no longer required to understand runtime behavior.
- [x] #2 Every provider-facing layer has task-level coverage in the backlog: registry/boot, deployment config, capsule composition, catalog/admission, runtime provisioning, CLI/UX, docs/migration, and regression verification.
- [x] #3 The completed slice preserves existing reference scenarios and default package behavior while making provider extension points observable through the new model.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Tracking parent for the provider-layer refactor. Treat the executable implementation stories as subtasks and start with GLA-110.01; do not attempt to implement the whole epic parent as one story.

2026-06-16 DoD audit: reviewed GLA-110 and subtasks GLA-110.01 through GLA-110.14. Each task carries task-specific DoD items in addition to the shared quality gate; GLA-110.14 was strengthened with final-removal documentation/API scan and reference-scenario verification checks.

2026-06-17 parent closure audit: GLA-110.01 through GLA-110.14 are Done, backlog sequence exposes only the parent, and a CLI audit found no unchecked AC/DoD rows across the required subtasks. Final verification evidence comes from GLA-110.14: full pnpm run gate passed with typecheck, Biome lint/format, required browser E2E preflight, and Vitest 82 files / 934 passed / 15 skipped; boundary scan rejects legacy provider-set/profile runtime inputs and supported UX fallbacks.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Provider-layer refactor completed through subtasks GLA-110.01 through GLA-110.14. Final contract and migration guidance: docs/architecture/provider-layer-refactor-contract.md. Cross-layer verification and regression matrix: docs/architecture/provider-layer-refactor-regression-matrix.md. AS IS / TO BE diagram: docs/architecture/provider-layer-refactor-as-is-to-be.html. Completed model: ProviderRegistry is the boot-time executable provider boundary; AppDeploymentConfig selects non-capsule app infrastructure; capsuleProviders/capsuleProviderConfig describe per-capsule composition; catalog/admission/provisioning consume resolved graph/capsule plans. Legacy ProviderSet/Profile compatibility support was removed from app runtime inputs, CLI supported commands, UX/API docs, and boundary allowlists, with remaining terminology limited to archived migration history.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [x] #7 The parent final summary links to the final contract, migration guidance, and cross-layer verification evidence.
- [x] #8 Backlog status shows no open provider-refactor subtasks that are required for the approved refactor scope.
- [x] #9 All subtasks GLA-110.01 through GLA-110.14 are Done before the parent is marked Done.
- [x] #10 Each provider-refactor subtask has task-specific Definition-of-Done evidence beyond the shared quality gate before the parent is closed.
<!-- DOD:END -->
