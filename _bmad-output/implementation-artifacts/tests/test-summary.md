# Test Automation Summary

## GLA-086 - Verify Deployed Authentik Login Method Choices

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

## GLA-092 - Make Browser-Backed E2E Availability A Hard Quality Gate

Workflow: `bmad-qa-generate-e2e-tests` / TEA review, spec-exists fallback

Date: 2026-06-14

### Scope

This QA summary covers the gate-hardening changes that make browser-backed and full human-view E2E
availability mandatory for the default project quality gate while preserving an explicit, visible non-DoD
opt-out for local iteration.

The implementation adds a root preflight before Vitest, hardens Chromium availability helpers to distinguish
default gate mode from explicit optional mode, requires the noVNC human-view binaries in default mode, aligns
CI/docs/scripts, and adds canary/static tests for the new gate contract.

### Generated And Updated Tests

- [x] `tools/browser-e2e-preflight.test.ts` - proves missing browser-runtime and full human-view canaries fail the default path, proves optional mode is visible and non-DoD, and asserts package scripts, CI, CONTRIBUTING, and test-strategy docs stay aligned.
- [x] `packages/gateway/src/handoff-client-browser.test.ts` - contains the controlled `GLA_BROWSER_E2E_CANARY_FAIL=1` browser-file assertion canary used by `gate:browser-canary`.
- [x] `tools/browser-e2e-canary.mjs` - runs the real `pnpm gate` with the browser-file canary enabled and passes only when that full gate turns red for the deliberate browser E2E assertion.
- [x] Chromium-gated app/gateway/adapter tests now check `GLA_BROWSER_E2E_MODE=optional` and require the Chromium executable to exist before reporting browser availability.
- [x] `tools/browser-e2e-preflight.mjs` verifies required browser E2E fixture files exist, verifies `Xvfb`, `x11vnc`, and `websockify` are on `PATH`, resolves Playwright Chromium from `@gla/app`, checks execute permission, launches Chromium headless, and renders a preflight page before full Vitest runs.

### AC Coverage

| AC | Coverage Evidence | Status |
| --- | --- | --- |
| AC1 | `pnpm gate` now runs `test:e2e:preflight` before `vitest run`; missing browser runtime is a non-zero preflight failure instead of a skipped-success Vitest result. | Covered. |
| AC2 | Preflight diagnostics name missing Chromium resolution, executable absence, execute permission, launch/render failure, full human-view binary absence, and remediation commands including `playwright install`, `--with-deps`, and `xvfb x11vnc websockify`. Required fixture absence is also a hard failure. | Covered. |
| AC3 | `gate:without-browser-e2e` sets `GLA_BROWSER_E2E_MODE=optional`, optional preflight prints a visible non-DoD warning, and browser tests report skipped branches under that mode. | Covered. |
| AC4 | CI installs `xvfb`, `x11vnc`, `websockify`, and `playwright@1.60.0` Chromium with Linux launch dependencies before running `pnpm gate`. | Covered by workflow config. |
| AC5 | Package scripts, CONTRIBUTING, test strategy, and GLA-092 task-specific DoD describe the same default/full/opt-out behavior; the Backlog.md global `definitionOfDone` key is CLI-protected and remains indirectly aligned through `pnpm gate`. | Covered with implementation note. |
| AC6 | `pnpm run gate:browser-canary` sets `GLA_BROWSER_E2E_CANARY_FAIL=1`, runs the real `pnpm gate`, and passes only because a deliberate assertion inside `packages/gateway/src/handoff-client-browser.test.ts` fails the full gate; normal full gate output shows browser-backed E2Es execute when the canary is not set. | Covered. |

### Validation

Focused validation:

```bash
pnpm exec vitest run tools/browser-e2e-preflight.test.ts --reporter=dot
pnpm run test:e2e:preflight
GLA_BROWSER_E2E_MODE=optional pnpm run test:e2e:preflight:optional
pnpm run gate:browser-canary
pnpm run gate:without-browser-e2e
```

Result: passed. The browser assertion canary proved a failing assertion inside a browser-backed E2E file fails
the full `pnpm gate`. The explicit opt-out gate reported optional mode and passed with 64 test files, 696 passed,
24 skipped.

Full DoD validation:

```bash
GLA_BROWSER_E2E_MODE=optional pnpm run gate
pnpm run gate
```

