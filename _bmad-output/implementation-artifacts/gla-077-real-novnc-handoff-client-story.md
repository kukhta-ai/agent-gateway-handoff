# GLA-077 - Serve a Real noVNC Handoff Client to the Recipient

Status: review

BMAD workflow: bmad-create-story

Mode: spec-exists fallback. `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent, so this story is grounded in `backlog task GLA-077 --plain`, committed docs, current code, and recent implementation artifacts rather than upstream BMAD sprint/planning artifacts. Backlog.md remains the story source of truth for status and acceptance criteria.

Scope note: this artifact was created as implementation context only. No source code, docs outside `_bmad-output`, backlog files, git state, or `.bmad/sdlc-state.yaml` should be changed by the create-story step.

## Story

As a verified handoff recipient, I need the handoff page to load a real browser noVNC client connected through the GLA Access Gateway so that I can see and control the live capsule browser without exposing my secret input to the agent or bypassing grant authorization.

## Acceptance Criteria

1. A full-mode browser handoff with a valid recipient-bound grant presents the authenticated recipient with a live capsule browser viewport in the browser tab.
2. Keyboard and pointer input through the recipient viewport reaches the capsule browser and can change or submit the target page.
3. User-entered secret text through the viewport is absent from agent-readable connector output, gateway responses, logs, audit/event text, and completion data.
4. A reused-auth second handoff opens the same live client onto the same capsule without a second identity ceremony while the reuse window is valid.
5. Absent, expired, revoked, wrong-recipient, or not-yet-authorized grants cannot establish the client connection and cause no traffic to reach the capsule entrypoint.
6. When the human-view stack or capsule noVNC endpoint is unavailable, the recipient sees a clear unavailable or refusal state and no false connected surface remains reachable.

## Current Behavior Model

The current implementation no longer treats a raw WebSocket open as recipient success. `packages/gateway/src/handoff-page.ts` now uses provider-declared browser-client metadata to load an RFB-compatible noVNC client from same-origin gateway-served assets, renders a visible `#viewer`, and reports explicit connected/refused/unavailable states. Reused-auth and delegated callback paths use the same browser-client opening path rather than a raw `new WebSocket` shortcut.

The gateway already owns the right authorization seam. `packages/gateway/src/index.ts` verifies grant state on page requests and WebSocket upgrades, keeps route authorization separate from reverse-proxy transport, closes sockets on revocation/unmount, and validates WebSocket reverse-proxy targets before mounting routes.

The noVNC provider seam exists after GLA-088. `adapters/entrypoint-novnc/src/index.ts` returns a `HumanEntrypointBinding` with `resourceId`, `provider`, `client`, and reverse-proxy `transport`. `adapters/launcher-process/src/index.ts` launches the full human-view stack in full mode and publishes provider-neutral runtime endpoint descriptors while retaining noVNC/CDP details inside launcher adapter state.

Current tests now include both lower-level gateway/adapter coverage and a real recipient browser proof. `packages/app/src/novnc-handoff-client-e2e.test.ts` runs a full-mode Xvfb/x11vnc/websockify capsule, loads the real provider-owned noVNC/RFB client through gateway same-origin assets, observes the RFB canvas/viewport, clicks through the canvas to focus a remote input, types a canary through noVNC, and verifies the canary reaches the capsule browser while the brokered connector is suspended when a brokered CDP URL is available. The strengthened AC3 proof wires the completion/connector-control lane with `completion: { pollMs: 100 }` and scans recipient page HTML, captured gateway text/json/script responses, CLI stdout/stderr/read commands, delivered channel links, direct session/handoff service read models, bridge session/handoff read models, and session/handoff completion fields. Audit/event text is covered to the extent this stack exposes no separate audit sink; the test scans the concrete outputs/read models available in this composition plus existing audit redaction tests elsewhere. AC6 is covered by deterministic adapter unavailable coverage, gateway negative/no-traffic coverage, and browser-negative no-false-connected coverage for missing client assets and RFB refusal; this is not a separate full real-host-stack outage test.

## Previous-Story Intelligence from GLA-088

