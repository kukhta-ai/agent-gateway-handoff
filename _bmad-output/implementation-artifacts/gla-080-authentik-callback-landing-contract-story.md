---
story_id: GLA-080
story_key: gla-080-authentik-callback-landing-contract
source_task: GLA-080
workflow: bmad-create-story
mode: spec-exists fallback
created_at: 2026-06-13
branch: feature/authentik-task-080
baseline_commit: c22381b
---

# Story GLA-080: Align the authentik OIDC Callback Landing Contract

Status: review

Workflow: bmad-create-story + bmad-dev-story + bmad-qa-generate-e2e-tests

Mode: spec-exists fallback. The upstream create-story workflow expects BMAD sprint/planning artifacts, but this
repo uses Backlog.md as the story source of truth and `_bmad-output/planning-artifacts/` is not authoritative
here. This artifact is seeded from `backlog task 080 --plain`, the committed architecture/docs/source, and the
completed GLA-079 story.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a GLA operator using authentik as the delegated identity provider,
I want the configured OIDC callback URL, gateway route, browser callback page, and deployment guidance to describe
one observable landing contract,
so that authentik handoff and enrollment returns complete through GLA without 404s, grant leakage, or duplicated
callback semantics.

## Acceptance Criteria

1. A configured authentik handoff return lands on a GLA-served URL that processes code and state, posts the opaque
   assertion to the handoff verify route, and authorizes the grant without a 404.
2. A configured authentik enrollment return lands on a GLA-served URL that processes code and state, posts the
   opaque attestation to the enrollment verify route, and records enrollment without a 404.
3. The advertised `GLA_AUTHENTIK_REDIRECT_URI`, authentik allowed redirect URI, and Caddy callback guidance name
   only URL paths that the gateway actually serves for OIDC return handling.
4. A direct, replayed, or contextless callback produces a catchable refusal and authorizes or enrolls nothing.
5. The GLA grant or operator-discharge grant is absent from the outbound authentik authorization URL, redirect
   URI, logs, and authentik-visible request.
6. The in-tree WebAuthn handoff and enrollment paths still complete without using the OIDC callback contract.

## Prior Work From GLA-079

GLA-079 already completed the foundational callback/base-path work. Do not duplicate it unless a test in this
story proves a defect.

- `packages/gateway/src/index.ts` now serves `GET /auth/callback` after public-base normalization and injects
  public-base-aware verify paths into the callback page.
- `packages/gateway/src/callback-page.ts` now renders a provider-neutral landing page that reads `code` and
  `state`, restores same-origin GLA state from sessionStorage, posts to `/enroll/verify` or
  `/handoff/auth/verify`, and opens the handoff stream after authorization.
- `packages/gateway/src/callback-page.test.ts` currently executes the generated callback script in a VM for
  delegated enrollment, delegated handoff, and contextless callback refusal.
- `packages/gateway/src/gateway.test.ts` currently proves the callback page is served under a configured public
  base path and that the unprefixed alias is not served for a subpath deployment.
- `packages/gateway/src/public-base.ts` centralizes public URL/path handling and makes
  `GLA_TRUST_FORWARDED_PREFIX` explicit instead of trusting `X-Forwarded-Prefix` by default.
- `wpm/wip/bundles/identity-provider/payload/templates/caddy-authentik-callback.snippet` now names
  `/auth/callback` and `/team-a/auth/callback` as GLA-served callback paths and documents no-grant-leak.

## AC Satisfaction Map

- AC #1 is satisfied by `packages/app/src/authentik-dual-method.test.ts`: the test fetches the real gateway-served
  `/auth/callback?code&state`, executes the returned callback script with same-origin handoff storage, observes
  the unchanged `/handoff/auth/verify` POST, asserts `AccessGateway.isGrantAuthorized(GRANT_ID)`, and verifies the
  subsequent WS upgrade reaches the stub capsule.
- AC #2 is satisfied by `packages/app/src/authentik-enrollment.test.ts`: the test obtains the server-built
  authentik `authorizeUrl`, stages FakeAuthentik, fetches the real gateway-served callback URL, executes the
  callback script with same-origin enrollment storage, observes the unchanged `/enroll/verify` POST, and asserts
  `IdentityService.isEnrolled(recipient)` plus recorded `credentialId`.