Result: passed. The ambient-optional run proved `pnpm gate` forces `GLA_BROWSER_E2E_MODE=required` for
preflight and Vitest. Typecheck passed, Biome passed, browser E2E preflight verified the full human-view stack
and launched Chromium, and Vitest passed with 64 test files, 705 passed, 15 skipped. Browser-backed E2Es
executed, including GLA-066 scenario-01, GLA-076 authentik capstone, GLA-077 noVNC handoff client,
launcher-process full noVNC, detector-url real CDP, provisioning, handoff, completion, teardown, two-handoff,
gateway browser-client, and daemon live-capsule coverage.

### Coverage Notes

- The default full gate requires browser-backed E2E and full human-view runtime availability but does not install host dependencies at application runtime.
- CI owns browser and human-view runtime installation before the single `pnpm gate` entrypoint.
- The explicit opt-out command is intentionally non-DoD evidence for browser-dependent tasks.

## GLA-093 - Strengthen Authentik And Gateway E2E Proof Quality

Workflow: `bmad-qa-generate-e2e-tests` / TEA review, spec-exists fallback

Date: 2026-06-14

### Scope

This QA summary covers proof-quality hardening for authentik and gateway E2E evidence. The implementation
keeps the live-authentik proof in the deployment/WPM lane, but strengthens the in-repo GLA-side proof:
browser callback flow, valid wrong-recipient modeling, explicit upstream counters, adapter discovery/JWKS
contracts, stable package-boundary checks, and bounded event-driven waits.

### Generated And Updated Tests

- [x] `packages/app/src/authentik-scenario-e2e.test.ts` - adds a real Chromium path through the GLA-served handoff page and `/auth/callback`, explicit upstream connection/byte counters, valid wrong-recipient authentik login modeling, and opt-in proof canary markers.
- [x] `tools/e2e-proof-canaries.mjs` - proves wrong-recipient and upstream-leak canaries visibly fail the strengthened E2E suite.
- [x] `adapters/auth-authentik/src/auth-authentik.test.ts` - adds OIDC discovery, remote JWKS/key rotation, token `redirect_uri`, invalid state/code, and diagnostic evidence coverage.
- [x] `adapters/auth-authentik/src/fake-authentik.ts` - exposes a safe JWKS document/key-id seam for remote-JWKS tests.
- [x] `packages/app/src/scenario-01-e2e.test.ts` and `packages/app/src/completion-e2e.test.ts` - replace critical fixed sleeps with bounded state/event polling.
- [x] `packages/app/src/authentik-dual-method.test.ts` and `packages/app/src/authentik-scenario-e2e.test.ts` - replace brittle provider-token source scans with stable package/runtime boundary assertions.

### AC Coverage

| AC | Coverage Evidence | Status |
| --- | --- | --- |
| AC1 | The passkey authentik capstone path now opens the GLA handoff page in Chromium, intercepts the fake IdP authorize URL, redirects to the GLA-served `/auth/callback`, and waits for the callback page to authorize the grant before WS reachability is asserted. | Covered. |
| AC2 | The forwarded-link negative enrolls a second valid recipient subject, proves that subject can authenticate to the provider, then presents that valid wrong subject against the original grant and receives 403 with the grant unauthorized. | Covered. |
| AC3 | The authentik capstone's stub upstream records connections, bytes to client, bytes from client, and hello writes. Accepted flows assert counters increase; refused flows assert counters remain unchanged. | Covered. |
| AC4 | Adapter contract tests now exercise discovery, remote JWKS, key rotation, token request `redirect_uri`, invalid state, invalid unstaged code, and mapped assurance diagnostics. | Covered. |
| AC5 | Provider seam checks rely on package dependency/runtime composition boundaries instead of broad source-string scans. The core boundary selftest remains in the full gate. | Covered. |
| AC6 | Critical scenario/completion waits now use `expect.poll` with diagnostic messages for connector severance, human form/code submission, off-contract state, and teardown. | Covered. |

### Validation

Focused validation:

```bash
pnpm exec vitest run adapters/auth-authentik/src/auth-authentik.test.ts --reporter=dot
pnpm exec vitest run packages/app/src/authentik-scenario-e2e.test.ts packages/app/src/authentik-dual-method.test.ts --reporter=dot
pnpm exec vitest run packages/app/src/scenario-01-e2e.test.ts packages/app/src/completion-e2e.test.ts --reporter=dot
pnpm run gate:e2e-proof-canaries
```

