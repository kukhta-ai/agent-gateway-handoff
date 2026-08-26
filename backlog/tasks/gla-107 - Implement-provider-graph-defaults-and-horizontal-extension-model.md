---
id: GLA-107
title: Implement provider graph defaults and horizontal extension model
status: Done
assignee: []
created_date: '2026-06-14 22:49'
updated_date: '2026-06-15 04:15'
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
- [x] #1 Provider defaults are selected by named profiles rather than hard-coded application composition.
- [x] #2 Runtime provider packages and template packages are represented and validated through their appropriate package contracts.
- [x] #3 Catalog, Doctor, Provider Host boot, and Admission consume one deterministic graph projection for compatibility, availability, and diagnostics.
- [x] #4 A provider added through the supported author and install path is discoverable through catalog, schema, skills, and dry-run admission without edits to narrow-waist packages.
- [x] #5 Security-bearing graph contracts for auth assurance, WPM evidence, public-edge transport, provider assets, and provider state have negative test coverage.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed the provider graph defaults and horizontal extension epic after all child tasks GLA-107.01 through GLA-107.13 reached Done. Parent evidence: named ProviderProfile defaults are implemented and tested in the reference provider set and app composition; ProviderPackage and TemplatePackage authoring/validation surfaces are implemented and tested; Catalog, Doctor, Provider Host boot, and Admission consume the deterministic provider graph projection; non-reference provider extension is proven through catalog/schema/skills/template/dry-run admission without narrow-waist edits; security-bearing contracts have negative coverage for auth assurance, WPM evidence, public-edge transport, provider assets, provider state, provider boundaries, secrets, compatibility, and runtime post-boot registration. TEA epic gate: bmad-testarch-trace and bmad-testarch-nfr loaded in Create mode with docs/backlog fallback; Trace PASS, NFR/Security PASS, blockers none; TEA reran pnpm run gate and focused capstone tests and approved parent closure. Verification: latest pnpm run gate passed with 77 test files, 847 passed, 15 skipped; focused capstone provider-profile/provider-set tests passed 17 tests; git diff --check clean. SDLC retrospective note: bmad-retrospective was loaded and its workflow requires active user participation at multiple WAIT gates; for this unattended implementation run, formal retrospective is deferred/user-gated rather than silently fabricated.
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
