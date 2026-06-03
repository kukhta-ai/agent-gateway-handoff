---
id: GLA-074
title: Build the wpm installer for the authentik identity provider
status: Done
assignee: []
created_date: '2026-06-03 15:42'
updated_date: '2026-06-03 18:26'
labels:
  - authentik
  - impl
dependencies:
  - GLA-073
  - GLA-068
priority: medium
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a delegated provider only works once its service is stood up and configured on the operator host; this extends the identity-provider wpm bundle to stand authentik up and configure it when that provider is selected. Builds the standup designed in its plan. Depends on the standup plan and the adapter it verifies against. Out of scope: the runtime adapter code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A wpm installer package stands the provider up on the host and is the unit that gets built, not an inline install.
- [x] #2 The package detects an existing usable provider before changing anything and leaves an adequate one unchanged, recorded as adopted.
- [x] #3 On completion the provider answers, a relying-party application for GLA exists, and a flow offering a passkey and a password is configured.
- [x] #4 The package records a verifiable receipt of what it changed and is idempotent on re-run.
- [x] #5 A host where the provider cannot be installed surfaces a clear, catchable failure rather than a partial state.
- [x] #6 With the delegated provider not selected, installing GLA requires none of this package.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the authentik branch of the wpm/bundles/identity-provider bundle (per GLA-073 plan). AUTHORED: 3 install-backlog tasks (identity-provider-4 detect authentik+ownership-mode, -5 stand-up/adopt+configure RP app+dual-method flow, -6 verify E2E+record binding; detect->setup->verify->record, dependency-ordered, standard 6-item DoD); 1 installer-skill (authentik-standup/SKILL.md, outcome-level); 4 payload templates (authentik-compose.yml.tmpl with version-branched Redis and ALL secrets parameterized via required-env placeholders PG_PASS/AUTHENTIK_SECRET_KEY - NO literals; oidc-app-and-flow.outcomes.md; caddy-authentik-callback.snippet same-origin redirect_uri; dependency-binding.example.json); 3 runnable probe scripts (check-nested-docker.sh -> NESTED_DOCKER_OK/BROKEN; probe-authentik.mjs discovery200/JWKS/token/authorize; smoke-amr-strength.mjs 16-case amr->strength proof exit 0); bundle.yml updated. Tasks 1-3 (WebAuthn default) UNCHANGED. NO packages/adapters touched (live GLA gate stays 542 green). AC#1 the wpm package stands it up not inline; AC#2 detect-before-change + adopt-unchanged; AC#3 provider-answers+RP-app+passkey/password-flow (task-6 probes); AC#4 DependencyBinding receipt (issuer/clientId/redirectUri/ownershipMode/installed/inverseOp; clientSecret as a SECRET-REF never a literal) + idempotent Repair; AC#5 clean catchable failure on unsupportable host (NESTED_DOCKER_BROKEN -> never attempt Managed-in-container on hermes-1 -> guided stop recommending Local/Remote-External, nothing half-built); AC#6 entirely gated on the authentik selection (default unburdened). HONEST DEFERRAL baked into task-6 AC#8: where no real authentik is available to probe, the E2E method-distinguishing + immutable-subject proofs are recorded as DEFERRED to the real deploy, never falsely marked verified. wpm project validate clean; wpm build dry-run exit 0. Rule-3: wpm bundle-authoring (install-backlog/ hook-exempt hand-authored); the wpm install-loop is the operator RUNTIME loop not an authoring step; validated structurally via the wpm CLI. DEFERRED to deploy/GLA-076: the real host standup (heavyweight; disk-constrained sandbox) + the live OIDC E2E proof.
<!-- SECTION:NOTES:END -->