Result: passed. Focused adapter tests: 44 passed. Focused authentik app tests: 21 passed. Focused
scenario/completion tests: 2 passed, 2 skipped. Canary command proved both wrong-recipient and upstream-leak
deliberate failures are visible.

Full DoD validation:

```bash
pnpm run gate
```

Result: passed. Typecheck passed, Biome passed, browser/full-human-view preflight passed, and Vitest passed
with 64 files, 707 passed, 15 skipped.

### Coverage Notes

- The in-repo test remains a deterministic `FakeAuthentik` proof for GLA-side behavior; deployed real-authentik method/source proof remains recorded through WPM/deployment diagnostics.
- The adapter now refreshes a non-injected remote JWKS resolver once after `bad_signature`, which is provider-neutral OIDC key-rotation behavior and does not change gateway/core authorization semantics.

## GLA-094 - Reconcile CLI Runtime Contract With Documented Commands

Workflow: `bmad-qa-generate-e2e-tests` / TEA review, spec-exists fallback

Date: 2026-06-14

### Scope

This QA summary covers contract hardening for the agent-facing `gla` CLI. The implementation separates the
current executable command surface from the future CLI roadmap, adds a machine-readable command registry,
implements `gla schema`, command-scoped machine help, top-level field masks, stable deferred diagnostics, and
connection-mode-aware version reporting.

### Generated And Updated Tests

- [x] `surfaces/cli/src/cli.test.ts` - adds GLA-094 contract tests for root help, command-scoped help, scoped schema, docs/help/schema drift, deferred surfaces, `--fields`, unknown, missing-value, and unexpected-value command-scoped flags with no-mutation behavior, documented field-mask snippet reuse, `--quiet`, endpoint override/unreachable daemon behavior, `session connector`, output/error channels, and version modes.
- [x] `surfaces/cli/src/transport.test.ts` - existing endpoint-locality and daemon-shared-state coverage remains part of the focused validation set.

### AC Coverage

| AC | Coverage Evidence | Status |
| --- | --- | --- |
| AC1 | Root machine help and docs drift tests assert the current supported command inventory; parser coverage includes representative supported commands plus direct `session connector`. | Covered. |
| AC2 | Deferred `policy mounts`, `events`, `audit list`, `auth login`, `auth logout`, `-o ndjson`, `--context`, `--trace-id`, and batch forms return `usage.unsupported` with `detail.status: "deferred"`. | Covered. |
| AC3 | `gla schema` and scoped command help expose noun, verb, args, flags, output category, exit codes, and read/mutate/block effect from the registry. | Covered. |
| AC4 | `--fields` trims top-level result fields, unknown fields fail before a mutating command runs, documented snippets parse masked JSON ids before reuse, and `--quiet` preserves JSON results/errors. | Covered. |
| AC5 | Docs and tests cover no-endpoint in-process mode, `GLA_ENDPOINT`, `--endpoint` override, non-local endpoint refusal, and unreachable daemon dependency errors. | Covered. |
| AC6 | Tests assert stdout remains result-only and stderr remains parseable errors in JSON/agent mode, including invalid/deferred/error paths and unsupported, missing-value, or unexpected-value command-scoped flags. Text mode remains documented separately. | Covered. |
| AC7 | Version tests distinguish client-only, in-process, and daemon modes without inventing a server version. | Covered. |
| AC8 | Contract tests fail on drift across docs/current contract, root help, scoped schema/help, global flags, field masks, endpoint errors, and deferred diagnostics. | Covered. |
| AC9 | Docs preserve the future/target CLI tree and explicitly label deferred/future surfaces rather than deleting roadmap content. | Covered. |

### Validation

Focused validation:

```bash
pnpm run lint:fix
pnpm exec vitest run surfaces/cli/src/cli.test.ts surfaces/cli/src/transport.test.ts --reporter=dot
pnpm run typecheck
```

Result: passed. Biome checked 197 files with no fixes after the final pass. Focused CLI/transport tests
passed with 80 tests. Typecheck passed.

Full DoD validation:

```bash
pnpm run gate
```

Result: passed. Typecheck passed, Biome passed, browser/full-human-view preflight passed, and Vitest passed
with 64 files, 726 passed, 15 skipped.

### Coverage Notes

- The task intentionally does not implement future `policy`, `events`, `audit`, `auth login/logout`, NDJSON,
  context profiles, trace correlation, MCP parity, or batch operations.
- `auth diagnostics` remains a current daemon/operator diagnostic extension and is explicitly separate from
  deferred authenticated-agent login/logout.