GLA-088 established the provider-neutral runtime endpoint and human-entrypoint contracts that this story must consume rather than bypass. Use `RuntimeEndpointDescriptor`, `HumanEntrypointBinding`, route `authorization`, route `client`, and route `transport` as the cross-package language.

Do not reintroduce noVNC-shaped core contracts. The GLA-088 boundary tests and fake non-CDP/non-noVNC provider work are the precedent: session, capability, auth, identity, and kernel layers should remain provider-neutral and resource-id oriented.

Treat noVNC as the reference browser-stream HumanEntrypoint provider. Any noVNC-specific client loading, RFB initialization, asset serving, or browser-client metadata belongs at the human-entrypoint/provider/gateway-client seam and must be documented as that seam, not as a new core assumption.

The residual gap GLA-077 closes is recipient-facing runtime proof: GLA-088 can describe a human-entrypoint client and transport, while this implementation proves the selected noVNC client can render and drive the live capsule through the gateway.

## Transcript Failure Lessons

Raw WebSocket reachability is not noVNC success. The transcript investigation found a false pass where the page opened a socket and displayed a checkmark while no noVNC UI rendered. GLA-077 must assert visible viewport behavior and browser input, not just HTTP 101 or socket `open`.

Do not load noVNC from a CDN. Prior attempts using CDN module imports broke the page before click handlers registered. Handoff clients must use deterministic local, same-origin assets that work under root, public-base/subpath, and reverse-proxy deployment shapes.

Do not serve unresolved package internals directly as browser modules. Serving `@novnc/novnc/lib/rfb.js` exposed CommonJS/package-export behavior that was not browser-importable under the repo's pnpm layout. If noVNC is bundled or copied, the build/asset path must be explicitly tested in the browser.

Do not accept silent JavaScript failure. Previous inline syntax issues prevented event handlers from registering. Tests must exercise the real page in a browser and assert useful failure states when client bootstrap or RFB import fails.

## Architecture Guardrails

Preserve the HumanEntrypointPort/provider boundary. noVNC may be the selected provider for this story, but noVNC-specific code must stay out of core, session, capability, auth, identity, and kernel logic.

Preserve Access Gateway authorization semantics. Authentik/WebAuthn step-up, recipient-bound grants, route authorization, and revocation checks remain GLA-owned. noVNC, websockify, Caddy, or any outer proxy must not become the handoff authorization decision point.

Preserve reverse-proxy transport separation. Gateway route authorization decides whether a recipient may connect; reverse-proxy transport only describes how to reach the provider-owned entrypoint after authorization succeeds. Do not add arbitrary proxy targets or user-controlled upstream selection.

Preserve private-port semantics. The noVNC/websockify/VNC/X display endpoints remain private runtime dependencies behind the gateway route. Public exposure is the gateway-served handoff page and authorized gateway WebSocket route only.

Preserve local host dependency ownership. WPM owns host-touching installation and receipt recording for the human-view stack. GLA may detect unavailable runtime state and report it clearly, but must not install noVNC, Xvfb, x11vnc, websockify, or browser dependencies at runtime.

Preserve agent-blind boundaries. User-entered secrets through the viewport must travel only through the human stream to the target website. They must not appear in CDP/agent connector observations, gateway HTML/API responses, audit text, logs, event payloads, completion data, or test failure messages.

Preserve public-base behavior. Any page script, noVNC asset URL, WebSocket URL, callback path, or reused-auth flow must work behind the existing gateway public base/subpath support and must not regress root, subpath, or separate-domain routing.

## Tasks and Subtasks

- [x] 1. Replace raw WebSocket success with a real browser noVNC client.
   - [x] Current diff initializes an RFB-compatible browser client from provider-declared handoff metadata in `packages/gateway/src/handoff-page.ts`.
   - [x] Current diff removes raw `new WebSocket` success from handoff, reused-auth, and delegated callback page paths.
   - [x] Current diff renders a visible `#viewer` surface and explicit connected/refused/unavailable states.
   - [x] `packages/app/src/novnc-handoff-client-e2e.test.ts` now proves a verified recipient opens a real noVNC/RFB viewport through the gateway to a full-mode Xvfb/x11vnc/websockify capsule.

