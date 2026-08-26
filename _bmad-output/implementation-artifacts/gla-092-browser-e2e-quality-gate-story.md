---
story: GLA-092
branch: feature/authentik-task-092
---

# Story GLA-092: Make Browser-Backed E2E Availability a Hard Quality Gate

Status: done

Backlog source of truth: `backlog task GLA-092 --plain`

BMAD workflow invoked for Rule 3 evidence:
- `bmad-create-story`: invoked in this worker lane to create this context-filled story artifact.
- Skill files read: `/home/agent/.codex/skills/bmad-create-story/SKILL.md`, `discover-inputs.md`, `template.md`, and `checklist.md`.

Spec-exists fallback note: `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent. This story was created from the Backlog.md task contract plus committed docs/code, not from upstream BMAD sprint-status or planning artifacts. Backlog.md remains authoritative for task status, ACs, and DoD.

Write-scope note: this create-story pass creates/updates only this artifact. Do not edit `backlog/` by hand.

## Story

As a maintainer relying on browser-backed acceptance evidence,
I want the full project quality gate to fail when required Chromium/noVNC browser E2E prerequisites are absent or accidentally skipped,
so green CI/local gate results cannot falsely satisfy tasks that require browser-level handoff, OIDC redirect, WebSocket, or recipient-visible proof.

## Acceptance Criteria

1. The project quality gate fails when required browser-backed E2E prerequisites are absent in CI or in a full local gate run, rather than silently skipping the scenarios.
2. A developer running the documented quality gate receives actionable diagnostics for missing browser binaries, launch dependencies, environment flags, ports, or test fixtures.
3. Any intentionally skipped browser-backed E2E mode is opt-in, visible in test output, and cannot satisfy backlog Definition of Done for tasks whose acceptance criteria require browser-level evidence.
4. CI installs or verifies the browser/runtime prerequisites needed by the browser-backed E2E suite before reporting the quality gate green.
5. The package scripts, CONTRIBUTING quality gate, and backlog Definition of Done refer to the same browser-backed E2E behavior and do not diverge.
6. A canary failure in a browser-backed E2E file fails the quality gate in CI and in the documented local full gate command.

## Definition of Done

1. Typecheck passes with no errors.
2. Linter passes clean.
3. Tests are added for the change and the full suite is green.
4. Public functions and exported types are documented.
5. No dead code or unused exports are introduced.
6. The core import-boundary holds: core depends only on ports, never on concrete adapters.
7. Quality-gate documentation describes default, full, and explicitly opted-out browser E2E modes.
8. CI evidence or local reproduction notes show the browser-backed E2E suite is actually executed by the full gate.

## Context Read

- `backlog task GLA-092 --plain`
- `CONTRIBUTING.md`
- `docs/architecture/test-strategy.md`
- `docs/architecture/baseline.md`
- `package.json`
- `vitest.config.ts`
- `.github/workflows/ci.yml`
- `packages/app/package.json`
- `packages/gateway/package.json`
- `packages/app/src/scenario-01-e2e.test.ts`
- `packages/app/src/authentik-scenario-e2e.test.ts`
- `packages/app/src/novnc-handoff-client-e2e.test.ts`
- `packages/app/src/provision.test.ts`
- `packages/app/src/daemon.test.ts`
- `packages/app/src/handoff-e2e.test.ts`
- `packages/app/src/completion-e2e.test.ts`
- `packages/app/src/two-handoff-e2e.test.ts`
- `packages/app/src/gateway-grant-canary-e2e.test.ts`
- `adapters/launcher-process/src/index.ts`
- `.github/workflows/ci.yml`
- `_bmad-output/implementation-artifacts/gla-077-real-novnc-handoff-client-story.md`
- `_bmad-output/implementation-artifacts/tests/gla-077-test-summary.md`
- `_bmad-output/implementation-artifacts/gla-088-runtime-connector-and-human-entrypoint-provider-contracts-story.md`
- `_bmad-output/implementation-artifacts/gla-089-harden-public-gateway-grant-transport-logs-html-story.md`

## Current Skip / Failure Model

The root `pnpm gate` script is currently `pnpm run typecheck && biome ci . && vitest run`. `vitest.config.ts` includes `packages/**/*.test.ts`, so the app E2E files are inside the normal Vitest run.

Browser-backed tests commonly gate their real assertions with `it.runIf(HAVE_CHROMIUM)` and add a companion `it.skipIf(HAVE_CHROMIUM)(...SKIPPED...)` sentinel. `HAVE_CHROMIUM` is usually computed from `playwright-core`'s `chromium.executablePath()`, sometimes plus `existsSync(path)`.

Full noVNC proof is gated more strongly: `packages/app/src/novnc-handoff-client-e2e.test.ts` uses `HAVE_FULL_NOVNC = chromiumAvailable() && fullStackAvailable()`, and `fullStackAvailable()` in `adapters/launcher-process/src/index.ts` checks `Xvfb`, `x11vnc`, and `websockify` on `PATH`.

This creates the GLA-092 failure mode: a clean local/CI run without cached Chromium or full noVNC host dependencies can report a green `vitest run` with visible skipped tests. That is acceptable for an explicitly opted-out quick/unit mode, but it must not satisfy the full quality gate or task DoD when browser evidence is required.

CI currently checks out, installs pnpm/Node dependencies, runs `pnpm install --frozen-lockfile`, and then runs `pnpm gate`. There is no explicit browser install or prerequisite verification step before the green gate. The repo uses `playwright-core`, which does not by itself guarantee a browser binary is installed in a fresh runner.

There is doc/code drift to address. `docs/architecture/test-strategy.md` says the E2E suite is wired into `vitest run` via a separate `vitest.e2e.config.ts` included in the gate, but the repo currently has only `vitest.config.ts`. The implementation may either create the missing split explicitly or update docs/scripts to describe the actual unified Vitest setup.

The GLA-077 evidence shows the full noVNC path can pass when prerequisites exist: Chromium, Xvfb, x11vnc, and websockify were available; `packages/app/src/novnc-handoff-client-e2e.test.ts` passed; full gate passed with browser tests present. GLA-092 should harden that proof into the default/full gate contract instead of relying on ad hoc environment availability.

## Architecture Guardrails

- Preserve the single quality-gate doctrine. `CONTRIBUTING.md`, package scripts, CI, and backlog DoD must point to one coherent gate story, not separate undocumented local and CI bars.
- Do not weaken or delete browser-backed acceptance tests to make the gate green. The task is to make missing prerequisites fail or require explicit opt-out, not to reduce evidence.
- Do not rewrite scenario E2E logic unless needed to replace silent skips with hard-gate-aware preconditions and diagnostics.
- Keep browser/runtime prerequisite logic outside core domain packages. This is test/tooling/CI/app-E2E infrastructure, not kernel/session/capability/gateway authorization logic.
- Preserve provider-neutral architecture. Browser/noVNC/CDP names may appear in app E2E tooling, launcher adapter tests, and docs, but must not leak into protected core package contracts.
- Preserve WPM ownership of host mutation. Runtime tests can verify or report missing Xvfb/x11vnc/websockify/browser dependencies; they should not silently install host packages during `vitest run`.
- CI may install browser dependencies as CI setup, but GLA runtime must not install them at application startup.
- Opt-out modes must be explicit, auditable, and named. A quick local mode can skip browser E2E only with an environment flag or script name that cannot be confused with the full gate.
- Diagnostics must name the missing class of prerequisite: Chromium browser binary, system launch libraries, full human-view binaries, port bind/connectivity constraints, or required fixture/harness state.
- Canary tests must prove inclusion. A deliberate failure in a browser-backed E2E file must make the full gate red; a test file being skipped entirely is not enough.

## Developer Tasks / Subtasks

- [ ] Define the browser E2E gate modes (AC: #1, #3, #5; DoD: #7).
  - [ ] Identify the default documented command that is allowed to satisfy task DoD.
  - [ ] Define any quick/unit/contract mode separately and require an explicit opt-out name or environment variable.
  - [ ] Ensure opt-out output states that browser-backed evidence was not executed and cannot close browser-dependent ACs.
- [ ] Add hard prerequisite verification for the full gate (AC: #1, #2, #4).
  - [ ] Verify Chromium browser binary availability before full browser E2E runs.
  - [ ] Verify browser launch dependencies enough to avoid a false green caused by launch failure/skip.
  - [ ] Verify full noVNC stack requirements (`Xvfb`, `x11vnc`, `websockify`) for tests that require full human-view evidence, or classify full noVNC as an explicit separately named mode that cannot satisfy noVNC ACs when skipped.
  - [ ] Emit actionable remediation, e.g. browser install command, required host packages/WPM bundle, missing binary names, and relevant env flags.
- [ ] Replace silent skip behavior with gate-aware behavior (AC: #1, #3).
  - [ ] Replace `it.runIf(HAVE_CHROMIUM)` / skip sentinels in browser-required full-gate tests with a shared preflight or fail-fast helper.
  - [ ] Keep visible skip sentinels only for explicit opt-out mode.
  - [ ] Avoid duplicating prerequisite logic across every E2E file if a central helper or setup file can own it.
- [ ] Harden CI setup (AC: #4).
  - [ ] Install or verify Chromium/runtime prerequisites before `pnpm gate`.
  - [ ] If full noVNC stack is in full-gate scope, install/verify `Xvfb`, `x11vnc`, and `websockify` or split a named full-human-view gate with CI coverage.
  - [ ] Ensure CI logs show the browser-backed E2E suite was actually eligible and executed.
- [ ] Align package scripts and docs (AC: #5; DoD: #7).
  - [ ] Update root package scripts so gate modes are explicit and easy to invoke.
  - [ ] Update `CONTRIBUTING.md` quality-gate section to describe default/full/opt-out browser E2E behavior.
  - [ ] Update `docs/architecture/test-strategy.md` to match the real Vitest/project setup.
  - [ ] Confirm backlog task DoD wording and PR template guidance remain aligned with the documented gate. Do not hand-edit backlog; use CLI only if backlog text must change.
- [ ] Add canary/inclusion tests (AC: #6; DoD: #8).
  - [ ] Add a deterministic test or script that proves at least one browser-backed E2E file is included in the full gate.
  - [ ] Add a canary failure mechanism that can be exercised locally/CI to prove a failing browser E2E assertion fails the full gate.
  - [ ] Do not leave a permanently failing canary enabled; make the canary controlled by a test env flag or selftest script.
- [ ] Run verification (DoD: #1-#8).
  - [ ] Run focused tests for the preflight/helper/scripts/docs.
  - [ ] Run `pnpm run gate` in full mode and capture evidence that browser-backed E2E tests executed.
  - [ ] If an opt-out quick mode exists, run it separately and verify it reports opt-out clearly.

## AC-to-Test Map

- AC1: Add a focused test for the preflight helper where Chromium is missing and assert the full gate path exits non-zero with no skipped-success fallback. Add an integration/selftest script that simulates missing browser prerequisites without requiring the developer to uninstall Chromium.
- AC2: Unit-test diagnostic generation for missing Chromium executable, missing browser system libraries/launch failure, unavailable `Xvfb`, unavailable `x11vnc`, unavailable `websockify`, port bind failure, and missing fixture state. Assertions should include remediation text and avoid opaque stack traces.
- AC3: Add tests for explicit opt-out mode. The opt-out must be visible in output and set a machine-readable signal or distinct script name showing browser evidence was skipped. A DoD/full-gate script must reject opt-out mode for browser-required tasks.
- AC4: CI workflow evidence: `.github/workflows/ci.yml` installs or verifies browser prerequisites before `pnpm gate`. Add a script-level check that CI runs the same full gate path as local docs.
- AC5: Static/content tests or focused assertions verify `package.json`, `CONTRIBUTING.md`, `docs/architecture/test-strategy.md`, and backlog DoD references describe the same commands and mode semantics.
- AC6: Add a controlled canary such as `GLA_BROWSER_E2E_CANARY_FAIL=1 pnpm <browser-gate-selftest>` that intentionally fails inside a browser-backed E2E file and proves the full gate reports failure. Also prove the normal full gate passes without the canary flag.

Recommended focused commands after implementation:
- `pnpm exec vitest run <new preflight/helper tests>`
- `pnpm exec vitest run packages/app/src/scenario-01-e2e.test.ts packages/app/src/authentik-scenario-e2e.test.ts`
- `pnpm exec vitest run packages/app/src/novnc-handoff-client-e2e.test.ts`
- `pnpm run gate`
- controlled canary command, e.g. `GLA_BROWSER_E2E_CANARY_FAIL=1 pnpm run gate:browser-canary` or the implemented equivalent

## Files Likely to Change

- `package.json` for explicit full/quick/browser gate scripts.
- `vitest.config.ts` or a new `vitest.e2e.config.ts` if the implementation splits projects/modes.
- `.github/workflows/ci.yml` for browser/runtime prerequisite install or verification before `pnpm gate`.
- `CONTRIBUTING.md` for the single quality-gate contract and opt-out semantics.
- `docs/architecture/test-strategy.md` for the actual browser E2E wiring and full/quick mode behavior.
- `packages/app/src/scenario-01-e2e.test.ts`
- `packages/app/src/authentik-scenario-e2e.test.ts`
- `packages/app/src/novnc-handoff-client-e2e.test.ts`
- Other Chromium-gated files that currently use `it.runIf(HAVE_CHROMIUM)` or `it.skipIf(HAVE_CHROMIUM)`, including `packages/app/src/provision.test.ts`, `packages/app/src/enrollment-e2e.test.ts`, `packages/app/src/handoff-e2e.test.ts`, `packages/app/src/completion-e2e.test.ts`, `packages/app/src/two-handoff-e2e.test.ts`, `packages/app/src/teardown-e2e.test.ts`, `packages/app/src/gateway-grant-canary-e2e.test.ts`, and relevant daemon tests.
- A shared test helper, likely under `packages/app/src/` or `tools/`, for browser/full-stack preflight and diagnostics.
- A selftest script under `tools/` if canary inclusion is easier to prove outside normal Vitest assertions.
- Package manifests or lockfile if switching from `playwright-core` to a dependency/tooling setup that can install browsers in CI. Use package-manager commands rather than manual manifest editing.

## Current Files to Read Before Editing

- Read the target E2E file fully before changing its skip behavior. These files contain cleanup/finally logic and long timeouts; careless edits can create orphan browsers/processes.
- Read `.github/workflows/ci.yml` fully before adding prerequisite installation; preserve the "same gate locally and CI" principle.
- Read `CONTRIBUTING.md` and `docs/architecture/test-strategy.md` together before changing docs; they must not diverge.
- Read `adapters/launcher-process/src/index.ts` before touching full noVNC preflight; it already owns `fullStackAvailable()` and Chromium resolution behavior.

## Implementation Notes

Prefer a central preflight contract over duplicating `chromiumAvailable()` everywhere. The current duplication makes it easy for one file to remain silently skippable after the gate is hardened.

A robust implementation can separate two questions:
- **Can this environment run browser E2E?** If no, full gate must fail with remediation.
- **Did the operator intentionally request a quick/no-browser mode?** If yes, output must say browser E2E was skipped and cannot satisfy browser-dependent DoD.

Do not confuse a skipped sentinel with execution evidence. Vitest output showing a skipped test proves the test file was discovered, not that browser behavior was verified.

For CI, `playwright-core` alone usually does not install browsers. Either install the browser/runtime explicitly in CI or introduce a checked-in/scripted browser-runtime prerequisite verification that fails before tests skip.

For full noVNC tests, decide whether the normal `pnpm gate` requires the full human-view stack or whether `pnpm gate` requires Chromium-backed E2E while a separate named `pnpm gate:browser-full` / `pnpm gate:human-view` covers Xvfb/x11vnc/websockify. If the latter, docs and DoD notes must state that tasks like GLA-077 cannot close with only the non-full mode.

Use environment variables cautiously. Names should be explicit, e.g. `GLA_E2E_BROWSER_MODE=required|skip`, not vague booleans. The default for `pnpm gate` should be required.

If adding a canary flag, ensure it cannot accidentally run during normal CI. The canary should be opt-in and should fail only when explicitly requested.

## Architecture Risks / Anti-Patterns

- Do not let browser E2E prerequisites silently downgrade from "required" to "skipped" in CI.
- Do not create a second undocumented quality gate. If a new script is added, document how it relates to `pnpm gate` and DoD.
- Do not make skipped browser E2E output look like success for browser-dependent tasks.
- Do not modify business logic or gateway authorization to satisfy this task. This is test/CI/docs hardening.
- Do not install host dependencies at application runtime.
- Do not leave canary failure permanently enabled.
- Do not overfit to current local environment. CI and clean checkout behavior are the target for AC1 and AC4.
- Do not hide missing prerequisites behind broad `try/catch` or generic `dependency.unavailable` messages without actionable detail.
- Do not weaken cleanup in long-running E2E tests; orphaned Chromium/Xvfb/websockify processes will create flaky gates.

## Open Implementation Risks

- CI runner dependency choice: Ubuntu runners can install Chromium through Playwright or system packages, but the current repo depends on `playwright-core`. The implementation must decide whether to add a Playwright browser-install tool/dependency or verify a separately supplied browser runtime.
- Full noVNC scope: making Xvfb/x11vnc/websockify mandatory in every `pnpm gate` may slow or complicate all local gates. If split, the split must be explicit and must not satisfy noVNC-specific DoD by accident.
- Existing E2E tests have long timeouts and real process cleanup. Replacing `runIf` with hard preflight must avoid running partial setup after a known prerequisite failure.
- Documentation drift already exists around `vitest.e2e.config.ts`; implementation must reconcile docs to actual scripts rather than layering more stale text on top.

## Dev Agent Record

Worker: Dirac, persistent worker/dev specialist

Created by: `bmad-create-story` workflow in spec-exists fallback mode

Source of truth: Backlog task GLA-092 and committed docs/code

Completion notes:
- Implemented required browser/full-human-view preflight in `tools/browser-e2e-preflight.mjs`.
- Added controlled browser-file assertion canary through `tools/browser-e2e-canary.mjs` and `packages/gateway/src/handoff-client-browser.test.ts`.
- Hardened browser-availability helpers so default/full gate mode cannot silently downgrade to skipped browser evidence.
- Aligned root package scripts, CI, `CONTRIBUTING.md`, and `docs/architecture/test-strategy.md` around the same gate semantics.
- Closed GLA-092 through Backlog.md CLI only; no direct backlog file editing.

Review evidence:
- Architect Mill approved the change as tooling/test/CI/doc hardening with no core/runtime layering violation.
- TEA Helmholtz requested fixes for ambient optional mode and stale docs; both were fixed, then TEA passed.
- Reviewer Wegener requested AC#6 proof inside a browser-backed E2E file; `gate:browser-canary` was added and the review passed.

Verification:
- `pnpm exec vitest run tools/browser-e2e-preflight.test.ts --reporter=dot`
- `pnpm run gate:browser-canary`
- `pnpm run gate:without-browser-e2e`
- `pnpm run gate`
- Existing unrelated worktree modifications were observed and left untouched.
- Implementation added `tools/browser-e2e-preflight.mjs` to make the default `pnpm gate` fail before Vitest when Playwright Chromium, full human-view binaries, or required browser-E2E fixtures are absent.
- Implementation added `tools/browser-e2e-preflight.test.ts` to prove the missing-browser canary fails the default path, optional mode is visible/non-DoD, and package scripts/CI/docs stay aligned.
- Root package scripts now include `test:e2e:preflight`, `test:e2e:preflight:optional`, default `gate` with mandatory preflight, and `gate:without-browser-e2e` with explicit `GLA_BROWSER_E2E_MODE=optional`.
- Default `pnpm gate` forces `GLA_BROWSER_E2E_MODE=required` for both preflight and Vitest, so an ambient optional env cannot downgrade DoD evidence.
- Chromium-gated app/gateway/adapter tests now require the executable to exist and honor `GLA_BROWSER_E2E_MODE=optional`; skip sentinels remain visible only for explicit optional mode.
- `packages/gateway/src/handoff-client-browser.test.ts` now includes a controlled `GLA_BROWSER_E2E_CANARY_FAIL=1` assertion canary; `pnpm run gate:browser-canary` runs the real full gate and succeeds only when that browser-backed assertion makes the gate fail.
- CI installs `xvfb`, `x11vnc`, `websockify`, and Playwright Chromium with Linux dependencies before running `pnpm gate`.
- CONTRIBUTING and `docs/architecture/test-strategy.md` now describe default/full/opt-out browser-E2E gate behavior consistently.
- Attempted to update global Backlog.md `definitionOfDone` through `backlog config set definitionOfDone`; the CLI rejects direct edits to that key. Per AGENTS.md, `backlog/config.yml` was not hand-edited. Alignment is recorded through package scripts, docs, CI, GLA-092 task DoD, and the fact that global DoD points to the single `pnpm gate`.
- Validation passed: `pnpm exec vitest run tools/browser-e2e-preflight.test.ts --reporter=dot`; `pnpm run test:e2e:preflight`; `GLA_BROWSER_E2E_MODE=optional pnpm run test:e2e:preflight:optional`; `pnpm run gate:browser-canary`; `pnpm run gate:without-browser-e2e` (64 test files, 696 passed, 24 skipped); and full `pnpm run gate` / `GLA_BROWSER_E2E_MODE=optional pnpm run gate` (forces required mode; 64 test files, 705 passed, 15 skipped).
- Review fix: addressed Helmholtz's blocker by making skip mode available only through `--allow-skip` preflight and by forcing required mode in the named DoD gate; also removed stale test-strategy wording that placed E2E outside the single gate.
- Review fix: addressed Wegener's AC #6 blocker by adding a controlled failing assertion inside `packages/gateway/src/handoff-client-browser.test.ts` plus `pnpm run gate:browser-canary`, which passes only when the real full gate fails on that browser-backed assertion.
- Final reviews: Mill architecture review APPROVE; Helmholtz TEA/security PASS; Wegener separate-lane story review APPROVE.

File List:
- `_bmad-output/implementation-artifacts/gla-092-browser-e2e-quality-gate-story.md`
- `_bmad-output/implementation-artifacts/tests/test-summary.md`
- `.bmad/sdlc-state.yaml`
- `.github/workflows/ci.yml`
- `backlog/tasks/gla-092 - Make-browser-backed-E2E-availability-a-hard-quality-gate.md`
- `CONTRIBUTING.md`
- `docs/architecture/test-strategy.md`
- `package.json`
- `tools/browser-e2e-canary.mjs`
- `tools/browser-e2e-preflight.mjs`
- `tools/browser-e2e-preflight.test.ts`
- `adapters/detector-url/src/detector-url.test.ts`
- `adapters/launcher-process/src/launcher-process.test.ts`
- `packages/app/src/authentik-scenario-e2e.test.ts`
- `packages/app/src/completion-e2e.test.ts`
- `packages/app/src/daemon.test.ts`
- `packages/app/src/enrollment-e2e.test.ts`
- `packages/app/src/gateway-grant-canary-e2e.test.ts`
- `packages/app/src/handoff-e2e.test.ts`
- `packages/app/src/novnc-handoff-client-e2e.test.ts`
- `packages/app/src/provision.test.ts`
- `packages/app/src/scenario-01-e2e.test.ts`
- `packages/app/src/teardown-e2e.test.ts`
- `packages/app/src/two-handoff-e2e.test.ts`
- `packages/gateway/src/handoff-client-browser.test.ts`
