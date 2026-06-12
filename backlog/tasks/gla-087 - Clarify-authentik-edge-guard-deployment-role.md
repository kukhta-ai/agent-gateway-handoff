---
id: GLA-087
title: Clarify authentik edge-guard deployment role
status: To Do
assignee: []
created_date: '2026-06-12 21:51'
updated_date: '2026-06-12 23:00'
labels:
  - authentik
  - deployment
  - gateway
  - edge-proxy
  - docs
dependencies:
  - GLA-074
  - GLA-079
  - GLA-080
references:
  - docs/architecture/authentik-service-standup.md
  - docs/architecture/authentik-integration.md
  - docs/components/access-gateway.md
  - docs/architecture/baseline.md
  - 'https://docs.goauthentik.io/add-secure-apps/providers/proxy/forward_auth/'
  - 'https://docs.goauthentik.io/add-secure-apps/providers/proxy/'
priority: high
ordinal: 87000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: operators can reasonably expect authentik to be the internet-facing guard in front of VPS internals, while this project currently uses authentik primarily as a delegated OIDC AuthProvider behind GLA's own grant-checking Access Gateway. The deployment model must make that boundary explicit so Caddy, authentik, and GLA are wired without false assumptions about which component protects handoff, enrollment, callback, bridge, and internal ports.

Boundaries: this task does not replace GLA grant verification with authentik proxy policy. It documents and verifies the supported deployment roles and keeps capsule-route authorization owned by GLA.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Operator-facing deployment docs distinguish authentik-as-GLA-OIDC-provider from authentik proxy or forward-auth guarding other upstream applications, and state which role is required for GLA handoff step-up.
- [ ] #2 A deployment diagram or equivalent operator surface shows Caddy, GLA public gateway routes, authentik OIDC endpoints, authentik callback routing, and private bridge/internal ports with the owner of each authorization decision.
- [ ] #3 A deployment that assumes authentik proxy protection while the GLA AuthProvider or callback wiring is absent produces an actionable diagnostic instead of a misleading partially working login.
- [ ] #4 When authentik proxy or forward-auth is used in addition to OIDC, GLA handoff and enrollment grants are still verified by GLA and cannot be bypassed by an authentik session alone.
- [ ] #5 Caddy/authentik examples cover supported root, subpath, and separate-domain deployment shapes without presenting unguarded callback URLs or direct internal daemon access as valid configurations.
- [ ] #6 The supported public deployment exposes only configured GLA public gateway routes under the configured public base, plus required authentik endpoints, while local bridge and internal service ports remain private.
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created from the authentik expectation review: authentik can be an edge guard/proxy, but GLA currently relies on it as a delegated identity provider while GLA remains the handoff/enrollment authorization point.

Review mapping update: root-only language was removed to align with GLA-079. This task now documents authentik edge-guard roles for configured public bases, including root, subpath, and separate-domain shapes, while keeping GLA as the handoff/enrollment authorization point.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [ ] #7 Deployment docs explicitly state that authentik can guard other upstream applications, but GLA handoff authorization remains inside the Access Gateway grant/recipient check.
<!-- DOD:END -->