- AC #3 is satisfied by the current gateway callback route plus terminology cleanup in the authentik architecture
  docs. The stale terms scan across `docs/architecture`, `adapters`, and `wpm/wip` found no adapter-owned callback
  or callback-listener wording after the edits.
- AC #4 is satisfied by the existing contextless callback script test plus new live-gateway bad-state callback
  tests for both handoff and enrollment. Handoff remains unauthorized and WS-refused; enrollment remains
  unenrolled and retryable.
- AC #5 is satisfied by adapter and app-level assertions that the outbound `authorizeUrl`, nested `redirect_uri`,
  and FakeAuthentik token request metadata do not contain recognizable GLA session/operator-discharge grant
  sentinels. Callback grants stay in same-origin storage and GLA POST bodies only.
- AC #6 is satisfied by the focused WebAuthn regression subset (`packages/app/src/enrollment-e2e.test.ts` and
  `packages/app/src/handoff-e2e.test.ts`) and by the full `pnpm gate`, with no WebAuthn production changes.

## Non-Goals

- Do not redesign the callback route. GLA-079 already chose the provider-neutral gateway-served
  `/auth/callback` landing contract.
- Do not add authentik-specific logic to `packages/gateway`. Gateway code must remain provider-neutral and branch
  only on generic opaque challenge shape.
- Do not change `/enroll/verify` or `/handoff/auth/verify` request contracts unless a test proves they cannot
  satisfy the existing callback contract.
- Do not alter grant classes, caveats, recipient binding, auth assurance policy, auth reuse, state/nonce/PKCE, or
  authentik `amr`/`acr` mapping.
- Do not expose the Agent Bridge, adapter-private internals, authentik internals, noVNC, CDP, or bridge ports.
- Do not hand-edit Backlog.md files or `.bmad/sdlc-state.yaml`.

## Tasks / Subtasks