- [x] 2. Serve or bundle noVNC client assets locally.
   - [x] Current diff adds same-origin gateway asset serving at `/handoff/client-assets/<ref>/...` with traversal rejection.
   - [x] Current diff has the noVNC provider declare bundled `@novnc/novnc` assets plus optional `GLA_NOVNC_WEB_ROOT`.
   - [x] Current diff adds package-manager-managed dependencies in package manifests and `pnpm-lock.yaml`.

- [x] 3. Keep provider-neutral gateway and route contracts intact.
   - [x] Current diff consumes `HumanEntrypointBinding.client` and `HumanEntrypointBinding.transport`.
   - [x] Current diff keeps noVNC-specific asset discovery in `adapters/entrypoint-novnc` and gateway asset hosting generic by opaque `ref`.
   - [x] Boundary scan was expanded to reject noVNC/RFB tokens in protected core/session/capability/identity/kernel areas.

- [x] 4. Preserve grant, auth reuse, and revocation behavior.
   - [x] Gateway tests still cover grant-checked page loads and WebSocket upgrades.
   - [x] Existing E2E/surrogate flows still cover auth reuse, revocation, wrong-recipient/forwarded grants, and no capsule traffic for refused upgrades.
   - [x] Full gate passed with the updated handoff/callback paths.

- [x] 5. Implement unavailable and refusal states without false connected UI.
   - [x] Current diff shows clear unavailable/refusal states for unconfigured client, invalid module, import failure, disconnect, and security failure in page script.
   - [x] Adapter tests cover headless/missing noVNC endpoint as `dependency.unavailable`.
   - [x] Browser-negative tests cover missing provider client asset import and RFB `securityfailure`, asserting unavailable/refusal states and no false connected status.
   - [x] Gateway negative tests cover absent/invalid/expired/revoked/wrong-recipient/not-yet-authorized paths with no unauthorized traffic to the capsule entrypoint.

- [x] 6. Add browser-relevant acceptance tests.
   - [x] Current diff adds `packages/gateway/src/handoff-client-browser.test.ts` proving same-origin fake RFB asset loading, visible viewport bootstrap, URL construction, and input through the rendered test client.
   - [x] Current diff updates gateway/callback/public-base tests for no raw socket shortcut, client asset URL propagation, and safe asset serving.
   - [x] `packages/app/src/novnc-handoff-client-e2e.test.ts` proves full-mode noVNC viewport/input against the real Xvfb/x11vnc/websockify/noVNC path in this environment.
   - [x] The real noVNC E2E types a canary through the noVNC canvas, asserts brokered connector suspension when applicable, and scans the concrete gateway/agent-readable outputs and read models exposed by this composition.
   - [x] Browser-level negative coverage asserts missing noVNC client assets and RFB refusal do not report connected.

- [x] 7. Record DoD #7 and #8 boundary evidence.
   - [x] Current diff updates architecture docs for provider-owned browser client assets, gateway generic asset hosting, and HumanEntrypoint binding split.
   - [x] Current diff updates `packages/kernel/src/provider-runtime-boundary.test.ts` to reject noVNC/RFB/client-asset tokens in protected core areas.
   - [x] Existing GLA-088 fake-provider boundary precedent remains compatible with the current implementation.

## Acceptance Mapping and Proof Expectations

AC1 proof must show a full-mode handoff with a valid recipient-bound grant opens a browser tab containing a live, visible noVNC/RFB-rendered capsule browser viewport. Socket-open status alone is insufficient.

AC2 proof must show pointer and keyboard input through the rendered viewport changes or submits the target page. Prefer a target fixture with observable DOM/server state so the test proves input reached the capsule browser, not only the gateway page.

AC3 proof must use a canary secret typed through the viewport and scan agent-readable connector output, gateway responses, completion data, and any concrete logs/audit/event sink exposed by the tested composition. If the composition exposes no separate audit sink, record that limitation and pair the real noVNC read/output scan with existing audit redaction coverage. Test output must avoid echoing the secret on failure.

AC4 proof must show a second handoff within the auth reuse window opens the same live client onto the same capsule without repeating the identity ceremony. Track ceremony count and capsule/route identity.

