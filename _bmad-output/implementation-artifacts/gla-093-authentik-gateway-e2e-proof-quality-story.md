---
story: GLA-093
branch: feature/authentik-task-093
---

# Story GLA-093: Strengthen Authentik and Gateway E2E Proof Quality

Status: done

Backlog source of truth: `backlog task GLA-093 --plain`

BMAD workflow invoked for Rule 3 evidence:
- `bmad-create-story`: invoked in this worker lane to create this context-filled story artifact.
- `bmad-dev-story`: worker implementation pass applied the test, fixture, adapter, package-script, and documentation changes.
- `bmad-qa-generate-e2e-tests`: worker/TEA lane produced and recorded the strengthened E2E/canary evidence.
- `bmad-story-automator-review`: separate reviewer lane reviewed the story and returned APPROVE.
- `bmad-create-architecture` conformance review: architect lane reviewed provider/layering boundaries and returned APPROVE.
- `bmad-testarch-test-review` conformance review: TEA/security lane reviewed test proof quality and returned PASS.
- Skill files read: `/home/agent/.codex/skills/bmad-create-story/SKILL.md`, `discover-inputs.md`, `template.md`, and `checklist.md`.

Spec-exists fallback note: `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent. This story was created from the Backlog.md task contract plus committed docs/code, not from upstream BMAD sprint-status or planning artifacts. Backlog.md remains authoritative for task status, ACs, and DoD.

Implementation pass note: Backlog.md remains the source of truth for status, ACs, and DoD. This artifact records story context, implementation evidence, specialist review outcomes, and validation commands.

## Story

As a maintainer relying on GLA E2E tests as security evidence,
I want the authentik and gateway proof suite to fail on false-positive paths and weak assertions,
so a green quality gate proves observable provider, gateway, recipient-binding, callback, and capsule-traffic outcomes across the architecture seams.

## Acceptance Criteria

1. The authentik browser E2E path exercises a GLA-served OIDC return URL and gateway page flow rather than satisfying handoff by direct test injection of assertions.
2. Forwarded-link and wrong-recipient E2E coverage uses a second valid recipient identity that can authenticate successfully to the provider but still cannot authorize the original grant.
3. No-traffic-to-capsule assertions are backed by explicit upstream connection and byte counters or equivalent instrumentation, not by absence of an expected first response chunk.
4. Auth-authentik adapter contract tests cover discovery, remote JWKS/key rotation behavior, token request redirect_uri shape, invalid state/code handling, and mapped evidence diagnostics.
5. Import-boundary and provider-selection seam tests assert stable runtime or AST-level boundaries instead of brittle package-name regex or source-string checks.
6. Critical async/network E2E assertions use event-driven waits with bounded diagnostics rather than fixed sleeps that can hide races or produce flaky passes.

## Definition of Done

1. Typecheck passes with no errors.
2. Linter passes clean.
3. Tests are added for the change and the full suite is green.
4. Public functions and exported types are documented.
5. No dead code or unused exports are introduced.
6. The core import-boundary holds: core depends only on ports, never on concrete adapters.
7. The authentik E2E verification doc identifies which tests are synthetic, which are browser-level, and which prove deployed-provider behavior.
8. At least one deliberate wrong-recipient and one deliberate upstream-leak canary fail the strengthened E2E suite.

## Context Read

- `backlog task GLA-093 --plain`
- `_bmad-output/implementation-artifacts/gla-092-browser-e2e-quality-gate-story.md`
- `docs/architecture/authentik-e2e-verification.md`
- `docs/architecture/test-strategy.md`
- `packages/app/src/authentik-scenario-e2e.test.ts`
- `packages/app/src/scenario-01-e2e.test.ts`
- `packages/app/src/completion-e2e.test.ts`
- `adapters/auth-authentik/src/auth-authentik.test.ts`
- `adapters/auth-authentik/src/fake-authentik.ts`
- `adapters/auth-authentik/src/index.ts`
- `adapters/auth-authentik/src/oidc.ts`
- `packages/app/src/auth-provider-selection.test.ts`
- `packages/app/src/authentik-dual-method.test.ts`
- `package.json`
- `CONTRIBUTING.md`
- `.github/workflows/ci.yml`
- `vitest.config.ts`

## Current Behavior Model

The GLA-092 gate hardening makes `pnpm gate` require browser E2E prerequisites before Vitest runs. The relevant scripts are currently `test:e2e:preflight`, `gate`, `gate:without-browser-e2e`, and `gate:browser-canary`; the full gate forces `GLA_BROWSER_E2E_MODE=required`.

`packages/app/src/authentik-scenario-e2e.test.ts` is the GLA-side authentik capstone. It uses real app composition, gateway, session, launcher, and a stub noVNC upstream, but uses `FakeAuthentik` for OIDC token/JWKS behavior. Its `synthesizeStepUp()` helper calls `/handoff/auth/options`, stages a fake login from the returned `state`/`nonce`, then posts directly to `/handoff/auth/verify`.

`packages/app/src/authentik-dual-method.test.ts` already has a focused callback-page path using a GLA-served `/auth/callback` page and browser-script execution (`beginCallbackStepUp()` / `executeHandoffCallback()`), but that proof is not the same as the authentik capstone's full browser E2E path.

Wrong-recipient coverage is stronger in `packages/app/src/scenario-01-e2e.test.ts`, where a second Playwright context and second recipient are enrolled before the forwarded grant is refused. In `packages/app/src/authentik-scenario-e2e.test.ts`, the forwarded-link negative currently proves an unauthorized raw grant does not reach upstream, but it does not model a second valid authentik login for the original grant.

The current raw WebSocket helpers resolve the first received bytes and mostly assert presence or absence of `UPSTREAM_NOVNC_HELLO`. That is enough to show an accepted path was proxied, but AC #3 requires explicit upstream connection/byte counters or equivalent instrumentation for refused paths.

`adapters/auth-authentik/src/auth-authentik.test.ts` covers challenge URL shape, PKCE, token request `redirect_uri`, happy paths, typed failures, one-time state, multi-audience `azp`, algorithm confusion, and diagnostic outcomes. It primarily injects explicit endpoints and a local JWKS resolver. GLA-093 needs contract coverage for discovery fallback, remote JWKS/key rotation behavior, invalid code/state handling, and mapped evidence diagnostics as first-class tests.

Provider seam tests currently include stable package dependency checks in `packages/app/src/auth-provider-selection.test.ts`, but `packages/app/src/authentik-dual-method.test.ts` and `packages/app/src/authentik-scenario-e2e.test.ts` also use broad source-token scans against `packages/gateway/src/**`. GLA-093 should replace or supplement those with stable runtime/AST/import-boundary assertions so wording changes do not masquerade as architecture regressions.

Critical E2E timing still includes fixed sleeps around CDP sever propagation, completion polling, teardown, and similar network/process events in `scenario-01-e2e.test.ts` and `completion-e2e.test.ts`. GLA-093 should move security-critical waits to event-driven or polling assertions with bounded diagnostics.

## Architecture Guardrails

- Keep this as proof-quality hardening. Product behavior should remain unchanged except for narrow, provider-neutral observability hooks needed to make security assertions reliable.
- Preserve provider-neutral gateway/core architecture. `packages/gateway` and protected core packages must not import or branch on authentik, OIDC, `amr`, `jwks`, issuer URLs, or provider-specific method labels.
- Keep authentik behind `AuthProviderPort`. Adapter tests may name OIDC/authentik; gateway tests should assert provider-neutral challenge/verify behavior and grant authorization results.
- Preserve the honest proof split from `docs/architecture/authentik-e2e-verification.md`: deterministic CI proof may use `FakeAuthentik`; real deployed authentik proof remains deployment/WPM evidence. Do not imply the CI suite exercised a live authentik server unless it actually does.
- Do not weaken GLA-092. Browser-backed E2E evidence required by this task must remain inside the full `pnpm gate` path and must not be satisfied by optional skip mode.
- Do not use source-string grep as the sole architecture proof. Prefer package graph assertions, AST-level import scans, runtime composition records, boundary selftests, or Biome import-boundary fixtures.
- Keep upstream traffic instrumentation out of production authorization decisions. If production code needs an observability seam, keep it provider-neutral, redacted, and inert unless injected by tests.
- Canary failures must be deterministic and opt-in. Normal gate must pass; deliberate canary runs must prove the strengthened suite would turn red for the intended wrong-recipient or upstream-leak regression.

## Developer Tasks / Subtasks

- [x] Strengthen the authentik callback/browser path (AC: #1; DoD: #7).
  - [x] Add or refactor a browser-backed authentik E2E path so the recipient exercises the GLA-served OIDC return URL and callback page flow, not only a direct test POST to `/handoff/auth/verify`.
  - [x] Assert the callback page carries only `{code,state}` into the provider-neutral verify route and does not expose grants, code verifier, client secret, tokens, or provider secrets.
  - [x] Keep direct adapter/gateway tests where useful, but do not let direct injection be the only authentik handoff proof.
- [x] Model a valid wrong-recipient provider identity (AC: #2; DoD: #8).
  - [x] Enroll or bind a second recipient with a distinct authentik subject.
  - [x] Stage a valid authentik login for that second subject against the forwarded/original grant path.
  - [x] Assert the original grant remains unauthorized, the refusal is catchable/actionable, and no upstream connection or bytes occur.
- [x] Add explicit upstream traffic instrumentation (AC: #3; DoD: #8).
  - [x] Build a reusable instrumented upstream helper that records connection count, bytes received, bytes sent, and whether the success marker was delivered.
  - [x] Assert accepted flows increment positive counters and refused flows leave counters at zero.
  - [x] Add an upstream-leak canary path that intentionally simulates or permits a refused path reaching upstream and proves the suite fails.
- [x] Expand authentik adapter contract tests (AC: #4).
  - [x] Cover discovery from `.well-known/openid-configuration`, including partial endpoint overrides and malformed/missing discovery fields.
  - [x] Cover remote JWKS resolver behavior and key rotation or no-matching-key behavior with a deterministic local JWKS fixture/server.
  - [x] Cover token request `redirect_uri` shape and ensure no GLA grant-bearing values enter `authorizeUrl`, `redirect_uri`, or token exchange fields.
  - [x] Cover invalid code handling, unknown state, replayed state, callback attempted for the wrong user, and mapped diagnostic outcomes.
  - [x] Assert mapped assurance evidence for password, WebAuthn/passkey with UV, ambiguous/unresolvable methods, and downgrade/fail-closed diagnostics.
- [x] Replace brittle seam assertions (AC: #5; DoD: #6).
  - [x] Keep package dependency and import-boundary checks for core/gateway/provider neutrality.
  - [x] Add AST or runtime composition assertions that verify only `packages/app` imports concrete auth adapters and that gateway code consumes only provider-neutral challenge/assertion shapes.
  - [x] If any text scan remains, narrow it to a secondary diagnostic, not the blocking proof.
- [x] Replace critical fixed sleeps with event-driven waits (AC: #6).
  - [x] Replace CDP sever/resume sleeps with `expect.poll` or connector events that report live socket counts and suspension state on timeout.
  - [x] Replace completion/off-contract waits with polling around session/handoff state and detector observations.
  - [x] Replace teardown sleeps with process/health/profile polling that includes pid, session id, route id, and timeout diagnostics.
- [x] Update documentation and QA evidence (DoD: #7-#8).
  - [x] Update `docs/architecture/authentik-e2e-verification.md` to label synthetic CI proof, browser-level GLA callback proof, and deployed-provider proof separately.
  - [x] Record canary commands/results and full-gate evidence in the implementation artifact/test summary once implemented.

## AC-To-Test Map

| AC | Implementation evidence expected |
| --- | --- |
| AC1 | A browser-backed authentik E2E opens a GLA handoff page, starts the provider-neutral redirect challenge, lands on the GLA-served `/auth/callback` URL/page with `code` and `state`, and authorizes only through the page's verify call. |
| AC2 | A focused or capstone E2E creates recipient A's handoff, authenticates recipient B successfully to the provider with B's bound subject, then proves B cannot authorize A's grant and cannot reach upstream. |
| AC3 | Instrumented upstream helper proves accepted paths have positive connection/byte counters and refused paths have zero connection/byte counters; assertions no longer rely only on missing first response text. |
| AC4 | `adapters/auth-authentik/src/auth-authentik.test.ts` or companion tests cover discovery, partial overrides, local remote-JWKS rotation/no-match, invalid code/state/replay/user mismatch, token `redirect_uri`, and assurance diagnostics. |
| AC5 | Import-boundary/provider-selection tests use package graph, AST import scan, runtime wiring records, or the existing Biome boundary selftest; source text regex is not the only blocker. |
| AC6 | Scenario/completion/authentik critical network waits use event-driven promises or bounded polling with diagnostic output; no security assertion depends solely on `setTimeout`. |

Recommended focused commands after implementation:
- `pnpm exec vitest run adapters/auth-authentik/src/auth-authentik.test.ts --reporter=dot`
- `pnpm exec vitest run packages/app/src/authentik-dual-method.test.ts packages/app/src/authentik-scenario-e2e.test.ts --reporter=dot`
- `pnpm exec vitest run packages/app/src/scenario-01-e2e.test.ts packages/app/src/completion-e2e.test.ts --reporter=dot`
- `pnpm exec vitest run packages/app/src/auth-provider-selection.test.ts --reporter=dot`
- `pnpm run gate`
- The implemented wrong-recipient canary command or env-flagged run
- The implemented upstream-leak canary command or env-flagged run

## Canary Requirements

- Wrong-recipient canary: deliberately drive a valid second-recipient authentik login against the first recipient's grant. The strengthened E2E must fail if that wrong recipient can authorize the grant, if the grant becomes authorized, or if upstream sees a connection/bytes.
- Upstream-leak canary: deliberately simulate the refused path reaching the upstream or enable a test-only regression flag in the instrumented helper. The strengthened E2E must fail when a refused flow increments upstream connection or byte counters.
- Inclusion: both canaries must be discoverable in the normal test suite or through documented opt-in commands that run the relevant E2E files. A skipped or uncollected canary is not DoD evidence.
- Safety: canaries must not leave the normal `pnpm gate` red by default and must not require internet access or a live authentik deployment.
- Redaction: canary markers must not be real grants, OIDC codes, code verifiers, client secrets, id_tokens, access tokens, passkeys, or passwords. If grant-like canaries are used, they must be synthetic and asserted absent from operator/agent-visible outputs where relevant.

## Files Likely to Change

- `packages/app/src/authentik-scenario-e2e.test.ts`
- `packages/app/src/authentik-dual-method.test.ts`
- `packages/app/src/scenario-01-e2e.test.ts`
- `packages/app/src/completion-e2e.test.ts`
- `packages/app/src/auth-provider-selection.test.ts`
- `adapters/auth-authentik/src/auth-authentik.test.ts`
- `adapters/auth-authentik/src/fake-authentik.ts`
- `adapters/auth-authentik/src/oidc.ts`
- A shared test helper for instrumented upstreams and event-driven waits, likely under `packages/app/src/` or a test helper path already used by the repo.
- `docs/architecture/authentik-e2e-verification.md`
- `_bmad-output/implementation-artifacts/tests/test-summary.md` or a GLA-093-specific test summary if the QA workflow records one.

## Implementation Notes

Prefer a shared test helper over one-off counters in every E2E. The helper should be able to report: connection attempts, accepted handshakes, bytes from gateway to upstream, bytes from upstream to gateway/client, marker delivery, and a bounded diagnostic snapshot on failure.

The wrong-recipient flow should prove a stronger property than "no step-up happened." It should show that another valid recipient can satisfy the provider, but cannot satisfy the grant recipient binding for the original handoff.

Discovery/JWKS tests should be hermetic. Use a local HTTP server or injected fetch/JWKS seams; do not call the internet or a real authentik server from the unit/contract suite.

Remote JWKS/key rotation can be proven by a local JWKS endpoint whose key set changes between tokens, or by a deterministic resolver that observes key lookup behavior. If `jose.createRemoteJWKSet` cache behavior makes rotation hard to prove at unit speed, document the chosen equivalent instrumentation.

The callback/browser proof should stay provider-neutral at the gateway layer. The page can handle a generic `options.kind === "redirect"` challenge and a generic `{code,state}` assertion; authentik-specific claims remain in adapter tests.

When replacing sleeps, do not tighten races by using too-short polling windows. Use explicit timeouts, interval polling, and diagnostic messages that include the observed session state, connector suspension state, live socket count, upstream counters, and last relevant event.

## Risks / Anti-Patterns

- Do not claim live authentik proof from a `FakeAuthentik` CI run.
- Do not turn GLA-093 into a live authentik deployment task; that belongs to deployment/WPM verification.
- Do not add authentik-specific branches to gateway/core to satisfy tests.
- Do not rely on broad forbidden-token regex over source files as the sole provider-neutrality proof.
- Do not infer no upstream traffic from missing `UPSTREAM_NOVNC_HELLO`; use counters or equivalent instrumentation.
- Do not leave opt-in canaries permanently failing the default gate.
- Do not hide real races behind longer sleeps.
- Do not expose grants, OIDC codes, code verifiers, id_tokens, client secrets, passwords, passkey material, or access tokens in test diagnostics.

## Open Implementation Risks

- The upstream counter helper remains local to the authentik capstone test. That keeps production seams clean; extract it later only if another E2E needs identical assertions.
- The in-repo authentik proof remains deterministic FakeAuthentik evidence, not live authentik UI evidence. The architecture doc now labels this split explicitly.
- The upstream-leak canary is an assertion-inversion canary, not a simulated production proxy leak. It still proves the strengthened suite reports refused-flow upstream traffic as a hard failure.

## Specialist Review Evidence

- Reviewer `Wegener` / `bmad-story-automator-review`: APPROVE. No blocking findings. Residual note: update stale story artifact/file list, completed here.
- Architect `Mill` / `bmad-create-architecture` conformance review: APPROVE. Confirmed gateway/kernel/core runtime layers remain provider-neutral and authentik-specific logic stays inside the adapter/app test lane.
- TEA/security `Helmholtz` / `bmad-testarch-test-review` conformance review: PASS. Confirmed callback proof, wrong-recipient modeling, upstream counters, JWKS retry safety, and canary evidence.

## Verification Evidence

- `pnpm exec vitest run adapters/auth-authentik/src/auth-authentik.test.ts --reporter=dot`: passed, 44 tests.
- `pnpm exec vitest run packages/app/src/authentik-scenario-e2e.test.ts packages/app/src/authentik-dual-method.test.ts --reporter=dot`: passed, 21 tests.
- `pnpm exec vitest run packages/app/src/scenario-01-e2e.test.ts packages/app/src/completion-e2e.test.ts --reporter=dot`: passed, 2 passed and 2 skipped.
- `pnpm run gate:e2e-proof-canaries`: passed; deliberate wrong-recipient and upstream-leak failures were visible.
- `pnpm run gate`: passed; typecheck, Biome, browser/full-human-view preflight, and Vitest passed with 64 files, 707 passed, 15 skipped.

## Dev Agent Record

Worker: Dirac, persistent worker/dev specialist

Created by: `bmad-create-story` workflow in spec-exists fallback mode

Source of truth: Backlog task GLA-093 and committed docs/code

Completion notes:
- Added browser-level authentik callback proof through the GLA handoff page and `/auth/callback`.
- Strengthened wrong-recipient proof with a valid second authentik identity and no-upstream assertions.
- Added explicit upstream traffic counters and opt-in proof canaries for wrong-recipient and upstream-leak failures.
- Expanded authentik adapter contract coverage for discovery, remote JWKS/key rotation, token shape, invalid state/code, and diagnostics.
- Replaced brittle provider-token source scans with package/runtime boundary assertions.
- Replaced critical fixed sleeps in scenario/completion E2Es with bounded polling diagnostics.
- Updated architecture and QA evidence to label synthetic, browser-level, gateway/capsule, and deployed-provider proof classes.

File List:
- `.bmad/sdlc-state.yaml`
- `_bmad-output/implementation-artifacts/gla-093-authentik-gateway-e2e-proof-quality-story.md`
- `_bmad-output/implementation-artifacts/tests/test-summary.md`
- `adapters/auth-authentik/src/auth-authentik.test.ts`
- `adapters/auth-authentik/src/fake-authentik.ts`
- `adapters/auth-authentik/src/index.ts`
- `backlog/tasks/gla-093 - Strengthen-authentik-and-gateway-E2E-proof-quality.md`
- `docs/architecture/authentik-e2e-verification.md`
- `package.json`
- `packages/app/src/authentik-dual-method.test.ts`
- `packages/app/src/authentik-scenario-e2e.test.ts`
- `packages/app/src/completion-e2e.test.ts`
- `packages/app/src/scenario-01-e2e.test.ts`
- `tools/e2e-proof-canaries.mjs`