- [x] Establish the callback-contract evidence baseline. (AC: #1-#6)
  - [x] Review current GLA-079 tests before adding new ones so GLA-080 does not duplicate parser/base-path or
        callback-script unit coverage.
  - [x] Identify which existing tests are direct verify-route simulations rather than actual callback landing
        tests; use those as setup helpers where possible.
  - [x] Keep new work focused on observable callback landing behavior and documentation alignment.

- [x] Add a handoff callback landing proof. (AC: #1, #4, #5)
  - [x] Build a focused test using the existing FakeAuthentik/authentik handoff harness.
  - [x] Start from the gateway-served handoff page or the same gateway options route the page uses, extract the
        server-built `authorizeUrl`, stage the fake authentik login for the returned `state`/`nonce`, then navigate
        or execute against the configured `redirect_uri` URL `/auth/callback?code=...&state=...`.
  - [x] Assert the callback URL returns the GLA callback page, posts to the unchanged handoff verify route, marks
        the grant authorized, and allows the expected WebSocket upgrade.
  - [x] Assert a replayed or bad-state callback does not authorize the grant and the WS upgrade remains refused.

- [x] Add an enrollment callback landing proof. (AC: #2, #4, #5)
  - [x] Reuse the existing authentik enrollment harness instead of creating a second provider/test double.
  - [x] Drive `/enroll/options` to obtain the server-built `authorizeUrl`, stage the fake authentik login, then
        complete through `/auth/callback?code=...&state=...` rather than direct `/enroll/verify`.
  - [x] Assert the callback page posts to `/enroll/verify`, the operator-discharge grant is consumed only on
        success, and the recipient is enrolled.
  - [x] Assert contextless, replayed, or failed callback attempts leave the recipient unenrolled and produce a
        catchable refusal.

- [x] Prove no GLA grant leaks to authentik-visible surfaces. (AC: #5)
  - [x] Assert the authentik `authorizeUrl` contains only OIDC parameters such as `client_id`, `redirect_uri`,
        `scope`, `state`, `nonce`, and PKCE values, and does not contain the session grant or
        operator-discharge grant.
  - [x] Assert the `redirect_uri` query is grant-free and names the configured callback path exactly.
  - [x] If using `FakeAuthentik`, inspect the fake authorize/token inputs or captured request data to prove
        authentik-visible traffic never includes GLA grants.
  - [x] Keep error/log assertions generic: no grant-bearing URL, client secret, OIDC code, or raw state should be
        printed in daemon/gateway diagnostics.

- [x] Align callback documentation and bundle artifacts. (AC: #3, #5)
  - [x] Update stale architecture language that still describes the callback as only a future GLA-072 deliverable
        or as an adapter-owned listener if that wording conflicts with the current gateway-served route.
  - [x] Ensure `docs/architecture/authentik-dual-method-flow.md`,
        `docs/architecture/authentik-enrollment.md`, and
        `docs/architecture/authentik-service-standup.md` consistently state that the configured
        `GLA_AUTHENTIK_REDIRECT_URI` lands on the GLA gateway callback page.
  - [x] Ensure `wpm/wip/bundles/identity-provider/payload/templates/caddy-authentik-callback.snippet`,
        `oidc-app-and-flow.outcomes.md`, and related installer guidance name only callback paths the gateway
        actually serves: root `/auth/callback` and public-base-prefixed equivalents such as
        `/team-a/auth/callback`.
  - [x] Preserve the explicit `GLA_TRUST_FORWARDED_PREFIX=true` warning for strip-prefix proxy mode.

- [x] Preserve the WebAuthn default path. (AC: #6)
  - [x] Do not change WebAuthn page behavior unless required by a failing callback-contract test.
  - [x] Run the existing WebAuthn enrollment and handoff browser tests, or a documented focused subset, to prove
        the in-tree provider still completes without `/auth/callback`.
  - [x] Confirm `packages/gateway/src/**` still has no concrete authentik/provider-specific route logic.

## Dev Notes

### Source of Truth

Backlog task `GLA-080` is the contract. It is `In Progress`, priority High, and depends on GLA-072, GLA-074,
GLA-076, and GLA-079. The task exists because the callback contract drifted between docs, Caddy guidance, and
gateway behavior. GLA-079 closed the major implementation gap, so this story should add missing proof and align
remaining language rather than reimplement callback routing.

This story was generated from:

- `backlog task 080 --plain`
- `docs/task-writing-conventions.md`
- `_bmad-output/implementation-artifacts/gla-079-public-base-paths-story.md`
- `docs/architecture/baseline.md`
- `docs/components/access-gateway.md`
- `docs/components/identity-and-auth.md`
- `docs/architecture/authentik-dual-method-flow.md`
- `docs/architecture/authentik-enrollment.md`
- `docs/architecture/authentik-service-standup.md`
- `packages/gateway/src/index.ts`
- `packages/gateway/src/callback-page.ts`
- `packages/gateway/src/callback-page.test.ts`
- `packages/gateway/src/enroll-page.ts`
- `packages/gateway/src/handoff-page.ts`
- `packages/gateway/src/gateway.test.ts`
- `packages/gateway/src/public-base.ts`
- `packages/app/src/authentik-scenario-e2e.test.ts`
- `packages/app/src/authentik-enrollment.test.ts`
- `packages/app/src/authentik-dual-method.test.ts`
- `packages/app/src/daemon.ts`
- `packages/app/src/daemon.test.ts`
- `adapters/auth-authentik/src/oidc.ts`
- `adapters/auth-authentik/src/index.ts`
- `wpm/wip/bundles/identity-provider/payload/templates/caddy-authentik-callback.snippet`
- `wpm/wip/bundles/identity-provider/payload/templates/oidc-app-and-flow.outcomes.md`

### Current Source State

- `AccessGateway.handle()` normalizes inbound public paths through `internalRequestPath()` and serves
  `GET /auth/callback` with `authCallbackPageHtml({ enrollVerify, handoffVerify })`.
- `authCallbackPageHtml()` is intentionally provider-neutral. It reads only `code`, `state`, injected
  same-origin verify paths, and same-origin sessionStorage keys. It does not import the authentik adapter.
- The callback page uses the enrollment page's exported `ENROLL_REDIRECT_STORAGE_KEY`, preventing key drift
  between the enrollment redirect arm and callback landing page.
- Existing `callback-page.test.ts` executes the generated callback browser script in `node:vm`, not a real
  browser. It proves the script body shape but not a full app/gateway/adapter callback landing flow.
- Existing authentik scenario/enrollment tests synthesize callback completion by posting directly to
  `/handoff/auth/verify` or `/enroll/verify`. They prove adapter and gateway verify semantics, but not that the
  configured `redirect_uri` route itself lands and completes.
- `adapters/auth-authentik/src/oidc.ts` builds the OIDC authorization URL from configured OIDC parameters and
  PKCE/state/nonce. It has no input slot for a GLA grant; keep that property explicit in tests.
- `buildAuthentikConfig()` in `packages/app/src/daemon.ts` verifies `GLA_AUTHENTIK_REDIRECT_URI` has the same
  origin as `GLA_PUBLIC_BASE_URL` and, for subpath deployments, remains under the configured public base prefix.
- WPM callback guidance now names `/auth/callback` and `/team-a/auth/callback`, but some architecture text may
  still carry older sequencing language from GLA-070/072/074. GLA-080 should make those references consistent
  without changing the design model.

### Architecture Constraints

- The Access Gateway remains the sole public entry and policy-enforcement membrane. The callback route is a
  GLA-served public page, not a privileged bypass.
- The callback page must re-POST to unchanged verify routes. Grant verification, recipient binding, state/nonce
  validation, PKCE, subject binding, and auth assurance policy remain in existing gateway/identity/adapter seams.
- Gateway code must stay provider-neutral: no concrete authentik imports, issuer URLs, raw `amr`/`acr`, OIDC
  endpoint names, or provider-specific branches in `packages/gateway`.
- The GLA grant and operator-discharge grant stay on GLA's own origin. Authentik sees only OIDC protocol values:
  authorization request parameters, `code`, and `state`.
- `GLA_PUBLIC_BASE_URL` determines the public callback path. Root deployments use `/auth/callback`; subpath
  deployments use the public-base-prefixed equivalent such as `/team-a/auth/callback`.
- `GLA_TRUST_FORWARDED_PREFIX=true` is valid only behind an edge that overwrites or strips client-supplied
  `X-Forwarded-Prefix`; prefix-preserving proxying does not require trusted forwarded headers.
- The Agent Bridge and all internal service ports remain private. Do not route callback traffic to bridge,
  authentik internals, noVNC internals, CDP broker, or adapter-private listeners.

### Files Likely Touched

- `packages/app/src/authentik-scenario-e2e.test.ts`: best existing place for handoff callback landing proof if
  the capstone harness can be extended without excessive runtime.
- `packages/app/src/authentik-enrollment.test.ts`: best existing place for enrollment callback landing proof.
- `packages/gateway/src/callback-page.test.ts`: extend only if more browser-script edge coverage is needed;
  avoid duplicating existing enrollment/handoff/contextless tests.
- `packages/gateway/src/gateway.test.ts`: extend only if the gateway route exposure matrix is missing a simple
  root/subpath callback path assertion.
- `packages/app/src/daemon.test.ts`: possible home for redirect URI/docs/template alignment assertions.
- `docs/architecture/authentik-dual-method-flow.md`
- `docs/architecture/authentik-enrollment.md`
- `docs/architecture/authentik-service-standup.md`
- `wpm/wip/bundles/identity-provider/payload/templates/caddy-authentik-callback.snippet`
- `wpm/wip/bundles/identity-provider/payload/templates/oidc-app-and-flow.outcomes.md`
- Related identity-provider advisor/install-backlog docs only if they still advertise a non-served callback path.

### Implementation Guidance

- Prefer tests before code. The current implementation may already satisfy most runtime behavior; GLA-080 should
  first expose missing proof, then fix only if a test fails.
- If a real browser-level callback test is too expensive, a deterministic VM-script test plus real gateway POST
  test is acceptable only if it proves the configured `redirect_uri` URL is served and the state transition is
  observable. The backlog asks for observable behavior, not a specific browser tool.
- The most valuable proof is a focused app-level helper that:
  - obtains a real `authorizeUrl` from the gateway options route,
  - parses `redirect_uri`, `state`, and `nonce`,
  - stages FakeAuthentik with the matching nonce,
  - seeds same-origin sessionStorage context as the originating page would,
  - executes or visits `redirect_uri?code=...&state=...`,
  - observes authorization/enrollment state after callback completion.
- For replay tests, burn the adapter state once through the happy callback, then attempt the same
  `code/state` again. The second attempt must refuse cleanly and must not authorize a new grant or enroll a
  recipient.
- For no-grant-leak tests, use recognizable sentinel grant strings and assert they do not appear in:
  `authorizeUrl`, the nested `redirect_uri`, FakeAuthentik-visible authorize request data if available, callback
  URL without same-origin storage, and captured logs.
- Documentation edits should remove ambiguity, not add new concepts. The contract is now: authentik redirects to
  a GLA-served callback page on GLA's public origin; the page re-POSTs to existing verify routes; authentik never
  sees GLA grants.

## Test Plan

Run targeted tests first, then the project gate.

- Callback landing, handoff:
  - Root and/or subpath public base serves `/auth/callback`.
  - Configured `redirect_uri?code&state` runs callback handling, posts to `/handoff/auth/verify`, and authorizes
    the grant.
  - The authorized handoff opens or permits the expected WebSocket upgrade.
  - Replayed or wrong-state callback leaves the grant unauthorized.
- Callback landing, enrollment:
  - Configured `redirect_uri?code&state` runs callback handling, posts to `/enroll/verify`, consumes the
    operator-discharge grant on success, and records enrollment.
  - Contextless or replayed callback leaves the recipient unenrolled and the grant state unchanged except for the
    intended one-time state burn in the adapter.
- No-grant-leak:
  - `authorizeUrl` and nested `redirect_uri` contain no session grant or operator-discharge grant.
  - Fake-authentik-visible request/redirect data contains no GLA grant.
  - Logs/errors do not echo grants or client secrets.
- Documentation/template tests:
  - `GLA_AUTHENTIK_REDIRECT_URI` examples point to gateway-served `/auth/callback` paths.
  - Caddy callback guidance aligns with root and public-base-prefixed paths.
  - Strip-prefix guidance mentions `GLA_TRUST_FORWARDED_PREFIX=true` only behind a sanitizing edge.
- WebAuthn regression:
  - Existing in-tree WebAuthn enrollment and handoff E2E still pass without `/auth/callback`.
  - Static gateway scan still finds no provider-specific authentik/OIDC logic in `packages/gateway`.

Suggested commands:

```bash
pnpm vitest run packages/gateway/src/callback-page.test.ts packages/gateway/src/gateway.test.ts
pnpm vitest run packages/app/src/authentik-enrollment.test.ts packages/app/src/authentik-scenario-e2e.test.ts packages/app/src/authentik-dual-method.test.ts
pnpm vitest run packages/app/src/enrollment-e2e.test.ts packages/app/src/handoff-e2e.test.ts
pnpm gate
```

`pnpm gate` is the repository quality gate: typecheck, Biome, and Vitest.

## Risks / Watchpoints

- False confidence from direct verify-route tests. GLA-080 must prove the configured callback landing path, not
  only `/enroll/verify` or `/handoff/auth/verify`.
- Accidentally moving grant handling into query parameters. The grant must stay in same-origin storage and POST
  bodies back to GLA, never in `redirect_uri` or authentik traffic.
- Stale docs. Some older docs intentionally described the callback as future GLA-072 work; after GLA-079 that
  wording can mislead installer agents.
- Overcorrecting provider neutrality. It is acceptable for app/adapter tests to use FakeAuthentik; it is not
  acceptable for gateway runtime code to import or branch on authentik.
- Replayed callback ambiguity. Adapter state is intentionally burned on claim, including failures; tests should
  assert catchable refusal and no authorization/enrollment, not state reuse.
- Subpath deployments. The callback path must stay under `GLA_PUBLIC_BASE_URL`, and strip-prefix proxying must
  not reintroduce spoofable unprefixed aliases.

## References

- Backlog: `backlog task 080 --plain`
- Task conventions: `docs/task-writing-conventions.md`
- Previous story: `_bmad-output/implementation-artifacts/gla-079-public-base-paths-story.md`
- Baseline architecture: `docs/architecture/baseline.md`
- Access Gateway component: `docs/components/access-gateway.md`
- Identity and Auth component: `docs/components/identity-and-auth.md`
- Authentik dual-method flow: `docs/architecture/authentik-dual-method-flow.md`
- Authentik enrollment: `docs/architecture/authentik-enrollment.md`
- Authentik service standup: `docs/architecture/authentik-service-standup.md`
- Gateway server: `packages/gateway/src/index.ts`
- Callback page: `packages/gateway/src/callback-page.ts`
- Callback page tests: `packages/gateway/src/callback-page.test.ts`
- Enrollment page: `packages/gateway/src/enroll-page.ts`
- Handoff page: `packages/gateway/src/handoff-page.ts`
- Public base seam: `packages/gateway/src/public-base.ts`
- Authentik scenario tests: `packages/app/src/authentik-scenario-e2e.test.ts`
- Authentik enrollment tests: `packages/app/src/authentik-enrollment.test.ts`
- Authentik dual-method tests: `packages/app/src/authentik-dual-method.test.ts`
- Daemon: `packages/app/src/daemon.ts`
- Authentik OIDC URL builder: `adapters/auth-authentik/src/oidc.ts`
- Authentik adapter verification: `adapters/auth-authentik/src/index.ts`
- Caddy callback snippet:
  `wpm/wip/bundles/identity-provider/payload/templates/caddy-authentik-callback.snippet`
- OIDC app outcomes:
  `wpm/wip/bundles/identity-provider/payload/templates/oidc-app-and-flow.outcomes.md`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Loaded `/home/agent/.codex/skills/bmad-create-story/SKILL.md`.
- Loaded direct skill references: `discover-inputs.md`, `template.md`, and `checklist.md`.
- Resolved workflow customization:
  `python3 _bmad/scripts/resolve_customization.py --skill /home/agent/.codex/skills/bmad-create-story --key workflow`.
- Loaded BMAD config: `_bmad/bmm/config.yaml`.
- Checked persistent facts: no `project-context.md` file found.
- Read task via CLI: `backlog task 080 --plain`.
- Read GLA-079 story artifact and current gateway/app/authentik/docs/WPM context.
- Created this artifact as spec-exists fallback without editing source, backlog, state, or git.
- Loaded `/home/agent/.codex/skills/bmad-dev-story/SKILL.md`.
- Loaded `/home/agent/.codex/skills/bmad-qa-generate-e2e-tests/SKILL.md`.
- Loaded `/home/agent/.codex/skills/bmad-story-automator-review/{workflow.yaml,instructions.xml,checklist.md}`.
- Added live-gateway callback landing tests in `packages/app/src/authentik-dual-method.test.ts` and
  `packages/app/src/authentik-enrollment.test.ts`.
- Extended `packages/gateway/src/callback-page.test.ts` for delegated handoff and contextless callback behavior.
- Added no-grant-leak assertions in `adapters/auth-authentik/src/auth-authentik.test.ts`.
- Ran stale callback terminology scan:
  `rg -n 'adapter-owned callback|callback LISTENER|adapter callback|new listener|mapped to the adapter|adapter callback URL|adapter callback must|authentik redirects back to the adapter callback' docs/architecture adapters wpm/wip -g '*.md' -g '*.ts' -g '*.tmpl' -g '*.snippet' -g 'SKILL.md'`
  (no matches).
- Ran focused regression:
  `pnpm vitest run packages/gateway/src/callback-page.test.ts packages/gateway/src/gateway.test.ts packages/app/src/authentik-dual-method.test.ts packages/app/src/authentik-enrollment.test.ts adapters/auth-authentik/src/auth-authentik.test.ts packages/app/src/enrollment-e2e.test.ts packages/app/src/handoff-e2e.test.ts`
  (7 files passed, 101 passed, 3 skipped).
- Ran full quality gate: `pnpm gate` (typecheck passed; Biome passed with known broken symlink warning for
  `wpm/CLAUDE.md`; Vitest 56 files passed, 591 passed, 12 skipped).
- Independent reviewer `Wegener` ran `bmad-story-automator-review` for GLA-080. Initial outcome:
  Changes Requested for stale adapter-owned callback/listener wording in architecture docs.
- Addressed review follow-up in `docs/architecture/authentik-integration.md`,
  `docs/architecture/authentik-dual-method-flow.md`, `docs/architecture/authentik-enrollment.md`, and
  `docs/architecture/authentik-service-standup.md`.
- Ran exact stale-term scan after review follow-up:
  `rg -n 'adapter-owned callback|adapter-owned listener|callback LISTENER|adapter callback|adapter\x27s callback|adapter-owned endpoint|small callback listener|public callback listener|routing the adapter\x27s callback|adapter callback URL|authentik redirects back to the adapter callback' docs/architecture adapters wpm/wip -g '*.md' -g '*.ts' -g '*.tmpl' -g '*.snippet' -g 'SKILL.md'`
  (no matches).
- Re-ran focused regression after review follow-up (7 files passed, 101 passed, 3 skipped).
- Re-ran full quality gate after review follow-up: `pnpm gate` (typecheck passed; Biome passed with known broken
  symlink warning for `wpm/CLAUDE.md`; Vitest 56 files passed, 591 passed, 12 skipped).
- Independent reviewer `Wegener` follow-up outcome: Approve.

### Completion Notes List

- Added observable callback-landing proof for authentik handoff: the configured callback URL is served by GLA,
  the browser script posts `{code,state}` to the unchanged handoff verify route, the grant becomes authorized,
  and the WS upgrade reaches the capsule.
- Added observable callback-landing proof for authentik enrollment: the configured callback URL is served by GLA,
  the browser script posts `{code,state}` to the unchanged enrollment verify route, the recipient is enrolled,
  and the operator-discharge grant is consumed on success.
- Added bad-state/contextless callback refusal coverage so callbacks without valid same-origin state do not
  authorize or enroll.
- Added explicit no-grant-leak assertions at the outbound authentik authorization/token boundary.
- Aligned stale architecture and adapter comments so the callback is consistently described as a GLA-served
  provider-neutral callback page, not an adapter-owned listener.

### Senior Developer Review (AI)

Reviewer: Wegener (`019ec07a-5c68-7351-acf7-7e6ed02101c5`)

Outcome: Approve after one docs-alignment follow-up.

Findings: None remaining. The initial High docs-alignment finding was resolved by cleaning remaining
adapter-owned callback/listener wording in architecture docs. The design guidance now consistently describes
authentik returns landing on the GLA-served provider-neutral `/auth/callback` page, with the adapter limited to
OIDC state/token validation and subject binding.

Review evidence:

- Exact stale-term scan found no remaining adapter-owned callback/listener model.
- Broader callback/adapter wording scan found only acceptable generic references.
- Focused regression passed: 7 files, 101 passed, 3 skipped.
- Full `pnpm gate` passed: typecheck, Biome with known `wpm/CLAUDE.md` symlink warning, Vitest 56 files,
  591 passed, 12 skipped.

Action items:

- [x] Clean remaining adapter-owned callback/listener wording in architecture docs.
- [x] Re-run exact stale-term scan.
- [x] Re-run focused regression and full quality gate.

### File List

- `_bmad-output/implementation-artifacts/gla-080-authentik-callback-landing-contract-story.md`
- `.bmad/sdlc-state.yaml`
- `backlog/tasks/gla-080 - Align-the-authentik-OIDC-callback-landing-contract.md`
- `adapters/auth-authentik/src/auth-authentik.test.ts`
- `adapters/auth-authentik/src/index.ts`
- `docs/architecture/authentik-dual-method-flow.md`
- `docs/architecture/authentik-e2e-verification.md`
- `docs/architecture/authentik-enrollment.md`
- `docs/architecture/authentik-integration.md`
- `docs/architecture/authentik-service-standup.md`
- `packages/app/src/authentik-dual-method.test.ts`
- `packages/app/src/authentik-enrollment.test.ts`
- `packages/gateway/src/callback-page.test.ts`

### Change Log

- 2026-06-13: Created GLA-080 story implementation guide with ready-for-dev status.
- 2026-06-13: Implemented callback landing proofs, no-grant-leak assertions, and callback documentation
  alignment; moved story to review after focused tests and full `pnpm gate` passed.
- 2026-06-13: Addressed independent review docs-alignment finding; reviewer approved after stale-term scan,
  focused regression, and full `pnpm gate` passed.