AC5 proof must cover absent, expired, revoked, wrong-recipient, and not-yet-authorized grants. Each must fail before provider traffic reaches the capsule entrypoint; use a counting fake upstream or provider-side connection counter where possible.

AC6 proof must cover missing human-view stack and missing/unreachable noVNC endpoint. The recipient must see a clear unavailable/refusal state and the UI must not expose a false connected surface.

DoD #7 proof must identify the owning packages for browser client assets, host human-view dependency, gateway proxy seam, and noVNC provider seam while showing noVNC-specific implementation does not leak into core/session/capability/auth.

DoD #8 proof must show another browser-stream HumanEntrypoint provider could be added without changing session/capability/auth/core contracts. Reuse or extend the GLA-088 fake-provider boundary tests if needed.

## Files Likely Touched

- `packages/gateway/src/handoff-page.ts` for recipient browser client bootstrap, visible viewport, local asset URLs, and failure states.
- `packages/gateway/src/index.ts` and gateway tests if same-origin noVNC client assets need gateway serving or if route client metadata is passed differently.
- `adapters/entrypoint-novnc/src/index.ts` and tests if the noVNC provider must advertise richer client metadata while preserving `HumanEntrypointBinding`.
- `adapters/launcher-process/src/index.ts` and tests if runtime endpoint/client metadata from the full human-view stack needs to include noVNC client requirements.
- `packages/app/src/*e2e*.test.ts` or a new E2E test file for live recipient viewport/input, reused auth, secret non-leak, and unavailable states.
- `packages/gateway/src/handoff.test.ts` for page HTML/client bootstrap and negative grant/refusal behavior.
- `packages/kernel/src/provider-runtime-boundary.test.ts` or equivalent boundary scan proving noVNC-specific code stays out of protected core packages.
- `docs/architecture/test-strategy.md`, `docs/architecture/dependency-strategy.md`, or component docs only if implementation needs DoD #7/#8 boundary documentation updates. This create-story step does not edit those docs.
- Package manifests only if local noVNC asset dependency or bundling support changes are required; use normal dependency tooling rather than manual manifest edits.

## Test Plan

Run the repo quality gate: `pnpm run gate` if available, otherwise the documented equivalent `tsc -b && biome ci . && vitest run`.

Add or update unit/contract tests for handoff-page bootstrap so the page includes local same-origin client assets, escapes embedded metadata safely, computes public-base-aware WebSocket/asset URLs, and shows refused/unavailable states when bootstrap or RFB loading fails.

Add gateway authorization tests for browser-client WebSocket upgrades covering valid, absent, expired, revoked, wrong-recipient, and not-yet-authorized grants. Assert invalid cases do not reach the provider upstream.

Add adapter tests for noVNC `HumanEntrypointBinding` client metadata and unavailable conditions. Preserve tests proving missing full-stack runtime or non-websocket transport fails with structured unavailable/refusal diagnostics.

Add browser/E2E coverage for full-mode live viewport and input. The test should open a real handoff page, wait for an RFB/noVNC-rendered viewport, send pointer/keyboard input through that viewport, and assert the target page changes or submits.

Add secret non-leak coverage with a canary typed through the viewport. Scan connector observations, completion data, gateway responses, concrete service/bridge read models, and any exposed audit/event/log sink for absence; where this composition exposes no separate audit sink, rely on existing audit redaction tests for that sink. Do not print the canary in test names or assertion messages.

Add reused-auth E2E coverage proving the second handoff uses the same live client/capsule without a second identity ceremony while the reuse window remains valid.

Add unavailable-state E2E coverage for missing human-view dependencies and unreachable noVNC endpoint. The browser page must show a clear unavailable/refusal state and never mark the client connected.

Add boundary evidence for DoD #7/#8. A static protected-package scan should fail if noVNC/provider-client code appears in kernel, session, capability, auth, or identity packages. A fake non-noVNC HumanEntrypoint provider test should continue to pass.

## Risks and Anti-Patterns

Do not mark AC1 or AC2 complete from a raw WebSocket upgrade test. The required proof is a visible and controllable noVNC/RFB viewport.

