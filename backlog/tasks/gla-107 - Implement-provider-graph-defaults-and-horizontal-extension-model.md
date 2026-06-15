---
id: GLA-107
title: Implement provider graph defaults and horizontal extension model
status: To Do
assignee: []
created_date: '2026-06-14 22:49'
updated_date: '2026-06-15 01:44'
labels:
  - provider-graph
  - epic
dependencies:
  - GLA-107.10
references:
  - docs/architecture/provider-graph-defaults-and-extension-plan.md
  - docs/02-provider-and-extension-model.md
  - docs/architecture/provider-host-extension-architecture.md
priority: high
ordinal: 107000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Epic for making the provider graph direction implementable: default providers are profile-selected packages, templates are catalog packages, graph resolution is deterministic, and user/operator agents can add providers horizontally without editing runtime narrow-waist packages.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Provider defaults are selected by named profiles rather than hard-coded application composition.
- [ ] #2 Runtime provider packages and template packages are represented and validated through their appropriate package contracts.
- [ ] #3 Catalog, Doctor, Provider Host boot, and Admission consume one deterministic graph projection for compatibility, availability, and diagnostics.
- [ ] #4 A provider added through the supported author and install path is discoverable through catalog, schema, skills, and dry-run admission without edits to narrow-waist packages.
- [ ] #5 Security-bearing graph contracts for auth assurance, WPM evidence, public-edge transport, provider assets, and provider state have negative test coverage.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Planned from docs/architecture/provider-graph-defaults-and-extension-plan.md after independent architect adversarial review. BMAD create-epics-and-stories was loaded; its first step is user-confirmation gated, so this uses the project docs-driven fallback and Backlog.md CLI only.

Epic parent is intentionally dependent on GLA-107.10 so backlog sequencing treats the child stories as implementation work and the parent as the final closure record.

2026-06-15 UX clarification: the epic carries three separate UX design tasks, not one authority-mode thesis: GLA-107.11 covers developer/provider authoring, GLA-107.12 covers operator install/update, and GLA-107.13 covers runtime discovery/consumption. The same physical agent may perform all three on an operator VPS, but the design boundary is the UX journey and handoff, with write/read restrictions treated as constraints inside each journey.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
