# GLA — Test Architecture & Strategy (Phase-3 testarch-test-design)

> **Rule-3 note:** `bmad-testarch-test-design` was invoked and loaded successfully at
> `/workspace/active/agent-gateway-handoff/.claude/skills/bmad-testarch-test-design`, but its initialization
> sequence is interactive — it blocks on a mandatory C/R/V/E mode selection and cannot continue unattended.
> Per AGENTS.md Rule-3 allowance this artifact is driven from the committed design set as the stated fallback.
> Blocker recorded; workflow step is not silently substituted.
>
> **Reads against:** `docs/scenario-01-unified.html` (Phases E,0–15), `docs/architecture/baseline.md`,
> `docs/architecture/kernel-contracts.md`, `docs/architecture/dependency-strategy.md`,
> `docs/01-architecture-overview.md §6`, `docs/05-cli-and-entities.md §5–§6`.
>
> **Quality gate:** `pnpm gate` = clean production `dist`, runtime build typecheck (`tsc -b`), strict no-emit
> test typecheck (`tsc -p tsconfig.tests.json --noEmit`), source-layout check, dist-layout check, `biome ci .`,
> browser-E2E preflight, and `vitest run` — the one bar used locally, in pre-commit, in CI, and as every task's
> Definition of Done (see CONTRIBUTING.md).

---

## §1 · Test levels & the pyramid

### 1.1 The three levels

| Level | What gets tested | Tooling | When it runs |
|---|---|---|---|
| **Unit** | Pure module logic — state-machine reducers, caveat algebra, schema validators, error taxonomy, policy evaluations — anything that can be proven without I/O or a running process | Vitest (in-process) | Every `pnpm gate` run |
| **Integration (contract)** | Each kernel PORT against its real adapter, over the seam only — no full stack, no external network | Vitest (with `@vitest/integration` or plain test files that start one real service) | Every `pnpm gate` run |
| **E2E (scenario thread)** | The complete scenario-01 thread (Phases E,0–15) through real modules on the process launcher, driven headlessly | Playwright test runner + the `channel-cli` fallback | CI gate on `dev`/feature branches; GLA-066 capstone |

The **import-boundary test** (the deliberate-bad fixture `tools/boundary-check/fixtures/core-importing-adapter.ts`
must be rejected by `biome ci .`) is exercised inside `vitest run` and re-asserts on every gate run — it sits at
the unit level conceptually but is the boundary-enforcement selftest (see CONTRIBUTING.md §Quality gate). The
Provider-layer migration adds a project-owned scanner in `tools/boundary-check/provider-boundary.mjs`: migrated
provider adapters may be imported by registry bootstrap packages, compatibility packages, and tests, but protected
runtime packages must use provider ids, kernel ports, `ProviderRegistry`, or internal ProviderHost mechanics only
behind the registry boundary.

### 1.1a Source and Test Layout

Runtime source directories are for production code only. Package-owned tests stay with the package that owns the
seam, but outside `src`:

| Location | Owner | Contents |
|---|---|---|
| `packages/<name>/src/`, `adapters/<name>/src/`, `surfaces/<name>/src/` | Production package | Runtime code and exported package surface only |
| `packages/<name>/test/unit/`, `adapters/<name>/test/unit/`, `surfaces/<name>/test/unit/` | Same package | Package-local unit tests for package-owned logic |
| `packages/<name>/test/contract/`, `adapters/<name>/test/contract/` | Same package/provider | Port/provider contract tests that prove the package-owned seam |
| `packages/<name>/test/integration/`, `surfaces/<name>/test/integration/` | Same package/surface | Package-local integration tests for non-app runtime seams such as gateway, bridge, and CLI behavior |
| `packages/<name>/test/e2e/` | Same package | Package-local E2E proofs for package-owned browser or process behavior that is not the app composition-root scenario |
| `packages/app/test/integration/` and `packages/app/test/e2e/` | App composition root | Composition-root integration and E2E tests, including scenario, daemon, gateway, authentik, noVNC, teardown, and grant-canary flows |
| `packages/<name>/test/fixtures/` or `adapters/<name>/test/fixtures/` | Same package/provider | Test-only fixtures and helpers; never exported as production API |
| `tests/<scope>/` | Repository-wide harness | Cross-package boundary, scenario, or migration harnesses that do not belong to one package |
| `tools/**/*.test.ts` | Tool owner | Tests for repository tooling such as boundary checks and browser-E2E preflight |

