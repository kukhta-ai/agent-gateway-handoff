---
id: GLA-083
title: Refuse stale public handoff links with typed outcomes
status: To Do
assignee: []
created_date: '2026-06-12 20:03'
labels:
  - hardening
  - gateway
  - handoff
  - auth
  - regression
dependencies:
  - GLA-035
  - GLA-039
  - GLA-045
  - GLA-065
  - GLA-076
references:
  - >-
    _bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md
  - docs/components/access-gateway.md
  - docs/components/session-service.md
  - docs/components/route-controller.md
  - docs/architecture/test-strategy.md
  - packages/gateway/src/index.ts
  - packages/gateway/src/handoff-page.ts
  - packages/session/src/index.ts
  - surfaces/cli/src/cli.ts
  - packages/kernel/src/errors.ts
priority: high
ordinal: 83000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: public handoff links whose window is expired, revoked, closed, or unmounted should fail closed as handoff/auth refusals, not as catalog lookup misses. Random unknown public paths should remain generic not-found.

Boundaries: this task does not expose route history for arbitrary paths and does not weaken grant verification or route unmounting.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A valid open handoff link still serves the normal handoff page and reaches the capsule only after required authorization.
- [ ] #2 An expired public handoff link returns a machine-readable handoff or auth refusal outcome and never returns catalog.unknown.
- [ ] #3 A revoked, completed, cancelled, or torn-down handoff link returns a machine-readable handoff or auth refusal outcome and never returns catalog.unknown.
- [ ] #4 Browser follow-up calls from a stale handoff page, including handoff auth options and verify, return the same typed refusal family rather than catalog.unknown or a generic unknown-route usage error.
- [ ] #5 A WebSocket upgrade using a stale handoff link is rejected before any upstream capsule connection is opened or retained.
- [ ] #6 Unrelated unknown public paths still return generic not-found without exposing handoff route history.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Prepared from the transcript comparison and independent subagent draft: Pascal/stale-link.
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
