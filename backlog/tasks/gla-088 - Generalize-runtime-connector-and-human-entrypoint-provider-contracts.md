---
id: GLA-088
title: Generalize runtime connector and human-entrypoint provider contracts
status: To Do
assignee: []
created_date: '2026-06-12 22:58'
labels:
  - architecture
  - human-entrypoint
  - session
  - gateway
  - provider-contract
  - hardening
dependencies:
  - GLA-008
  - GLA-023
  - GLA-039
  - GLA-041
  - GLA-076
references:
  - docs/02-provider-and-extension-model.md
  - docs/architecture/kernel-contracts.md
  - docs/components/access-gateway.md
  - docs/components/session-service.md
  - docs/components/route-controller.md
  - docs/components/worker-plane.md
  - packages/kernel/src/runtime-handle.ts
  - packages/session/src/index.ts
  - packages/gateway/src/index.ts
  - packages/route/src/index.ts
  - packages/worker/src/index.ts
priority: high
ordinal: 88000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: independent architecture review found that several core seams still encode today's CDP/noVNC realization instead of the documented provider-horizontal model. RuntimeDescriptor names CDP and noVNC fields, Session lifecycle keys connector ownership to CDP URLs, Access Gateway routes are noVNC/WebSocket-shaped, RouteController mixes authorization route programming with reverse-proxy transport routing, and WorkerManager falls back to a provider-specific temp workspace. These couplings make GLA harder to extend to additional Agent Connector and Human Entrypoint technologies.

Architectural context: the project model treats Agent Connector, Human Entrypoint, Access Gateway, Session, Route Controller, and Worker Plane as separate layers with ports between them. noVNC and CDP are current providers, not kernel concepts. This task establishes the provider-neutral contracts that later noVNC and authentik tasks must build on.

Boundaries: this task does not add a new concrete connector or human-view provider. It defines and enforces the extension seams so current providers continue to work while future providers can be added without editing core/session/auth/capability logic.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Runtime handles expose provider-neutral endpoint descriptors for agent connectors and human entrypoints without CDP or noVNC field names in the kernel contract.
- [ ] #2 Session lifecycle, bind, unbind, reuse, and teardown behavior identifies connector and entrypoint resources through provider-neutral resource identities rather than CDP URLs or noVNC endpoint shapes.
- [ ] #3 Access Gateway authorization and route registration can represent HumanEntrypoint providers with different browser-client asset and transport requirements while preserving identical grant and recipient enforcement outcomes.
- [ ] #4 Reverse-proxy transport programming and Access Gateway authorization route programming are distinct boundaries, and diagnostics show which layer owns a route failure.
- [ ] #5 Missing or unresolved provider workspace state fails closed with an actionable diagnostic instead of silently falling back to a provider-specific default workspace.
- [ ] #6 Existing CDP and noVNC providers remain behaviorally compatible through adapter-owned mappings, and import-boundary tests prevent provider-specific runtime fields from re-entering kernel/session/capability/auth logic.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created from independent architecture/layering review findings. Evidence: packages/kernel/src/runtime-handle.ts currently names CDP/noVNC fields; packages/session/src/index.ts keys connector lifecycle around CDP URLs; packages/gateway/src/index.ts is noVNC/WebSocket-shaped; packages/route/src/index.ts conflates route authorization with Caddy transport programming; packages/worker/src/index.ts contains a provider-specific workspace fallback.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [ ] #7 Architecture docs are updated to name the provider-neutral runtime endpoint, connector-resource, human-entrypoint, route-authorization, and reverse-proxy transport seams.
- [ ] #8 Boundary tests cover adding a fake non-CDP connector and a fake non-noVNC human-entrypoint provider without kernel/session/capability/auth edits.
<!-- DOD:END -->
