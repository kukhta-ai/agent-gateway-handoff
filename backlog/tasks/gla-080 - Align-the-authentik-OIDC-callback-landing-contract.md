---
id: GLA-080
title: Align the authentik OIDC callback landing contract
status: Done
assignee: []
created_date: '2026-06-12 20:02'
updated_date: '2026-06-13 11:00'
labels:
  - hardening
  - authentik
  - oidc
  - gateway
  - identity-provider
dependencies:
  - GLA-072
  - GLA-074
  - GLA-076
  - GLA-079
references:
  - >-
    _bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md
  - docs/architecture/authentik-dual-method-flow.md
  - docs/architecture/authentik-enrollment.md
  - docs/architecture/authentik-service-standup.md
  - packages/gateway/src/index.ts
  - packages/gateway/src/handoff-page.ts
  - packages/gateway/src/enroll-page.ts
  - >-
    wpm/wip/bundles/identity-provider/payload/templates/caddy-authentik-callback.snippet
priority: high
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the authentik OIDC return contract has drifted. The docs and Caddy snippet advertise a callback path, while the gateway currently serves only enrollment and handoff routes with page-local redirect return handling. The configured redirect URI, gateway-served page, callback documentation, and bundle wiring need one coherent contract.

Boundaries: preserve the unchanged verify routes and provider-agnostic gateway model; the callback must not become a privileged bypass or expose grants to authentik.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A configured authentik handoff return lands on a GLA-served URL that processes code and state, posts the opaque assertion to the handoff verify route, and authorizes the grant without a 404.
- [x] #2 A configured authentik enrollment return lands on a GLA-served URL that processes code and state, posts the opaque attestation to the enrollment verify route, and records enrollment without a 404.
- [x] #3 The advertised GLA_AUTHENTIK_REDIRECT_URI, authentik allowed redirect URI, and Caddy callback guidance name only URL paths that the gateway actually serves for OIDC return handling.
- [x] #4 A direct, replayed, or contextless callback produces a catchable refusal and authorizes or enrolls nothing.
- [x] #5 The GLA grant or operator-discharge grant is absent from the outbound authentik authorization URL, redirect URI, logs, and authentik-visible request.
- [x] #6 The in-tree WebAuthn handoff and enrollment paths still complete without using the OIDC callback contract.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented GLA-080 under Phase 5 with persistent worker/reviewer roles. Evidence: bmad-create-story artifact updated; bmad-dev-story/bmad-qa workflow evidence recorded; live gateway callback landing tests added for authentik handoff and enrollment; no-grant-leak assertions added at outbound authentik boundary; architecture docs aligned to GLA-served provider-neutral /auth/callback contract; exact stale callback terminology scan clean; focused regression passed (7 files, 101 passed, 3 skipped); full pnpm gate passed (typecheck, Biome with known wpm/CLAUDE.md symlink warning, Vitest 56 files, 591 passed, 12 skipped). Independent reviewer Wegener ran bmad-story-automator-review, requested docs alignment follow-up, then approved after fixes.
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
