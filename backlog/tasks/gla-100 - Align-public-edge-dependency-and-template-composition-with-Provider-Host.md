---
id: GLA-100
title: Align public-edge dependency and template composition with Provider Host
status: To Do
assignee: []
created_date: '2026-06-14 13:25'
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
- [ ] #1 CapsuleTemplate availability and compatibility are derived from registered provider manifests, provider-host availability, WPM dependency bindings, and current probes rather than duplicated static compatibility tables.
- [ ] #2 A template that names an unknown, unavailable, incompatible, or disabled provider is rejected from admission with stable catalog/provider diagnostics before any session, route, or capsule is created.
- [ ] #3 Public-edge proxy requirements are modeled as dependency and route-transport evidence, and diagnostics distinguish exposure/proxy transport failures from Access Gateway grant, recipient, and auth-assurance failures.
- [ ] #4 Caddy, future nginx/Traefik alternatives, custom public base URLs, and subpath deployments remain compatible with provider-host catalog reads without giving the exposure layer authority to bypass GLA gateway checks.
- [ ] #5 Template, catalog, and doctor outputs show which provider family and dependency evidence make each required part usable, while exposing connection secrets only as secret references.
- [ ] #6 Architecture and operator docs explain the public-edge versus Access Gateway boundary, including why authentik forward-auth or outpost deployments may be outer guards but cannot replace GLA grants and recipient checks.
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
