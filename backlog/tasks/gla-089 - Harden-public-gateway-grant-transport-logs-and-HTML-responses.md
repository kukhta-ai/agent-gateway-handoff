---
id: GLA-089
title: 'Harden public gateway grant transport, logs, and HTML responses'
status: To Do
assignee: []
created_date: '2026-06-12 22:58'
labels:
  - security
  - gateway
  - bearer-grant
  - html
  - edge-proxy
  - hardening
dependencies:
  - GLA-035
  - GLA-039
  - GLA-079
  - GLA-080
  - GLA-084
references:
  - docs/components/access-gateway.md
  - docs/architecture/baseline.md
  - docs/architecture/authentik-dual-method-flow.md
  - packages/gateway/src/index.ts
  - packages/gateway/src/handoff-page.ts
  - packages/gateway/src/enroll-page.ts
  - packages/kernel/src/assembly.ts
  - packages/bridge/src/index.ts
  - wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl
priority: high
ordinal: 89000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: independent security review found that bearer grants can remain in public URLs, request logs, browser state, and gateway-rendered HTML. Gateway pages also embed JSON in script data islands while recipient-controlled strings are only lightly validated, making public HTML rendering part of the security boundary. This is separate from operator redaction because it covers browser history, referrers, edge-proxy logs, cache behavior, and script/HTML breakout resistance.

Architectural context: Access Gateway is the guard in front of internal capsule and session state. It can deliver recipient links, but grants must not become ambient public identifiers that leak through external IdPs, reverse proxies, logs, caches, referrers, or unsafe HTML serialization.

Boundaries: this task does not change grant meaning, recipient binding, or authentik assurance policy. It hardens how public gateway flows carry, scrub, render, cache, and log security-bearing values.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Grant-bearing enrollment and handoff flows do not leave raw grant values in browser-visible URLs, referrers, authentik-visible requests, edge-proxy access logs, or gateway logs after the recipient bootstrap point has been consumed.
- [ ] #2 Gateway-served enrollment, handoff, callback, refusal, and unavailable responses include cache and referrer protections appropriate for bearer or recipient-bound security state.
- [ ] #3 Adversarial recipient, path, and grant-shaped values cannot break out of gateway HTML, script data islands, attributes, URLs, or client-side state containers.
- [ ] #4 Wrong-recipient, expired, replayed, revoked, and not-yet-authorized attempts produce refusals without exposing raw grants or upstream endpoint details in public responses.
- [ ] #5 Caddy and WPM edge-proxy templates either avoid logging grant-bearing request components or redact them consistently with daemon and audit redaction.
- [ ] #6 Canary E2E coverage proves the same raw grant and adversarial display strings are absent from public HTML, response headers, browser referrer targets, gateway logs, edge logs, and audit egress.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created from independent security and local inspection findings. Evidence includes packages/gateway/src/index.ts URL/log surfaces; packages/gateway/src/handoff-page.ts and packages/gateway/src/enroll-page.ts script data islands/sessionStorage behavior; packages/kernel/src/assembly.ts and packages/bridge/src/index.ts recipient validation; wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl access logging.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [ ] #7 Security review covers URL transport, referrer behavior, cache behavior, edge logging, gateway rendering, and HTML/script serialization.
- [ ] #8 Docs describe which recipient-facing values may be bearer-bearing, where they are scrubbed, and which logs or public surfaces must never contain them.
<!-- DOD:END -->
