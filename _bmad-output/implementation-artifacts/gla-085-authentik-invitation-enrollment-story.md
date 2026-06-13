# Story GLA-085: Provide invitation-based authentik recipient enrollment

Status: done

BMAD workflow note: `bmad-create-story` was invoked/read for this context pass. `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent in this repo, so the workflow could not use sprint-status discovery and ran as the repo's docs-driven/spec-exists fallback with `backlog task GLA-085 --plain` as the source story contract. Planning epic artifacts are not authoritative here; Backlog.md plus committed design docs are the contract.

## Story

As an operator,
I want to issue a GLA enrollment invite that sends an unregistered recipient through an authentik-owned invitation/enrollment flow,
so that the recipient establishes or links their own authentik identity while GLA records only the stable subject binding needed for handoff.

## Acceptance Criteria

1. Operator-issued GLA enrollment invite lets unregistered recipient complete authentik enrollment flow and leaves recipient bound in GLA to stable authentik subject.
2. Recipient establishes/uses own authentik credential without generated password shown in GLA output, WPM output, receipts, logs, or docs examples.
3. Missing, expired, reused, forged, or wrong-recipient enrollment invites cannot create GLA subject binding or make recipient verifiable for handoff.
4. Failed or abandoned authentik enrollment leaves no half-bound GLA recipient and no reusable GLA enrollment grant.
5. Re-enrollment/recovery replaces prior bound subject only after fresh invite-backed authentik round trip verifies successfully.
6. Operator-facing diagnostics distinguish an authentik account that exists from a GLA recipient enrolled/bound for handoff.
7. Active authentik enrollment method policy is observable to operator, including selected enrollment flow, credential setup stages, external sources, required methods, optional recipient choices.
8. When password and WebAuthn/passkey setup configured, invited recipient can establish own password and register own WebAuthn/passkey credential without operator-generated password.
9. When multiple authenticator setup choices configured for one requirement, invited recipient can choose among configured choices and cannot select unsupported methods outside policy.
10. When OAuth/SAML sources configured for GLA authentik application, recipient can enroll by linking through source and GLA records only resulting stable subject binding.
11. Configured MFA/recovery/source/authenticator methods are reported as provider evidence and mapped through GLA assurance policy; no method silently satisfies stronger requirement just because authentik login succeeded.
12. If configured authentik enrollment/login methods cannot satisfy selected GLA assurance policy, operator sees actionable diagnostic before relying on invite for handoff.

## AC Mapping / Current Coverage

- AC #1 is partially satisfied by existing delegated enrollment plumbing: `AuthAuthentikProvider.finishEnrollment()` binds `{sub}` only after verified OIDC callback, `IdentityService.enrollComplete()` records the enrollment fact, and the gateway already supports redirect enrollment through `/enroll/options`, `/auth/callback`, and `/enroll/verify`. The remaining work is proving this path is authentik invitation-backed, not merely generic OIDC enrollment.
- AC #2 is partially satisfied by existing architecture and redaction hardening from GLA-084: GLA does not store authentik passwords and current provider state stores only subject/attempt facts. The remaining work is removing or preventing any operator/WPM/docs examples that imply generated recipient passwords and adding explicit tests/doc checks for no generated-password output.
- AC #3 is mostly covered for GLA enrollment grants by current gateway grant tests and authentik adapter state/nonce/kind/TTL tests. Add invitation-specific coverage for authentik invitation failures and wrong-recipient invite completion.
- AC #4 has a contract ambiguity: current gateway behavior intentionally rolls back enrollment-grant consume on failed attestation so a still-valid grant is retryable. The task now says failed or abandoned authentik enrollment leaves "no reusable GLA enrollment grant." Implementation needs main-agent/product decision before changing this, because it conflicts with existing GLA-013-era retry semantics and tests.
- AC #5 is partly supported because `IdentityService.enrollComplete()` replaces an existing `EnrollmentRecord` after provider success and the authentik adapter updates the bound subject after successful token validation. Add recovery tests proving old subject remains on failed re-enrollment and is replaced only after a fresh invite-backed round trip succeeds.
- AC #6 is not yet clearly implemented. Existing diagnostics distinguish auth-provider capability and enrolled vs un-enrolled behavior, but not "authentik account exists" versus "GLA recipient bound for handoff" as an operator-facing diagnostic.
- AC #7 is not yet implemented as an observable GLA operator surface. Authentik flow/stage/source policy currently lives in authentik/WPM configuration and is not surfaced through a structured provider-neutral diagnostic.
- AC #8 is partially covered by GLA-072/078 tests for password and WebAuthn assurance mapping, but not by invitation enrollment proof that recipient establishes both own password and own WebAuthn/passkey credential without operator-generated password.
- AC #9 is not yet covered. Current code maps resulting evidence, but does not model or report configured authenticator setup choices or prove unsupported choices are unavailable.
- AC #10 is not yet covered. Current adapter accepts any validated authentik OIDC subject; add tests and docs for source-linked enrollment where GLA stores only resulting `sub`, not external-source credentials or source-specific secrets.
- AC #11 is largely supported by GLA-078 assurance evidence mapping in `packages/kernel/src/auth-assurance.ts` and `adapters/auth-authentik/src/strength.ts`. Add invitation-enrollment tests for provider evidence through enrollment and handoff with MFA/recovery/source methods that must not up-map silently.
- AC #12 is partially supported by `authAssuranceProviderDiagnostic()` and policy validation. Remaining work is a pre-handoff/pre-invite operator diagnostic that compares configured authentik enrollment/login method policy with selected `GLA_AUTH_ASSURANCE_POLICY`.

## Tasks / Subtasks

- [x] Decide AC #4 grant failure semantics before implementation. Either update gateway behavior/tests to burn the GLA enrollment grant on any authentik ceremony failure, or preserve retryability and record a task-contract clarification.
- [x] Model authentik invitation-backed enrollment at the provider/app seam without moving provider-specific logic into gateway/kernel. The browser/gateway should continue to treat enrollment as provider-neutral redirect options plus callback attestation.
- [x] Ensure `enrollInvite` starts an authentik invitation-backed enrollment path for authentik deployments. The operator action must mint a recipient-bound GLA enrollment grant and direct the recipient to the GLA-controlled enrollment URL/callback path, while authentik owns credential setup.
- [x] Preserve the GLA-only subject boundary. GLA durable records may store recipient binding, identity enrollment record, authentik `sub`, auth strength, assurance evidence, and timestamps; they must not store authentik passwords, WebAuthn private material, OAuth/SAML tokens, TOTP seeds, recovery codes, generated passwords, or source credentials.
- [x] Add operator diagnostics for enrollment state. Diagnostics should distinguish "authentik can identify/account exists" from "GLA has a recipient enrollment binding that is eligible for handoff."
- [x] Add operator diagnostics for active authentik enrollment method policy. Surface selected enrollment flow, invitation requirement, user-write/user-login behavior, password setup, WebAuthn/passkey setup, authenticator validation choices, external OAuth/SAML sources, required methods, optional choices, and the provider evidence expected for GLA assurance mapping.
- [x] Keep authentik credential choice within authentik policy. GLA may report configured choices and interpret final evidence, but must not become the installer, policy author, or credential collector.
- [x] Extend assurance compatibility checks so unsupported or too-weak configured enrollment/login methods produce actionable operator diagnostics before invite reliance.
- [x] Update recipient-facing enrollment copy to be delegated-provider neutral. The current enrollment page still says "Register passkey"; authentik invitation/password/source enrollment needs wording that does not imply only WebAuthn while retaining WebAuthn behavior for the in-tree provider.
- [x] Update deployment/operator docs and WPM/authentik guidance so examples never show generated recipient passwords and describe invitation, password, passkey, source-linking, and assurance-policy behavior accurately.
- [x] Add unit, integration, and browser/E2E-style tests mapped to all ACs before ticking backlog acceptance criteria.

## Current Behavior Notes

- `adapters/auth-authentik/src/index.ts` already implements delegated OIDC enrollment: `beginEnrollment()` creates a `register` pending attempt and redirect authorize URL; `finishEnrollment()` validates state, nonce, token, issuer, audience, expiry, signature, and attempt kind, then stores `BoundSubject { sub }` only after success.
- `adapters/auth-authentik/src/stores.ts` persists only `BoundSubject { sub }` and transient `PendingAttempt` values. It does not persist authentik credential material.
- `adapters/auth-authentik/src/strength.ts` maps authentik `amr`/`acr` into provider-neutral strength and assurance evidence. Passkey/WebAuthn tokens map to phishing-resistant evidence, password maps to password, and unknown-but-valid claims floor rather than up-map.
- `packages/identity/src/index.ts` records `EnrollmentRecord { userId, credentialId, authStrength, authAssurance, enrolledAt }` only after the provider finishes enrollment. For authentik, `credentialId` is the stable provider subject, not a password or passkey secret.
- `packages/gateway/src/index.ts` re-verifies the enrollment grant on `/enroll/options`, atomically consumes it on `/enroll/verify`, calls the identity enrollment seam, and returns the recorded `auth_strength`. It currently calls `grants.unspend(...)` after enrollment failure, making a still-valid grant retryable.
- `packages/gateway/src/enroll-page.ts` already handles both WebAuthn `publicKey` options and delegated `redirect` options, persisting the GLA enrollment grant in same-origin `sessionStorage` across the provider redirect. Its visible copy is still passkey-centered.
- `packages/gateway/src/callback-page.ts` is provider-neutral and sends `{ code, state }` back to `/enroll/verify` or `/handoff/auth/verify` based on same-origin stored flow context.
- `packages/app/src/index.ts` is the composition seam that chooses `AuthAuthentikProvider`, wires shared identity/enrollment stores, and exposes operator `enrollInvite`. Keep authentik-specific construction here or in the authentik adapter/WPM receipt layer, not in gateway/kernel.
- `packages/app/src/daemon.ts` parses authentik config, assurance policy, and startup diagnostics. Existing `authAssuranceProviderDiagnostic()` is a starting point but does not yet report active authentik enrollment flow/stage/source policy.
- Existing tests already cover delegated subject binding, no-half-bound adapter behavior, state replay, wrong attempt kind, token validation failures, public-base callback routing, and assurance mapping. They do not yet prove authentik invitation policy, recipient choice among configured setup stages, external source-linking enrollment, or operator-visible method policy.

## Architecture Guardrails

- Authentik owns delegated credentials. Recipient password setup, passkey/WebAuthn registration, external OAuth/SAML source authentication, MFA setup, and recovery factors happen inside authentik-controlled flows/stages/sources.
- GLA records only the stable subject binding and provider-neutral facts required for handoff: recipient binding, `EnrollmentRecord`, authentik `sub`, auth strength, assurance evidence, and diagnostic metadata safe for operators.
- Gateway and kernel remain provider-neutral. Do not add authentik, issuer, `amr`, `acr`, OIDC, invitation-stage, or source-stage authorization branches to gateway/kernel grant or route logic.
- GLA invite semantics remain operator-initiated and recipient-bound. The agent cannot initiate enrollment, receive credential material, or use an enrollment invite.
- Operator-discharge/GLA enrollment grants still gate the GLA enrollment page and callback. Authentik invitations do not replace GLA's recipient-bound grant semantics; they are provider-side enrollment controls.
- Preserve agent-blind boundaries. Grant-bearing URLs are delivered only through recipient delivery/browser surfaces, not agent/operator diagnostic surfaces.
- GLA-078 assurance policy remains provider-extensible. Authentik evidence is mapped into the common `AuthAssuranceEvidence` contract, and the selected GLA assurance profile makes the admit/deny decision.
- MFA/recovery methods such as TOTP, email, SMS, static codes, and Duo are provider evidence unless policy explicitly maps them. They must not silently satisfy a stronger GLA requirement because authentik login succeeded.
- External OAuth/SAML source enrollment records only the resulting authentik stable subject in GLA. GLA must not store external-source tokens, profiles beyond safe diagnostic facts, or source credentials.
- WPM/deployment owns authentik setup/adoption and host mutation. GLA runtime may read structured config/receipts and report diagnostics, but must not create authentik flows, stages, sources, or users at runtime unless a future task explicitly changes that boundary.
- Persistence must remain explicit records, not raw provider/session dumps. Subject bindings and enrollment records should remain durable and repairable; pending attempts must retain TTL/replay protections.

## Files Likely Needing Changes

- `adapters/auth-authentik/src/index.ts` - expose safe provider/enrollment policy metadata if the chosen design makes the adapter report configured policy; preserve OIDC validation and subject binding semantics.
- `adapters/auth-authentik/src/stores.ts` - only if recovery/re-enrollment needs additional explicit subject-binding metadata; do not add credential material.
- `adapters/auth-authentik/src/strength.ts` - assurance/evidence mapping additions for source/MFA method reporting if current `amr`/`acr` projection is insufficient.
- `packages/kernel/src/ports.ts` and `packages/kernel/src/auth-assurance.ts` - provider-neutral interfaces/types for enrollment policy diagnostics if needed.
- `packages/identity/src/index.ts` - pass through safe enrollment policy diagnostics or recovery/re-enrollment checks if the provider interface changes.
- `packages/gateway/src/index.ts` - only for AC #4 grant-consumption semantics or response shape changes; keep provider-specific details out.
- `packages/gateway/src/enroll-page.ts` and `packages/gateway/src/callback-page.ts` - delegated-provider-neutral enrollment copy and browser callback coverage.
- `packages/app/src/index.ts` - compose authentik enrollment policy/reporting with `createProvisioningBridge()` / `createEnrollmentStack()` and `enrollInvite`.
- `packages/app/src/daemon.ts` - operator diagnostics for auth provider, assurance compatibility, and active authentik enrollment method policy.
- `packages/app/src/*authentik*.test.ts` - invitation/recovery/source/assurance integration tests using FakeAuthentik seams.
- `packages/gateway/src/gateway.test.ts` and `packages/gateway/src/callback-page.test.ts` - grant failure semantics and browser/callback regression tests.
- `adapters/auth-authentik/src/auth-authentik.test.ts` and `strength.test.ts` - provider-level invitation/recovery/evidence mapping tests.
- `surfaces/cli/src/cli.ts` and tests - operator-facing diagnostics if CLI exposes enrollment state/policy.
- `docs/architecture/authentik-enrollment.md`, `docs/architecture/authentik-service-standup.md`, `docs/architecture/authentik-dual-method-flow.md`, and/or deployment/WPM docs - align operator guidance and remove generated-password implications.
- `wpm/wip/bundles/identity-provider/**` and `wpm/wip/bundles/gla-core/**` - if installer/env/receipt examples need to express invitation flow policy, source choices, and no generated recipient passwords.

## Test Plan

- AC #1: Add an app-level delegated enrollment test where operator `enrollInvite` delivers a GLA enrollment URL, the browser follows an authentik invitation-backed redirect, authentik returns a valid `id_token`, and GLA records only the stable `sub` for the recipient.
- AC #2: Add canary tests scanning GLA output, WPM output/receipts, logs, docs examples, and diagnostics for generated password patterns or known credential canaries; recipient credential setup must occur only inside the authentik flow.
- AC #3: Extend gateway/app negative tests for missing, expired, reused, forged, wrong-recipient GLA enrollment grants and invalid authentik invitation outcomes. Assert no `EnrollmentRecord`, no `BoundSubject`, and handoff remains unverifiable.
- AC #4: After resolving the grant ambiguity, update gateway tests to prove the selected semantics. If task wording wins, failed/abandoned authentik enrollment must leave no half-bound recipient and the same GLA enrollment grant must be unusable. If retryability stays, update task/notes before implementation.
- AC #5: Add recovery/re-enrollment tests where an existing subject remains bound after failed replacement, then a fresh invite-backed authentik round trip succeeds and replaces both the authentik subject binding and identity enrollment record.
- AC #6: Add daemon/CLI diagnostics tests showing three states: authentik account exists but no GLA binding, GLA recipient bound/enrolled and eligible for handoff, and GLA recipient not enrolled.
- AC #7: Add diagnostics tests for active authentik enrollment policy: flow slug/name, invitation required, password setup, WebAuthn setup, authenticator validation requirements, optional choices, external OAuth/SAML sources, and resulting expected evidence.
- AC #8: Add FakeAuthentik/browser-style tests proving one invited recipient can set their own password and register their own WebAuthn/passkey credential when both are configured, with no operator-generated password in any GLA/WPM surface.
- AC #9: Add policy-choice tests where authentik advertises multiple configured setup choices for one requirement. Assert configured choices are shown/allowed and unsupported methods are absent/refused.
- AC #10: Add source-link enrollment tests for OAuth/SAML-source-backed flow where GLA records only authentik `sub` and assurance evidence, not source token/profile secrets.
- AC #11: Extend assurance tests so MFA/recovery/source/authenticator methods are preserved as provider evidence and cannot satisfy `phishing-resistant` unless mapped to phishing-resistant evidence.
- AC #12: Add pre-invite/pre-handoff diagnostics tests where selected GLA assurance policy is incompatible with configured authentik methods and operator sees an actionable failure before relying on an invite.
- Browser/E2E relevance: ensure callback tests cover same-origin `/auth/callback`, public-base-prefixed paths, enrollment `sessionStorage` grant restoration, redirected `{code,state}` postback, and no grant leakage to authentik URLs.

## Risks / Anti-Patterns

- Do not let a provider-side authentik invitation replace GLA's recipient-bound grant checks. Both layers are needed: authentik controls credential enrollment; GLA controls recipient-bound handoff eligibility.
- Do not add generated recipient passwords as a fallback. The task explicitly rejects operator-created/generated passwords handed to recipients.
- Do not store or log authentik passwords, passkey private material, OAuth/SAML tokens, TOTP seeds, static recovery codes, or source credentials in GLA state, WPM receipts, operator logs, or docs examples.
- Do not conflate "authentik account exists" with "GLA recipient is enrolled/bound." Handoff eligibility depends on the GLA binding.
- Do not up-map weak or ambiguous authentik evidence. Unknown, missing, recovery, or second-factor-only evidence must not silently satisfy a stronger GLA assurance policy.
- Do not move authentik flow/stage/source policy authoring into GLA runtime. WPM/operators configure authentik; GLA observes safe structured policy and uses the resulting evidence.
- Do not break the in-tree WebAuthn provider while generalizing enrollment page copy and redirect behavior.
- Do not leak GLA grants to authentik. Authentik should receive OIDC state/nonce/PKCE and its own invitation token where configured, not GLA operator-discharge grants.
- Do not leave old subject binding active after a failed recovery/re-enrollment attempt, and do not replace it before successful fresh invite-backed verification.

## Blockers / Ambiguity

- AC #4 conflicts with current implemented and tested gateway behavior. Current `/enroll/verify` consumes the GLA enrollment grant before provider verification, then rolls the consume back on failed attestation so a still-valid grant can retry. GLA-085 says failed or abandoned authentik enrollment leaves "no reusable GLA enrollment grant." This needs a main-agent/product decision before changing behavior.
- "Active authentik enrollment method policy is observable" needs a design decision for the source of truth. Options include structured WPM receipt/config metadata, adapter-provided safe metadata, daemon config, or an authentik admin/API probe. The story should not implement an unauthenticated or brittle scrape.
- External OAuth/SAML source enrollment proof depends on how the FakeAuthentik test double represents source-linked evidence and `amr`/`acr`. Add test-double support only to prove GLA seams, not to emulate all authentik internals.

## References Read

- `/home/agent/.codex/skills/bmad-create-story/SKILL.md`
- `/home/agent/.codex/skills/bmad-create-story/discover-inputs.md`
- `/home/agent/.codex/skills/bmad-create-story/template.md`
- `/home/agent/.codex/skills/bmad-create-story/checklist.md`
- `backlog task GLA-085 --plain`
- `docs/architecture/authentik-enrollment.md`
- `docs/architecture/authentik-service-standup.md`
- `docs/architecture/authentik-dual-method-flow.md`
- `_bmad-output/implementation-artifacts/investigations/authentik-invitation-auth-options-investigation.md`
- `_bmad-output/implementation-artifacts/gla-078-provider-extensible-auth-assurance-policy.md`
- `adapters/auth-authentik/src/index.ts`
- `adapters/auth-authentik/src/stores.ts`
- `adapters/auth-authentik/src/strength.ts`
- `packages/identity/src/index.ts`
- `packages/kernel/src/ports.ts`
- `packages/kernel/src/auth-assurance.ts`
- `packages/gateway/src/index.ts`
- `packages/gateway/src/enroll-page.ts`
- `packages/gateway/src/callback-page.ts`
- `packages/app/src/index.ts`
- `packages/app/src/daemon.ts`
- `packages/gateway/src/gateway.test.ts`
- `packages/identity/src/enrollment.test.ts`
- `adapters/auth-authentik/src/auth-authentik.test.ts`
- `packages/app/src/authentik-dual-method.test.ts`
- `packages/app/src/authentik-scenario-e2e.test.ts`
- authentik Invitations documentation: https://docs.goauthentik.io/users-sources/user/invitations/
- authentik Invitation stage documentation: https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/invitation/
- authentik User Write stage documentation: https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/user_write/
- authentik Authenticator Validation stage documentation: https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_validate/
- authentik WebAuthn / FIDO2 / Passkeys setup stage documentation: https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_webauthn/
- authentik Identification stage documentation: https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/identification/
- authentik Source stage documentation: https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/source/

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Completion Notes List

- Ran `bmad-create-story` and `bmad-dev-story` as the story workflow context; sprint-status is absent, so Backlog.md plus committed design docs remained the source contract.
- Implemented provider-extensible enrollment policy diagnostics, including active flow/stage/source/method/choice reporting, recipient-scoped binding diagnostics, unsupported choice checks, evidence redaction, and assurance overclaim downgrade/concerns.
- Preserved the GLA/authentik boundary: authentik owns credentials and sources; GLA stores and reports only recipient binding, stable provider subject facts, assurance evidence, and safe diagnostics.
- Resolved AC #4 by keeping WebAuthn malformed/local ceremony retry semantics while making delegated redirect enrollment consume the GLA grant before leaving GLA's origin; callback completion is one-shot against a pending consumed nonce, and failure/abandonment requires a fresh invite.
- Hardened public enrollment HTML for delegated redirects with provider-neutral copy, grant URL scrubbing, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and `nosniff`.
- Updated architecture docs, WPM templates, and installer guidance to describe recipient-owned invitation enrollment, declared method policy, supported password/passkey/source choices, MFA/recovery evidence, no generated recipient passwords, and no grant leak.
- Independent reviewer `Wegener` approved after blocker fixes; TEA/security `Helmholtz` reported no blockers and residual process-local pending nonce/orphan-attempt tradeoffs were documented or covered by tests.
- Final quality gate: `pnpm run gate` passed with 59 test files, 641 passed, 12 skipped; only known warning is broken symlink `wpm/CLAUDE.md`.

### File List

- `.bmad/sdlc-state.yaml`
- `_bmad-output/implementation-artifacts/gla-085-authentik-invitation-enrollment-story.md`
- `backlog/tasks/gla-085 - Provide-invitation-based-authentik-recipient-enrollment.md`
- `docs/architecture/authentik-enrollment.md`
- `docs/architecture/authentik-service-standup.md`
- `packages/app/src/auth-enrollment-policy.ts`
- `packages/app/src/auth-provider-selection.test.ts`
- `packages/app/src/authentik-dual-method.test.ts`
- `packages/app/src/authentik-enrollment.test.ts`
- `packages/app/src/daemon.test.ts`
- `packages/app/src/daemon.ts`
- `packages/capability/src/enrollment-grant.test.ts`
- `packages/capability/src/index.ts`
- `packages/gateway/src/enroll-page.ts`
- `packages/gateway/src/gateway.test.ts`
- `packages/gateway/src/index.ts`
- `surfaces/cli/src/cli.ts`
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`
- `wpm/wip/bundles/identity-provider/installer-skills/authentik-standup/SKILL.md`
- `wpm/wip/bundles/identity-provider/payload/templates/dependency-binding.example.json`
- `wpm/wip/bundles/identity-provider/payload/templates/oidc-app-and-flow.outcomes.md`

### Change Log

- 2026-06-13: Implemented GLA-085 invitation enrollment diagnostics, delegated grant lifecycle hardening, docs/WPM guidance, tests, specialist review fixes, and final green gate.
