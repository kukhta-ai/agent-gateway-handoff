---
id: GLA-080
title: Align the authentik OIDC callback landing contract
status: To Do
assignee: []
created_date: '2026-06-12 20:02'
updated_date: '2026-06-12 23:01'
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
- [ ] #1 A configured authentik handoff return lands on a GLA-served URL that processes code and state, posts the opaque assertion to the handoff verify route, and authorizes the grant without a 404.
- [ ] #2 A configured authentik enrollment return lands on a GLA-served URL that processes code and state, posts the opaque attestation to the enrollment verify route, and records enrollment without a 404.
- [ ] #3 The advertised GLA_AUTHENTIK_REDIRECT_URI, authentik allowed redirect URI, and Caddy callback guidance name only URL paths that the gateway actually serves for OIDC return handling.
- [ ] #4 A direct, replayed, or contextless callback produces a catchable refusal and authorizes or enrolls nothing.
- [ ] #5 The GLA grant or operator-discharge grant is absent from the outbound authentik authorization URL, redirect URI, logs, and authentik-visible request.
- [ ] #6 The in-tree WebAuthn handoff and enrollment paths still complete without using the OIDC callback contract.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Prepared from the transcript comparison and independent subagent draft: McClintock/callback.

Review mapping update: callback findings are covered here. Evidence: docs/Caddy snippets advertise an authentik callback path while packages/gateway/src/index.ts currently serves enrollment/handoff routes and page-local verify behavior; adapters/auth-authentik/src/oidc.ts expects a redirect flow. GLA-080 must make the callback a real GLA-served route and keep grants out of redirect_uri/authentik-visible requests.
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