Do not add CDN imports or external browser asset fetches. They are not deterministic, they break subpath/offline deployments, and previous attempts failed before user interaction.

Do not expose grant-bearing URLs, secrets, raw upstream endpoints, or private ports in page text, logs, diagnostics, audit events, or test failure output.

Do not collapse noVNC into the product architecture. noVNC is a reference HumanEntrypoint provider, not a core/session/capability/auth concept.

Do not broaden gateway proxying into arbitrary target forwarding. Route authorization and provider-declared reverse-proxy transport must stay bound together.

Do not make GLA an installer for the human-view stack. Missing host dependencies should produce unavailable diagnostics; WPM remains the host mutation owner.

Do not accept skipped full-mode browser tests as the only evidence for AC1/AC2. If CI cannot host the full noVNC stack, record the gating limitation and provide a deterministic local/hermetic lane before closing the ACs.

## References Read

- `backlog task GLA-077 --plain`
- `/home/agent/.codex/skills/bmad-create-story/SKILL.md`
- `/home/agent/.codex/skills/bmad-create-story/discover-inputs.md`
- `/home/agent/.codex/skills/bmad-create-story/template.md`
- `/home/agent/.codex/skills/bmad-create-story/checklist.md`
- `docs/task-writing-conventions.md`
- `docs/02-provider-and-extension-model.md`
- `docs/architecture/kernel-contracts.md`
- `docs/architecture/test-strategy.md`
- `docs/architecture/dependency-strategy.md`
- `docs/components/access-gateway.md`
- `docs/components/worker-plane.md`
- `docs/components/capsule.md`
- `_bmad-output/implementation-artifacts/gla-088-runtime-connector-and-human-entrypoint-provider-contracts-story.md`
- `_bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md`
- `_bmad-output/implementation-artifacts/investigations/entrypoint-extensibility-investigation.md`
- `packages/gateway/src/handoff-page.ts`
- `packages/gateway/src/index.ts`
- `adapters/entrypoint-novnc/src/index.ts`
- `adapters/launcher-process/src/index.ts`
- Existing gateway, app E2E, launcher, entrypoint, and provider boundary tests located by repository search.

## Dev Agent Record

Agent: Dirac, persistent worker/dev specialist

Model: Codex GPT-5

Created by: bmad-create-story workflow in spec-exists fallback mode

Source of truth: Backlog task GLA-077 and committed docs/artifacts

### Debug Log

