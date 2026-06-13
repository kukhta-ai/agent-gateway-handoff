# Test Automation Summary: GLA-086

Task: GLA-086 - Verify deployed authentik login method choices

Workflow: `bmad-qa-generate-e2e-tests`

Date: 2026-06-13

## Scope

This QA summary covers the existing GLA-086 test implementation for deployed authentik login-method proof diagnostics. The implementation/tests already existed before this QA pass; this pass did not generate or edit source tests because the user constrained write scope to this summary artifact.

The tests validate GLA-side diagnostics and structured deployment/receipt evidence. They do not drive a live real-authentik browser passkey login. Live authentik UI/passkey/source observation remains a WPM/deployment verification responsibility recorded into safe `loginMethodProofs[]` or dependency-binding receipt evidence.

## Generated And Updated Tests

### Diagnostics And Descriptor Tests

- [x] `packages/app/src/auth-provider-selection.test.ts` - validates authentik enrollment policy descriptors, deployed `loginMethodProofs[]`, password/passkey/source diagnostics, missing/deferred proof warnings, evidence mapping, redaction, and adapter-boundary constraints.
- [x] `packages/app/src/daemon.test.ts` - validates daemon/CLI `gla auth diagnostics` output over the local daemon socket, including login-method proof readback, passkey evidence, external source subject stability, edge-guard context, recipient-scoped diagnostics, and redaction.

### Deterministic Mapping Smoke

- [x] `wpm/wip/bundles/identity-provider/installer-scripts/smoke-amr-strength.mjs` - validates deterministic authentik `amr`/`acr` + `gla_uv` mapping: verified passkey evidence maps to `webauthn`, password/MFA maps to `password`, and ambiguous evidence never up-maps.

## AC Coverage

| AC | Coverage Evidence | Status |
| --- | --- | --- |
| AC1 | `auth-provider-selection.test.ts` includes verified password and WebAuthn/passkey `loginMethodProofs[]`, accepts passkey proof matched by stage when UV/binding/replay evidence is present, and flags missing/deferred passkey proof as password-only risk. | Covered by diagnostics/receipt evidence, not live UI. |
| AC2 | `auth-provider-selection.test.ts` flags password-only authentik policy before relying on phishing-resistant handoff and reports deferred passkey proof as a password-only risk. Existing authentik policy-gating tests continue to prove password evidence is eligible only when the selected GLA policy permits it. | Covered. |
| AC3 | `auth-provider-selection.test.ts` reports configured external source choices and flags source proof that lacks stable subject evidence; `daemon.test.ts` verifies `oauth:github` proof is surfaced with `subjectStable: true`. | Covered. |
| AC4 | `auth-provider-selection.test.ts` validates distinct passkey/password/source evidence outcomes, missing UV/binding/replay diagnostics, phishing-resistant overstatement, ambiguous/deferred proof, and redaction; `smoke-amr-strength.mjs` validates the never-up-map mapping contract. | Covered. |
| AC5 | `daemon.test.ts` validates daemon/CLI diagnostics report authentik provider config, credential setup stages, external sources, login-method proofs, passkey evidence, GLA assurance mapping, edge guards, and recipient binding state without leaking secrets. | Covered. |
| AC6 | Documentation/WPM/template updates explain password-only screens and the flow/stage/source/evidence/policy controls; tests exercise the corresponding diagnostics surfaces and full gate validates docs/templates formatting. | Covered by docs plus diagnostics tests. |

## Validation

Focused validation run by QA:

```bash
pnpm exec vitest run packages/app/src/auth-provider-selection.test.ts packages/app/src/daemon.test.ts --reporter=dot && node wpm/wip/bundles/identity-provider/installer-scripts/smoke-amr-strength.mjs
```

Result: passed after the review-fix regressions. Vitest: 3 focused test files, 68 passed, 1 skipped. Smoke: all mapping cases passed and `SMOKE_RESULT` reported verified passkey=`webauthn`, password=`password`, never up-map.

Full gate evidence recorded from the implementation run:

```bash
pnpm run gate
```

Result: passed after formatting and review-fix validation. Typecheck passed, Biome passed, and Vitest passed with 63 test files, 700 passed, 15 skipped.

## Coverage Notes

- API endpoint count: N/A. GLA-086 is validated through app diagnostics, daemon/CLI diagnostics, descriptor parsing, and WPM mapping smoke.
- UI E2E count: no new live browser E2E was generated in this QA pass. The local suite intentionally validates deployment proof receipts and diagnostics instead of performing a live real-authentik passkey browser run.
- Residual deployment obligation: WPM/deployment verification must produce truthful `loginMethodProofs[]` for the actual authentik application, including password, passkey/WebAuthn for an enrolled compatible authenticator, configured sources, proof freshness/status, and redacted provider evidence.

## Next Steps

- No source test changes are required from this QA pass.
- If a future environment provides a running authentik instance with browser/passkey automation, add a WPM-owned live proof that records `loginMethodProofs[]`; keep GLA runtime consuming only the sanitized receipt/diagnostic evidence.
