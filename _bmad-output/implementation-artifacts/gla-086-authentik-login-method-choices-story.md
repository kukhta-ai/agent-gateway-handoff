---
baseline_commit: 9ec368a068dfa9bd4070564e4b353511a58b37c3
---

# Story GLA-086: Verify Deployed Authentik Login Method Choices

Status: done

Backlog source of truth: `backlog task GLA-086 --plain`

Branch: `feature/authentik-task-086`

BMAD workflow invoked for Rule 3 evidence:
- `bmad-create-story`: used to create this context-filled story artifact from the backlog task, committed docs, current code, WPM bundle artifacts, and the completed GLA-091 story.
- `bmad-dev-story`: used for implementation work in the persistent worker lane.
- `bmad-qa-generate-e2e-tests`: used by the persistent TEA/QA lane to validate tests and write the test summary.

Spec-exists fallback note: `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent, so this story was produced from the Backlog.md task contract plus committed design/code references rather than from upstream BMAD sprint/planning artifacts.

## Story

As a GLA operator using authentik as the delegated identity provider, I want a deployment verification and doctor surface that proves which authentik login choices are visible and what evidence they emit, so that password-only, missing passkey, missing source, or ambiguous-evidence deployments are caught before handoff policy relies on them.

## Acceptance Criteria

1. The deployed authentik flow for the GLA application presents a password path and presents a passkey or WebAuthn path to a recipient with an enrolled compatible authenticator.
2. A recipient without an enrolled passkey still has an observable password fallback path, and that path succeeds for handoff only when the selected GLA assurance policy permits the resulting evidence.
3. Configured external, social, or enterprise sources for the GLA authentik application appear as login choices and return stable subject evidence that can be enrolled and later verified.
4. Successful passkey, password, and configured source logins produce provider evidence that GLA maps to distinct assurance outcomes; missing or ambiguous evidence is surfaced as degraded or insufficient, never silently as stronger assurance.
5. A deployment verification or doctor surface reports which authentik stages, passkey configuration, password path, configured sources, emitted evidence, and GLA assurance mapping are active for the GLA application.
6. Operator-facing documentation explains what a password-only authentik screen means and which authentik flow, stage, source, authenticator, evidence-emission, and GLA assurance-policy settings control visible login options and handoff eligibility.

## Scope

This story is about observable deployed authentik configuration and evidence. It should not rebuild the authentik adapter, change gateway authorization semantics, or make gateway/core understand authentik internals. The desired result is a reliable deployment verification/doctor readout that tells an operator whether the actual authentik flow can satisfy the selected GLA assurance policy.

## Context Read

- `backlog task GLA-086 --plain`
- `docs/architecture/authentik-dual-method-flow.md`
- `docs/architecture/authentik-e2e-verification.md`
- `docs/architecture/authentik-service-standup.md`
- `docs/components/identity-and-auth.md`
- `_bmad-output/implementation-artifacts/gla-091-webauthn-assurance-story.md`
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`
- `wpm/wip/bundles/gla-core/bundle.yml`
- `wpm/wip/bundles/identity-provider/bundle.yml`
- `wpm/wip/bundles/identity-provider/install-backlog/tasks/identity-provider-5 - Stand-up-or-adopt-authentik-and-configure-the-RP-application-and-dual-method-flow.md`
- `wpm/wip/bundles/identity-provider/install-backlog/tasks/identity-provider-6 - Verify-authentik-end-to-end-and-record-the-dependency-binding.md`
- `wpm/wip/bundles/identity-provider/payload/templates/oidc-app-and-flow.outcomes.md`
- `wpm/wip/bundles/identity-provider/payload/templates/amr-scope-mapping.md`
- `wpm/wip/bundles/identity-provider/payload/templates/amr-scope-mapping.py`
- `wpm/wip/bundles/identity-provider/payload/templates/dependency-binding.example.json`
- `wpm/wip/bundles/identity-provider/installer-scripts/probe-authentik.mjs`
- `wpm/wip/bundles/identity-provider/installer-scripts/smoke-amr-strength.mjs`
- `wpm/wip/bundles/identity-provider/installer-skills/authentik-standup/SKILL.md`
- `adapters/auth-authentik/src/index.ts`
- `adapters/auth-authentik/src/oidc.ts`
- `adapters/auth-authentik/src/strength.ts`
- `adapters/auth-authentik/src/fake-authentik.ts`
- `adapters/auth-authentik/src/auth-authentik.test.ts`
- `adapters/auth-authentik/src/strength.test.ts`
- `packages/app/src/auth-enrollment-policy.ts`
- `packages/app/src/daemon.ts`
- `packages/app/src/index.ts`
- `packages/app/src/auth-provider-selection.test.ts`
- `packages/app/src/authentik-dual-method.test.ts`
- `packages/app/src/authentik-enrollment.test.ts`
- `packages/app/src/authentik-scenario-e2e.test.ts`
- `packages/app/src/daemon.test.ts`
- `surfaces/cli/src/cli.ts`
- External authentik docs referenced by the backlog: Identification stage, WebAuthn/FIDO2/Passkeys authenticator setup stage, and Sources.

