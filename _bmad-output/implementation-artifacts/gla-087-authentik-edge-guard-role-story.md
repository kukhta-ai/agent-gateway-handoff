# Story GLA-087: Clarify authentik edge-guard deployment role

Status: done

BMAD workflow note: `bmad-create-story` was invoked/read for this worker evidence step. `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent in this repo, so the workflow could not use sprint-status discovery and ran as the repo's docs-driven/spec-exists fallback with `backlog task GLA-087 --plain` as the source story contract. Backlog.md remains authoritative for status; do not mark this task done from the story pass.

## Story

As an operator deploying GLA with authentik and Caddy,
I want the deployment model to distinguish authentik-as-OIDC-provider from optional authentik proxy/forward-auth edge protection,
so that handoff, enrollment, callback, bridge, and internal ports are wired with the correct authorization owner and fail with actionable diagnostics when OIDC wiring is missing.

## Acceptance Criteria

1. Operator-facing deployment docs distinguish authentik-as-GLA-OIDC-provider from authentik proxy or forward-auth guarding other upstream applications, and state which role is required for GLA handoff step-up.
2. A deployment diagram or equivalent operator surface shows Caddy, GLA public gateway routes, authentik OIDC endpoints, authentik callback routing, and private bridge/internal ports with the owner of each authorization decision.
3. A deployment that assumes authentik proxy protection while the GLA AuthProvider or callback wiring is absent produces an actionable diagnostic instead of a misleading partially working login.
4. When authentik proxy or forward-auth is used in addition to OIDC, GLA handoff and enrollment grants are still verified by GLA and cannot be bypassed by an authentik session alone.
5. Caddy/authentik examples cover supported root, subpath, and separate-domain deployment shapes without presenting unguarded callback URLs or direct internal daemon access as valid configurations.
6. The supported public deployment exposes only configured GLA public gateway routes under the configured public base, plus required authentik endpoints, while local bridge and internal service ports remain private.

## Non-Goals

- Do not replace GLA grant verification with authentik proxy, forward-auth, headers, cookies, or outpost policy.
- Do not make Caddy or authentik the capability/recipient authorization PEP for GLA handoff or enrollment.
- Do not change capability classes, grant caveats, recipient binding, auth assurance policy, callback mechanics, or OIDC state/nonce/PKCE semantics.
- Do not expose the Agent Bridge, noVNC internal endpoint, CDP broker, worker internals, authentik database/worker internals, or daemon private ports.
- Do not add provider-specific authorization branches to `packages/gateway` or core packages.
- Do not edit backlog files or `.bmad/sdlc-state.yaml` while implementing this story.

## AC Mapping / Current Coverage

- AC #1 is partially covered by existing docs that say authentik is selected with `GLA_AUTH_PROVIDER=authentik` and that Caddy is transport/TLS. Missing: explicit operator-facing distinction between required OIDC AuthProvider wiring and optional authentik proxy/forward-auth.
- AC #2 is partially covered by `authentik-service-standup.md`, `caddy-authentik-callback.snippet`, and edge-proxy guidance. Missing: one consolidated diagram/table that names route owners and private/public surfaces for Caddy, GLA, authentik OIDC, proxy outpost, callback, bridge, and internal ports.
- AC #3 is partly covered by `buildAuthentikConfig()` requiring OIDC config when `authProvider=authentik` and by redirect URI/public-base validation. Missing: diagnostic for the common proxy-only mistake, where authentik forward-auth/proxy may protect the public site but `GLA_AUTH_PROVIDER` remains `webauthn` or OIDC/callback wiring is absent.
- AC #4 is mostly covered by gateway behavior: all `/enroll/*`, `/handoff/auth/*`, handoff page, and WebSocket upgrade paths re-verify GLA grants and recipient bindings regardless of outer proxy state. Add tests/documentation proving an authentik proxy session/header/cookie alone cannot authorize a GLA route or WS upgrade.
- AC #5 is partly covered by GLA-079 public-base docs/tests for root and subpath, and by callback docs naming separate authentik issuer origin. Missing: examples that explicitly include optional authentik proxy/forward-auth shapes without implying callback or daemon internals can be exposed directly.
- AC #6 is partly covered by daemon bridge-local guard, gateway public-base routing, and Caddy templates. Add deployment docs/tests that enumerate exposed public routes and private ports for root, subpath, and separate-domain shapes.

## Tasks / Subtasks

- [x] Establish the role model in operator-facing docs. (AC: #1, #2)
  - [x] State that authentik OIDC provider wiring is required for GLA handoff step-up when `GLA_AUTH_PROVIDER=authentik`.
  - [x] State that authentik proxy/forward-auth is optional outer protection for HTTP upstreams and cannot replace GLA grant/recipient checks.
  - [x] State that Caddy owns TLS/path routing only; GLA Access Gateway owns `/enroll`, `/handoff/*`, `/handoff/auth/*`, `/auth/callback`, and WS authorization.
  - [x] State that authentik OIDC owns issuer, authorize, token, JWKS, hosted login/enrollment, and provider-local policy/credential decisions.

- [x] Add a deployment diagram or equivalent route-ownership table. (AC: #2, #5, #6)
  - [x] Include root deployment: `https://gla.example/` routes to GLA gateway; `https://idp.example/...` routes to authentik; callback is `https://gla.example/auth/callback`.
  - [x] Include subpath deployment: `https://gla.example/team-a/` routes to GLA gateway, with either prefix-preserving proxying or sanitized `X-Forwarded-Prefix` plus `GLA_TRUST_FORWARDED_PREFIX=true`; callback is `/team-a/auth/callback`.
  - [x] Include separate-domain deployment: GLA public origin and authentik issuer origin are separate domains; `GLA_AUTHENTIK_REDIRECT_URI` still lands on GLA, while `GLA_AUTHENTIK_ISSUER_URL` points at authentik.
  - [x] Mark private surfaces: Agent Bridge Unix/loopback endpoint, GLA daemon private admin/bridge socket, capsule noVNC/websockify internal endpoint, CDP broker, authentik Postgres/worker/Redis, and host/container internal forwards.

- [x] Add or extend actionable diagnostics for proxy-only/missing-OIDC wiring. (AC: #3)
  - [x] Detect/report `authentik proxy/forward-auth configured but GLA_AUTH_PROVIDER is not authentik` as "outer proxy does not perform GLA step-up; select authentik OIDC or use in-tree WebAuthn intentionally."
  - [x] Detect/report `GLA_AUTH_PROVIDER=authentik` with missing `GLA_AUTHENTIK_ISSUER_URL`, `CLIENT_ID`, `CLIENT_SECRET`, or `REDIRECT_URI` as missing required OIDC wiring.
  - [x] Detect/report redirect URI that points at authentik or outside `GLA_PUBLIC_BASE_URL` as invalid callback wiring.
  - [x] Detect/report callback path not routed to the GLA gateway as "OIDC login may succeed at authentik, but GLA cannot complete grant-verified step-up/enrollment."
  - [x] Keep diagnostics redacted: no client secret, grant-bearing URL, OIDC code, raw state, proxy cookies, or invitation token in output.

- [x] Prove outer authentik proxy cannot bypass GLA. (AC: #4, #6)
  - [x] Add provider-neutral gateway tests simulating outer proxy headers/cookies/session markers on `/enroll`, `/handoff/auth/options`, mounted handoff page, and WS upgrade without adding provider-specific tokens to `packages/gateway`.
  - [x] Assert requests without a valid GLA grant remain refused even when outer proxy headers are present.
  - [x] Assert a handoff WS upgrade with an outer proxy session but without GLA step-up authorization remains refused.
  - [x] Assert no route is authorized from outer proxy headers, forwarded-style headers, or cookie state alone.

- [x] Align Caddy/authentik examples. (AC: #1, #2, #5, #6, DoD #7)
  - [x] Update edge-proxy guidance to keep GLA gateway routing separate from optional authentik forward-auth/outpost routing.
  - [x] Update identity-provider/authentik guidance to say the OIDC callback route is on GLA's public origin and is not an authentik proxy/outpost path.
  - [x] Include authentik forward-auth examples only as optional defense-in-depth, with `/outpost.goauthentik.io/*` routed to the outpost and application traffic still proxied to GLA gateway.
  - [x] Never present direct access to GLA daemon internals, bridge endpoint, noVNC/websockify, CDP, or authentik datastore ports as valid public config.

- [x] Preserve current root/subpath/callback behavior. (AC: #5, #6)
  - [x] Reuse `packages/gateway/src/public-base.ts` for route/path reasoning; do not create a second public-base parser.
  - [x] Preserve `GLA_TRUST_FORWARDED_PREFIX` semantics: only true behind an edge that overwrites/sanitizes incoming `X-Forwarded-Prefix`.
  - [x] Preserve `/auth/callback` as a gateway-served provider-neutral callback page under the configured public base.
  - [x] Preserve WebAuthn default behavior when `GLA_AUTH_PROVIDER` is unset or `webauthn`.

## Current Behavior Notes

- `packages/gateway/src/index.ts` is the public authorization membrane. It serves enrollment, handoff, handoff auth, gateway callback, mounted route pages, and WebSocket upgrades. It imports no authentik adapter and verifies GLA grants before identity/provider work.
- `packages/gateway/src/index.ts` serves `GET /auth/callback` as a provider-neutral callback landing page. The callback page reposts `{code,state}` to existing verify routes; it is not an authentik listener and not a bridge endpoint.
- `packages/gateway/src/public-base.ts` centralizes root/subpath URL handling. It supports prefix-preserving proxying and strip-prefix proxying only when `GLA_TRUST_FORWARDED_PREFIX` is explicitly enabled behind a sanitizing edge.
- `packages/gateway/src/callback-page.ts` restores GLA state from same-origin sessionStorage and posts to GLA verify paths. Authentik sees OIDC parameters, not GLA grants.
- `packages/app/src/daemon.ts` fails closed when the Agent Bridge endpoint is non-local, requires OIDC config when `GLA_AUTH_PROVIDER=authentik`, and validates `GLA_AUTHENTIK_REDIRECT_URI` against `GLA_PUBLIC_BASE_URL`.
- `packages/app/src/daemon.ts` already emits startup diagnostics for public gateway, local bridge, auth provider, auth assurance, enrollment policy, public base, and bridge locality. Extend this diagnostic surface instead of inventing a parallel one.
- `packages/app/src/auth-enrollment-policy.ts` already models operator-visible auth/enrollment diagnostics and separates provider-local account state from GLA enrollment binding. It may be the right place to add role/edge-guard concerns if structured policy data carries proxy mode.
- `surfaces/cli/src/cli.ts` exposes `gla auth diagnostics` through the daemon operator op. Use this for user-facing diagnostics if the change needs CLI evidence.
- `wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl` already documents root and subpath GLA routing and that GLA verifies grants; it does not yet clearly incorporate optional authentik proxy/forward-auth role without conflating it with OIDC.
- `wpm/wip/bundles/identity-provider/payload/templates/caddy-authentik-callback.snippet` correctly states callback lives on GLA's origin and authentik endpoints are separate. GLA-087 should preserve and cross-link this.

## Deployment Shapes To Cover

- Root, shared host: Caddy serves `https://gla.example/` and reverse-proxies to GLA gateway `:3000`; authentik issuer may be `https://idp.example/application/o/gla/`; callback is `https://gla.example/auth/callback`; bridge remains a Unix socket or loopback endpoint.
- Subpath: Caddy serves `https://gla.example/team-a/` and either preserves `/team-a` to GLA or strips it with sanitized `X-Forwarded-Prefix: /team-a`; `GLA_PUBLIC_BASE_URL=https://gla.example/team-a/`; callback is `https://gla.example/team-a/auth/callback`; unprefixed aliases must not be exposed accidentally.
- Separate domain: GLA public origin and authentik issuer origin are different domains, for example `https://gla.example/` and `https://idp.example/application/o/gla/`; redirect URI still lands on the GLA origin; OIDC discovery/token/JWKS live at authentik.
- Optional outer guard: authentik proxy/forward-auth can sit in front of GLA as defense-in-depth. It may authenticate an outer browser session or inject `X-Authentik-*` headers, but GLA still requires its own grant, recipient binding, step-up, and route authorization before proxying to the capsule.
- Unsupported public exposure: direct public bridge socket/TCP bridge, direct noVNC/websockify endpoint, direct CDP broker, direct GLA internal host/container forward, direct authentik database/worker/Redis, callback routed to authentik instead of GLA.

## Architecture Guardrails

- Authentik has two distinct roles. Required GLA role: delegated OIDC AuthProvider for recipient step-up/enrollment when selected. Optional role: proxy/forward-auth outer guard for HTTP upstreams.
- A valid authentik proxy session is not a GLA grant, not a GLA recipient binding, and not GLA step-up authorization.
- Caddy is routing/TLS/path normalization. It must not be documented or implemented as the GLA grant verifier.
- The Access Gateway owns handoff/enrollment/callback grant authorization. Every public request and WS upgrade must still verify GLA capability, recipient caveat, route scope, TTL, revocation, enrollment state, and selected auth assurance.
- Gateway/core remain provider-neutral. Do not add authorization decisions based on authentik headers, outpost cookies, issuer URLs, `amr`, `acr`, provider names, or proxy mode.
- The callback route is a public GLA gateway page under the configured public base. It is not an authentik outpost endpoint, not a local bridge endpoint, and not a privileged bypass.
- Bridge/internal ports stay private. The daemon's bridge locality guard is load-bearing and must not be weakened for proxy convenience.
- WPM owns host mutation and Caddy/authentik setup. GLA runtime can read/diagnose structured evidence but must not become an authentik proxy installer or Caddy manager at runtime.

## Files Likely Needing Changes

- `docs/architecture/authentik-service-standup.md` - add role distinction and diagram/table for Caddy, GLA, authentik OIDC, optional proxy/outpost, callback, and private ports.
- `docs/architecture/authentik-integration.md` - clarify OIDC provider role versus proxy provider role and keep required step-up language explicit.
- `docs/components/access-gateway.md` - reinforce that outer authentik proxy sessions cannot bypass GLA grants.
- `docs/architecture/baseline.md` - only if the Caddy transport vs GLA authorization wording needs a small alignment.
- `wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl` - optional forward-auth examples and explicit "defense-in-depth only" warnings.
- `wpm/wip/installer-skills/edge-proxy-advisor/SKILL.md` - operator guidance for root/subpath/separate-domain and optional proxy-only warning.
- `wpm/wip/installer-skills/identity-provider-advisor/SKILL.md` - required OIDC wiring and callback-on-GLA wording.
- `wpm/wip/bundles/identity-provider/payload/templates/caddy-authentik-callback.snippet` - cross-link optional proxy role while preserving callback route semantics.
- `wpm/wip/bundles/identity-provider/payload/templates/dependency-binding.example.json` or related receipt examples - if proxy mode is represented as structured evidence for diagnostics.
- `packages/app/src/daemon.ts` and `packages/app/src/auth-enrollment-policy.ts` - actionable diagnostics for proxy-only/missing OIDC/callback wiring if runtime diagnostics are required.
- `surfaces/cli/src/cli.ts` and CLI tests - only if `gla auth diagnostics` output shape changes.
- `packages/gateway/src/index.ts`, `packages/gateway/src/public-base.ts`, and gateway tests - likely tests only; source changes should be unnecessary unless a bypass is found.
- `packages/app/src/daemon.test.ts`, `packages/gateway/src/gateway.test.ts`, `packages/gateway/src/handoff.test.ts`, and WPM template snapshot/scanning tests - main verification surfaces.

## Test Plan

- AC #1: Add docs/template tests that scan deployment guidance for required phrases: authentik OIDC required for GLA step-up when selected; proxy/forward-auth optional; Caddy transport only; GLA grant checks remain authoritative.
- AC #2: Add docs/template tests for a route-ownership table or diagram including Caddy, GLA public routes, authentik OIDC endpoints, callback, bridge, noVNC/internal endpoint, CDP, and authentik internals.
- AC #3: Add daemon/auth diagnostics tests for proxy-only evidence with missing `GLA_AUTH_PROVIDER=authentik`, missing OIDC config, bad callback origin/prefix, and callback path not routed to GLA. Assert messages are actionable and redacted.
- AC #4: Add gateway tests with synthetic authentik proxy headers/cookies. Requests without valid GLA grant still fail; WS upgrade without GLA authorization still fails; valid GLA grant/step-up remains required even with outer proxy markers.
- AC #5: Extend WPM/Caddy template tests for root, subpath, and separate-domain examples. Include optional forward-auth shape using authentik outpost routing without implying direct internal daemon access or callback-on-authentik.
- AC #6: Add exposure tests or static assertions that public docs/templates expose only configured GLA public base routes plus authentik issuer/outpost endpoints, and keep bridge/internal ports private. Keep existing bridge non-local refusal test green.
- Regression: Run existing public-base tests, callback-page tests, authentik dual-method/enrollment focused tests, gateway handoff/enroll tests, and `pnpm gate` before closing implementation.

## Risks / Anti-Patterns

- Proxy-session bypass: treating `X-Authentik-*`, proxy cookies, or outpost success as sufficient to authorize a GLA handoff.
- Callback misrouting: configuring `GLA_AUTHENTIK_REDIRECT_URI` on authentik's origin or outpost path instead of the GLA gateway origin.
- Public bridge leak: exposing `GLA_ENDPOINT`, a TCP bridge, noVNC/websockify, CDP, or host/container internal forwards through Caddy.
- Double public entry: publishing both prefixed and unprefixed GLA routes in a subpath deployment.
- Header trust bug: enabling `GLA_TRUST_FORWARDED_PREFIX` when Caddy does not overwrite/sanitize incoming `X-Forwarded-Prefix`.
- Over-documenting forward-auth: making optional authentik proxy examples look like the required GLA step-up path.
- Provider-specific gateway drift: adding authentik header/issuer/proxy-mode checks to gateway authorization logic instead of keeping them in app/WPM diagnostics and provider-neutral gateway tests.

## External Authentik Reference Notes

- Authentik Proxy Provider docs describe proxy mode and forward-auth modes for applications that do not support native auth protocols; this is an outer application-protection role, not GLA's OIDC AuthProvider seam.
- Authentik Forward Auth docs state that the existing reverse proxy handles application traffic and asks an authentik outpost to check authentication/authorization; in GLA this can only be an additional outer layer because GLA grants still authorize handoff/enrollment.
- Authentik Caddy forward-auth docs route `/outpost.goauthentik.io/*` to the outpost and use Caddy `forward_auth` before reverse-proxying the application upstream. If used with GLA, this must wrap the GLA public gateway routes without bypassing the gateway's own grant checks.

## References Read

- `/home/agent/.codex/skills/bmad-create-story/SKILL.md`
- `/home/agent/.codex/skills/bmad-create-story/discover-inputs.md`
- `/home/agent/.codex/skills/bmad-create-story/template.md`
- `/home/agent/.codex/skills/bmad-create-story/checklist.md`
- `backlog task GLA-087 --plain`
- `docs/architecture/authentik-service-standup.md`
- `docs/architecture/authentik-integration.md`
- `docs/components/access-gateway.md`
- `docs/architecture/baseline.md`
- `docs/architecture/authentik-dual-method-flow.md`
- `_bmad-output/implementation-artifacts/gla-079-public-base-paths-story.md`
- `_bmad-output/implementation-artifacts/gla-080-authentik-callback-landing-contract-story.md`
- `packages/gateway/src/index.ts`
- `packages/gateway/src/public-base.ts`
- `packages/gateway/src/callback-page.ts`
- `packages/app/src/daemon.ts`
- `packages/app/src/auth-enrollment-policy.ts`
- `surfaces/cli/src/cli.ts`
- `wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl`
- `wpm/wip/bundles/identity-provider/payload/templates/caddy-authentik-callback.snippet`
- `wpm/wip/bundles/identity-provider/payload/templates/oidc-app-and-flow.outcomes.md`
- `wpm/wip/installer-skills/identity-provider-advisor/SKILL.md`
- Authentik Proxy Provider docs: https://docs.goauthentik.io/add-secure-apps/providers/proxy/
- Authentik Forward Auth docs: https://docs.goauthentik.io/add-secure-apps/providers/proxy/forward_auth/
- Authentik Caddy forward-auth docs: https://docs.goauthentik.io/add-secure-apps/providers/proxy/server_caddy/

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Completion Notes List

- `bmad-create-story` and `bmad-dev-story` were invoked for GLA-087; the implementation was extended beyond the first bounded runtime slice after architecture review identified docs/WPM/gateway evidence as required for AC closure.
- Operator-facing architecture docs now distinguish authentik as the GLA OIDC provider from authentik proxy/forward-auth as an optional outer edge guard, and route ownership is documented across Caddy, GLA public routes, authentik OIDC endpoints, callback, bridge, capsule internals, and authentik internals.
- WPM Caddy/authentik templates and installer advisors now describe root, subpath, separate-domain, and optional forward-auth shapes without presenting bridge, capsule, CDP, daemon internals, or authentik datastore/worker ports as public surfaces.
- `authEnrollmentDiagnostics` now accepts provider-extensible deployment-role evidence, recognizes authentik proxy/forward-auth as optional outer guard, preserves future role strings, and exposes redacted `deploymentRoles` plus `edgeGuard` diagnostics through daemon/CLI diagnostics.
- `gla serve` now parses `GLA_AUTH_DEPLOYMENT_ROLES_JSON`, `GLA_AUTH_EDGE_GUARD_ROLES_JSON`, `--auth-deployment-roles-json`, and `--auth-edge-guard-roles-json`; startup logs include a redacted edge-guard summary.
- Proxy-only authentik deployments now produce an actionable concern pointing to `GLA_AUTH_PROVIDER=authentik` plus required `GLA_AUTHENTIK_*` OIDC/callback config, or intentional WebAuthn use.
- `GLA_AUTH_PROVIDER=authentik` now fails loudly when required OIDC config is missing, when redirect URI origin/prefix disagrees with `GLA_PUBLIC_BASE_URL`, or when the redirect URI does not land on the gateway-served `/auth/callback` path under the configured public base.
- Gateway tests prove outer proxy headers/cookies/session markers do not replace GLA enrollment grants, handoff grants, or WebSocket step-up authorization. The tests are intentionally provider-neutral so `packages/gateway` remains free of provider-specific authentik logic/tokens.
- Independent review outcomes: Wegener requested only story-artifact/File List correction and found no source-level AC blocker; Helmholtz passed the security/test review with no blocking findings.

### Tests Run

- `pnpm exec vitest run packages/app/src/auth-provider-selection.test.ts packages/app/src/daemon.test.ts`
- `pnpm exec vitest run packages/app/src/authentik-dual-method.test.ts packages/app/src/authentik-scenario-e2e.test.ts packages/gateway/src/gateway.test.ts packages/gateway/src/handoff.test.ts`
- `pnpm exec vitest run packages/app/src/auth-provider-selection.test.ts packages/app/src/daemon.test.ts packages/gateway/src/gateway.test.ts packages/gateway/src/handoff.test.ts`
- `pnpm run typecheck`
- `pnpm exec biome check packages/app/src/auth-enrollment-policy.ts packages/app/src/daemon.ts packages/app/src/auth-provider-selection.test.ts packages/app/src/daemon.test.ts`
- `pnpm exec biome check packages/app/src/daemon.ts packages/app/src/daemon.test.ts packages/app/src/auth-enrollment-policy.ts packages/app/src/auth-provider-selection.test.ts packages/gateway/src/gateway.test.ts packages/gateway/src/handoff.test.ts`
- `pnpm run gate` (final pass after callback-path tightening: 59 test files passed; 649 passed, 12 skipped; known Biome warning for broken `wpm/CLAUDE.md` symlink)

### File List

- `.bmad/sdlc-state.yaml`
- `_bmad-output/implementation-artifacts/gla-087-authentik-edge-guard-role-story.md`
- `backlog/tasks/gla-087 - Clarify-authentik-edge-guard-deployment-role.md`
- `docs/architecture/authentik-integration.md`
- `docs/architecture/authentik-service-standup.md`
- `docs/architecture/baseline.md`
- `docs/components/access-gateway.md`
- `packages/app/src/auth-enrollment-policy.ts`
- `packages/app/src/auth-provider-selection.test.ts`
- `packages/app/src/daemon.test.ts`
- `packages/app/src/daemon.ts`
- `packages/gateway/src/gateway.test.ts`
- `packages/gateway/src/handoff.test.ts`
- `wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl`
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`
- `wpm/wip/bundles/identity-provider/payload/templates/caddy-authentik-callback.snippet`
- `wpm/wip/installer-skills/edge-proxy-advisor/SKILL.md`
- `wpm/wip/installer-skills/gla-core-advisor/SKILL.md`
- `wpm/wip/installer-skills/identity-provider-advisor/SKILL.md`

### Change Log

- 2026-06-13: Implemented GLA-087 authentik edge-guard role clarification, diagnostics, docs/WPM guidance, gateway non-bypass tests, and review-requested story artifact correction.

## Senior Developer Review (AI)

### Wegener — Story Automator Review

Outcome: CHANGES REQUESTED for stale story artifact metadata only; no source-level AC blocker found. Required correction: File List and completion notes had to include docs, WPM templates/advisors, gateway tests, state, and backlog changes.

Resolution: applied in this story artifact by updating the task checklist, completion notes, test evidence, File List, and Change Log.

### Helmholtz — TEA/Security Review

Outcome: PASS. No blocking security/test findings. Review specifically checked optional outer-guard semantics, GLA-owned grant checks, redacted diagnostics, provider-neutral gateway boundary, and tests for proxy/session non-bypass.
