---
id: GLA-103
title: Move package and provider unit contract tests out of src
status: To Do
assignee: []
created_date: '2026-06-14 13:35'
labels:
  - test-architecture
  - source-layout
  - unit-tests
  - contract-tests
  - providers
dependencies:
  - GLA-102
references:
  - packages/kernel/src
  - packages/session/src
  - packages/catalog/src
  - adapters/auth-authentik/src
  - adapters/entrypoint-novnc/src
  - adapters/connector-cdp/src
documentation:
  - docs/architecture/test-strategy.md
priority: high
ordinal: 103000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: most core, core-adjacent, adapter, and surface tests are currently stored inside src. This hides the distinction between production runtime code and test contracts, and it will become noisier as provider-host contract tests multiply.

Context: package and provider tests should remain owned by the package that owns the seam. This task moves unit and contract tests to package-local test directories without centralizing them into a disconnected top-level test tree.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Core and core-adjacent package unit tests live in package-local test/unit or equivalent documented directories outside src.
- [ ] #2 Adapter and provider contract tests live in provider-local test/contract or equivalent documented directories outside src.
- [ ] #3 Package-local fixtures and test helpers live outside runtime src and are not exported as production API.
- [ ] #4 Moved tests preserve their current assertions, naming clarity, and package ownership, and imports continue to exercise public seams unless a test is explicitly documented as an internal unit test.
- [ ] #5 The quality gate runs and typechecks the moved package/provider tests from their new locations.
- [ ] #6 No production package relies on importing from another package's test directory or fixture directory.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
