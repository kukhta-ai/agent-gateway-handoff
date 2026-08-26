---
baseline_commit: ec5b05e99fe0caa0dee997fb9485178e2fc25268
---

# Story GLA-078: Architect Provider-Extensible Auth Assurance Policy

Status: done

Workflow: bmad-create-story
Mode: spec-exists fallback. The literal upstream workflow could not run because `_bmad-output/implementation-artifacts/sprint-status.yaml` and `_bmad-output/planning-artifacts/epics.md` are absent. This story is created directly from `backlog task GLA-078 --plain`, the committed docs, and the source references named by the task. Backlog.md remains the source of truth for status and acceptance criteria.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator and AuthProvider extender,
I want deployment auth requirements expressed as provider-neutral assurance policy,
so that GLA can accept verified evidence from WebAuthn, authentik, and future providers without teaching the gateway provider-specific method names.

## Acceptance Criteria

1. A provider-neutral auth-assurance contract is available at the GLA boundary and can represent verified evidence from different AuthProvider adapters without requiring core or gateway code to depend on provider-specific method names.
2. Deployment policy selects required assurance by a stable GLA policy/profile contract rather than by an app-local enum tied to today's provider methods.
3. The shipped policy profiles preserve the current secure default and current password-permitted behaviour: unset policy demands phishing-resistant/passkey-grade assurance, and password-grade evidence is accepted only by a policy that explicitly permits it.
4. AuthProvider adapters can map provider evidence into the common assurance contract, including authentik amr/acr/factor/source evidence and future provider-specific claims, while unmapped or ambiguous evidence fails closed or degrades only to the lowest safe assurance.
5. The Access Gateway authorizes handoff and auth-reuse decisions from the common assurance contract plus grant and recipient facts, with no provider-specific route logic, raw amr/acr checks, or concrete provider names in gateway authorization decisions.
6. CLI, environment, WPM templates, and operator diagnostics expose the selected assurance policy and report whether the configured provider can satisfy it before a deployment relies on handoff.
7. Invalid policy values, unknown policy profiles, and provider evidence that cannot satisfy the selected policy produce stable actionable diagnostics rather than silent fallback.
8. Developer documentation explains how to add a new auth provider: which port to implement, how verified provider evidence maps into GLA assurance, how installer/doctor verification proves the mapping, and what tests demonstrate gateway independence.

## Non-Goals

- Do not implement recipient-owned authentik account invitations; that is tracked by GLA-085.
- Do not verify deployed authentik login method choices beyond this policy surface; that is tracked by GLA-086.
- Do not decide or document authentik's edge-guard deployment role beyond what this policy needs; that is tracked by GLA-087.
- Do not change the fixed identity/auth model: AuthProvider adapters report facts, and the gateway remains the enforcement point.
- Do not add provider-specific method checks to `packages/gateway`.
- Do not add new package dependencies unless an existing repo dependency cannot satisfy the contract and the user approves.

## Tasks / Subtasks

