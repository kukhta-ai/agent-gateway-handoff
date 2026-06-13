# Story GLA-089: Harden public gateway grant transport, logs, and HTML responses

Status: implemented — review cycle 1

Source task: GLA-089 via `backlog task GLA-089 --plain`
Branch: feature/authentik-task-089
BMAD workflows invoked: `bmad-create-story`, then `bmad-dev-story` in planning-only mode; implementation completed by main worker; independent reviewer/TEA review requested
Workflow mode: spec-exists fallback. `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent, so Backlog.md remains the story contract and committed docs/code provide implementation context.

## Story

As an operator and security reviewer, I want public gateway browser flows to keep bearer grants out of durable public URLs, referrers, logs, and rendered HTML after the recipient bootstrap point is consumed, so enrollment and handoff remain usable without exposing grant-bearing state to proxies, providers, browser history, or script/HTML breakout paths.

## Acceptance Criteria

1. Grant-bearing enrollment and handoff flows do not leave raw grant values in browser-visible URLs, referrers, authentik-visible requests, edge-proxy access logs, or gateway logs after recipient bootstrap point consumed.
2. Gateway-served enrollment, handoff, callback, refusal, and unavailable responses include cache and referrer protections appropriate for bearer or recipient-bound security state.
3. Adversarial recipient, path, and grant-shaped values cannot break out of gateway HTML, script data islands, attributes, URLs, or client-side state containers.
4. Wrong-recipient, expired, replayed, revoked, and not-yet-authorized attempts produce refusals without exposing raw grants or upstream endpoint details in public responses.
5. Caddy and WPM edge-proxy templates either avoid logging grant-bearing request components or redact them consistently with daemon and audit redaction.
6. Canary E2E coverage proves the same raw grant and adversarial display strings are absent from public HTML, response headers, browser referrer targets, gateway logs, edge logs, and audit egress.

## Definition-of-Done Emphasis

DoD #7 security review must explicitly cover URL transport, referrer behavior, cache behavior, edge logging, gateway rendering, and HTML/script serialization.

DoD #8 documentation alignment must describe which recipient-facing values may be bearer-bearing, where they are scrubbed, and which logs/public surfaces must never contain them.

## Context Read

- `docs/task-writing-conventions.md`
- `docs/components/access-gateway.md`
- `docs/architecture/baseline.md`
- `docs/architecture/authentik-dual-method-flow.md`
- `docs/architecture/test-strategy.md`
- `docs/architecture/dependency-strategy.md`
- `_bmad-output/implementation-artifacts/gla-079-public-base-paths-story.md`
- `_bmad-output/implementation-artifacts/gla-080-authentik-callback-landing-contract-story.md`
- `_bmad-output/implementation-artifacts/gla-084-redaction-hardening-story.md`
- `_bmad-output/implementation-artifacts/gla-088-runtime-connector-and-human-entrypoint-provider-contracts-story.md`
- `packages/gateway/src/index.ts`
- `packages/gateway/src/handoff-page.ts`
- `packages/gateway/src/enroll-page.ts`
- `packages/gateway/src/callback-page.ts`
- `packages/kernel/src/assembly.ts`
- `packages/kernel/src/redaction.ts`
- `packages/bridge/src/index.ts`
- `packages/audit/src/index.ts`
- `surfaces/cli/src/cli.ts`
- `wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl`

## Current Behavior Model

- The Access Gateway remains the sole public grant authorization point for enrollment, handoff, callback, and stream upgrades. Caddy and authentik proxy/forward-auth are transport or outer-guard layers only and cannot replace GLA grant or recipient checks.
- `AccessGateway.enrollLink()` and `AccessGateway.handoffLink()` currently build recipient-facing links with `?grant=` query parameters. Recipient delivery must remain usable, but browser flows must scrub grant-bearing URLs after bootstrap consumes the value.
- `handoffPageHtml()` and `authCallbackPageHtml()` use `jsonScriptData()` to escape JSON data islands. `enrollPageHtml()` currently uses plain `JSON.stringify()` for the data island and should be hardened to the shared safe serializer.
- Enrollment, handoff, and callback scripts already use same-origin session storage for redirect continuity and call `history.replaceState()` in several paths. GLA-089 must make the scrubbing contract explicit and tested for enrollment, handoff, callback, and reused-hand-off paths.
- `sendHtml()` already applies `cache-control: no-store`, `referrer-policy: no-referrer`, and `x-content-type-options: nosniff`. JSON responses currently have narrower headers and need review for security-bearing options, verify, refusal, and unavailable responses.
- GLA-084 added shared operator/audit redaction utilities in `packages/kernel/src/redaction.ts`. GLA-089 should reuse that boundary for gateway/operator/audit text instead of creating divergent redaction logic.
- CLI/operator read models already redact handoff links through `redactOperatorEgress()`, while recipient delivery still carries usable grant-bearing links. Preserve that split.
- The edge-proxy Caddy template currently includes plain `log` directives in examples. This story requires either no grant-bearing request component logging or a tested Caddy-supported redacted/no-query logging strategy.

## Architecture Guardrails

- Preserve provider-neutral gateway/core boundaries. Do not add authentik-specific authorization branches to grant verification or handoff stream access.
- Preserve capability semantics and recipient binding. This task hardens transport/rendering/logging only; it must not change what a grant authorizes or who may redeem it.
- Preserve private bridge/internal ports and upstream details. Public refusal, unavailable, and diagnostic responses must not expose private hostnames, ports, connector URLs, or provider endpoints.
- Treat recipient-facing grant links as bearer-bearing only at the delivery/bootstrap seam. They may be delivered to the intended recipient, then must be scrubbed from durable browser-visible locations after the page consumes them.
- Do not rely on Caddy, authentik proxy/forward-auth, or browser asset routing to enforce GLA authorization. Gateway grant checks still run on every protected request and WebSocket upgrade.
- Do not make persistence or logging a raw dump of request URLs. Any request-target logging added by this task must pass through the shared redaction contract first.
- Public-base and forwarded-prefix behavior from GLA-079 must remain intact for root, subpath, and separate-domain deployment shapes.
- Keep recipient delivery usable. Do not redact or remove the actual grant from channel delivery before the recipient can open the bootstrap page.

## Tasks and Subtasks

- Add RED tests for public security headers across enrollment, handoff, callback, refusal, unavailable, and security-bearing JSON responses.
- Add browser/client tests proving enrollment, handoff, callback, reused handoff, and redirect-return paths remove grant-bearing query parameters after bootstrap consumption.
- Harden enrollment page data-island serialization to use the shared safe JSON script serializer.
- Review and harden refusal/unavailable HTML interpolation so adversarial reason, path, recipient, or grant-shaped values cannot break out of text, attributes, URLs, scripts, or client-side state containers.
- Extend negative grant tests for wrong-recipient, expired, replayed, revoked, and not-yet-authorized attempts to assert no raw grant, private upstream endpoint, or internal transport detail appears in public body or headers.
- Add log/audit canary coverage that scans gateway log output, audit egress, and edge-proxy log output or generated log template behavior for raw grants and adversarial display strings.
- Harden WPM edge-proxy Caddy template logging. Either remove access logging from grant-bearing public route examples or use a tested no-query/redacted format consistent with daemon and audit redaction.
- Update implementation docs or comments required for DoD #8 to describe bearer-bearing recipient values, where they are scrubbed, and which public/operator/log surfaces must never contain them.
- Run focused gateway/app/template tests, then the project quality gate: `pnpm run gate`.

## AC-to-Test Plan

- AC1: Browser-oriented gateway tests open grant-bearing enrollment and handoff links, then assert `location.href`, `history`, callback/authentik-visible redirect targets, captured referrer targets, gateway logs, and edge logs do not retain the raw grant after bootstrap consumption. Tests must still prove the recipient delivery link was usable.
- AC2: Gateway integration tests assert `cache-control: no-store`, `referrer-policy: no-referrer`, and `x-content-type-options: nosniff` on enrollment, handoff, callback, refusal, and unavailable HTML responses, plus security-bearing JSON options/verify/error responses where bearer or recipient-bound state is present.
- AC3: Serialization tests feed adversarial recipient labels, route paths, grant-shaped strings, client asset metadata, and refusal messages into enrollment, handoff, reused-handoff, callback, refusal, and unavailable renderers. Assertions must prove no `</script>` breakout, executable attribute injection, unsafe URL injection, or malformed client state container.
- AC4: Negative authorization tests cover wrong-recipient, expired, replayed, revoked, and not-yet-authorized attempts for page and stream paths. Public responses must be refusal-shaped and must not include raw grants, upstream/private endpoints, connector URLs, or bridge/internal port details.
- AC5: Template tests inspect generated root and subpath edge-proxy Caddy templates and prove grant-bearing request components are not logged, or are logged only through a verified redacted/no-query format aligned with the shared daemon/audit redaction semantics.
- AC6: Canary E2E uses one raw grant canary and one adversarial display-string canary, then scans public HTML, response headers, browser referrer targets, gateway logs, edge logs, and audit egress. The same canaries must be absent from all scanned public/operator surfaces while recipient bootstrap remains functional.

## Files Likely to Change

- `packages/gateway/src/index.ts`
- `packages/gateway/src/handoff-page.ts`
- `packages/gateway/src/enroll-page.ts`
- `packages/gateway/src/callback-page.ts`
- `packages/gateway/src/gateway.test.ts`
- `packages/gateway/src/handoff.test.ts`
- `packages/gateway/src/callback-page.test.ts`
- `packages/gateway/src/public-base.test.ts`
- `packages/gateway/src/handoff-client-browser.test.ts`
- `packages/kernel/src/redaction.ts`
- `packages/kernel/src/redaction.test.ts`
- `packages/audit/src/audit.test.ts`
- `packages/app/src/*e2e*.test.ts`
- `surfaces/cli/src/cli.test.ts`
- `wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl`
- Edge-proxy template tests, if this repo has or adds a template-render test harness.
- DoD #8 documentation target, likely `docs/components/access-gateway.md`, `docs/architecture/authentik-dual-method-flow.md`, or edge-proxy deployment guidance.

## Security Risks to Watch

- Redacting recipient delivery links before the recipient can use them would break the product while appearing secure.
- Moving grants from URL query into longer-lived browser storage without cleanup can trade a referrer/history leak for a storage/replay leak.
- Authentik authorize URLs, callback URLs, or referrers must never carry GLA grants; only OIDC `code/state` belongs in authentik-visible traffic.
- Caddy access logging syntax must be verified by tests or disabled for grant-bearing routes. Do not assume a redaction directive works without rendering or execution evidence.
- Avoid divergent redaction regexes. Shared redaction behavior from GLA-084 is the project contract for operator/audit surfaces.
- Escaping JSON data islands alone is insufficient if refusal messages, text nodes, attributes, URLs, or client asset metadata interpolate adversarial values elsewhere.
- Negative tests must not leak the grant canary in assertion messages, snapshots, test logs, or failure diagnostics.
- Do not expose private bridge ports, upstream connector URLs, or provider-internal endpoints in public refusal/unavailable responses.
- Public-base/subpath deployments are high-risk for regressions because route rewriting, callback paths, and edge logging interact at the same boundary.

## bmad-dev-story Implementation Plan

1. Establish RED coverage first for AC1 through AC6, using canaries for grants and adversarial display strings.
2. Introduce or reuse a central helper for security headers on all public security-bearing HTML and JSON responses.
3. Reuse `jsonScriptData()` for all gateway script data islands, starting with enrollment, and add HTML/text escaping where any public page interpolates dynamic text.
4. Make grant query scrubbing deterministic after bootstrap consumption for enrollment, handoff, callback return, and reused handoff flows without changing grant verification semantics.
5. Apply shared redaction to any gateway/operator log path touched by this work and extend audit egress coverage for the GLA-089 canary shape.
6. Harden the Caddy template with either no grant-bearing access log components or a test-backed no-query/redacted format.
7. Add DoD #7/#8 evidence in code comments, docs, or test names where appropriate, then run focused tests and `pnpm run gate`.

## Open Decisions for Main Agent

- Decide the exact edge-proxy logging strategy: disable route access logs for grant-bearing examples, or implement a verified Caddy-supported no-query/redacted log format.
- Decide whether security-bearing JSON responses should all receive the same no-store/no-referrer/nosniff headers as HTML, or whether a narrower helper is justified and documented.
- Decide whether grant transport to WebSocket stays query-based with strict post-bootstrap scrubbing/log redaction, or whether a follow-up task should introduce a separate same-origin upgrade token mechanism. This story should not change authorization semantics without explicit design review.

## Dev Agent Record

- 2026-06-13: Invoked `bmad-create-story` and created this spec-exists fallback story artifact from Backlog task GLA-089 plus committed docs/code.
- 2026-06-13: Invoked `bmad-dev-story` in planning-only mode and stopped before source edits per user instruction. Implementation plan, AC-to-test plan, likely files, and risks are recorded above.
- 2026-06-13: Implemented gateway-local bootstrap and stream-ticket hardening. Initial public recipient URLs still carry raw grants only at the delivery/bootstrap seam. Gateway verifies the raw grant on the first `GET`, serves no-store/no-referrer HTML without embedding the raw grant, and stores the raw grant server-side behind short-lived same-origin HttpOnly bootstrap tickets. Browser POSTs omit grants and resolve through the bootstrap ticket. Successful handoff authorization issues a one-use same-origin HttpOnly stream ticket so browser WebSockets use the route path without `?grant=`.
- 2026-06-13: Preserved legacy body/query grant compatibility for non-browser callers and existing tests while making the browser path ticket-backed. Cookie, Authorization, X-Forwarded, and other non-handshake headers remain dropped before upstream WS proxying.
- 2026-06-13: Added `html-safety.ts` for JSON data islands and text-node escaping. Enrollment, handoff, callback, refusal, and reused-auth pages no longer store raw grants in HTML or `sessionStorage`; delegated callbacks keep only non-secret route/client context or an enrollment marker.
- 2026-06-13: Disabled access logging in the WPM Caddy template by default and documented that operator-enabled logs must omit/redact query strings plus `Cookie`, `Authorization`, and `Sec-WebSocket-Protocol`.
- 2026-06-13: Updated architecture/docs for bearer-bearing public surfaces and authentik callback behavior. Retargeted tracked `wpm/CLAUDE.md` symlink from a stale absolute path to repo-local `../AGENTS.md` so the project gate can traverse the repo.
- 2026-06-13: Independent reviewer found AC #6 evidence incomplete. Added `packages/app/src/gateway-grant-canary-e2e.test.ts`, a Chromium-backed same-canary E2E covering public HTML/headers, URL scrub, provider-visible request/referrer, default gateway/edge logs, Caddy template no active access log, and audit egress. Hardened operator/audit redaction for script-breakout fragments.

## Verification Evidence

- `pnpm exec vitest run packages/gateway/src/gateway.test.ts packages/gateway/src/handoff.test.ts packages/gateway/src/handoff-client-browser.test.ts packages/gateway/src/public-base.test.ts packages/gateway/src/callback-page.test.ts packages/app/src/daemon.test.ts` → 103 passed, 2 skipped.
- `pnpm exec vitest run packages/app/src/novnc-handoff-client-e2e.test.ts` → 1 passed, 1 skipped.
- `pnpm exec vitest run packages/app/src/authentik-dual-method.test.ts packages/app/src/authentik-enrollment.test.ts` → 38 passed.
- `pnpm exec vitest run packages/app/src/gateway-grant-canary-e2e.test.ts packages/kernel/src/redaction.test.ts packages/audit/src/audit.test.ts` → 7 passed, 1 skipped.
- `pnpm run gate` → typecheck + `biome ci .` + all tests green: 63 test files, 669 passed, 15 skipped.

## Change Log

- 2026-06-13: Initial GLA-089 story/context artifact created.
- 2026-06-13: Implementation and review-cycle evidence appended.