The gate enforces two separate TypeScript contracts:

- `pnpm run typecheck` starts by cleaning production `dist`, then `tsc -b` builds production packages from
  `src` roots and inherits `tsconfig.base.json` exclusions for tests, fixtures, `dist`, and dependency folders.
  `tools/source-layout.mjs` fails the gate if runtime `src` contains test files/test-only directories, if
  runtime source imports package-local tests/fixtures/fake providers or `/testing` exports, or if package
  manifests publish tests/fixtures. `tools/check-dist-layout.mjs` fails the gate if a test or fixture artifact
  appears in production output.
- `tsc -p tsconfig.tests.json --noEmit` typechecks all test locations above with the same strict compiler
  options. Runtime `src` directories are not test roots; package-local and app-local `test/` trees are.

Vitest discovers the documented outside-`src` test locations. The browser-E2E preflight and provider-layer boundary
checks remain part of `pnpm gate`; moving a test changes its path, not its proof strength.

### 1.2 Package-to-level map

```
packages/kernel        → UNIT (K0–K9: all pure; state reducers, caveat algebra, schema validity)
packages/task          → UNIT (state machine reducers) + CONTRACT (TaskService against its port)
packages/session       → UNIT (session lifecycle reducers, saga decisions) + CONTRACT (SessionService)
packages/capability    → UNIT (attenuation predicate, verify purity) + CONTRACT (CapabilityPort adapter)
packages/route         → UNIT (route lifecycle) + CONTRACT (RouteController against gateway seam)
packages/completion    → UNIT (signal→envelope normalization, out-of-contract rejection) + CONTRACT
packages/audit         → UNIT (append-only invariant, redaction logic) + CONTRACT (AuditPort)
packages/admission     → UNIT (mutate pipeline, Cedar policy evaluation) + CONTRACT (PolicyPort + offline validation)
packages/catalog       → UNIT (entity validation, availability derivation) + CONTRACT (CatalogPort)
packages/identity      → UNIT (binding narrowing, enrollment rules) + CONTRACT (IdentityPort / AuthProviderPort)
packages/worker        → CONTRACT (LauncherPort × process-tier adapter; WorkspacePort)
packages/gateway       → INTEGRATION (stateless verify against real CapabilityPort; browser-client asset host; WS upgrade path; route proxy)
packages/bridge        → INTEGRATION (CLI + MCP surface parity; thin transport test)
packages/assembly      → UNIT (AssemblySpec schema, template resolution, offline dry-run)
packages/app           → INTEGRATION + E2E (the composition root; not unit-tested in isolation)
adapters/policy-cedar  → CONTRACT (PolicyPort guarantee: pure, total, forbid-wins)
adapters/auth-webauthn → CONTRACT (AuthProviderPort: enrollment + assertion round-trip with a virtual authenticator)
adapters/launcher-process → CONTRACT (LauncherPort: spawn + health + stop on T2 process tier)
adapters/entrypoint-novnc → CONTRACT (HumanEntrypointPort: returns provider-neutral binding + noVNC/RFB client metadata)
adapters/connector-cdp → CONTRACT (AgentConnectorPort: attach returns a live CDP url)
adapters/workspace-profile → CONTRACT (WorkspacePort: realize → reap, ephemeral)
adapters/detector-url  → CONTRACT (CompletionDetectorPort: watcher fires on the declared URL; contract rejection)
adapters/channel-cli   → CONTRACT (ChannelPort: deliver + receive round-trip, headless; used in E2E)
adapters/channel-telegram → CONTRACT (ChannelPort: stub/mocked — no live Telegram in CI)
surfaces/cli           → INTEGRATION (exit-code map; parity with MCP surface)
surfaces/mcp           → INTEGRATION (tool-per-command parity; same auth/validation path)
```

