---
id: GLA-100
title: Align public-edge dependency and template composition with Provider Host
status: Done
assignee: []
created_date: '2026-06-14 13:25'
updated_date: '2026-06-14 17:03'
labels:
  - architecture
  - provider-host
  - public-edge
  - templates
  - catalog
  - wpm
dependencies:
  - GLA-095
  - GLA-082
  - GLA-079
references:
  - docs/components/access-gateway.md
  - docs/components/route-controller.md
  - docs/04-capsule-assembly.md
  - docs/architecture/catalog-dependency-bindings.md
  - packages/catalog/src/manifests.ts
  - packages/route/src/index.ts
documentation:
  - docs/architecture/provider-host-extension-architecture.md
priority: high
ordinal: 100000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: public edge and capsule templates use the same provider/dependency vocabulary as other layers, but they must not be confused with AuthProvider or Access Gateway internals. The edge proxy is a dependency/transport layer, while templates are declarative compositions of provider capabilities.

Context: this task aligns edge and template metadata with Provider Host state after the runtime providers have a shared registration mechanism. It preserves the Access Gateway as GLA's grant/recipient enforcement point and keeps Caddy/nginx/Traefik as exposure dependencies rather than auth decision makers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CapsuleTemplate availability and compatibility are derived from registered provider manifests, provider-host availability, WPM dependency bindings, and current probes rather than duplicated static compatibility tables.
- [x] #2 A template that names an unknown, unavailable, incompatible, or disabled provider is rejected from admission with stable catalog/provider diagnostics before any session, route, or capsule is created.
- [x] #3 Public-edge proxy requirements are modeled as dependency and route-transport evidence, and diagnostics distinguish exposure/proxy transport failures from Access Gateway grant, recipient, and auth-assurance failures.
- [x] #4 Caddy, future nginx/Traefik alternatives, custom public base URLs, and subpath deployments remain compatible with provider-host catalog reads without giving the exposure layer authority to bypass GLA gateway checks.
- [x] #5 Template, catalog, and doctor outputs show which provider family and dependency evidence make each required part usable, while exposing connection secrets only as secret references.
- [x] #6 Architecture and operator docs explain the public-edge versus Access Gateway boundary, including why authentik forward-auth or outpost deployments may be outer guards but cannot replace GLA grants and recipient checks.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GLA-100 SDLC evidence: worker loaded bmad-create-story/dev-story/qa-generate-e2e-tests paths; BMAD sprint-status/story artifact auto-discovery remained unavailable, so implementation used docs/backlog fallback per recorded SDLC deviation. Full gate passed on 2026-06-14 UTC: pnpm gate = typecheck, Biome, browser E2E preflight, Vitest 66 files / 768 passed / 15 skipped. TEA re-review PASS after compatibility over-admission fix; separate reviewer APPROVE after focused catalog/admission/app/provider-set tests and git diff --check. Public edge is modeled as template-level dependency/transport evidence, Access Gateway remains grant/recipient/auth-assurance PEP, and compatibility is derived from manifests/relations/defaults rather than app-local tables.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Provider Host-aligned template availability and compatibility: browser-handoff now carries edge-proxy transport dependency evidence, catalog derives template/provider diagnostics from manifests, dependency bindings, probes, and selected defaults, admission fails closed before state creation for unavailable template/provider evidence, and docs describe the public-edge vs Access Gateway boundary.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
