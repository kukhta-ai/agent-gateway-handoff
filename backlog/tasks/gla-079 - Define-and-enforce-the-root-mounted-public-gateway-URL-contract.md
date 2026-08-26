---
id: GLA-079
title: Support configured public gateway base paths
status: Done
assignee: []
created_date: '2026-06-12 20:02'
updated_date: '2026-06-13 10:33'
labels:
  - hardening
  - gateway
  - edge-proxy
  - deployment
  - authentik
dependencies:
  - GLA-010
  - GLA-013
  - GLA-033
  - GLA-035
  - GLA-072
  - GLA-074
  - GLA-076
references:
  - >-
    _bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md
  - docs/architecture/baseline.md
  - docs/architecture/authentik-service-standup.md
  - docs/architecture/authentik-dual-method-flow.md
  - packages/gateway/src/handoff-page.ts
  - packages/gateway/src/enroll-page.ts
  - packages/app/src/daemon.ts
  - wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl
  - wpm/wip/installer-skills/edge-proxy-advisor/SKILL.md
  - wpm/wip/installer-skills/gla-core-advisor/SKILL.md
priority: high
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: GLA_PUBLIC_BASE_URL is the externally reachable base for enrollment, handoff, WebSocket, and authentik callback flows. Operators may already have Caddy, authentik, or reverse-proxy layouts where GLA is mounted under a path prefix or other custom public base. GLA should honor the configured public base path instead of assuming root deployment or rejecting subpaths.

Boundary: this task adds base-path-aware public routing and link generation, not arbitrary proxy autodiscovery. The configured public base remains the contract: all public links, browser fetches, WebSocket URLs, and authentik callback URLs must resolve under it, while grant/recipient auth semantics and private bridge/internal ports remain unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GLA_PUBLIC_BASE_URL values with empty/root pathname and with a non-root path prefix both mint enrollment, handoff, reused-auth, authentik callback, and WebSocket URLs under the configured public base without double-prefixing or dropping the prefix.
- [x] #2 Browser-served enrollment, handoff, and callback pages make same-origin HTTP requests and WebSocket connections that remain correct when GLA is mounted under a path prefix.
- [x] #3 Authentik delegated redirect URI can be configured under the same public base path and the returned code/state lands on a GLA-served callback without leaking the GLA grant to authentik.
- [x] #4 Invalid or ambiguous public base values fail before serving starts with actionable errors, including missing scheme or host, malformed URL, path normalization ambiguity, and unsupported query or fragment components.
- [x] #5 Root-mounted deployments remain backward-compatible and continue to produce the existing route shapes.
- [x] #6 Edge-proxy, WPM, and operator-facing docs and templates describe both dedicated-root and subpath/custom-base deployments, including the exact relationship among Caddy public routing, GLA_PUBLIC_BASE_URL, WebSocket upgrade paths, and authentik redirect URI.
- [x] #7 Public base path support does not widen authorization: only configured GLA public routes are reachable, local bridge/internal service ports remain private, and grant/recipient-bound verification behavior is unchanged.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented with BMAD evidence: Dirac worker ran create-story/dev-story/qa validation for GLA-079; Wegener separate reviewer ran story-automator-review and approved after fixes. Added centralized public-base seam, provider-neutral callback landing page, explicit trusted-forwarded-prefix opt-in, docs/templates, executable callback coverage, and full gate evidence. Final pnpm gate passed: 56 test files, 585 passed, 12 skipped; Biome warning remains the known broken symlink wpm/CLAUDE.md.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [x] #7 Architecture gate completed: public-base handling is centralized behind a documented URL/path builder or equivalent seam, with no ad hoc string concatenation in gateway pages, app daemon, authentik callback, or WPM templates.
- [x] #8 Deployment docs and instructions include examples for root, subpath, and separate-domain authentik issuer shapes, and tests cover each supported shape.
<!-- DOD:END -->