---

## §2 · The scenario-01 E2E harness design

### 2.1 Goal

Drive Phases E, 0–15 (see `docs/scenario-01-unified.html`) headlessly in two environments:

- **Dev / local:** the developer's machine or a clean CI runner, no Telegram, no real website.
- **`hermes-1`:** the LXD container target at `https://203.0.113.10/`, process-tier T2 launcher, host Caddy as the TLS edge.

### 2.2 The five harness actors

| Actor | Real vs stub | Notes |
|---|---|---|
| **`gla` process** | **Real** — the full GLA server (`packages/app` wired with all adapters) | Runs on `:3000`; started by the harness with `channel-cli` instead of `channel-telegram` |
| **"Agent" script** | **Real (thin shell)** — executes the exact `gla` CLI calls from `docs/05 §6` in order | Uses `channel=cli`; not a mock |
| **"Human" Playwright client** | **Scripted** — a Playwright browser acting as the recipient | Performs WebAuthn via the `virtual-authenticator` CDP API; fills forms; navigates |
| **Target stub** (`acme.example`) | **Local stub server** | Serves `/register` → POST → `/verify` (with a known code) → `/dashboard`; makes `url-watcher` fire deterministically |
| **Virtual WebAuthn authenticator** | **CDP built-in** (`Page.addVirtualAuthenticator`) | No real passkey device needed; the `auth-webauthn` adapter works against the browser's WebAuthn API unchanged |

### 2.3 The seam table — what is real vs doubled

| Seam | In E2E harness | Rationale |
|---|---|---|
| `ChannelPort` | **`channel-cli` adapter** (real, in-tree) | Delivers links to stdout/file instead of Telegram; the "human" Playwright client polls for the link |
| `LauncherPort` | **`launcher-process` adapter** (real, T2) | `hermes-1`'s Docker storage driver is broken; process-tier is the correct default |
| `HumanEntrypointPort` | **`entrypoint-novnc` adapter** (real) | noVNC stack started by the launcher; the recipient browser loads the provider-owned RFB client from same-origin gateway assets and connects through the grant-protected route |
| `AuthProviderPort` | **`auth-webauthn` adapter** (real) + `Page.addVirtualAuthenticator` | Full WebAuthn round-trip in Chromium; no mock |
| `PolicyPort` | **`policy-cedar` adapter** (real) | Actual Cedar evaluation; the policy file is the minimal MVP policy set |
| `CompletionDetectorPort` (url-watcher) | **`detector-url` adapter** (real) against the **local stub** | Fires deterministically when the stub serves `/dashboard` |
| `ChannelPort` (Telegram) | **stubbed / not wired** | `channel-telegram` is not loaded in the E2E config; `channel-cli` replaces it |
| Caddy (TLS edge) | **Dev: Caddy-less** (direct `:3000`) / **`hermes-1`: real host Caddy** | Grant verification in `gateway` is real in both; Caddy is transport only |
| Telegram Bot API | **Not called** | Zero outbound Telegram calls; the `channel-cli` adapter is the only channel loaded |
| Target website (`acme.example`) | **Local HTTP stub** (a few `express`/`hono` routes, ~30 lines) | Makes completion deterministic and CI-hermetic |

### 2.4 The Phase-by-phase harness walkthrough

