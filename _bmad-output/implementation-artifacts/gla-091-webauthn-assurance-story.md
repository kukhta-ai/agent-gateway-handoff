# Story GLA-091: Require User Verification for WebAuthn Assurance

Status: review

Backlog source of truth: `backlog task GLA-091 --plain`

Branch: `feature/authentik-task-091`

BMAD workflows invoked for Rule 3 evidence:
- `bmad-create-story`: used to create this context-filled story artifact from the backlog task and committed docs/code.
- `bmad-dev-story`: used for implementation on `feature/authentik-task-091`; source, tests, docs, and installer templates were updated.

Spec-exists fallback note: `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent in this repo, so this story was produced from the Backlog.md task contract plus committed design/code references rather than from upstream BMAD sprint/planning artifacts.

## Story

As a gateway operator relying on WebAuthn/passkeys for strong handoff assurance, I want WebAuthn-related evidence to satisfy the strongest assurance profile only when user verification or an equivalent configured proof is present, so that weaker authenticator events cannot be silently upgraded into phishing-resistant assurance.

## Acceptance Criteria

1. WebAuthn and passkey evidence that lacks required user verification or equivalent configured proof is not classified as the strongest phishing-resistant assurance outcome.
2. Provider evidence with explicit user verification, recipient binding, and replay-resistant challenge validation can satisfy the strongest shipped assurance profile.
3. Missing, ambiguous, downgraded, or provider-specific authenticator evidence produces a degraded or insufficient assurance result with actionable diagnostics.
4. The in-tree WebAuthn adapter and authentik evidence mapping report assurance facts through the common auth-assurance contract without gateway code checking provider-specific flags.
5. Password-permitted policies continue to accept password-grade evidence only when explicitly selected and do not cause non-UV WebAuthn evidence to be upgraded.
6. Tests cover UV-required success, UV-missing refusal or downgrade, authentik mapped evidence, replayed assertions, and diagnostics for ambiguous authenticator evidence.

Definition of Done emphasis from backlog:
- DoD #7: Auth-assurance docs define the difference among presence, verification, phishing-resistant evidence, and password-grade evidence.
- DoD #8: Security review notes explain downgrade/fail-closed behavior and why ambiguous authenticator evidence cannot satisfy strongest assurance.

## Context Read

- `docs/components/identity-and-auth.md`
- `docs/architecture/authentik-dual-method-flow.md`
- `adapters/auth-webauthn/src/index.ts`
- `adapters/auth-authentik/src/strength.ts`
- `packages/kernel/src/auth-assurance.ts`
- `packages/kernel/src/auth-assurance.test.ts`
- `packages/kernel/src/ports.ts`
- `packages/identity/src/index.ts`
- `packages/gateway/src/index.ts`
- `adapters/auth-webauthn/src/auth-webauthn.test.ts`
- `adapters/auth-authentik/src/strength.test.ts`
- `adapters/auth-authentik/src/auth-authentik.test.ts`
- `packages/app/src/auth-provider-selection.test.ts`
- `packages/app/src/authentik-dual-method.test.ts`
- `_bmad-output/implementation-artifacts/gla-078-provider-extensible-auth-assurance-policy.md`

## Current Behavior Model

The architecture already separates authentication facts from authorization decisions. Identity/Auth providers verify credentials and emit provider-neutral `AuthAssuranceEvidence`; the gateway evaluates that common evidence against an assurance policy and must not inspect authentik/WebAuthn-specific flags.

`packages/kernel/src/auth-assurance.ts` currently maps legacy `authStrength: "webauthn"` directly to `level: "phishing-resistant"` through compatibility helpers. That is safe only when adapters have already proven the WebAuthn assertion includes user verification or an equivalent configured proof.

`adapters/auth-webauthn/src/index.ts` currently requests WebAuthn user verification as `preferred`, verifies registration and authentication with `requireUserVerification: false`, and returns `authStrength: "webauthn"` plus phishing-resistant assurance on any verified assertion. This is the primary gap for AC1.

`adapters/auth-authentik/src/strength.ts` maps passkey-like `amr` tokens such as `hwk`, `swk`, `webauthn`, and `fido`, plus configured WebAuthn `acr` values, to `authStrength: "webauthn"` without separately proving user verification or equivalent assurance. Ambiguous/unmatched evidence already floors to password-grade with `methodResolvable: false`; GLA-091 should extend that fail-closed behavior to passkey/WebAuthn labels that lack UV/equivalent proof.

`packages/gateway/src/index.ts` consumes `factResult.assurance ?? factResult.authStrength` and evaluates it through provider-neutral policy. That boundary should remain unchanged except for tests proving no provider-specific WebAuthn/authentik logic is introduced.

## Architecture Constraints

- Preserve the provider-neutral auth-assurance contract. Provider adapters translate native evidence into common facts; gateway/core enforce policy only on common facts.
- Do not add gateway checks for WebAuthn flags, authentik `amr`, authentik `acr`, issuer-specific claims, provider names, or adapter internals.
- Ambiguous, missing, provider-specific, or downgraded evidence must degrade or fail closed. It must not be up-mapped because the string contains WebAuthn/passkey/fido terminology.
- Preserve GLA grant, recipient binding, capability, and replay semantics. This task changes assurance classification and diagnostics, not authorization model or capability semantics.
- Password-permitted policy is an explicit lower-assurance profile. It must not transform non-UV WebAuthn into phishing-resistant assurance.
- Keep authentik and WebAuthn provider semantics in adapters. The kernel may define common evidence shape and policy rules, but it should not depend on provider-specific claim names.

## Tasks and Subtasks

- [x] Define or tighten the common assurance evidence needed to distinguish presence from user verification.
  - [x] Prefer a provider-neutral field or policy input such as verified-user evidence, verification strength, or equivalent configured phishing-resistant proof.
  - [x] Avoid provider-specific claim names in kernel/gateway interfaces.
  - [x] Preserve compatibility for existing providers that already emit explicit `level` evidence.
- [x] Harden the WebAuthn adapter assurance result.
  - [x] Request user verification for authentication when strongest assurance is expected.
  - [x] Require user verification during assertion verification, or deliberately downgrade/refuse assertions that do not prove it.
  - [x] Ensure replayed assertions and challenge/counter failures never produce phishing-resistant assurance.
  - [x] Confirm enrollment-time evidence does not imply future authentication assurance unless assertion evidence proves UV.
- [x] Harden authentik evidence mapping.
  - [x] Treat passkey/WebAuthn-like labels as insufficient for phishing-resistant assurance unless explicit UV or equivalent configured proof is present.
  - [x] Keep ambiguous or unrecognized method evidence degraded with diagnostics.
  - [x] Preserve password-grade mapping for password claims and the explicit password-permitted profile.
- [x] Add actionable diagnostics.
  - [x] Surface why WebAuthn/passkey evidence was downgraded: missing UV, ambiguous provider evidence, unresolved method, replay/challenge failure, or only password-grade proof.
  - [x] Keep diagnostics redacted and operator-oriented.
- [x] Preserve provider-neutral gateway behavior.
  - [x] Keep gateway authorization decisions based on `AuthAssuranceEvidence` and selected policy.
  - [x] Add or update static/boundary tests to prove gateway does not import/check provider-specific WebAuthn/authentik markers.
- [x] Update docs/security notes required by DoD #7 and #8.
  - [x] Define presence, user verification, phishing-resistant evidence, and password-grade evidence.
  - [x] Explain fail-closed downgrade behavior for ambiguous authenticator evidence.

## AC-to-Test Plan

- AC1: Add WebAuthn adapter tests proving UV-missing assertions are refused or downgraded and do not emit `level: "phishing-resistant"`. Add authentik mapper tests proving passkey/WebAuthn labels without UV/equivalent proof degrade or are insufficient.
- AC2: Add UV-required success coverage for the WebAuthn adapter and authentik mapped evidence with explicit UV/equivalent proof. Include recipient binding and replay-resistant challenge validation evidence through existing provider verification flows.
- AC3: Add diagnostics tests for missing UV, ambiguous authenticator evidence, and unresolved provider method evidence. Verify default phishing-resistant policy rejects degraded evidence with actionable failure text.
- AC4: Add or preserve boundary tests scanning gateway/kernel/provider imports so gateway code does not inspect provider-specific WebAuthn/authentik flags. Unit tests should assert adapters report through `AuthAssuranceEvidence`.
- AC5: Extend password-permitted tests so password-grade evidence remains accepted only under the password-permitted profile, while non-UV WebAuthn remains degraded and is not upgraded by that policy.
- AC6: Cover the required matrix explicitly: UV-required success, UV-missing refusal/downgrade, authentik mapped evidence, replayed assertions, and diagnostics for ambiguous authenticator evidence.

Recommended focused commands:
- `pnpm exec vitest run packages/kernel/src/auth-assurance.test.ts`
- `pnpm exec vitest run adapters/auth-webauthn/src/auth-webauthn.test.ts`
- `pnpm exec vitest run adapters/auth-authentik/src/strength.test.ts adapters/auth-authentik/src/auth-authentik.test.ts`
- `pnpm exec vitest run packages/app/src/auth-provider-selection.test.ts packages/app/src/authentik-dual-method.test.ts`
- `pnpm run gate`

## Files Likely to Change

- `packages/kernel/src/auth-assurance.ts`
- `packages/kernel/src/auth-assurance.test.ts`
- `packages/kernel/src/ports.ts`
- `adapters/auth-webauthn/src/index.ts`
- `adapters/auth-webauthn/src/auth-webauthn.test.ts`
- `adapters/auth-authentik/src/strength.ts`
- `adapters/auth-authentik/src/strength.test.ts`
- `adapters/auth-authentik/src/auth-authentik.test.ts`
- `packages/app/src/auth-provider-selection.test.ts`
- `packages/app/src/authentik-dual-method.test.ts`
- `docs/components/identity-and-auth.md`
- `docs/architecture/authentik-dual-method-flow.md`

Files that should generally not need production changes:
- `packages/gateway/src/index.ts`, except tests/boundary evidence if existing provider-neutral behavior is insufficiently covered.
- `packages/identity/src/index.ts`, unless the common evidence type changes require typing or persistence adjustments.

## Implementation Plan

1. Write failing tests first for UV-missing downgrade/refusal and authentik passkey label downgrade.
2. Define the minimal provider-neutral assurance evidence extension, if existing `AuthAssuranceEvidence` cannot express verified-user proof clearly.
3. Update the WebAuthn adapter so strongest assurance requires UV-proven assertions.
4. Update authentik strength mapping so passkey/WebAuthn labels require explicit UV or equivalent configured proof before mapping to phishing-resistant assurance.
5. Add diagnostics for downgrade/fail-closed cases and keep all diagnostics redacted.
6. Verify password-permitted policy still accepts only password-grade evidence and never upgrades non-UV WebAuthn.
7. Re-run boundary tests proving gateway remains provider-neutral.
8. Update auth-assurance docs/security notes for DoD #7 and #8.
9. Run focused tests, then the full project gate.

## Risks and Anti-Patterns

- Do not treat `authStrength: "webauthn"`, a passkey label, or authentik `amr` text as sufficient phishing-resistant proof by itself.
- Do not move provider-specific WebAuthn/authentik checks into gateway code.
- Do not make password-permitted policy upgrade non-UV WebAuthn; it is a lower-assurance acceptance profile only.
- Do not weaken replay or recipient-binding checks while changing assurance classification.
- Do not expose raw provider claims, assertion material, challenge state, secrets, or grant-bearing URLs in diagnostics.
- Avoid a raw provider-specific contract such as `authentikUv` or `webauthnFlag` in shared gateway-facing types; use provider-neutral semantics.
- Watch for stored/reused recipient auth state that carries only legacy `authStrength`; it must not bypass a stricter assurance decision.

## Open Decisions

- What exact provider-neutral evidence field should represent verified-user or equivalent phishing-resistant proof?
- Should the in-tree WebAuthn adapter require UV unconditionally by setting WebAuthn options and verification to required, or allow non-UV ceremonies while returning degraded/insufficient assurance?
- Which authentik claim combination counts as equivalent configured proof: explicit UV claim, configured `acr`, flow/policy evidence, or another documented claim source?
- Should legacy `authStrength` compatibility remain unchanged for third-party providers, with shipped adapters responsible for strict evidence, or should policy evaluation reject legacy WebAuthn strength when no assurance evidence is provided?
- What is the most stable test seam for WebAuthn UV success/failure: mocking `@simplewebauthn/server`, virtual authenticator E2E, or both?

## Dev Agent Record

Agent: Dirac, persistent worker/dev specialist

Source workflow evidence:
- Invoked `bmad-create-story` for story context in spec-exists fallback mode.
- Invoked `bmad-dev-story` for implementation and validation on `feature/authentik-task-091`.

Implementation notes:
- Added provider-neutral assurance proof fields and diagnostics to the kernel contract.
- Made object-based phishing-resistant policy require explicit user verification, recipient binding, and replay-resistant challenge proof.
- Removed legacy string-only `"webauthn"` as sufficient phishing-resistant evidence; strongest enforcement now requires structured assurance evidence.
- Hardened the in-tree WebAuthn adapter to request and require user verification and to refuse/downgrade failed or non-UV assertions.
- Hardened authentik strength mapping so passkey/WebAuthn labels require explicit `gla_uv`/user-verification evidence plus adapter-established binding and replay proof.
- Kept gateway policy evaluation provider-neutral; provider-specific authentik/WebAuthn evidence is translated at adapter boundaries.
- Updated app diagnostics, docs, and identity-provider bundle templates/instructions so installer-generated authentik evidence includes `amr` plus explicit UV evidence.

Validation commands:
- `pnpm exec tsc -b packages/kernel adapters/auth-webauthn adapters/auth-authentik packages/gateway packages/app --pretty false`
- `pnpm exec vitest run packages/kernel/src/auth-assurance.test.ts adapters/auth-webauthn/src/auth-webauthn.test.ts adapters/auth-authentik/src/strength.test.ts adapters/auth-authentik/src/auth-authentik.test.ts packages/gateway/src/handoff.test.ts packages/app/src/auth-provider-selection.test.ts packages/app/src/daemon.test.ts packages/app/src/daemon-state.test.ts --reporter=dot`
- `node wpm/wip/bundles/identity-provider/installer-scripts/smoke-amr-strength.mjs`
- `pnpm exec vitest run packages/app/src/authentik-dual-method.test.ts packages/app/src/authentik-enrollment.test.ts packages/app/src/authentik-scenario-e2e.test.ts --reporter=dot`
- `pnpm exec biome check --write packages/app/src/authentik-dual-method.test.ts packages/app/src/authentik-enrollment.test.ts packages/app/src/authentik-scenario-e2e.test.ts`
- `pnpm exec vitest run packages/kernel/src/auth-assurance.test.ts packages/gateway/src/handoff.test.ts packages/app/src/gateway-grant-canary-e2e.test.ts --reporter=dot`
- `pnpm run gate` passed after review fixes: typecheck, Biome CI, and 63 Vitest files green with 694 passed and 15 skipped.

Specialist review evidence:
- Reviewer `Wegener` invoked `bmad-story-automator-review` in read-only mode and APPROVED after verifying the legacy string-only WebAuthn regression, authentik docs/template alignment, story File List, and focused kernel/gateway plus adapter tests.
- TEA/security `Helmholtz` invoked `bmad-testarch-test-review` in bounded read-only mode and returned PASS; focused kernel/gateway tests passed locally and full-gate evidence was closure-sufficient.
- Architect `Mill` performed targeted architecture conformance review and APPROVED after the common policy rejected legacy string-only `"webauthn"` and docs/templates declared UV proof.

## File List

- `.bmad/sdlc-state.yaml`
- `_bmad-output/implementation-artifacts/gla-091-webauthn-assurance-story.md`
- `adapters/auth-authentik/src/auth-authentik.test.ts`
- `adapters/auth-authentik/src/fake-authentik.ts`
- `adapters/auth-authentik/src/index.ts`
- `adapters/auth-authentik/src/oidc.ts`
- `adapters/auth-authentik/src/strength.test.ts`
- `adapters/auth-authentik/src/strength.ts`
- `adapters/auth-webauthn/src/auth-webauthn.test.ts`
- `adapters/auth-webauthn/src/index.ts`
- `backlog/tasks/gla-091 - Require-verified-user-presence-for-WebAuthn-assurance.md`
- `docs/architecture/authentik-dual-method-flow.md`
- `docs/architecture/authentik-integration.md`
- `docs/architecture/authentik-service-standup.md`
- `docs/architecture/kernel-contracts.md`
- `docs/components/identity-and-auth.md`
- `packages/app/src/auth-enrollment-policy.ts`
- `packages/app/src/auth-provider-selection.test.ts`
- `packages/app/src/authentik-dual-method.test.ts`
- `packages/app/src/authentik-enrollment.test.ts`
- `packages/app/src/authentik-scenario-e2e.test.ts`
- `packages/app/src/daemon-state.test.ts`
- `packages/app/src/daemon.test.ts`
- `packages/app/src/gateway-grant-canary-e2e.test.ts`
- `packages/gateway/src/handoff.test.ts`
- `packages/kernel/src/auth-assurance.test.ts`
- `packages/kernel/src/auth-assurance.ts`
- `packages/kernel/src/index.ts`
- `packages/kernel/src/ports.ts`
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`
- `wpm/wip/bundles/identity-provider/_AGENTS.md`
- `wpm/wip/bundles/identity-provider/installer-scripts/smoke-amr-strength.mjs`
- `wpm/wip/bundles/identity-provider/installer-skills/authentik-standup/SKILL.md`
- `wpm/wip/bundles/identity-provider/payload/templates/amr-scope-mapping.md`
- `wpm/wip/bundles/identity-provider/payload/templates/amr-scope-mapping.py`
- `wpm/wip/bundles/identity-provider/payload/templates/oidc-app-and-flow.outcomes.md`

## Change Log

- 2026-06-13: Implemented provider-neutral UV/binding/replay assurance proof, hardened WebAuthn and authentik mappings, removed legacy string-only WebAuthn as sufficient strongest proof, updated diagnostics/docs/installers, and verified with full `pnpm run gate`.
- 2026-06-13: Persistent reviewer, TEA/security, and architect re-reviews approved GLA-091 after review-driven fixes.
