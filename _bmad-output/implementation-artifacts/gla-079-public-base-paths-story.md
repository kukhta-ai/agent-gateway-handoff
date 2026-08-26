---
story_id: GLA-079
story_key: gla-079-public-base-paths
source_task: GLA-079
workflow: bmad-create-story
mode: spec-exists fallback
created_at: 2026-06-13
baseline_commit: cb50b5c057bd748ca73e8f5b155aa04533b9c57a
---

# Story GLA-079: Support Configured Public Gateway Base Paths

Status: done

Workflow: bmad-create-story

Mode: spec-exists fallback. The literal upstream create-story workflow could not treat BMAD sprint/planning
artifacts as authoritative because `_bmad-output/implementation-artifacts/sprint-status.yaml` and
`_bmad-output/planning-artifacts/epics.md` are absent here. Backlog.md remains the story source of truth, so
this guide is seeded from `backlog task 079 --plain`, the committed design/docs, the referenced source files,
the GLA-078 story context, and the authentik install transcript investigation.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a GLA operator deploying behind an existing reverse proxy or custom public mount,
I want `GLA_PUBLIC_BASE_URL` to define the public base path for enrollment, handoff, reused-auth, WebSocket,
and authentik callback flows,
so that GLA works at both a dedicated root URL and a subpath/custom public base without weakening gateway
authorization or exposing private ports.

## Acceptance Criteria

1. `GLA_PUBLIC_BASE_URL` values with empty/root pathname and with a non-root path prefix both mint enrollment,
   handoff, reused-auth, authentik callback, and WebSocket URLs under the configured public base without
   double-prefixing or dropping the prefix.
2. Browser-served enrollment, handoff, and callback pages make same-origin HTTP requests and WebSocket
   connections that remain correct when GLA is mounted under a path prefix.
3. Authentik delegated redirect URI can be configured under the same public base path and the returned
   code/state lands on a GLA-served callback without leaking the GLA grant to authentik.
4. Invalid or ambiguous public base values fail before serving starts with actionable errors, including missing
   scheme or host, malformed URL, path normalization ambiguity, and unsupported query or fragment components.
5. Root-mounted deployments remain backward-compatible and continue to produce the existing route shapes.
6. Edge-proxy, WPM, and operator-facing docs and templates describe both dedicated-root and subpath/custom-base
   deployments, including the exact relationship among Caddy public routing, `GLA_PUBLIC_BASE_URL`, WebSocket
   upgrade paths, and authentik redirect URI.
7. Public base path support does not widen authorization: only configured GLA public routes are reachable,
   local bridge/internal service ports remain private, and grant/recipient-bound verification behavior is
   unchanged.

## Non-Goals

- Do not introduce arbitrary proxy autodiscovery. The configured public base is the contract.
- Do not change grant classes, caveat semantics, recipient binding, auth assurance policy, auth reuse, or
  authentik `amr`/`acr` mapping.
- Do not make Caddy or any other reverse proxy the authorization PEP. The Access Gateway remains the grant and
  auth enforcement point.
- Do not expose the Agent Bridge, adapter-private listeners, noVNC internal endpoints, CDP broker endpoints, or
  authentik internals publicly.
- Do not solve durable enrollment/session state, stale process cleanup, or real noVNC browser rendering here.
- Do not hand-edit root `backlog/` files or `.bmad/sdlc-state.yaml`.

## Tasks / Subtasks

