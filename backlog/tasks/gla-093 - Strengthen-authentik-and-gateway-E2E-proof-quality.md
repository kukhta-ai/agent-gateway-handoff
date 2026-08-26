---
id: GLA-093
title: Strengthen authentik and gateway E2E proof quality
status: Done
assignee: []
created_date: '2026-06-12 23:00'
updated_date: '2026-06-14 10:33'
labels:
  - testing
  - e2e
  - authentik
  - gateway
  - false-positive
  - hardening
dependencies:
  - GLA-077
  - GLA-080
  - GLA-086
  - GLA-092
references:
  - docs/architecture/authentik-e2e-verification.md
  - docs/architecture/test-strategy.md
  - packages/app/src/authentik-scenario-e2e.test.ts
  - packages/app/src/scenario-01-e2e.test.ts
  - packages/app/src/completion-e2e.test.ts
  - adapters/auth-authentik/src/auth-authentik.test.ts
  - adapters/auth-authentik/src/fake-authentik.ts
  - packages/app/src/auth-provider-selection.test.ts
  - packages/app/src/authentik-dual-method.test.ts
priority: high
ordinal: 93000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: independent test review found several E2E and adapter tests that can pass while missing the real behavior they claim to prove. The authentik capstone uses a fake IdP and stub noVNC path, bypasses browser callback navigation, forwarded-link negative coverage does not model a valid wrong-recipient login, no-upstream-traffic checks can rely on weak first-chunk assertions, adapter tests skip discovery/remote JWKS behavior, and some seam tests inspect source text instead of stable boundaries.

Architectural context: GLA relies on E2E tests as acceptance evidence for security-critical gateway, authentik, and human-entrypoint flows. Those tests must prove observable user and network outcomes across the same seams the architecture names: AuthProvider, Access Gateway, Human Entrypoint, Session, and Route Controller.

Boundaries: this task improves proof quality and fixtures. It does not change product behavior except where production seams need observability hooks to support reliable security assertions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The authentik browser E2E path exercises a GLA-served OIDC return URL and gateway page flow rather than satisfying handoff by direct test injection of assertions.
- [x] #2 Forwarded-link and wrong-recipient E2E coverage uses a second valid recipient identity that can authenticate successfully to the provider but still cannot authorize the original grant.
- [x] #3 No-traffic-to-capsule assertions are backed by explicit upstream connection and byte counters or equivalent instrumentation, not by absence of an expected first response chunk.
- [x] #4 Auth-authentik adapter contract tests cover discovery, remote JWKS/key rotation behavior, token request redirect_uri shape, invalid state/code handling, and mapped evidence diagnostics.
- [x] #5 Import-boundary and provider-selection seam tests assert stable runtime or AST-level boundaries instead of brittle package-name regex or source-string checks.
- [x] #6 Critical async/network E2E assertions use event-driven waits with bounded diagnostics rather than fixed sleeps that can hide races or produce flaky passes.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GLA-093 implementation evidence: browser callback proof through GLA handoff and /auth/callback, valid wrong-recipient authentik identity refusal, explicit upstream connection/byte counters, adapter discovery/remote-JWKS/key-rotation/diagnostics coverage, provider-neutral boundary assertions, bounded async waits, proof canaries, and architecture/TEA/reviewer approvals recorded in _bmad-output/implementation-artifacts/gla-093-authentik-gateway-e2e-proof-quality-story.md. Validation: focused adapter/authentik/scenario suites passed; pnpm run gate:e2e-proof-canaries passed; pnpm run gate passed with 64 files, 707 passed, 15 skipped.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [x] #7 The authentik E2E verification doc identifies which tests are synthetic, which are browser-level, and which prove deployed-provider behavior.
- [x] #8 At least one deliberate wrong-recipient and one deliberate upstream-leak canary fail the strengthened E2E suite.
<!-- DOD:END -->