- 2026-06-13: Invoked `bmad-dev-story` as an evidence pass only. User constraint forbade production/test source edits, so the workflow halted at implementation/edit steps and recorded current-diff evidence instead of changing code.
- 2026-06-13: Invoked `bmad-qa-generate-e2e-tests` in validation/summary mode only. User constraint forbade generating source tests, so QA output is a summary artifact rather than new test code.
- 2026-06-13: Confirmed `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent; story progress is tracked in this artifact only.
- 2026-06-13: Ran targeted tests: `pnpm vitest run packages/gateway/src/handoff-client-browser.test.ts packages/gateway/src/handoff.test.ts packages/gateway/src/callback-page.test.ts packages/gateway/src/public-base.test.ts adapters/entrypoint-novnc/src/entrypoint-novnc.test.ts packages/kernel/src/provider-runtime-boundary.test.ts`. Result: 6 files passed, 59 tests passed, 1 skipped.
- 2026-06-13: Ran full gate: `pnpm run gate`. Result: typecheck passed, Biome CI passed with one existing broken-symlink warning for `wpm/CLAUDE.md`, Vitest passed with 61 files, 659 tests passed, 13 skipped.
- 2026-06-13: Re-verified host human-view dependencies for the main-agent update: `Xvfb`, `x11vnc`, and `websockify` are on PATH; `dpkg -C` returned clean.
- 2026-06-13: Ran real noVNC targeted test: `pnpm vitest run packages/app/src/novnc-handoff-client-e2e.test.ts`. Result: 1 file passed, 1 real proof passed, 1 unavailable-skip sentinel skipped.
- 2026-06-13: Ran full gate after main-agent update: `pnpm run gate`. Result: typecheck passed, Biome CI passed with one existing broken-symlink warning for `wpm/CLAUDE.md`, Vitest passed with 62 files, 660 tests passed, 14 skipped.
- 2026-06-13: Recorded launcher full-mode reliability fix evidence: `adapters/launcher-process/src/index.ts` now seeds X display allocation from `process.pid` to reduce Vitest worker collisions during full-mode noVNC tests.
- 2026-06-13: Re-ran real noVNC targeted test in this evidence pass: `pnpm vitest run packages/app/src/novnc-handoff-client-e2e.test.ts`. Result: 1 file passed, 1 real proof passed, 1 unavailable-skip sentinel skipped.
- 2026-06-13: Previous evidence-pass gate failure on `packages/gateway/src/callback-page.test.ts` formatting was superseded by main-agent formatting cleanup.
- 2026-06-13: Ran focused gateway AC6/hardening tests after cleanup: `pnpm exec vitest run packages/gateway/src/handoff-client-browser.test.ts packages/gateway/src/handoff.test.ts packages/gateway/src/callback-page.test.ts packages/gateway/src/public-base.test.ts`. Result: 4 files passed, 56 tests passed, 1 skipped.
- 2026-06-13: Re-ran full gate after cleanup: `pnpm run gate`. Result: typecheck passed, Biome CI passed with one known broken-symlink warning for `wpm/CLAUDE.md`, Vitest passed with 62 files, 663 tests passed, 14 skipped.
- 2026-06-13: TEA/Helmholtz found AC3 under-proven for the real noVNC path; main-agent strengthened `packages/app/src/novnc-handoff-client-e2e.test.ts` with the completion/connector-control lane, brokered connector suspension assertion, and expanded real noVNC canary scans.
- 2026-06-13: Recorded post-fix targeted real noVNC E2E evidence: `pnpm exec vitest run packages/app/src/novnc-handoff-client-e2e.test.ts`; result: 1 file passed, 1 passed, 1 skipped.
- 2026-06-13: Recorded post-fix full gate evidence: `pnpm run gate`; result: typecheck passed, Biome passed with the known existing `wpm/CLAUDE.md` broken symlink warning, Vitest passed with 62 files, 663 passed, 14 skipped.

### Completion Notes

- Current implementation diff replaces raw handoff/callback WebSocket client success with an RFB-compatible browser-client bootstrap and same-origin provider asset route.
- Current implementation diff keeps noVNC asset ownership in `adapters/entrypoint-novnc`, keeps gateway asset hosting generic, and preserves Access Gateway grant checks for route upgrades.
- QA evidence is green for the repository gate, fake RFB browser-client rendering/input, real full-mode noVNC/RFB viewport/input, safe local asset serving, public-base propagation, callback/reused-auth client path, no raw socket shortcut, adapter unavailable behavior, and protected boundary scan.
- AC1 and AC2 are now directly covered by `packages/app/src/novnc-handoff-client-e2e.test.ts`, which runs the real Xvfb/x11vnc/websockify/noVNC path and verifies visible viewport plus pointer/keyboard input into the capsule browser.
- AC3 is now covered for the real noVNC path by the strengthened E2E: it wires `completion: { pollMs: 100 }`, verifies the brokered connector is suspended while the noVNC window is open when a brokered CDP URL is available, types the canary through the real viewport, and scans recipient page HTML, captured gateway text/json/script responses, CLI stdout/stderr/read commands, delivered links, service/bridge read models, and completion fields. Audit/event text is covered to the extent this composition exposes no separate audit sink; existing audit redaction tests cover audit redaction elsewhere.
- AC6 is covered by deterministic adapter unavailable coverage, gateway negative/no-traffic coverage, and browser-negative tests for missing noVNC assets and RFB refusal that assert no false connected state. This is not a separate full real-host-stack outage test.
- Launcher full-mode display allocation was made cross-worker safer with pid-seeded display numbers, reducing collisions between parallel full-mode tests.
- Gateway client asset serving is hardened against traversal and symlink escapes outside the configured asset root, with coverage in `packages/gateway/src/handoff.test.ts`.
- Callback page JSON data-island escaping now reuses `jsonScriptData`, with coverage in `packages/gateway/src/callback-page.test.ts`.
- Current full gate is green in this evidence pass.

### Current AC Evidence

- AC1: Covered by the real noVNC E2E opening a verified recipient handoff page and observing a live RFB canvas/viewport through the gateway.
- AC2: Covered by the real noVNC E2E clicking through the canvas to focus a remote input and typing through noVNC into the capsule browser.
- AC3: Covered for the real noVNC path by the strengthened E2E canary scan across recipient page HTML, captured gateway text/json/script responses, session/handoff CLI stdout/stderr/read outputs, delivered channel links, direct and bridge service read models, and session/handoff completion fields. The same test wires completion polling and asserts brokered connector suspension when a brokered CDP URL is available. Audit/event text is covered to the extent this composition exposes no separate audit sink, with existing audit redaction tests covering audit redaction elsewhere.
- AC4: Covered by existing reused-auth E2Es plus current reused handoff page using the provider browser-client path.
- AC5: Covered by gateway negative tests and existing E2Es proving invalid/forwarded/wrong-recipient/revoked paths do not reach the capsule entrypoint.
- AC6: Covered by adapter unavailable tests, gateway negative/no-traffic tests, and browser-negative tests that prove missing provider client assets and RFB `securityfailure` show unavailable/refusal without reporting connected. This is deterministic browser/adapter/gateway coverage rather than a separate full real-host-stack outage test.

## File List

Files changed by this evidence pass:

- `_bmad-output/implementation-artifacts/gla-077-real-novnc-handoff-client-story.md`
- `_bmad-output/implementation-artifacts/tests/gla-077-test-summary.md`

Current GLA-077 implementation diff observed but not edited by this evidence pass:

- `adapters/entrypoint-novnc/package.json`
- `adapters/entrypoint-novnc/src/entrypoint-novnc.test.ts`
- `adapters/entrypoint-novnc/src/index.ts`
- `adapters/launcher-process/src/index.ts`
- `docs/architecture/dependency-strategy.md`
- `docs/architecture/test-strategy.md`
- `docs/components/access-gateway.md`
- `docs/components/capsule.md`
- `packages/app/src/index.ts`
- `packages/gateway/package.json`
- `packages/gateway/src/callback-page.test.ts`
- `packages/gateway/src/callback-page.ts`
- `packages/gateway/src/handoff-client-browser.test.ts`
- `packages/gateway/src/handoff-page.ts`
- `packages/gateway/src/handoff.test.ts`
- `packages/gateway/src/index.ts`
- `packages/gateway/src/public-base.test.ts`
- `packages/kernel/src/provider-runtime-boundary.test.ts`
- `packages/app/src/novnc-handoff-client-e2e.test.ts`
- `pnpm-lock.yaml`

Pre-existing modified files intentionally not touched by this evidence pass:

- `.bmad/sdlc-state.yaml`
- `backlog/tasks/gla-077 - Serve-a-real-noVNC-handoff-client-to-the-recipient.md`
- `.codex/`

## Change Log

- 2026-06-13: Ran `bmad-dev-story` and `bmad-qa-generate-e2e-tests` evidence pass under no-source-edit constraints; updated story status, task evidence checkboxes, Dev Agent Record, File List, and Change Log.
- 2026-06-13: Added GLA-077 QA summary under implementation artifacts.
- 2026-06-13: Updated GLA-077 evidence after main-agent implementation: real full-mode noVNC E2E passes locally, AC1/AC2 fake-only evidence notes closed, and AC3 strengthened.
- 2026-06-13: Removed stale current-behavior text that described the page as raw-WebSocket-only and added current AC evidence mapping plus launcher display-allocation reliability note.
- 2026-06-13: Superseded prior Biome-formatting gate failure after main-agent formatting cleanup; focused gateway tests and full gate now pass.
- 2026-06-13: Updated AC6 evidence after main-agent hardening: browser-negative unavailable/refusal tests, symlink-escape asset serving coverage, callback JSON data-island escaping coverage, focused gateway tests green, and full gate green.
- 2026-06-13: Updated AC3 evidence after TEA fix: completion/connector-control lane, brokered connector suspension assertion, expanded real noVNC canary scans, targeted real E2E green, and full gate green.