## Current Behavior Model

Runtime authentik support is already provider-neutral at the GLA boundary. `packages/app/src/index.ts` is the composition root that imports concrete auth adapters; `packages/gateway` and `packages/kernel` remain adapter-free. The gateway evaluates only `AuthAssuranceEvidence` / selected `AuthAssurancePolicy`.

GLA-091 has already tightened the assurance contract. In current code, authentik passkey-like `amr`/`acr` labels map to strongest assurance only with explicit `gla_uv` / user-verification proof plus recipient binding and replay-resistant OIDC state/nonce/PKCE validation. Missing UV or ambiguous method evidence degrades to password-grade diagnostics instead of being up-mapped.

`adapters/auth-authentik/src/strength.ts` is the provider-specific mapping seam. It recognizes default passkey labels `{hwk, swk, webauthn, fido}` only when `userVerified` is true, recognizes password `{pwd}`, and floors unresolved valid tokens to password with diagnostics. `adapters/auth-authentik/src/index.ts` verifies OIDC state, nonce, issuer, audience, token signature, subject binding, and one-time replay semantics before returning provider-neutral facts.

Existing deterministic tests cover the adapter and GLA-side behavior with `FakeAuthentik`: passkey plus UV authorizes under phishing-resistant policy, password authorizes only under password-permitted policy, non-UV passkey degrades, ambiguous evidence floors, replay and subject mismatch fail closed, and gateway source remains provider-agnostic.

The WPM identity-provider bundle already contains install-side truth that GLA-086 should build on. `probe-authentik.mjs` checks discovery, JWKS, token endpoint liveness, and whether the authorize request accepts GLA's client/redirect. `smoke-amr-strength.mjs` proves the deterministic mapping contract. The bundle docs say real method-choice proof is a live deployment responsibility, especially real passkey-to-`webauthn` and source visibility evidence.

The current `gla auth diagnostics` surface in `packages/app/src/auth-enrollment-policy.ts` and `packages/app/src/daemon.ts` already reports declared credential setup stages, external sources, MFA/recovery methods, optional recipient choices, edge-guard roles, provider/account-vs-GLA-binding semantics, assurance-fit concerns, and redacts secret-like evidence. It does not yet clearly report deployed login-method proof freshness/status for authentik's actual password/passkey/source choices and emitted evidence.

## Architecture Guardrails

- GLA gateway/core must not inspect authentik flow stages, `amr`, `acr`, `gla_uv`, source ids, authentik APIs, or authentik cookies. Those remain adapter, WPM, and diagnostics concerns.
- GLA consumes provider-neutral facts and diagnostics. Authentik-specific flow inspection belongs in WPM verify/probe artifacts or app-level operator diagnostics, not in gateway authorization.
- WPM owns detect/setup/verify/record and any host mutation. GLA owns read-only structured receipt ingest, runtime probes, operator/doctor orientation, and fail-closed handoff decisions.
- A password-only authentik screen is not necessarily a runtime error, but it means phishing-resistant handoff cannot be proven unless another configured path emits verified phishing-resistant evidence.
- A visible passkey option is not enough after GLA-091. The deployment proof must show the emitted token evidence includes explicit user-verification or equivalent configured proof.
- External/social/enterprise sources are login choices and subject sources. They are not automatically phishing-resistant. They satisfy higher assurance only when explicit provider evidence maps through the common assurance contract.
- Missing, stale, deferred, ambiguous, or redacted-only evidence must be reported as degraded/insufficient and must not be treated as "available".
- Client secrets, id_tokens, access tokens, invitation tokens, passwords, passkey material, grants, code verifiers, OIDC codes, and source tokens must not appear in logs, receipts, diagnostics, or test snapshots.
- Authentik proxy/forward-auth remains optional outer protection. It does not prove GLA OIDC method choices and cannot authorize handoff.

