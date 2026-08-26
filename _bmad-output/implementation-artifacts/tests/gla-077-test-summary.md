# GLA-077 Test Automation Summary

BMAD skill: bmad-qa-generate-e2e-tests

Mode: validation summary only. User constraints forbade production/test source edits, so this pass did not generate or modify tests. It inspected the current uncommitted implementation/tests and ran the repository gate.

## Current Tests Observed

- [x] `packages/gateway/src/handoff-client-browser.test.ts` - fake RFB-compatible browser test proving same-origin provider asset loading, visible rendered test viewport, RFB URL construction, and input through the fake client.
- [x] `packages/gateway/src/handoff-client-browser.test.ts` - browser-negative coverage for missing provider client asset import and RFB `securityfailure`, asserting unavailable/refusal states and no false connected status.
- [x] `packages/gateway/src/handoff.test.ts` - gateway handoff tests covering no raw socket shortcut in HTML, provider client binding propagation, safe generic client asset serving including symlink-escape rejection, grant enforcement, WebSocket proxying, revocation, and refusal behavior.
- [x] `packages/gateway/src/callback-page.test.ts` and `packages/gateway/src/public-base.test.ts` - callback/reused-auth/public-base coverage for client asset paths, JSON data-island escaping via `jsonScriptData`, and removal of the old raw WebSocket shortcut.
- [x] `adapters/entrypoint-novnc/src/entrypoint-novnc.test.ts` - noVNC HumanEntrypoint binding, bundled asset mount discovery, and unavailable headless/missing endpoint behavior.
- [x] `packages/kernel/src/provider-runtime-boundary.test.ts` - protected boundary scan for noVNC/RFB/client-asset tokens.
- [x] `packages/app/src/novnc-handoff-client-e2e.test.ts` - real full-mode E2E proving a verified recipient opens a noVNC/RFB viewport through the gateway to an Xvfb/x11vnc/websockify capsule, pointer click focuses the remote input, keyboard typing reaches the capsule browser, the brokered connector is suspended while the noVNC window is open when a brokered CDP URL is available, and the typed canary is absent from the concrete gateway/agent-readable outputs and read models exposed by this composition.
- [x] Existing app E2Es - reused auth, negative grants, revocation, secret non-leak, and agent-blind behavior through existing surrogate human paths.
- [x] `adapters/launcher-process/src/index.ts` implementation evidence - full-mode X display allocation is pid-seeded so parallel Vitest workers are less likely to collide on the same display number.

## AC Mapping

- AC1: Covered. `packages/app/src/novnc-handoff-client-e2e.test.ts` passed locally and proves a live full-mode noVNC/RFB viewport through the gateway to the real Xvfb/x11vnc/websockify stack.
- AC2: Covered. The same real noVNC E2E proves pointer click through the canvas focuses the remote input and keyboard typing through noVNC reaches the capsule browser.
- AC3: Covered for the real noVNC path by the strengthened E2E. It wires `completion: { pollMs: 100 }`, asserts brokered connector suspension when a brokered CDP URL is available, then scans recipient page HTML, captured gateway text/json/script responses, `session create` stdout/stderr, `session connector`, `session get`, `session list`, `handoff get`, `handoff list`, delivered channel links, direct session/handoff service read models, bridge session/handoff read models, and session/handoff completion fields. Audit/event text is covered to the extent this stack exposes no separate audit sink; the test scans the concrete outputs/read models available in this composition plus existing audit redaction tests elsewhere.
- AC4: Covered by existing reused-auth E2Es and current client-path changes for reused handoff pages.
- AC5: Covered by gateway negative tests and existing E2Es showing refused/forwarded/wrong-recipient/revoked grants do not reach the capsule entrypoint.
- AC6: Covered by deterministic adapter unavailable tests, gateway negative/no-traffic tests, and browser-negative no-false-connected tests for missing client assets and RFB refusal. This is not a separate full real-host-stack outage test.
- DoD #7: Covered by current docs, provider-owned asset mount, gateway generic asset hosting, and protected boundary scan.
- DoD #8: Covered by provider-neutral binding use and existing GLA-088 fake-provider/boundary precedent; current noVNC code remains outside protected core packages.

## Commands Run

- `pnpm vitest run packages/gateway/src/handoff-client-browser.test.ts packages/gateway/src/handoff.test.ts packages/gateway/src/callback-page.test.ts packages/gateway/src/public-base.test.ts adapters/entrypoint-novnc/src/entrypoint-novnc.test.ts packages/kernel/src/provider-runtime-boundary.test.ts`
- Result: 6 test files passed, 59 tests passed, 1 skipped.
- `pnpm run gate`
- Result: typecheck passed, Biome CI passed with one existing broken-symlink warning for `wpm/CLAUDE.md`, Vitest passed with 61 files, 659 tests passed, 13 skipped.
- Host stack verification: `Xvfb`, `x11vnc`, and `websockify` were found on PATH; `dpkg -C` returned clean.
- Exact paths observed: `/usr/bin/Xvfb`, `/usr/bin/x11vnc`, `/home/agent/.local/bin/websockify`.
- `pnpm vitest run packages/app/src/novnc-handoff-client-e2e.test.ts`
- Result: 1 test file passed, 1 real noVNC proof passed, 1 unavailable-skip sentinel skipped.
- `pnpm run gate`
- Result: typecheck passed, Biome CI passed with one existing broken-symlink warning for `wpm/CLAUDE.md`, Vitest passed with 62 files, 660 tests passed, 14 skipped.
- Current evidence-pass rerun: `pnpm vitest run packages/app/src/novnc-handoff-client-e2e.test.ts`
- Result: 1 test file passed, 1 real noVNC proof passed, 1 unavailable-skip sentinel skipped.
- Main-agent cleanup: Biome formatting drift was fixed by running `pnpm exec biome format --write` on touched gateway files.
- Current evidence-pass rerun: `pnpm exec vitest run packages/gateway/src/handoff-client-browser.test.ts packages/gateway/src/handoff.test.ts packages/gateway/src/callback-page.test.ts packages/gateway/src/public-base.test.ts`
- Result: 4 test files passed, 56 tests passed, 1 skipped.
- Current evidence-pass rerun: `pnpm run gate`
- Result: typecheck passed, Biome CI passed with one known broken-symlink warning for `wpm/CLAUDE.md`, Vitest passed with 62 files, 663 tests passed, 14 skipped.
- Post-TEA AC3 fix targeted evidence: `pnpm exec vitest run packages/app/src/novnc-handoff-client-e2e.test.ts`
- Result: 1 test file passed, 1 test passed, 1 skipped.
- Post-TEA AC3 fix full gate evidence: `pnpm run gate`
- Result: typecheck passed, Biome passed with the known existing broken-symlink warning for `wpm/CLAUDE.md`, Vitest passed with 62 files, 663 tests passed, 14 skipped.

## Gaps

- No remaining AC-specific evidence gaps identified in this artifact pass. AC3 audit/event text is covered to the extent this composition exposes no separate audit sink; coverage is the concrete real noVNC read/output scan plus existing audit redaction tests elsewhere. AC6 is covered by deterministic browser/adapter/gateway negative evidence, not by a separate full real-host-stack outage test.