- [x] Define a central public-base URL/path seam. (AC: #1, #2, #3, #4, #5, #7)
  - [x] Add or extend one documented builder/normalizer that parses `GLA_PUBLIC_BASE_URL` into origin plus
        canonical public path prefix.
  - [x] Reject invalid values before the Access Gateway begins serving: missing scheme, missing host,
        malformed URL, non-canonical/dot-segment path ambiguity, query string, and fragment.
  - [x] Treat empty/root path as the legacy root mount and non-root path as the external mount prefix.
  - [x] Keep internal route scope paths root-shaped unless an explicit gateway-side route translation requires
        otherwise; do not broaden capability scope caveats to compensate for public prefixing.

- [x] Route all public link generation through the seam. (AC: #1, #3, #5)
  - [x] Ensure `AccessGateway.enrollLink()` and `AccessGateway.handoffLink()` or their replacements join paths
        against the configured base without `new URL("/path", base)` dropping the base pathname.
  - [x] Cover enrollment invite links, first handoff links, reused-auth handoff links, mounted route public URLs,
        and any authentik callback/return URL emitted by app composition.
  - [x] Verify root deployments still mint `https://host/enroll?...` and `https://host/handoff/...?...`.
  - [x] Verify subpath deployments mint `https://host/a/enroll?...`,
        `https://host/a/handoff/...?...`, and a callback URI under `https://host/a/...`.

- [x] Make browser-served pages base-path-aware without provider-specific gateway logic. (AC: #2, #3, #5, #7)
  - [x] Replace hardcoded root-absolute page fetches such as `/enroll/options`, `/enroll/verify`,
        `/handoff/auth/options`, and `/handoff/auth/verify` with same-origin URLs derived from the central
        public base path.
  - [x] Replace WebSocket URL construction that combines `location.host + routePath` directly with a builder that
        prefixes the public base path exactly once.
  - [x] Preserve the existing provider-agnostic `options.kind === "redirect"` page branch; do not introduce
        authentik strings, issuer URLs, `amr`/`acr`, or method names into `packages/gateway`.
  - [x] Preserve same-origin `sessionStorage` handling across redirects so the GLA grant remains on GLA's origin
        and authentik sees only OIDC `code`/`state`.

- [x] Align inbound gateway matching with the chosen edge contract. (AC: #2, #5, #7)
  - [x] Decide and document whether the supported Caddy subpath mode strips the public prefix before proxying to
        GLA, or whether the gateway strips its configured prefix before internal routing.
  - [x] Ensure the chosen behavior is tested for HTTP page routes, POST auth/enrollment routes, and WebSocket
        upgrades.
  - [x] Keep the gateway's "nothing else is publicly reachable" behavior: unknown paths outside the configured
        public route set still return the existing refusal/404 behavior.
  - [x] Do not make unprefixed public aliases reachable in subpath deployments unless the operator also exposes
        GLA at root intentionally. A subpath deployment should not accidentally publish both `/a/handoff/...` and
        `/handoff/...`.

- [x] Wire daemon and authentik config validation. (AC: #3, #4, #6)
  - [x] Validate `GLA_PUBLIC_BASE_URL` during `serve()` startup and expose actionable `gla serve` errors from
        `parseServeArgs()`/daemon startup.
  - [x] Derive WebAuthn expected origin from the base URL origin only; the path prefix must not enter WebAuthn
        origin verification.
  - [x] For `GLA_AUTH_PROVIDER=authentik`, ensure `GLA_AUTHENTIK_REDIRECT_URI` can be set under the same public
        base path and diagnostics explain mismatches between the public base and redirect URI.
  - [x] Keep `GLA_AUTHENTIK_CLIENT_SECRET`, bearer grants, and grant-bearing URLs out of logs and error text.

- [x] Update WPM/operator-facing deployment artifacts. (AC: #6)
  - [x] Update `gla-core` env guidance so `GLA_PUBLIC_BASE_URL` examples include dedicated root, subpath, and
        custom/separate-domain authentik issuer shapes.
  - [x] Update the edge-proxy Caddy template/advisor to explain root `reverse_proxy` and subpath/custom-base
        routing, including whether Caddy strips the prefix before proxying to GLA.
  - [x] Document that Caddy transports requests and WebSocket upgrades; GLA remains the authorization membrane.
  - [x] Document that `GLA_AUTHENTIK_REDIRECT_URI` must be an exact allowed redirect under GLA's public base
        path, while `GLA_AUTHENTIK_ISSUER_URL` may be a separate authentik origin.

- [x] Add regression tests before implementation is closed. (AC: #1-#7)
  - [x] Unit-test the public-base parser/builder for root, trailing slash, non-root prefix, no double-prefix,
        missing scheme/host, malformed URL, dot segments, query, and fragment.
  - [x] Test `AccessGateway.enrollLink()` and `handoffLink()` or their replacement with root and subpath bases.
  - [x] Test served page HTML/script behavior or browser E2E enough to prove fetch and WebSocket URLs remain
        same-origin and prefixed under a public base path.
  - [x] Test authentik redirect/return under a prefixed public base without putting the GLA grant in the
        provider-facing URL.
  - [x] Test `gla serve` parsing/startup diagnostics for invalid public base values and authentik redirect
        relationship diagnostics.
  - [x] Test WPM templates or fixtures for root, subpath, and separate authentik issuer examples.
  - [x] Run the full project quality gate: `pnpm gate`.

## Dev Notes

### Source of Truth

Backlog task `GLA-079` is the task contract. It is already `In Progress` and depends on GLA-010, GLA-013,
GLA-033, GLA-035, GLA-072, GLA-074, and GLA-076. Its references and implementation notes identify the base
path defect across gateway page URLs, daemon link generation, and WPM templates.

This story was generated from:

- `backlog task 079 --plain`
- `docs/task-writing-conventions.md`
- `docs/architecture/baseline.md`
- `docs/architecture/authentik-service-standup.md`
- `docs/architecture/authentik-dual-method-flow.md`
- `docs/architecture/authentik-integration.md`
- `docs/components/access-gateway.md`
- `docs/components/identity-and-auth.md`
- `_bmad-output/implementation-artifacts/gla-078-provider-extensible-auth-assurance-policy.md`
- `_bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md`
- `packages/gateway/src/index.ts`
- `packages/gateway/src/handoff-page.ts`
- `packages/gateway/src/enroll-page.ts`
- `packages/app/src/index.ts`
- `packages/app/src/daemon.ts`
- `packages/session/src/index.ts`
- `packages/route/src/index.ts`
- `wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl`
- `wpm/wip/installer-skills/edge-proxy-advisor/SKILL.md`
- `wpm/wip/installer-skills/gla-core-advisor/SKILL.md`
- `wpm/wip/installer-skills/identity-provider-advisor/SKILL.md`
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`
- Caddy official docs for `handle_path`, `handle`, `uri`, and `reverse_proxy`

### Current Source State

- `packages/gateway/src/index.ts` has static link helpers that use `new URL("/enroll", baseUrl)` and
  `new URL(path, baseUrl)`. A leading slash path causes the base pathname to be discarded, so
  `https://host/a/` currently risks minting `https://host/enroll?...` or `https://host/handoff/...?...`.
- `packages/gateway/src/index.ts` routes inbound HTTP by exact root path: `/enroll`,
  `/enroll/options`, `/enroll/verify`, `/handoff/auth/options`, `/handoff/auth/verify`, plus mounted route
  paths such as `/handoff/<session>` or `/task/<task>/handoff/<session>`.
- `packages/gateway/src/handoff-page.ts` currently uses root-absolute browser fetches for
  `/handoff/auth/options` and `/handoff/auth/verify`, and creates WebSocket URLs from
  `location.protocol`, `location.host`, and the internal route path. This drops an external `/a` base path.
- `packages/gateway/src/enroll-page.ts` currently uses root-absolute browser fetches for `/enroll/options`
  and `/enroll/verify`. This also drops an external `/a` base path.
- Both gateway pages already implement the provider-agnostic redirect branch and same-origin `sessionStorage`
  preservation from GLA-072. Preserve that shape.
- `packages/app/src/daemon.ts` accepts `GLA_PUBLIC_BASE_URL`/`--public-base-url`, derives WebAuthn
  `expectedOrigin` from `new URL(publicBaseUrl).origin`, and passes the raw string into the handoff stack. It
  does not currently validate path prefix semantics or reject query/fragment/ambiguous paths.
- `packages/app/src/index.ts` centralizes app composition: handoff delivery uses
  `AccessGateway.handoffLink(h.publicBaseUrl, path, token)` and enrollment uses
  `AccessGateway.enrollLink(h.publicBaseUrl, minted.token)`.
- `packages/route/src/index.ts` defaults mounted route paths to `/handoff/<sessionId>` and accepts caller
  provided paths. This is an internal/public route path seam tied to grant scope; do not casually prefix it
  with the deployment base path unless the capability scope contract is deliberately reviewed.
- `packages/capability/src/index.ts` defaults session grant scope paths to `/handoff/<sessionId>` and verifies
  path scope. Public base prefixing must not accidentally widen the child scope relative to its parent task.
- `wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl` currently documents root-style proxying:
  site block -> `reverse_proxy <upstream>`, with WebSocket upgrades transparently proxied.
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl` currently documents a root-style
  `GLA_PUBLIC_BASE_URL`, with examples such as `https://203.0.113.10/`.
- `wpm/wip/installer-skills/gla-core-advisor/SKILL.md` tells operators that `GLA_PUBLIC_BASE_URL` is the
  externally reachable URL and not the container-internal address. It needs the same subpath/custom-base
  clarification as the env template.
- The GLA-078 story is done and introduced provider-neutral auth assurance policy. Do not regress to
  `requiredAuthStrength` as the public contract while changing public-base behavior.
- The transcript investigation confirms non-root `/a/` mounting broke link and browser path assumptions during
  the client authentik install attempt.

### Architecture Constraints

- The Access Gateway remains the sole public authorization membrane. Caddy is transport/TLS/path routing only;
  it must not hold capability or recipient-auth logic.
- Every public request and WebSocket upgrade still verifies the recipient-bound grant statelessly and enforces
  recipient caveats, scope, TTL, revocation, and selected auth assurance.
- The Agent Bridge remains local-only. GLA-079 must not change the S-6 daemon guard that refuses a public bridge
  endpoint.
- Internal service ports remain private: noVNC/websockify endpoint, CDP broker endpoint, authentik server/worker
  internals, adapter-private callback listeners if any, and bridge sockets must not become direct public targets.
- Authentik redirect handling must preserve "no grant leak": authentik receives OIDC `code`/`state` flow
  parameters only. The GLA grant stays on GLA's same-origin page/sessionStorage and is re-verified by GLA.
- Gateway page changes must remain provider-agnostic. A generic URL/path builder or base path data island is
  acceptable; gateway pages must not branch on provider names, issuer URLs, `amr`, `acr`, or method labels.
- WebAuthn expected origin is scheme + host + port only. A public path prefix changes same-origin URL paths, not
  the WebAuthn origin value.
- The public base path must be canonical. Reject ambiguous path normalization instead of guessing, because
  guessing can create mismatched grant scope, callback, or proxy behavior.
- Root-mounted behavior is compatibility-sensitive. Existing tests and route shapes such as `/enroll` and
  `/handoff/<session>` must continue to work at root.

### Public Base Path Contract Guidance

The exact implementation shape is open, but converge on a single seam that answers these questions for all
callers:

- `origin`: `https://example.com`
- `basePath`: `""` for root, or `"/a"` for `https://example.com/a/`
- `publicPath("/enroll")`: `"/enroll"` at root, `"/a/enroll"` under a prefix
- `publicUrl("/handoff/sess_1", { grant })`: `https://example.com/handoff/sess_1?grant=...` at root,
  `https://example.com/a/handoff/sess_1?grant=...` under a prefix
- `sameOriginFetch("/handoff/auth/verify")`: path under the same base path, not a full cross-origin URL
- `websocketUrl("/handoff/sess_1", { grant })`: `wss://example.com/a/handoff/sess_1?grant=...` when the
  page was loaded from `https://example.com/a/...`

Recommended acceptance examples:

- Root base: `https://gla.example/`
- Root equivalent: `https://gla.example`
- Subpath base: `https://gla.example/a/`
- Separate authentik issuer, same GLA callback base:
  `GLA_PUBLIC_BASE_URL=https://gla.example/a/`,
  `GLA_AUTHENTIK_ISSUER_URL=https://idp.example/application/o/gla/`,
  `GLA_AUTHENTIK_REDIRECT_URI=https://gla.example/a/auth/callback` or the equivalent GLA-served return path
  chosen by the current callback architecture.

Reject examples:

- `gla.example/a` or `/a` because scheme/host are missing.
- `https:///a` or otherwise malformed URL.
- `https://gla.example/a?x=1` because query is unsupported.
- `https://gla.example/a#frag` because fragment is unsupported.
- `https://gla.example/a/../b`, encoded slash/backslash ambiguity, or other non-canonical paths if the
  normalizer cannot produce one stable, auditable base path.

### Caddy / Edge Contract Guidance

Official Caddy docs matter for the operator-facing examples:

- `handle_path /a/* { ... }` strips `/a` before running handlers, effectively adding `uri strip_prefix /a`.
- `handle /a/* { ... }` keeps the `/a` prefix.
- `reverse_proxy` upstream addresses cannot contain paths or query strings; path changes should be expressed
  with Caddy routing/URI directives, not by writing an upstream like `127.0.0.1:13000/a`.

For the story implementation, make one supported subpath pattern explicit in WPM templates. The most likely
safe deployment contract is:

- Dedicated root: Caddy site proxies all requests to GLA. `GLA_PUBLIC_BASE_URL=https://gla.example/`.
- Subpath/custom base: Caddy matches the public prefix and strips it before proxying to GLA's root-shaped
  internal routes. `GLA_PUBLIC_BASE_URL=https://gla.example/a/`; browser URLs and links include `/a`; GLA
  receives `/enroll`, `/handoff/...`, `/handoff/auth/...`, and WebSocket upgrades after Caddy stripping.

If dev chooses gateway-side prefix stripping instead, document that explicitly and test it. Do not leave both
behaviors implicit.

### Files Likely Touched

- `packages/gateway/src/index.ts`: central link helpers, route matching, or injection of public-base metadata
  into served pages.
- `packages/gateway/src/handoff-page.ts`: same-origin fetch URLs, redirect-return POST URL, WebSocket URL
  construction, reused-auth WebSocket URL construction.
- `packages/gateway/src/enroll-page.ts`: same-origin fetch URLs and redirect-return POST URL.
- `packages/app/src/daemon.ts`: `GLA_PUBLIC_BASE_URL` parsing/validation, startup diagnostics, usage text,
  authentik redirect relationship diagnostics, expected origin derivation.
- `packages/app/src/index.ts`: handoff/enrollment stack wiring, public URL builder injection, callback URL
  derivation if app composition owns it.
- `packages/session/src/index.ts`: only if link building or route paths need better typing/documentation at the
  session seam. Do not change route scope semantics casually.
- `packages/route/src/index.ts`: only if route programming needs a documented distinction between internal
  route path and external public path. Preserve RouteController's core abstraction.
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`: root/subpath/custom-base examples.
- `wpm/wip/bundles/gla-core/payload/templates/gla.service.tmpl`: only if example command text needs the
  subpath URL.
- `wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl`: root and subpath Caddy examples, WebSocket
  upgrade notes, strip-prefix guidance.
- `wpm/wip/installer-skills/edge-proxy-advisor/SKILL.md`: operator advisory for root vs subpath edge-proxy
  layouts.
- `wpm/wip/installer-skills/gla-core-advisor/SKILL.md`: operator advisory for `GLA_PUBLIC_BASE_URL` including
  subpath/custom public base.
- `wpm/wip/installer-skills/identity-provider-advisor/SKILL.md` and
  `wpm/wip/bundles/identity-provider/...`: only if authentik redirect URI examples must be updated to include
  a configured GLA base path.
- Tests likely in `packages/gateway/src/*`, `packages/app/src/daemon.test.ts`,
  `packages/app/src/auth-provider-selection.test.ts`, `packages/app/src/authentik-*.test.ts`,
  and WPM template/fixture tests.

### Test Plan

Use existing Vitest patterns plus at least one browser-level or script-level assertion for generated page URLs.

- Parser/builder unit tests:
  - Root and empty path normalize to root.
  - `https://host/a/` normalizes to a single `basePath` and joins all public paths under `/a`.
  - Leading slash paths do not discard the base path.
  - Trailing slashes do not double-prefix.
  - Missing scheme/host, malformed URL, query, fragment, dot segments, and encoded path ambiguity fail with
    stable actionable messages.
- Link generation tests:
  - Enrollment, handoff, reused-auth, and callback URLs include the configured base path exactly once.
  - Root-mode output remains byte-for-byte compatible with existing route shapes where tests assert them.
- Gateway/browser tests:
  - Enrollment page fetches `/a/enroll/options` and `/a/enroll/verify` when loaded under `/a/enroll?...`.
  - Handoff page fetches `/a/handoff/auth/options` and `/a/handoff/auth/verify`.
  - Handoff and reused-auth WebSocket URLs use `ws(s)://host/a/<route>?grant=...`.
  - Redirect-return with `?code&state` posts to the same prefixed GLA route and removes code/state from the
    address bar without replaying.
- Authentik tests:
  - `authorizeUrl` generated by the adapter contains the configured redirect URI under the public base path.
  - The GLA grant is not present in the authentik authorize URL or redirect URI.
  - `GLA_AUTHENTIK_REDIRECT_URI` mismatch diagnostics do not print client secrets or grants.
- Edge/WPM tests:
  - Caddy root example and subpath example are present and describe WebSocket upgrade behavior.
  - `gla.env.tmpl` examples include root, subpath, and separate authentik issuer with same GLA callback base.
- Security regression tests:
  - Subpath support does not authorize a WebSocket without a prior successful step-up.
  - Unknown routes and unconfigured paths remain unreachable.
  - The Agent Bridge still refuses non-local endpoints.

Full gate:

```bash
pnpm install
pnpm gate
```

`pnpm gate` is `pnpm run typecheck && biome ci . && vitest run`.

### Risks / Watchpoints

- Double-prefixing or prefix dropping is easy if the code mixes `new URL("/x", base)` with already-prefixed
  strings. Centralize path joining and test it directly.
- Prefixing internal route paths can accidentally alter capability scope checks. Keep internal scope and public
  presentation separate unless deliberately reviewed.
- Browser relative URL shortcuts can resolve incorrectly from nested handoff paths. Prefer a data-island
  base path plus a tiny join helper in the served HTML.
- Authentik redirect URI exact matching is unforgiving. WPM/operator docs must show the final external URL
  under `GLA_PUBLIC_BASE_URL`, not the internal `:3000` URL.
- A Caddy subpath can be configured to strip or preserve prefixes. The implementation and docs must choose one
  supported contract and verify it end to end.
- Do not expose bearer grants in public shortcut files, logs, or diagnostics while updating examples.
- Existing root-mode E2Es may be brittle around exact URL substrings. Add root compatibility tests before
  changing builders.

### Open Questions For Dev Agent

- Should GLA support both Caddy strip-prefix and gateway strip-prefix modes, or only document/test one mode?
  Prefer one explicit supported mode unless the task owner asks for both.
- Should `GLA_AUTHENTIK_REDIRECT_URI` be auto-derived from `GLA_PUBLIC_BASE_URL` when absent, or remain an
  explicit required env for authentik? Existing daemon code requires it; this story should not silently change
  that unless tests and docs make the compatibility clear.
- Should prefixed inbound routes be rejected if they reach GLA without Caddy stripping, or should GLA strip its
  configured public prefix itself? Make this visible in tests and WPM docs.

## References

- Backlog: `backlog task 079 --plain`
- Task conventions: `docs/task-writing-conventions.md`
- Baseline architecture: `docs/architecture/baseline.md`
- Authentik service standup: `docs/architecture/authentik-service-standup.md`
- Authentik dual-method flow: `docs/architecture/authentik-dual-method-flow.md`
- Authentik integration: `docs/architecture/authentik-integration.md`
- Access Gateway component: `docs/components/access-gateway.md`
- Identity and Auth component: `docs/components/identity-and-auth.md`
- Investigation: `_bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md`
- Previous story context: `_bmad-output/implementation-artifacts/gla-078-provider-extensible-auth-assurance-policy.md`
- Gateway server: `packages/gateway/src/index.ts`
- Handoff page: `packages/gateway/src/handoff-page.ts`
- Enrollment page: `packages/gateway/src/enroll-page.ts`
- App composition: `packages/app/src/index.ts`
- Daemon: `packages/app/src/daemon.ts`
- WPM edge template: `wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl`
- Edge-proxy advisor: `wpm/wip/installer-skills/edge-proxy-advisor/SKILL.md`
- GLA-core advisor: `wpm/wip/installer-skills/gla-core-advisor/SKILL.md`
- Caddy `handle_path`: https://caddyserver.com/docs/caddyfile/directives/handle_path
- Caddy `reverse_proxy`: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Caddy `uri`: https://caddyserver.com/docs/caddyfile/directives/uri

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Loaded `/home/agent/.codex/skills/bmad-create-story/SKILL.md`.
- Loaded `/home/agent/.codex/skills/bmad-dev-story/SKILL.md`.
- Loaded `/home/agent/.codex/skills/bmad-qa-generate-e2e-tests/SKILL.md`.
- Loaded `/home/agent/.codex/skills/bmad-story-automator-review/SKILL.md`,
  `workflow.yaml`, `instructions.xml`, and `checklist.md`.
- Loaded direct skill references: `discover-inputs.md`, `template.md`, `checklist.md`.
- Resolved workflow customization:
  `python3 _bmad/scripts/resolve_customization.py --skill /home/agent/.codex/skills/bmad-create-story --key workflow`.
- Resolved dev/QA workflow customization:
  `python3 _bmad/scripts/resolve_customization.py --skill /home/agent/.codex/skills/bmad-dev-story --key workflow`
  and
  `python3 _bmad/scripts/resolve_customization.py --skill /home/agent/.codex/skills/bmad-qa-generate-e2e-tests --key workflow`.
- Review workflow customization has no `customize.toml`; using bundled workflow/instructions/checklist directly.
- Loaded BMAD config: `_bmad/bmm/config.yaml`.
- Checked persistent facts: no `project-context.md` file found.
- Read task via CLI: `backlog task 079 --plain`.
- Read relevant docs and source files listed in this story.
- Consulted official Caddy docs for path-prefix and reverse-proxy behavior.
- Implemented public-base seam and tests on branch `feature/authentik-task-079`.
- Verification:
  `pnpm run typecheck` passed.
- Verification:
  `pnpm vitest run packages/gateway/src/public-base.test.ts packages/gateway/src/gateway.test.ts packages/gateway/src/handoff.test.ts packages/app/src/daemon.test.ts`
  passed: 70 passed, 1 skipped.
- Verification:
  `pnpm exec biome ci .` passed with the pre-existing broken-symlink warning for `wpm/CLAUDE.md`.
- Verification:
  `pnpm gate` passed: 55 test files, 580 passed, 12 skipped.
- Worker validation findings addressed: added a GLA-served `/auth/callback` page under the configured public base,
  made `X-Forwarded-Prefix` trust explicit instead of default, and rejected malformed missing-authority public base
  values such as `https:///a`.
- Verification after review fixes:
  `pnpm run typecheck` passed.
- Verification after review fixes:
  `pnpm vitest run packages/gateway/src/public-base.test.ts packages/gateway/src/gateway.test.ts packages/gateway/src/handoff.test.ts packages/app/src/daemon.test.ts`
  passed: 74 passed, 1 skipped.
- Verification after review fixes:
  `pnpm gate` passed: 55 test files, 584 passed, 12 skipped.
- Confirmation-review finding addressed: the callback page now reuses the enrollment page's exported
  `ENROLL_REDIRECT_STORAGE_KEY`, and `packages/gateway/src/callback-page.test.ts` executes the generated browser
  script to prove delegated enrollment callback completion posts the stored GLA grant plus `{code,state}` to the
  prefixed verify route.
- Final verification:
  `pnpm gate` passed: 56 test files, 585 passed, 12 skipped.

### Completion Notes List

- Created via `bmad-create-story` spec-exists fallback because sprint status and planning epics artifacts are
  absent/not authoritative in this repo.
- Story grounded in Backlog.md task GLA-079 and current committed docs/source context.
- Added a central `PublicBase` parser/builder seam in `@gla/gateway` and routed public URL/path generation,
  inbound prefix translation, and page data through that seam.
- Preserved root route shapes while supporting configured subpath deployments with either prefix-preserving
  proxying or strip-prefix proxying that forwards `X-Forwarded-Prefix`.
- Kept internal route scope paths root-shaped; public presentation paths are prefixed separately, preserving
  grant/recipient auth semantics.
- Validated daemon startup and authentik redirect URI relationship against the configured public base before
  serving, without logging grants or client secrets.
- Updated WPM templates, installer advisors, and authentik architecture docs with root, subpath/custom-base,
  WebSocket, and separate authentik issuer guidance.
- Added regression coverage for parser validation, root/subpath link generation, page fetch/verify URLs,
  WebSocket upgrade paths, strip-prefix edge mode, authentik redirect relationship diagnostics, and deployment
  templates.
- Added a provider-neutral same-origin `/auth/callback` landing page that restores GLA state from sessionStorage
  and re-POSTs opaque `{code,state}` to the unchanged enrollment or handoff verify routes.
- Added executable callback-page coverage for delegated enrollment return handling, so the callback storage key
  cannot drift from the enrollment page's redirect storage key.
- Changed strip-prefix proxy support to require explicit trusted-edge configuration
  (`GLA_TRUST_FORWARDED_PREFIX=true`) so direct clients cannot spoof unprefixed aliases with
  `X-Forwarded-Prefix`.
- Hardened public-base diagnostics and validation so malformed authorities and grant-bearing invalid values are
  rejected without reflecting secrets in error text.

## Senior Developer Review (AI)

### Review Outcome

Approve.

### Reviewer

Wegener (`019ec07a-5c68-7351-acf7-7e6ed02101c5`), separate-lane BMAD story-automator-review specialist.

### Findings

- Initial review requested changes for three blockers: missing GLA-served `/auth/callback`, unsafe default trust
  of `X-Forwarded-Prefix`, and malformed `https:///a` validation. All were fixed and covered by tests.
- Confirmation review found one remaining blocker: delegated enrollment callback used a different sessionStorage
  key from the enrollment page. Fixed by sharing `ENROLL_REDIRECT_STORAGE_KEY` and adding executable callback-page
  coverage.
- Final confirmation review found no critical/high issues.

### Review Verification

- Focused callback test passed: `pnpm vitest run packages/gateway/src/callback-page.test.ts`.
- Full quality gate passed: `pnpm gate` with 56 test files, 585 passed, 12 skipped.
- Known residual warning: Biome reports the pre-existing broken symlink `wpm/CLAUDE.md`.

### File List

- `.bmad/sdlc-state.yaml`
- `backlog/tasks/gla-079 - Define-and-enforce-the-root-mounted-public-gateway-URL-contract.md`
- `_bmad-output/implementation-artifacts/gla-079-public-base-paths-story.md`
- `docs/architecture/authentik-dual-method-flow.md`
- `docs/architecture/authentik-integration.md`
- `docs/architecture/authentik-service-standup.md`
- `packages/app/src/daemon.test.ts`
- `packages/app/src/daemon.ts`
- `packages/app/src/index.ts`
- `packages/gateway/src/callback-page.test.ts`
- `packages/gateway/src/callback-page.ts`
- `packages/gateway/src/enroll-page.ts`
- `packages/gateway/src/gateway.test.ts`
- `packages/gateway/src/handoff-page.ts`
- `packages/gateway/src/handoff.test.ts`
- `packages/gateway/src/index.ts`
- `packages/gateway/src/public-base.test.ts`
- `packages/gateway/src/public-base.ts`
- `wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl`
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`
- `wpm/wip/bundles/identity-provider/payload/templates/caddy-authentik-callback.snippet`
- `wpm/wip/installer-skills/edge-proxy-advisor/SKILL.md`
- `wpm/wip/installer-skills/gla-core-advisor/SKILL.md`
- `wpm/wip/installer-skills/identity-provider-advisor/SKILL.md`

### Change Log

- 2026-06-13: Created GLA-079 story implementation guide with ready-for-dev status.
- 2026-06-13: Implemented configured public gateway base paths and marked story ready for independent review.
- 2026-06-13: Addressed independent review findings and approved GLA-079 after full gate.