```
Phase E  (one-time, run once in harness setup)
  harness: create a virtual authenticator in the "human" Playwright page
  harness: POST /enroll to GLA gateway with a single-use operator-discharge token
  harness: drive the WebAuthn registration ceremony via CDP (Page.addVirtualAuthenticator)
  assert:  recipient binding established; authStrength = "webauthn"

Phase 0  inbound request via channel-cli
  harness: inject a message event via the cli-channel's receive() pipe
  assert:  agent script receives the recipient binding

Phase 1  orient
  agent:   gla whoami → gla template show browser-handoff → gla skill show browser-handoff
  assert:  exit 0; JSON contains expected fields; template shows process-tier launcher available

Phase 2  propose (dry-run then provision)
  agent:   gla task create ...
  agent:   gla session create -f assembly.json --dry-run   → assert exit 0, accepted
  agent:   gla session create -f assembly.json              → assert exit 0, session_id + connector

Phase 3  provision
  assert:  capsule spawned (launcher-process health check); noVNC port reachable

Phase 4  agent drives via connector (CDP)
  harness: Playwright attaches to cdp_url; navigates to stub /register
  assert:  stub /register responds 200

Phase 5  handoff 1 open
  agent:   gla handoff open --session $SESS ...
  assert:  handoff_id returned; channel-cli writes the link to the polling file

Phase 6  user authenticates at the edge
  harness (human Playwright): navigates to the handoff link (direct `:3000` or via Caddy)
  harness: WebAuthn assertion via Page.addVirtualAuthenticator
  assert:  GW accepts; the provider client loads from same-origin assets; RFB/noVNC renders a visible live viewport
  assert:  lower-level gateway proxy tests still prove the authorized WebSocket upgrade reaches only the mounted entrypoint

Phase 7  user fills the form
  harness (human Playwright): fills the registration form through the rendered noVNC/RFB viewport
  stub:    POST /register → 200, "check your email"; emits verification-email event (known code)
  assert:  url-watcher signals /verify

Phase 8  completion 1
  assert:  gla handoff wait returns {status:"submitted", next:"email-verification"}
  assert:  grant-1 revoked; route unmounted; WebSocket force-closed

Phase 9  agent inspects via CDP
  harness: Playwright reads /verify page text via CDP
  assert:  page contains "enter code" text

Phase 11  handoff 2 open (same capsule)
  agent:   gla handoff open --session $SESS --reason "enter verification code"
  assert:  new handoff_id on the SAME session_id

Phase 12  user enters the code (auth reused)
  harness (human Playwright): opens handoff-2 link
  assert:  GW reuses auth (no re-challenge because auth is still valid within TTL)
  harness: reads known code from stub; enters through the rendered noVNC/RFB viewport
  stub:    POST /verify-code → 302 /dashboard
  assert:  url-watcher fires on /dashboard

Phase 13  completion 2
  assert:  gla handoff wait returns {status:"verified"}
  assert:  grant-2 revoked; route unmounted

Phase 14  agent configures account
  harness: Playwright navigates /dashboard via CDP; sets a preference
  assert:  stub returns 200 for the preference endpoint

Phase 15  teardown
  agent:   gla task complete $TASK
  assert:  exit 0; capsule process gone (launcher health returns "down"); temp profile directory deleted
  assert:  audit trail for task contains all expected event kinds (task.completed, session.completed, capability.revoked ×N)
```

### 2.5 Running in `hermes-1` vs dev

| Concern | Dev / CI | `hermes-1` target |
|---|---|---|
| TLS | No TLS; direct `:3000` | Host Caddy at `https://203.0.113.10/`; harness sets `GLA_ENDPOINT=https://203.0.113.10/` |
| Launcher | `launcher-process` (same) | `launcher-process` (same; Docker alt is not the default) |
| noVNC connectivity | provider RFB client assets from gateway + grant-protected `ws://127.0.0.1:<path>` | provider RFB client assets from gateway + grant-protected `wss://203.0.113.10/<path>` via Caddy |
| Network isolation | Loopback only | LXD container network; same security invariants |
| Cold start | `pnpm install && pnpm gate` from a fresh checkout | Same; GLA-066 specifically mandates a **cold start** (clean env, nothing warm) |

---

## §3 · Security-invariant test checklist

These are the **must-cover** invariants from `docs/01 §6` and `docs/architecture/baseline.md §2–§4`. Each is a
**blocking requirement** for GLA-066 (the capstone) and for any task whose implementation touches the relevant
seam. The level and the observable assertion are specified so a failing test makes the specific invariant visible.

