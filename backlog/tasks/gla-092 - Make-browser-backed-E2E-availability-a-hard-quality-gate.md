---
id: GLA-092
title: Make browser-backed E2E availability a hard quality gate
status: To Do
assignee: []
created_date: '2026-06-12 22:59'
labels:
  - testing
  - e2e
  - ci
  - quality-gate
  - browser
  - hardening
dependencies:
  - GLA-066
  - GLA-076
references:
  - CONTRIBUTING.md
  - docs/architecture/test-strategy.md
  - package.json
  - packages/app/src/scenario-01-e2e.test.ts
  - packages/app/src/authentik-scenario-e2e.test.ts
priority: high
ordinal: 92000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: independent test review found that Chromium-backed E2E tests can be absent from pnpm gate while still giving a green result. That creates false confidence exactly where GLA needs end-to-end evidence: real browser navigation, gateway pages, OIDC redirects, WebSocket entrypoint behavior, and recipient-visible handoff flows.

Architectural context: the project Definition of Done depends on the same quality gate being used locally, in pre-commit/CI, and in backlog task closure. Browser-backed E2E tests are part of acceptance evidence for gateway and authentik flows, so their prerequisites must be explicit and failure-visible.

Boundaries: this task hardens test execution and diagnostics. It does not rewrite the E2E scenarios themselves except where necessary to make absent browser/runtime support fail or report explicitly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The project quality gate fails when required browser-backed E2E prerequisites are absent in CI or in a full local gate run, rather than silently skipping the scenarios.
- [ ] #2 A developer running the documented quality gate receives actionable diagnostics for missing browser binaries, launch dependencies, environment flags, ports, or test fixtures.
- [ ] #3 Any intentionally skipped browser-backed E2E mode is opt-in, visible in test output, and cannot satisfy backlog Definition of Done for tasks whose acceptance criteria require browser-level evidence.
- [ ] #4 CI installs or verifies the browser/runtime prerequisites needed by the browser-backed E2E suite before reporting the quality gate green.
- [ ] #5 The package scripts, CONTRIBUTING quality gate, and backlog Definition of Done refer to the same browser-backed E2E behavior and do not diverge.
- [ ] #6 A canary failure in a browser-backed E2E file fails the quality gate in CI and in the documented local full gate command.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created from independent test-quality review. Evidence: package.json gate script and Chromium-dependent tests in packages/app/src/scenario-01-e2e.test.ts and packages/app/src/authentik-scenario-e2e.test.ts. Finding: browser E2E absence can currently look like a pass, weakening DoD evidence.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [ ] #7 Quality-gate documentation describes default, full, and explicitly opted-out browser E2E modes.
- [ ] #8 CI evidence or local reproduction notes show the browser-backed E2E suite is actually executed by the full gate.
<!-- DOD:END -->
