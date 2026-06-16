---
id: GLA-110
title: >-
  Refactor provider layer around registry, deployment config, and capsule
  composition
status: To Do
assignee: []
created_date: '2026-06-16 09:45'
updated_date: '2026-06-16 09:54'
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
- [ ] #1 The app exposes a single provider-layer model where executable providers are discoverable through a registry, app infrastructure selection is separate from capsule composition, and legacy ProviderSet/Profile nouns are no longer required to understand runtime behavior.
- [ ] #2 Every provider-facing layer has task-level coverage in the backlog: registry/boot, deployment config, capsule composition, catalog/admission, runtime provisioning, CLI/UX, docs/migration, and regression verification.
- [ ] #3 The completed slice preserves existing reference scenarios and default package behavior while making provider extension points observable through the new model.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Tracking parent for the provider-layer refactor. Treat the executable implementation stories as subtasks and start with GLA-110.01; do not attempt to implement the whole epic parent as one story.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [ ] #7 All subtasks GLA-110.01 through GLA-110.13 are Done before the parent is marked Done.
- [ ] #8 The parent final summary links to the final contract, migration guidance, and cross-layer verification evidence.
- [ ] #9 Backlog status shows no open provider-refactor subtasks that are required for the approved refactor scope.
<!-- DOD:END -->