| # | Invariant | Level | Observable assertion | Mapping |
|---|---|---|---|---|
| S-1 | **Recipient-bound grant fails closed for the wrong recipient** | Integration (gateway seam) | Present grant-A (bound to recipient R1) with recipient-context R2 in the request → `verify()` returns `{ok:false, reason:"auth.recipient_mismatch"}` → gateway returns 401/403; WebSocket upgrade rejected | `kernel-contracts.md §2.3`, `baseline.md §4` |
| S-2 | **Agent-blind: raw secret never in agent-visible output, logs, or audit egress** | Unit + Integration + E2E | (a) Unit: `SecretStorePort.put()` returns a `Ref<"secret-ref">`, never the raw value. (b) Integration: `gla session connector` prints `secret_ref`, not the secret value. (c) E2E: scan the full audit trail (`gla audit list --task $T`) for the known test-secret string — assert zero occurrences. (d) Scan the agent connector JSON for the test-secret string. | `kernel-contracts.md §2.3`, `baseline.md §2`, `docs/01 §6` |
| S-3 | **Stateless edge verification — no DB round-trip in the common verify path** | Unit | `CapabilityPort.verify()` accepts only `(token, {now, recipient, revocations: RevocationSnapshot})` — no async I/O interface; Vitest spy confirms no database calls inside `verify()`. The `verify()` implementation is pure given its inputs (a property test with random valid tokens). | `kernel-contracts.md §2.3–§2.4`, `docs/01 §6` |
| S-4 | **Capability attenuation only — child ⊆ parent** | Unit | `attenuate()` with a caveat that would widen the parent (longer TTL, different recipient, broader ops) → throws / returns an error, never a valid child token. Property-based: for any random valid parent, any random additional caveat that would widen → rejected. | `kernel-contracts.md §2.2`, `baseline.md §4` |
| S-5 | **Lineage revocation cascades to descendants** | Integration (CapabilityPort) | Mint root → child → grandchild. Revoke the root. Verify child and grandchild both return `{ok:false, reason:"auth.revoked"}`. Assert the revocation snapshot carries all three IDs. | `kernel-contracts.md §2.4`, `docs/01 §6` |
| S-6 | **Single public entry — nothing but the gateway is bound on `0.0.0.0`** | E2E / Doctor probe | After GLA starts, assert that only `:3000` (or the gateway's configured port) is listening on `0.0.0.0`; the Agent Bridge port is never on `0.0.0.0`. Implemented as the Doctor probe assertion in the cold-start E2E setup step. | `baseline.md §3`, `identity-and-auth.md` |
| S-7 | **Offline admission rejects policy/schema/mount violations with the correct exit code** | Unit + CLI Integration | (a) `policy.*` rejection → exit 3. (b) `mount.denied` → exit 3. (c) `mount.not_found` → exit 5. (d) `mount.conflict` → exit 7. (e) `mount.unsupported` → exit 8. Each tested with a deliberate bad assembly spec passed to `gla session create --dry-run`. No process spawned. | `kernel-contracts.md §5.1–§5.2`, `docs/05 §5` |
| S-8 | **Completion out-of-contract signal is rejected** | Unit | Feed the `CompletionService` a `RawCompletionSignal` whose shape does not match the detector's `contract` (ConfigSchema). Assert the signal is rejected (not normalized to a `CompletionEnvelope`), status does not advance, and the session state does not move to `completed`. | `kernel-contracts.md §1.6`, `baseline.md §2` |
| S-9 | **AssemblySpec is immutable after admission** | Unit | Take a `Session` in `issued` state with a `ResolvedAssemblySpec`. Attempt to mutate `session.spec`. Assert the mutation is rejected (type-level: `spec` is typed as `ResolvedAssemblySpec & {readonly …}`) and any runtime mutation attempt on a frozen object throws. | `kernel-contracts.md §3`, `docs/01 §10` |
| S-10 | **Forwarded grant link is useless to a different recipient** | E2E | (Full E2E variant of S-1.) During handoff-1, the harness opens the grant-1 link in a **second Playwright context** with a different virtual authenticator (different user). Assert: authentication fails; WS upgrade is denied; the capsule receives no traffic from the second context. | `baseline.md §4`, `docs/01 §3` |

**Count: 10 invariants, 3 levels (unit / integration / E2E).**

---

## §4 · Traceability

### 4.1 Task-to-test-level mapping

The 66 GLA-### tasks form one epic. Each impl task (odd id) has acceptance criteria that are the behavioral contract
the tests must make observable. The tracing rule: **every acceptance criterion in a task's `backlog task <id>
--plain` output maps to at least one test assertion at the appropriate level** (unit for pure logic criteria,
contract/integration for seam criteria, E2E for the capstone or scenario-thread criteria).

| Task range | Content | Primary test level |
|---|---|---|
| GLA-001–005 | Architecture / scaffold / contracts / dependency strategy | No runtime tests; boundary selftest from GLA-003 |
| GLA-006 | Cedar integration (`policy-cedar`) | CONTRACT: `PolicyPort` guarantee (pure, total, forbid-wins) |
| GLA-007–011 | `wpm` bundle tasks (browser-runtime, human-view, isolation, edge-proxy, identity-provider) | No `packages/**` tests; verified by the E2E capsule spawn |
| GLA-012/013 | Enrollment plan + impl | UNIT: enrollment rules (one-time, operator-discharge-gated); CONTRACT: `IdentityPort.enroll()`; E2E: Phase E |
| GLA-014/015 | Inbound request + agent connect | UNIT: channel receive; CONTRACT: `ChannelPort.receive()`; Integration: `gla whoami` exit 0 |
| GLA-016/017 | Agent orientation | Integration: `gla template show`, `gla skill show`; exit codes |
| GLA-018–021 | Propose + admit (dry-run + real) | UNIT: admission pipeline; exit codes 3/4/5/7/8 from S-7; E2E: Phase 2 |
| GLA-022/023 | Provision capsule | CONTRACT: `LauncherPort.spawn()`; E2E: Phase 3 |
| GLA-024/025 | Agent connector | CONTRACT: `AgentConnectorPort.attach()`; S-2 (agent-blind); E2E: Phase 4 |
| GLA-026–031 | Agent drives via connector (Phase 4 + deltas) | E2E: Playwright CDP steps |
| GLA-032/033 | Open handoff window | CONTRACT: grant mint, route mount; E2E: Phase 5 |
| GLA-034–037 | User authenticates at edge | CONTRACT: `AuthProviderPort.verifyAssertion()`; S-1 (wrong recipient); E2E: Phase 6 |
| GLA-038/039 | Verified human reaches capsule | Integration: gateway proxy; E2E: Phase 6 WS upgrade |
| GLA-040/041 | Human works agent-blind | S-2 (secret scan); E2E: Phase 7 |
| GLA-042/043 | Completion detection | UNIT: signal validation; CONTRACT: `CompletionDetectorPort`; S-8; E2E: Phase 8 |
| GLA-044/045 | Close window + resume | CONTRACT: route unmount, grant revoke; E2E: Phase 8 assertions |
| GLA-046–063 | Second-handoff delta tasks | E2E: Phases 9–14 (reuse auth, re-open, second completion) |
| GLA-064/065 | Teardown plan + impl | CONTRACT: `LauncherPort.stop()`, `WorkspacePort.reap()`; S-6 (no orphan process); E2E: Phase 15 |
| **GLA-066** | **Capstone: full scenario-01 cold E2E** | **E2E: all Phases E,0–15 in sequence, cold start, all S-* invariants asserted** |

### 4.2 GLA-066 as the capstone gate

GLA-066 (`Pass the scenario-01 through-case end to end`) depends on every scenario-thread impl task (the direct
dependencies stated in the backlog: GLA-013,015,017,019,021,023,025,027,033,035,039,041,043,045,065, plus the
delta chain 047–063). It is the **final test gate** that proves the whole system composes correctly:

- Clean checkout, `pnpm install`, `pnpm gate`: one command runs unit, contract, browser/full-human-view
  preflight, and browser-backed E2E evidence inside the same DoD gate.
- No warm state: the GLA process is started fresh; the `hermes-1` variant additionally verifies no residual
  capsule processes from prior runs.
- The harness runs Phases E,0–15 in the order above (§2.4).
- All 10 security invariants (§3) are asserted within the same E2E run.
- `pnpm gate` remains the final CLI command. Before Vitest runs, `test:e2e:preflight` verifies that the
  Playwright Chromium runtime is installed, executable, and launchable; `Xvfb`, `x11vnc`, and `websockify`
  are on `PATH`; and the browser-backed E2E fixture files are present. Browser/full-human-view absence is
  therefore a gate failure, not a skipped green result.

### 4.3 `pnpm gate` is the single DoD bar

```
pnpm gate = clean dist && tsc -b && test typecheck && source-layout && dist-layout && biome ci . && preflight && vitest
                                      ↑                ↑                         ↑                         ↑
         package/app-local tests typechecked          runtime src has no       production dist has       browser/full
         outside src with strict compiler options      tests/test imports       no tests or fixtures      human-view preflight
```

The full `pnpm gate` always requires browser-backed E2E availability. For local iteration only, a developer
can run `pnpm run gate:without-browser-e2e`; that command sets `GLA_BROWSER_E2E_MODE=optional`, uses
`test:e2e:preflight:optional`, prints an explicit opt-out warning, and is not valid backlog
Definition-of-Done evidence for work whose acceptance criteria require browser-level proof.

To prove browser-backed E2E assertions are actually inside the full gate, `pnpm run gate:browser-canary`
temporarily sets `GLA_BROWSER_E2E_CANARY_FAIL=1`, runs the real `pnpm gate`, and passes only when the gate
turns red for the deliberate assertion inside `packages/gateway/test/e2e/handoff-client-browser.test.ts`.

---

## §5 · NFR and quality gates (light — for GLA-066 + future testarch-nfr)

These are the non-functional dimensions that the capstone and a future `testarch-nfr` pass should assert.
Numbers are targets, not hard SLOs, until a `testarch-nfr` document refines them.

| Dimension | What to measure | Target / gate |
|---|---|---|
| **Provision latency** | Wall-clock from `gla session create` submission to capsule health=up | < 8 s on `hermes-1` (process tier) |
| **Handoff open latency** | Wall-clock from `gla handoff open` to link delivered via `channel-cli` | < 2 s |
| **End-to-end flow** | Total time for Phases 0–15 in the E2E harness (excluding human think-time stub) | < 60 s on `hermes-1` |
| **Teardown completeness** | After `gla task complete`: no residual capsule processes (verified by `launcher.health()` = "down" and `ps` scan for the capsule's browser PID) | 0 orphan processes |
| **Workspace cleanup** | After `gla task complete`: ephemeral temp-profile directory deleted | 0 leftover directories |
| **Audit completeness** | `gla audit list --task $T` contains all expected event kinds in order | Events present for: `task.created`, `session.issued`, `session.opened`, `handoff.opened` ×2, `handoff.completed` ×2, `session.completed`, `task.completed`, `capability.revoked` ×N |
| **Security invariants** | All 10 invariants in §3 green | Zero failures; any S-* failure blocks GLA-066 |
| **Import boundary** | `pnpm gate:selftest` exits 0 (the bad fixture is rejected) | Always green; it is inside `vitest run` already |
| **CLI/MCP parity** | For every CLI command, the equivalent MCP tool call returns an identical result shape | Parity test in `surfaces/mcp` integration suite |

---

## Cross-references

- `docs/scenario-01-unified.html` — the authoritative sequence (Phases E,0–15) the E2E harness follows.
- `docs/architecture/baseline.md §1–§5` — package layout, boundary rules, deployment profile (process-tier default).
- `docs/architecture/kernel-contracts.md §1–§6` — entities, capability contract, ports: the shapes under contract-test.
- `docs/architecture/dependency-strategy.md §3–§4` — which adapters are in-tree vs `wpm`; seams per dependency.
- `docs/01-architecture-overview.md §6` — the security model; the invariants that MUST have tests (S-1 through S-10).
- `docs/05-cli-and-entities.md §5–§6` — the exit-code taxonomy (S-7) and the exact CLI sequence for scenario-01.
- `CONTRIBUTING.md §Quality gate` — `pnpm gate` definition; the single DoD bar.
- `backlog/` — `backlog task <id> --plain` for each GLA-### task's acceptance criteria (the per-task traceability source).