- [x] Define the provider-neutral assurance boundary contract. (AC: #1, #4, #8)
  - [x] Extend or wrap the current `AuthStrength` fact so adapters can report a common assurance outcome plus safe diagnostic evidence without exposing provider vocabulary to gateway decisions.
  - [x] Preserve compatibility for existing WebAuthn and authentik flows while moving decision inputs away from the two-value deployment enum shape.
  - [x] Document exported public types and functions.

- [x] Introduce stable deployment policy profiles. (AC: #2, #3, #7)
  - [x] Add a policy/profile resolver that has a secure default equivalent to today's passkey/phishing-resistant requirement.
  - [x] Add an explicit password-permitted profile that admits password-grade evidence and nothing weaker.
  - [x] Reject unknown policy/profile values with stable actionable errors; do not silently fall back to the secure default or permissive behavior.

- [x] Map provider evidence into the common assurance contract. (AC: #1, #4, #7)
  - [x] Keep authentik amr/acr interpretation inside the authentik adapter or a provider-owned mapper.
  - [x] Represent method-resolvability and ambiguous evidence so diagnostics can warn operators without upgrading weak evidence.
  - [x] Ensure unmapped or ambiguous valid authentik evidence floors only to the lowest safe accepted tier, matching the existing never-up-map rule.

- [x] Wire the policy through `gla serve` and app composition. (AC: #2, #3, #6, #7)
  - [x] Add CLI/env parsing for the selected assurance policy/profile.
  - [x] Thread the resolved profile into the handoff gateway composition.
  - [x] Ensure startup diagnostics identify the selected policy/profile and provider capability without printing secrets.

- [x] Keep gateway authorization provider-independent. (AC: #5)
  - [x] Replace direct `requiredAuthStrength` decision inputs with the common assurance policy evaluation, or isolate compatibility behind an internal adapter that the gateway treats generically.
  - [x] Ensure handoff authorization and auth-reuse compare only grant facts, recipient facts, and common assurance facts.
  - [x] Add regression checks that no gateway authorization branch depends on `authentik`, amr, acr, source names, or provider method strings.

- [x] Update operator-facing deployment artifacts and diagnostics. (AC: #6, #7)
  - [x] Add the selected assurance policy/profile to the WPM `gla-core` env template.
  - [x] Add diagnostics that tell the operator when the configured provider cannot satisfy the selected policy.
  - [x] Preserve secret redaction for authentik client secret and bearer URLs.

- [x] Update developer documentation for AuthProvider authors. (AC: #8)
  - [x] Explain the port to implement, the common assurance facts to report, and how provider-local evidence maps into those facts.
  - [x] Explain how installer/doctor verification proves a provider can satisfy a selected policy.
  - [x] Explain the tests that prove gateway/core independence from provider-specific evidence.

- [x] Add and update tests before closing the story. (AC: #1-#8)
  - [x] Unit-test policy/profile resolution, invalid values, default behavior, and password-permitted behavior.
  - [x] Unit-test authentik evidence mapping for passkey, password, MFA companions, unresolved amr/acr, and explicit failure.
  - [x] Integration-test `parseServeArgs` env/flag plumbing and `createProvisioningBridge` handoff wiring.
  - [x] Gateway-test provider independence, insufficient assurance refusal, and auth-reuse safety with stored lower assurance.
  - [x] WPM-template or fixture-test that the env template exposes the selected policy.
  - [x] Run `pnpm gate`.

## Dev Notes

### Source of Truth

Backlog task `GLA-078` is the task contract. It is already `In Progress` and depends on `GLA-072`, `GLA-074`, and `GLA-076`.

This story was generated from:

- `backlog task GLA-078 --plain`
- `_bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md`
- `docs/components/identity-and-auth.md`
- `docs/components/access-gateway.md`
- `docs/components/capability-service.md`
- `docs/architecture/kernel-contracts.md`
- `docs/architecture/authentik-integration.md`
- `docs/architecture/authentik-dual-method-flow.md`
- `docs/architecture/authentik-e2e-verification.md`
- `docs/architecture/dependency-strategy.md`
- `packages/kernel/src/ports.ts`
- `packages/app/src/index.ts`
- `packages/app/src/daemon.ts`
- `packages/gateway/src/index.ts`
- `adapters/auth-authentik/src/strength.ts`
- `adapters/auth-authentik/src/index.ts`
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`

### Current Source State

- `packages/kernel/src/ports.ts` currently defines `AuthStrength = "none" | "password" | "webauthn"`. `IdentityPort.verify` and `AuthProviderPort.verifyAssertion` return `authStrength` facts, not decisions. The kernel names no concrete auth provider.
- `packages/app/src/index.ts` already has `AuthProviderKind = "webauthn" | "authentik"` and wires the chosen provider only in the composition root. The handoff options include `requiredAuthStrength?: "password" | "webauthn"` and thread it into `AccessGateway`.
- `packages/app/src/daemon.ts` exposes `--auth-provider` and `GLA_AUTH_PROVIDER`, plus `GLA_AUTHENTIK_*` OIDC config. It does not expose the required assurance/auth-strength policy for `gla serve`.
- `packages/gateway/src/index.ts` currently defines `RequiredAuthStrength = Exclude<AuthStrength, "none">`, defaults `requiredAuthStrength` to `"webauthn"`, and uses `strengthSufficient()` to rank `none < password < webauthn`. Handoff verify and auth-reuse decisions rely on this rank.
- `adapters/auth-authentik/src/strength.ts` maps authentik amr/acr into `AuthStrength`. It already contains the critical never-up-map rule: valid but unresolved method evidence returns the password floor, and invalid tokens return none in the verifier.
- `adapters/auth-authentik/src/index.ts` consumes OIDC `{code,state}`, validates tokens, checks subject binding, maps method evidence to strength, and emits detailed verify outcomes internally. The port method returns only `{ok, authStrength}`.
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl` exposes public edge, WebAuthn RP, and launcher settings. It does not expose a required assurance policy/profile.

### Architecture Guardrails

- Identity + Auth is the verifier of credentials/assertions and reports facts only. It is not a policy decision point. [Source: docs/components/identity-and-auth.md]
- The Access Gateway is the sole public entry and enforcement point for recipient handoff. It triggers step-up and proxies only after grant and auth checks pass. [Source: docs/components/access-gateway.md]
- Capabilities remain the authorization primitive. A recipient-bound grant must still be verified on every request and WebSocket upgrade. [Source: docs/components/capability-service.md]
- Provider selection is horizontal extension. Authentik and future providers must plug in behind `AuthProviderPort`; core and gateway must not import concrete adapters. [Source: docs/architecture/authentik-integration.md]
- The authentik adapter may interpret amr/acr/factor/source details, but gateway logic must never inspect those provider-local values. [Source: docs/architecture/authentik-dual-method-flow.md]
- The deployment policy should be a stable GLA outcome/profile contract, not `webauthn` or `password` as provider method names. Treat today's passkey-required and password-permitted behaviors as initial profiles, not the whole architecture.
- Ambiguous evidence must never upgrade to stronger assurance. Existing authentik mapping already floors unresolved valid evidence to password and failures to none; preserve that safety property. [Source: adapters/auth-authentik/src/strength.ts]
- Auth reuse must enforce the selected policy against the actual stored assurance of the previous step-up. A reused password-grade auth must not open a phishing-resistant/passkey-required route. [Source: docs/architecture/authentik-dual-method-flow.md]
- Operator diagnostics must be actionable and stable, but must not leak secrets. `GLA_AUTHENTIK_CLIENT_SECRET`, grant URLs, bearer tokens, and secret placeholders are sensitive.

### Suggested Contract Shape

The exact naming is an implementation decision, but the story should converge on these boundaries:

- A common assurance fact reported by auth providers, with an ordered outcome usable by the gateway and optional sanitized evidence for diagnostics.
- A common policy/profile resolver that translates operator configuration into requirements over those facts.
- Provider-local evidence mapping owned by adapters or provider-specific helpers.
- A gateway evaluator that accepts the resolved policy and common assurance fact, not provider names or raw method claims.

Avoid making the public deployment surface `requiredAuthStrength=password|webauthn` as the long-term contract. A better public shape is a profile name such as `phishing-resistant` or `password-permitted`, with compatibility aliases only if needed and explicitly documented as aliases.

### Current Source Files To Touch Carefully

- `packages/kernel/src/ports.ts`: public seam for auth facts and provider ports. Preserve adapter-free kernel imports and document exported types. If `AuthProviderPort` changes, update both WebAuthn and authentik adapters plus identity service call sites.
- `packages/app/src/index.ts`: composition root. It may import concrete adapters. This is the correct place to resolve provider selection and thread policy/profile into `AccessGateway`.
- `packages/app/src/daemon.ts`: `gla serve` operator surface. Add CLI/env parsing and stable invalid-value diagnostics here. Keep secret values out of logs and errors.
- `packages/gateway/src/index.ts`: enforcement point. Keep it provider-agnostic. Any new policy evaluation here must depend only on common assurance facts, grant facts, and recipient facts.
- `adapters/auth-authentik/src/strength.ts`: provider evidence mapper. Keep amr/acr matching here, not in gateway. Preserve never-up-map behavior and method-resolvability diagnostics.
- `adapters/auth-authentik/src/index.ts`: authentik adapter. If the port fact shape changes, project detailed verify outcomes into the new common contract without leaking secrets.
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`: expose operator policy/profile settings in the daemon env template. Use clear comments that match `gla serve` parsing.

### Behaviors To Preserve

- Unset deployment policy remains secure by default: phishing-resistant/passkey-grade assurance is required.
- Password-grade authentik evidence is accepted only when the selected policy explicitly permits it.
- Invalid provider evidence, wrong subject, bad state, expired attempts, token-validation failures, or failed exchange must never assert identity or assurance.
- A provider outage or missing capability must fail closed with a dependency/auth diagnostic, not open the handoff.
- Gateway package must continue to declare no dependency on `@gla/auth-authentik` or `@gla/auth-webauthn`.
- Kernel package must continue to declare no dependency on concrete auth adapters.

### Testing Requirements

Use existing Vitest patterns. Relevant current tests include:

- `packages/app/src/auth-provider-selection.test.ts` for daemon parsing and provider selection wiring.
- `packages/app/src/authentik-dual-method.test.ts` for required strength behavior and never-up-map floor.
- `packages/app/src/authentik-scenario-e2e.test.ts` for authentik handoff flows with fake authentik.
- `packages/gateway/src/handoff.test.ts` and `packages/gateway/src/gateway.test.ts` for gateway enforcement behavior.
- `adapters/auth-authentik/src/strength.test.ts` and `adapters/auth-authentik/src/auth-authentik.test.ts` for authentik evidence mapping and adapter outcomes.

Add tests that prove:

- Unset policy resolves to the secure profile.
- Password-permitted profile admits password-grade evidence.
- Unknown policy values fail with stable diagnostics.
- Unresolved valid authentik evidence does not upgrade to phishing-resistant/passkey-grade assurance.
- Gateway authorization has no dependency on provider method strings or provider names.
- Auth reuse evaluates the selected policy against the stored assurance, including rejection of reused password assurance under a phishing-resistant policy.
- WPM env template exposes the selected policy/profile.

Full project gate:

```bash
pnpm install
pnpm gate
```

`pnpm gate` is `pnpm run typecheck && biome ci . && vitest run`.

### Security Review Focus

- Assurance ordering: the rank must be explicit, total, and safe.
- Fail-closed/degrade-only behavior: unknown or ambiguous provider evidence must not silently upgrade.
- Authentik amr/acr ambiguity: a valid token with unresolved method evidence must not satisfy phishing-resistant policy.
- Auth reuse: a reused lower-assurance record must not satisfy a higher-assurance policy.
- Gateway independence: no provider-specific evidence may enter gateway authorization logic.
- Diagnostics: report enough to fix provider/policy mismatch without logging secrets, bearer URLs, raw grants, or client secrets.

### Project Structure Notes

- Keep concrete adapter imports in `packages/app` only. The module-boundary rule is a quality-gate invariant.
- Keep provider-local evidence interpretation in adapter packages.
- Keep policy/profile names and public configuration in app/daemon/WPM surfaces, not in gateway route logic.
- Documentation updates are part of the task's Definition of Done, but this create-story step does not edit docs.

### Open Questions For Dev Agent

- Final public profile names should be chosen once and then used consistently across CLI, env, docs, diagnostics, and tests. Recommended names: `phishing-resistant` for the secure default and `password-permitted` for the explicit fallback-permitting profile.
- Decide whether to keep `requiredAuthStrength` as a private compatibility layer while introducing the public profile contract, or replace it fully with a policy evaluator in this task.

## References

- Backlog: `backlog task GLA-078 --plain`
- Investigation: `_bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md`
- Identity/Auth component: `docs/components/identity-and-auth.md`
- Access Gateway component: `docs/components/access-gateway.md`
- Capability service: `docs/components/capability-service.md`
- Kernel contracts: `docs/architecture/kernel-contracts.md`
- Authentik integration: `docs/architecture/authentik-integration.md`
- Dual-method flow: `docs/architecture/authentik-dual-method-flow.md`
- E2E verification: `docs/architecture/authentik-e2e-verification.md`
- Dependency strategy: `docs/architecture/dependency-strategy.md`
- Kernel port source: `packages/kernel/src/ports.ts`
- App composition source: `packages/app/src/index.ts`
- Daemon source: `packages/app/src/daemon.ts`
- Gateway source: `packages/gateway/src/index.ts`
- Authentik strength mapper: `adapters/auth-authentik/src/strength.ts`
- Authentik adapter: `adapters/auth-authentik/src/index.ts`
- WPM env template: `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `bmad-dev-story` skill loaded from `/home/agent/.codex/skills/bmad-dev-story/SKILL.md`.
- `python3 _bmad/scripts/resolve_customization.py --skill /home/agent/.codex/skills/bmad-create-story --key workflow`
- `backlog task GLA-078 --plain`
- `find _bmad-output -maxdepth 3 -type f -print | sort`
- `rg -n "requiredAuthStrength|authProvider|AuthStrength|AuthProviderPort|auth_strength|GLA_AUTH_PROVIDER|GLA_LAUNCHER_MODE" ...`
- Red check before implementation: `pnpm exec vitest run packages/kernel/src/auth-assurance.test.ts packages/gateway/src/handoff.test.ts packages/app/src/auth-provider-selection.test.ts adapters/auth-authentik/src/strength.test.ts` failed on missing assurance-policy exports/plumbing.
- `pnpm --filter @gla/kernel build` passed.
- Targeted green check: `pnpm exec vitest run packages/kernel/src/auth-assurance.test.ts packages/gateway/src/handoff.test.ts packages/app/src/auth-provider-selection.test.ts adapters/auth-authentik/src/strength.test.ts` passed.
- Related authentik/app check: `pnpm exec vitest run packages/app/src/authentik-dual-method.test.ts packages/app/src/authentik-scenario-e2e.test.ts packages/app/src/daemon.test.ts adapters/auth-authentik/src/auth-authentik.test.ts` passed.
- Focused compatibility check: `pnpm exec vitest run packages/app/src/authentik-dual-method.test.ts` passed.
- `pnpm run typecheck` passed.
- First `pnpm gate` run failed on Biome formatting/import ordering in touched files; fixed with targeted `pnpm exec biome check --write ...`.
- Final `pnpm gate` passed: typecheck, `biome ci .`, and full Vitest suite passed with 54 test files, 560 passed, 12 skipped. Biome emitted a non-blocking warning for the pre-existing broken symlink `wpm/CLAUDE.md`.
- `bmad-story-automator-review` skill loaded from `/home/agent/.codex/skills/bmad-story-automator-review/SKILL.md`, with `workflow.yaml`, `instructions.xml`, and `checklist.md`.
- Review discovery: `git status --porcelain=v1`, `git diff --name-only`, and `git diff --cached --name-only`.
- Review targeted check: `pnpm exec vitest run packages/kernel/src/auth-assurance.test.ts adapters/auth-authentik/src/strength.test.ts packages/gateway/src/handoff.test.ts packages/app/src/auth-provider-selection.test.ts --reporter=dot` passed with 4 files and 85 tests.
- Review typecheck: `pnpm exec tsc -b packages/kernel packages/identity packages/gateway adapters/auth-authentik adapters/auth-webauthn packages/app --pretty false` passed after removing an unused import introduced during review fixes.
- Review related check: `pnpm exec vitest run adapters/auth-authentik/src/auth-authentik.test.ts adapters/auth-webauthn/src/auth-webauthn.test.ts packages/identity/src/enrollment.test.ts packages/gateway/src/handoff.test.ts packages/app/src/auth-provider-selection.test.ts packages/app/src/authentik-dual-method.test.ts packages/app/src/authentik-scenario-e2e.test.ts --reporter=dot` passed with 7 files and 125 tests.
- Review format fix: `pnpm exec biome check --write adapters/auth-authentik/src/auth-authentik.test.ts adapters/auth-authentik/src/index.ts adapters/auth-authentik/src/stores.ts adapters/auth-authentik/src/strength.test.ts adapters/auth-authentik/src/strength.ts adapters/auth-webauthn/src/index.ts packages/app/src/auth-provider-selection.test.ts packages/app/src/authentik-dual-method.test.ts packages/app/src/daemon.ts packages/app/src/index.ts packages/gateway/src/handoff-page.ts packages/gateway/src/handoff.test.ts packages/gateway/src/index.ts packages/identity/src/index.ts packages/kernel/src/auth-assurance.test.ts packages/kernel/src/auth-assurance.ts packages/kernel/src/index.ts packages/kernel/src/ports.ts` updated touched TypeScript files.
- Review final gate: `pnpm gate` passed with typecheck, `biome ci .`, and full Vitest suite; Vitest reported 54 files passed, 563 tests passed, and 12 skipped. Biome emitted a non-blocking warning for the pre-existing broken symlink `wpm/CLAUDE.md`.

### Completion Notes List

- Created via `bmad-create-story` spec-exists fallback because sprint status and planning epics artifacts are absent.
- Story grounded in the backlog task, referenced architecture/component docs, investigation note, and current source seams.
- Implemented provider-neutral auth assurance policy types, profile parsing, compatibility translation from legacy `AuthStrength`, and policy sufficiency evaluation in the kernel.
- Wired `authAssurancePolicy` through the gateway and app composition while keeping deprecated `requiredAuthStrength` as a compatibility adapter.
- Added `gla serve` CLI/env support for `--auth-assurance-policy` / `GLA_AUTH_ASSURANCE_POLICY`, startup diagnostics for the selected profile, and stable invalid-profile errors.
- Kept authentik method interpretation adapter-local and projected amr/acr evidence into common assurance facts with method-resolvability diagnostics.
- Updated WPM env template and architecture/component docs for policy profiles, gateway independence, and AuthProvider author guidance.
- Added/updated unit, integration, gateway, authentik, and WPM-template tests. Final `pnpm gate` passed.
- Pre-existing dirty files `.bmad/sdlc-state.yaml` and `backlog/tasks/gla-078 - Expose-deployment-auth-strength-policy-for-gla-serve.md` were left untouched by this dev-story run.
- Ran `bmad-story-automator-review` and found two verified blocking gaps: provider assurance evidence did not fully cross the `AuthProviderPort`/identity/gateway boundary, and `gla serve` diagnostics did not state provider-policy satisfiability before deployment.
- Applied authorized HIGH/MEDIUM review fixes in GLA-078 scope: preserved optional provider assurance evidence across kernel ports, identity, authentik/WebAuthn adapters, and gateway step-up; gateway now fails closed when optional assurance evidence is weaker than compatibility `authStrength`.
- Added `gla serve` provider capability diagnostics for WebAuthn and authentik, including authentik method-map/doctor verification guidance without printing secrets.
- Updated docs and tests to reflect the provider-neutral `{ authStrength, assurance? }` boundary and gateway evaluation of common assurance facts.
- Sprint-status sync skipped during review because `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent; Backlog.md managed task state was not edited.

### Senior Developer Review (AI)

Reviewer: GPT-5 Codex on 2026-06-13

Outcome: Approved after automatic fixes. No CRITICAL, HIGH, or MEDIUM findings remain in the reviewed GLA-078 scope.

Findings fixed:

- HIGH: The common assurance contract existed in kernel helpers, but `AuthProviderPort`, identity, and gateway step-up still primarily crossed the boundary as legacy `authStrength`. Authentik/WebAuthn provider evidence could be discarded before gateway enforcement, so AC1, AC4, and AC5 were only partially satisfied. Fixed by adding optional provider-neutral assurance evidence to the provider and identity port result shapes, preserving authentik/WebAuthn evidence through identity, and making gateway policy evaluation prefer explicit assurance evidence over the compatibility strength.
- MEDIUM: `gla serve` startup diagnostics exposed the selected profile but did not report whether the configured provider could satisfy it or whether authentik method mapping needed verification, leaving AC6 and AC7 partially satisfied. Fixed by adding provider-policy capability diagnostics for WebAuthn and authentik.
- MEDIUM: Several docs and source comments still described the port as strictly `{ ok, authStrength }` or "unchanged", which contradicted the new provider-neutral assurance boundary and could mislead future provider authors under AC8. Fixed by updating kernel/authentik/gateway documentation and source comments.

Review evidence:

- AC coverage rechecked against actual git diff and story claims, including gateway provider-independence, assurance fail-closed behavior, diagnostics, docs, tests, and WPM env template.
- Regression coverage added for a compatibility `authStrength: "webauthn"` result with weaker explicit assurance evidence, proving gateway authorization fails closed under the default phishing-resistant policy.
- `pnpm gate` passed after review fixes. Biome still warns about the pre-existing broken symlink `wpm/CLAUDE.md`, but the quality gate exits successfully.

### File List

- `_bmad-output/implementation-artifacts/gla-078-provider-extensible-auth-assurance-policy.md`
- `packages/kernel/src/auth-assurance.ts`
- `packages/kernel/src/auth-assurance.test.ts`
- `packages/kernel/src/index.ts`
- `packages/kernel/src/ports.ts`
- `packages/gateway/src/index.ts`
- `packages/gateway/src/handoff-page.ts`
- `packages/gateway/src/handoff.test.ts`
- `packages/identity/src/index.ts`
- `packages/app/src/index.ts`
- `packages/app/src/daemon.ts`
- `packages/app/src/auth-provider-selection.test.ts`
- `packages/app/src/authentik-dual-method.test.ts`
- `adapters/auth-authentik/src/auth-authentik.test.ts`
- `adapters/auth-authentik/src/index.ts`
- `adapters/auth-authentik/src/stores.ts`
- `adapters/auth-authentik/src/strength.ts`
- `adapters/auth-authentik/src/strength.test.ts`
- `adapters/auth-webauthn/src/index.ts`
- `docs/components/identity-and-auth.md`
- `docs/components/access-gateway.md`
- `docs/architecture/kernel-contracts.md`
- `docs/architecture/authentik-integration.md`
- `docs/architecture/authentik-dual-method-flow.md`
- `docs/architecture/authentik-e2e-verification.md`
- `docs/architecture/slice-4b-handoff.md`
- `docs/architecture/slice-6-second-handoff.md`
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`

### Change Log

- 2026-06-12: Created GLA-078 story context artifact.
- 2026-06-12: Ran `bmad-dev-story`; implemented provider-neutral auth assurance policy, deployment profile plumbing, adapter evidence projection, WPM/docs updates, and tests. Story moved to review.
- 2026-06-13: Ran `bmad-story-automator-review`; fixed assurance evidence propagation across provider/identity/gateway boundaries, added provider-policy capability diagnostics, updated story file list/docs/tests, and verified with `pnpm gate`. Story moved to done.
