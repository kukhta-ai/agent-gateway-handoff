---
title: 'Stabilize noVNC focus readiness in release CI'
type: 'bugfix'
created: '2026-08-26'
status: 'done'
baseline_commit: 'fc03eb3761f76cdbbfc952026335984df839f798'
context:
  - '{project-root}/CONTRIBUTING.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** PR #4's required browser gate consistently stops before the noVNC handoff because headed Chromium on the GitHub runner does not reliably honor the target page's HTML `autofocus`. The failing assertion establishes test setup, not product behavior, so it prevents the release candidate from reaching the real pointer and keyboard proof.

**Approach:** Establish the remote input's initial focused state deterministically inside the control browser, verify it, then blur and verify it is unfocused before opening the handoff. Preserve the later assertions that only the real noVNC canvas click refocuses the field and that keyboard input reaches the capsule browser.

## Boundaries & Constraints

**Always:**

- Keep the full Xvfb, x11vnc, websockify, Chromium, gateway, and noVNC path required in CI.
- Preserve the test's post-handoff pointer-focus, keyboard-delivery, connector-suspension, and secret-non-leak assertions.
- Limit the implementation to deterministic test setup unless new evidence shows a production defect.
- Treat GitHub's full `pnpm gate` result as the release-blocking verdict.

**Ask First:**

- Any production runtime, gateway, launcher, or noVNC client change.
- Any timeout increase, retry policy, test skip, optional-browser mode, or CI-requirement change.
- Any weakening or removal of the later remote-input assertions.

**Never:**

- Mark PR #4 ready while its required gate is red.
- Mock or bypass the real noVNC/RFB path.
- Treat `gate:without-browser-e2e` as release evidence.
- Include provider-host or provider-graph refactoring in this fix.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Runner ignores autofocus | Target page is loaded but the input is not active | Test setup explicitly establishes and observes focus, then blurs it before handoff | Fail at the setup assertion if the field cannot be focused |
| Real remote pointer path | Input is confirmed blurred before the recipient opens noVNC | Canvas click through noVNC makes the remote input active | Existing post-click focus assertion remains blocking |
| Real remote keyboard path | Remote input was focused by the noVNC click | Typed canary reaches the capsule input and remains absent from agent-readable outputs | Existing delivery and non-leak assertions remain blocking |

</frozen-after-approval>

## Code Map

- `packages/app/src/novnc-handoff-client-e2e.test.ts` -- required full-stack browser E2E; the baseline relied on HTML autofocus, while this fix establishes and verifies focus explicitly before blurring it for the handoff proof.
- `.github/workflows/ci.yml` -- installs the complete human-view/browser runtime and executes the release-blocking `pnpm gate`.
- `_bmad-output/implementation-artifacts/investigations/novnc-readiness-investigation.md` -- prior sidecar/gateway root-cause record; confirms those production fixes already landed.
- `_bmad-output/implementation-artifacts/tests/gla-077-test-summary.md` -- intended evidence contract for real pointer focus, keyboard delivery, and non-leak behavior.

## Tasks & Acceptance

**Execution:**

- [x] `packages/app/src/novnc-handoff-client-e2e.test.ts` -- make the pre-handoff focus/blur setup deterministic while leaving all recipient-driven noVNC assertions intact.
- [x] `.github/workflows/ci.yml` -- verify that the focused fix leaves its required gate unchanged; fresh PR #4 evidence remains the release acceptance check below.

**Acceptance Criteria:**

- Given headed Chromium does not honor HTML autofocus, when the required noVNC E2E initializes the capsule target page, then the test reaches the handoff phase without timing out on its setup state.
- Given the remote input is demonstrably blurred before handoff, when the recipient clicks it through the real noVNC canvas, then the input becomes active and the existing assertion proves that transition.
- Given the noVNC click focused the field, when the recipient types the canary, then the capsule receives it and the existing agent-blind/non-leak checks remain green.
- Given PR #4 runs on GitHub's installed browser and human-view stack, when `pnpm gate` completes, then the required CI check is green with no browser-path waiver.

## Spec Change Log

- 2026-08-26 CI follow-up: the required gate showed HTML autofocus reactivating the field during handoff setup, so the fixture attribute was removed and explicit setup became the only pre-handoff focus source; the just-in-time blurred-state guard remains blocking.

## Design Notes

Explicitly focusing the field is limited to arranging the test's precondition. The test immediately blurs it and confirms the blurred state; therefore the later noVNC pointer click still supplies the behavior under test and cannot pass because of the setup focus.

## Verification

**Commands:**

- `GLA_BROWSER_E2E_MODE=required pnpm exec vitest run packages/app/src/novnc-handoff-client-e2e.test.ts --reporter=verbose` -- expected: the real noVNC proof passes when the required runtime is installed.
- `pnpm run gate` -- expected: typecheck, Biome, browser preflight, all tests, and boundary checks pass.
- `gh pr checks 4` -- expected: every required check reports success before the draft is marked ready.

## Suggested Review Order

**Deterministic setup**

- Removing fixture autofocus prevents window activation from preempting the pointer proof.
  [`novnc-handoff-client-e2e.test.ts:285`](../../packages/app/src/novnc-handoff-client-e2e.test.ts#L285)

- Explicit focus replaces unreliable HTML autofocus while retaining an observable setup check.
  [`novnc-handoff-client-e2e.test.ts:291`](../../packages/app/src/novnc-handoff-client-e2e.test.ts#L291)

**Pointer proof**

- A just-in-time blur check prevents handoff setup from satisfying the pointer assertion.
  [`novnc-handoff-client-e2e.test.ts:326`](../../packages/app/src/novnc-handoff-client-e2e.test.ts#L326)

- Post-click focus and typing remain the real noVNC behavioral proof.
  [`novnc-handoff-client-e2e.test.ts:334`](../../packages/app/src/novnc-handoff-client-e2e.test.ts#L334)

**Release contract**

- The approved release constraint keeps GitHub's required gate authoritative.
  [`spec-stabilize-novnc-focus-readiness.md:13`](spec-stabilize-novnc-focus-readiness.md#L13)