## Developer Tasks / Subtasks

- [x] Model the deployed authentik login-method verification state (AC: #1, #3, #5).
  - [x] Reuse or extend the existing provider-extensible diagnostics/receipt shapes rather than adding gateway state.
  - [x] Represent password path, passkey/WebAuthn path, external sources, MFA/recovery, flow/stage names, evidence emission, proof freshness, and live/deferred/unavailable status.
  - [x] Make stale or deferred live proof visible as a concern, not a silent pass.
- [x] Extend WPM verification guidance/probes as needed (AC: #1, #3, #4, #5).
  - [x] Keep host mutation in WPM tasks/scripts/templates only.
  - [x] Preserve `probe-authentik.mjs` for OIDC reachability/RP-app checks or extend it without requiring secrets in output.
  - [x] Add a safe way to record observed method choices and emitted claims from real login runs, including password, passkey/WebAuthn with UV, and configured source paths.
  - [x] Keep deterministic `smoke-amr-strength.mjs` as mapping proof, but do not let it replace live deployed-method proof when ACs require a deployed flow.
- [x] Extend `gla auth diagnostics` / startup diagnostics (AC: #2, #4, #5).
  - [x] Report whether the selected provider is authentik, whether the authentik OIDC wiring is present, and whether the verified method-choice evidence can satisfy `GLA_AUTH_ASSURANCE_POLICY`.
  - [x] Report password fallback as available only if the deployment evidence says the path is active.
  - [x] Report passkey/WebAuthn as phishing-resistant only when emitted evidence includes UV/equivalent proof and the GLA mapping sees binding/replay proof.
  - [x] Report external sources separately from password/passkey and include stable-subject proof status without exposing source tokens or mutable identifiers.
- [x] Preserve provider-neutral enforcement and fail-closed semantics (AC: #2, #4).
  - [x] Keep gateway decisions based on common assurance only.
  - [x] Keep `password-permitted` as the only policy that admits password-grade evidence.
  - [x] Ensure password-only, source-only, missing-UV, and ambiguous-provider deployments are insufficient for default phishing-resistant handoff.
- [x] Update operator docs/templates (AC: #6).
  - [x] Explain what a password-only authentik screen means.
  - [x] Explain which authentik Identification, WebAuthn/passkey setup/validation, Password, Source, scope-mapping, subject, redirect URI, and GLA policy settings affect visible choices and handoff eligibility.
  - [x] Document that passkey autofill/conditional UI depends on browser, HTTPS, discoverable credential, validation-stage config, and user enrollment.
- [x] Add tests and boundary checks (AC: #1-#6).
  - [x] Use fixture descriptors/receipts for deployment diagnostics and current `FakeAuthentik` tests for GLA-side mapping/gating.
  - [x] Keep or extend static checks that `packages/gateway` contains no provider-specific authentik/WebAuthn claim logic.

## AC-to-Test Map

- AC1: Add diagnostics/unit tests where the deployment descriptor reports both an active password path and an active WebAuthn/passkey path for an enrolled compatible authenticator. Include a negative fixture where passkey setup exists but the login flow/validation stage evidence is missing, and assert diagnostics warn that the deployed flow may present password only.
- AC2: Reuse existing `packages/app/src/authentik-dual-method.test.ts` policy-gating coverage for password under `password-permitted` vs default `phishing-resistant`. Add diagnostics tests showing a no-passkey recipient has an observable password fallback only when the deployment proof declares the password path, and that the handoff eligibility text points to the selected assurance policy.
- AC3: Add diagnostics tests for configured external/social/enterprise sources in the authentik policy descriptor or WPM binding. Assert sources appear as login choices, are not conflated with GLA enrollment by local account presence, and include stable-subject proof status for enroll-then-verify.
- AC4: Add tests for emitted provider evidence summary: passkey with `amr:["swk"]` plus `gla_uv:true` maps to phishing-resistant; password with `amr:["pwd"]` maps to password; source evidence maps to its declared/provider-neutral tier; missing `gla_uv`, empty `amr`, unresolved `acr`, or source evidence gaps produce degraded/insufficient diagnostics.
- AC5: Add daemon/CLI tests for `gla auth diagnostics` and startup logs that include authentik stages, password path, passkey configuration, configured sources, evidence emission status, and GLA assurance mapping. Assert all output is redacted and includes actionable remediation for password-only, missing passkey, missing source, missing UV, stale probe, or unavailable provider.
- AC6: Add documentation/template static tests or focused content tests proving operator docs explain password-only screens, flow/stage/source/authenticator/scope-mapping controls, and `GLA_AUTH_ASSURANCE_POLICY` effects.

Recommended focused commands:
- `pnpm exec vitest run packages/app/src/auth-provider-selection.test.ts packages/app/src/daemon.test.ts`
- `pnpm exec vitest run packages/app/src/authentik-dual-method.test.ts packages/app/src/authentik-enrollment.test.ts packages/app/src/authentik-scenario-e2e.test.ts`
- `pnpm exec vitest run adapters/auth-authentik/src/strength.test.ts adapters/auth-authentik/src/auth-authentik.test.ts`
- `node wpm/wip/bundles/identity-provider/installer-scripts/smoke-amr-strength.mjs`
- `pnpm run gate`

## Files Likely to Change

- `packages/app/src/auth-enrollment-policy.ts`
- `packages/app/src/daemon.ts`
- `packages/app/src/auth-provider-selection.test.ts`
- `packages/app/src/daemon.test.ts`
- `packages/app/src/authentik-dual-method.test.ts`
- `packages/app/src/authentik-enrollment.test.ts`
- `packages/app/src/authentik-scenario-e2e.test.ts`
- `adapters/auth-authentik/src/strength.ts`
- `adapters/auth-authentik/src/strength.test.ts`
- `adapters/auth-authentik/src/auth-authentik.test.ts`
- `wpm/wip/bundles/identity-provider/installer-scripts/probe-authentik.mjs`
- `wpm/wip/bundles/identity-provider/installer-scripts/smoke-amr-strength.mjs`
- `wpm/wip/bundles/identity-provider/payload/templates/oidc-app-and-flow.outcomes.md`
- `wpm/wip/bundles/identity-provider/payload/templates/amr-scope-mapping.md`
- `wpm/wip/bundles/identity-provider/payload/templates/amr-scope-mapping.py`
- `wpm/wip/bundles/identity-provider/payload/templates/dependency-binding.example.json`
- `wpm/wip/bundles/identity-provider/installer-skills/authentik-standup/SKILL.md`
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`
- `docs/architecture/authentik-service-standup.md`
- `docs/architecture/authentik-e2e-verification.md`
- `docs/architecture/authentik-dual-method-flow.md`
- `docs/components/identity-and-auth.md`

Files that should generally not need production changes:
- `packages/gateway/src/*`, except existing static/boundary tests if they need to assert no provider-specific logic.
- `packages/kernel/src/*`, unless the existing provider-neutral diagnostic shape cannot carry method-choice proof status.

## Implementation Notes

Do not implement a browser scraper in gateway. If live deployed authentik proof needs a browser/API path, keep it in WPM verify tooling or operator-run doctor/probe code and feed only sanitized structured evidence into `gla auth diagnostics`.

Treat "configured" and "observed" separately. A descriptor may say the flow is intended to include password/passkey/source choices; the doctor surface should show whether that was actually verified against the running instance, when it was verified, and whether any proof is deferred.

For AC1, "recipient with an enrolled compatible authenticator" matters. A passkey setup stage alone does not prove that a specific recipient will see a passkey choice. The proof should distinguish deployment capability from recipient-specific enrollment/binding state.

For AC3, configured sources can identify or create users in authentik, but GLA handoff still requires the GLA recipient binding established through enrollment. A source account existing at authentik is not a GLA enrollment by itself.

For AC4, align with GLA-091. The doctor must explain that passkey-like labels without user verification proof are password-grade/degraded, not strongest assurance. The emitted evidence to report is safe metadata such as `amr` labels, `gla_uv` boolean, source id/name, subject-stability proof status, and mapping outcome - not raw tokens.

The latest authentik docs currently identify the Identification stage as the place that can embed password entry, passkey autofill through a WebAuthn Authenticator Validation stage, passwordless links, and selected sources. The WebAuthn/FIDO2/Passkeys setup stage controls user verification, resident-key/discoverable credentials, and authenticator attachment. The Sources docs say sources must be added to the flow to appear on the login page. These docs are versioned as authentik 2026.5 at time of this story.

## Security Risks / Anti-Patterns

- Do not trust conversation memory, seeded defaults, or template examples as proof of deployed method choices.
- Do not mark a deployment verified from `smoke-amr-strength.mjs` alone; it proves mapping logic, not live authentik presentation.
- Do not treat authentik's empty `amr`, generic `acr`, or passkey-looking label without `gla_uv:true` as phishing-resistant.
- Do not make external/social/enterprise sources strongest assurance by default.
- Do not expose client secrets, bootstrap tokens, source tokens, id_tokens, authorization codes, code verifiers, grants, invitation tokens, passkey material, or passwords in receipts/diagnostics/logs.
- Do not let authentik proxy/forward-auth be reported as GLA OIDC method-choice proof.
- Do not make GLA runtime perform host mutation, install authentik, or repair authentik flow configuration.
- Do not add authentik-specific branches to gateway, admission, kernel, or capability code.

## Open Decisions

- What is the final structured shape for deployed login-method proof: extend `GLA_AUTH_ENROLLMENT_POLICY_JSON`, add a sibling diagnostics/receipt field, or read directly from the WPM `DependencyBinding.lastProbe.detail` with structured subfields?
- Does AC1 require a live browser/DOM proof of the authentik login page, or is API/flow configuration plus real login proof sufficient for the deployment doctor?
- What source evidence claim names should the default authentik recipe emit for external/social/enterprise sources, and how should those map to provider-neutral assurance beyond password-grade?
- How should diagnostics represent proof freshness and deferral: timestamped `available/degraded/unavailable`, per-method status, or both?
- Should the identity-provider WPM verify task require real passkey proof before recording `available`, or permit `degraded` with password proof plus deterministic passkey mapping when live passkey hardware/browser proof is deferred?

## References

- `docs/architecture/authentik-dual-method-flow.md`: redirect/read/gate model, provider-neutral gateway, `amr` plus `gla_uv` mapping, policy gating.
- `docs/architecture/authentik-e2e-verification.md`: deterministic GLA-side proof vs live deploy-time authentik proof split.
- `docs/architecture/authentik-service-standup.md`: WPM ownership, OIDC app/flow outcomes, same-origin callback, receipt/probe model.
- `docs/components/identity-and-auth.md`: auth provider emits facts, enforcement points make policy decisions, ambiguous evidence degrades.
- `_bmad-output/implementation-artifacts/gla-091-webauthn-assurance-story.md`: user-verification requirement and never-up-map guardrail.
- `adapters/auth-authentik/src/strength.ts`: authentik claim-to-assurance mapping seam.
- `packages/app/src/auth-enrollment-policy.ts`: current diagnostics model to extend.
- `wpm/wip/bundles/identity-provider/installer-scripts/probe-authentik.mjs`: current provider/RP-app probe.
- `wpm/wip/bundles/identity-provider/installer-scripts/smoke-amr-strength.mjs`: deterministic mapping smoke proof.
- Authentik Identification stage docs: https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/identification/
- Authentik WebAuthn/FIDO2/Passkeys setup docs: https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_webauthn/
- Authentik Sources docs: https://docs.goauthentik.io/users-sources/sources/

## Change Log

- 2026-06-13: Added WPM/docs/template support for redacted authentik `loginMethodProofs[]`, including parser-compatible daemon descriptor examples and WPM receipt-only proof detail.
- 2026-06-13: Added app diagnostics parsing/redaction/concerns for `loginMethodProofs[]`, daemon output assertions, QA summary, and full gate verification.
- 2026-06-13: Addressed reviewer blocker by requiring verified login-method proofs to include emitted evidence and GLA assurance mapping before diagnostics treat them as available.
- 2026-06-13: Addressed security review findings by rejecting proof-level assurance overclaims, requiring WebAuthn-strength mapping for passkey availability, and expanding canary redaction coverage for password/credential-shaped values in safe-looking fields.

## Dev Agent Record

Agent: Dirac, persistent worker/dev specialist

Source workflow evidence:
- Invoked `bmad-create-story` in spec-exists fallback mode.
- Invoked `bmad-dev-story` in spec-exists fallback mode for the WPM/docs/template implementation slice.

Completion notes:
- Create-story pass created the story artifact only; dev-story WPM/docs pass modified only the owned WPM/docs/template/story slice.
- Existing unrelated worktree modifications were observed in `.bmad/sdlc-state.yaml` and `backlog/tasks/gla-086 - Verify-deployed-authentik-login-method-choices.md`; they were not touched.
- Development pass started from baseline commit `9ec368a068dfa9bd4070564e4b353511a58b37c3`.
- Added redacted `loginMethodProofs[]` guidance for password, WebAuthn/passkey with UV, and external source stable-subject proof.
- Kept daemon env descriptor examples aligned with the app parser fields: `method`, `kind`, `label`, `stage`, `source`, `status`, `authStrength`, `assuranceLevel`, `observedAt`, `subjectStable`, `evidence`, and `diagnostics`.
- Explicitly scoped richer fields such as `loginChoiceVisible`, `observedClaims`, `assuranceOutcome`, and `eligiblePolicies` to WPM `DependencyBinding.lastProbe.detail`, not `GLA_AUTH_ENROLLMENT_POLICY_JSON`.
- Runtime app diagnostics/tests remain for the main-agent-owned app files; this pass did not touch `packages/app/*`.
- Checks run: `node -e 'JSON.parse(...)'` for `dependency-binding.example.json` passed; `node wpm/wip/bundles/identity-provider/installer-scripts/smoke-amr-strength.mjs` passed; receipt-only field grep confirmed those fields are absent from the daemon env example; `git diff --check` passed for touched files.
- App implementation added provider-extensible `AuthLoginMethodProof` parsing, redaction, summaries, and authentik-only deployed-method diagnostics without adding provider-specific branches to gateway/kernel.
- Diagnostics now warn on missing, degraded, unavailable, or deferred deployed method proof; require verified emitted evidence and GLA assurance mapping for available proofs; require verified UV/binding/replay evidence for passkey-grade proof; and require stable subject evidence for configured external sources.
- Proof-level assurance overclaims are now diagnostic concerns, and passkey availability requires both `authStrength:"webauthn"` and phishing-resistant UV/binding/replay evidence.
- Global operator-text canary redaction now catches password/credential/private-key shaped canaries, including diagnostics and safe-looking evidence fields.
- Focused validation passed: `pnpm exec vitest run packages/app/src/auth-provider-selection.test.ts packages/app/src/daemon.test.ts --reporter=dot`, `pnpm exec tsc -b packages/app --pretty false`, `node wpm/wip/bundles/identity-provider/installer-scripts/smoke-amr-strength.mjs`, and focused authentik adapter/scenario tests.
- Full validation passed after formatting and review-fix validation: `pnpm run gate` (typecheck, Biome, 63 test files, 700 passed, 15 skipped).
- Fresh close-out validation passed on 2026-06-13: `pnpm run gate` (typecheck, Biome CI, Vitest; 63 test files, 700 passed, 15 skipped).
- QA workflow updated `_bmad-output/implementation-artifacts/tests/test-summary.md` for GLA-086 coverage and residual deployment-proof scope.
- Persistent architect review (Mill) approved the provider-extensible proof layer and confirmed gateway/kernel/provider boundaries stayed intact.
- Persistent TEA/security review (Helmholtz) approved after proof-overclaim and safe-looking redaction gaps were fixed.
- Persistent separate-lane story review (Wegener) approved after false-green proof blockers were fixed.

File List:
- `_bmad-output/implementation-artifacts/gla-086-authentik-login-method-choices-story.md`
- `_bmad-output/implementation-artifacts/tests/test-summary.md`
- `docs/architecture/authentik-dual-method-flow.md`
- `docs/architecture/authentik-e2e-verification.md`
- `docs/architecture/authentik-service-standup.md`
- `docs/components/identity-and-auth.md`
- `packages/app/src/auth-enrollment-policy.ts`
- `packages/app/src/auth-provider-selection.test.ts`
- `packages/app/src/daemon.test.ts`
- `packages/kernel/src/redaction.ts`
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`
- `wpm/wip/bundles/identity-provider/payload/templates/dependency-binding.example.json`
- `wpm/wip/bundles/identity-provider/payload/templates/oidc-app-and-flow.outcomes.md`
