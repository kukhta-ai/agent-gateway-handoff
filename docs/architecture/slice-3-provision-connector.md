# GLA — Slice 3: Provision + Connector (scenario-01 Phases 3–4)

> **Status:** Slice design + build note. **Satisfies the PLAN tasks GLA-022 (provision) and GLA-024
> (connector).** **Scope:** the provision→connector thread for scenario-01 Phases 3–4 — standing up the
> **live capsule** (the worker plane realizing an abstract launcher + a temp browser profile + the human
> view) as the **reversible create-saga**, and minting + returning the agent's **agent-blind connector**
> (a CDP endpoint + a `secret_ref` capability reference, never raw signing material). It builds on Slice 2's
> `SessionService.provision()` seam (stubbed there) and turns it real.
>
> This conforms to the committed spec; cross-references (`see docs/<x>`) are the source of truth and are not
> restated. Where this names a concrete package it concretizes a `baseline.md §1` layout slot, never
> overriding a goal, vocabulary, or invariant.
>
> **Reads against:** `components/{worker-plane,capsule,session-service,capability-service}.md`;
> `kernel-contracts.md` §6 (LauncherPort / WorkspacePort / AgentConnectorPort / HumanEntrypointPort /
> CapabilityPort); `docs/04 §6` (mounts at the agent uid); `docs/03 §5–§10` (Docker/process tier, noVNC,
> CDP, temp profile); `baseline.md` §3 (two-actor capsule), §5 (T2 default); `test-strategy.md` §1–§2;
> `docs/05` (`session create` / `session connector`, output shape, exit 7 conflict).

## Rule-3 note

`bmad-dev-story` (and `bmad-quick-dev`) **were loaded** (the skills activate) but cannot run unattended for
these tasks. `bmad-dev-story` SKILL.md Step 1 (`tag="sprint-status"`) reads
`{implementation_artifacts}/sprint-status.yaml` to find the next ready story and then opens a context-filled
per-story spec file; in this repo `_bmad-output/implementation-artifacts/sprint-status.yaml` and any per-story
spec file **do not exist** (the directory is empty), so the workflow hits its interactive `<ask>Choose option
[1]/[2]/[3]/[4]</ask>` HALT and cannot continue. Per `AGENTS.md` Rule-3's explicit allowance, that path was
stopped, the blocker named, and this slice was implemented **directly from the committed design set** as the
stated fallback — the same posture Slices 1–2 record. The skills actually run per task are recorded in the
build note (below) and each task's `--notes`.

---

## 1 · Provision (GLA-022/023) — the reversible create-saga

Provision is the **issue → spawn** saga: the Session service, as conductor, turns an admitted (`issued`)
session into a **live capsule** plus the agent's connector, and **moves the session `issued → active`** on
success. Every step is **reversible**: a failure midway compensates (stop the capsule, reap the workspace,
revoke the connector) and lands the session `failed` with **no orphaned capsule or workspace** (GLA-023
AC#3). It does the *coordinating*; the worker plane does the *hosting*.

### 1.1 The create-saga as a contract

`SessionService.provision(sessionId)` (the seam Slice 2 left stubbed) runs the forward saga and returns the
public provision view. The steps, each with its compensation:

| # | Forward step | Compensation on a later failure |
|---|---|---|
| 1 | **Mint the agent-connector capability** (Capability service, `mintConnector`) — an agent-blind `secret-ref`-class reference attenuated from the session/task | **Revoke** the connector capability |
| 2 | **Spawn the capsule** via the worker (`CapsuleLifecycleManager.spawn` → `LauncherPort.spawn` + `WorkspacePort.realize`, health-probe) | **Stop** the capsule + **reap** the workspace (the lifecycle manager's teardown) |
| 3 | **Attach the connector** (`AgentConnectorPort.attach`) → `{type, cdp_url, secret_ref}` | (no external effect; nothing to undo) |
| 4 | **Advance state** `issued → active` (kernel reducer) and pin the runtime handle on the session | (terminal-on-success; only reached when 1–3 held) |

On **any** step failure the saga runs the compensations **in reverse order of what already succeeded**, sets
the session `failed` (kernel reducer `issued → failed`), and rethrows the typed error. The compensation path
reuses the **same** teardown the reconciler uses (idempotent), so a compensation that itself partially fails
still converges on a clean state. The result: a saga failure leaves **no orphan capsule and no orphan
workspace** (the load-bearing GLA-023 AC#3).

`SessionService.connector(sessionId)` re-emits the connector for a **live** capsule (so a crashed agent
re-attaches its CDP client). A session with **no live capsule** is a catchable **`state.conflict` (exit 7)**,
never a crash (GLA-025 AC#4) — surfaced via the kernel error taxonomy.

The **spec stays immutable** throughout (it was deep-frozen at admission, invariant 9); provision reads it,
never mutates it.

### 1.2 The worker / spawner seam — abstract launcher + tiers + per-launcher mount capability

The worker plane (`packages/worker`, `worker-plane.md`) hides the isolation tier behind **one abstract
spawner interface** (the JupyterHub Spawner pattern) so the session/capsule code depends only on the seam — a
new launcher tier needs **no** session/capsule change (GLA-023 AC#7/#4). Four owned pieces:

- **Spawner Registry** — registers launchers by **name + tier** over the kernel `LauncherPort`. Each launcher
  declares its **mount capability** (which host mounts it realizes: file/dir, `ro`/`rw`, or `none` for a
  remote worker). The session/capsule layer resolves a launcher *by name* from the registry; it never names a
  concrete adapter. **Registering a second launcher needs no session/capsule change** (the pluggability
  proof, GLA-023 AC#4).
- **Capsule Lifecycle Manager** — drives **spawn → health-probe → stop** per session; tracks the live runtime
  handle; detects orphans. `spawn` realizes the workspace first (`WorkspacePort.realize` at the agent uid),
  then the launcher (`LauncherPort.spawn`), then health-probes (`LauncherPort.health` answers `up`); on a
  spawn or health failure it tears the partial capsule down and rethrows (no orphan).
- **Workspace Manager** — realizes the **workspace strategy** (here `browser-profile-temp`) and the agent's
  requested **mounts as the agent's own uid** with privilege-escalation off (DAC fails closed, the
  confused-deputy bound, `docs/04 §6`); honors the operator allowed-set / denylist **already enforced at
  admission**; reaps the capsule's **own ephemeral** materials at teardown (host mounts survive).
- **Cleanup Reconciler** — **idempotent, restart-safe** teardown of a terminal session: stop the capsule, reap
  the workspace, revoke the connector — safe to call repeatedly, and **a saga failure midway leaves no
  orphan** (GLA-023 AC#3). The same routine is the saga's compensation.

The **spawner seam is full-capability**: it carries everything a launcher of *any* tier needs (the resolved
spec, the agent uid, the workspace + mounts, health, stop) — so a non-process tier (Docker/T4, remote-worker)
slots in behind it with no seam change, exactly as `baseline.md §6` requires.

### 1.3 The capsule as one shared state assembled from layers (agent-uid mounts)

A capsule is **not a container** — it is the two-actor shell around one live working state (`capsule.md`,
`baseline.md §3`): **one workspace + one launcher + one-or-more HumanEntrypoints + the AgentConnector**,
assembled at provision time from **independently installed layers** (`docs/03`, `docs/04 §1`): the isolation
**runtime** (the launcher's process tier), the **browser** + its automation engine, and the **human-view**
stack. For the **process tier (T2 default)** the layers compose into a live capsule like this:

```
WorkspacePort.realize → a per-session temp browser profile dir (--user-data-dir), agent-uid mounts realized into it
        │
        ▼
LauncherPort.spawn  ──(full mode: Xvfb :N → headed Chromium DISPLAY=:N --remote-debugging-port → x11vnc → websockify+noVNC)──┐
                    └─(headless mode: headless Chromium --remote-debugging-port)──────────────────────────────────────────────┤
        │                                                                                                                      │
        ▼                                                                                                                      ▼
AgentConnectorPort.attach → { type:"cdp", cdp_url (raw webSocketDebuggerUrl), secret_ref }      HumanEntrypointPort.open → internal noVNC ws endpoint
        (the agent's continuous handle)                                                          (full mode only; the gateway proxies it in Slice 4)
```

Both interfaces sit over the **one** browser state: the agent drives it over CDP continuously; the human (in
Slice 4) reaches it over noVNC only inside a recipient-bound window. **Agent-blind on secret fields** holds by
construction — the human's keystrokes go to the site over the noVNC input path, never to the agent
(`capsule.md` invariant).

**Mounts at the agent uid (`docs/04 §6`).** The Workspace Manager realizes each agent mount into the capsule
view by running the capsule process as the **agent's own uid** with privilege-escalation off, so the kernel's
DAC enforces exactly the agent's access — a path the agent itself cannot read fails closed, with no separate
check. The allowed-set / denylist / launcher-capability gate already ran **offline at admission** (Slice 2);
the worker only *realizes*. The capsule's own ephemeral profile is destroyed at reap; host mounts and
persisted outputs live on the host and survive.

### 1.4 Operating experience — how runtime / browser / view assemble into a live capsule

From the agent's side it is one call (`gla session create` without `--dry-run`) that returns a live handle:
admission accepts → the saga mints the connector, the worker spawns the capsule, and the agent gets back
`{session_id, state:"active", capsule:{id, template}, connector:{type:"cdp", cdp_url, secret_ref}}` (exit 0).
The agent then **drives the browser over `cdp_url` with its own CDP client, not `gla`** (`docs/05 §2`). If the
agent crashes, `gla session connector <id>` re-emits the same connector for the live capsule; if the capsule
is gone, that is a clean `state.conflict` (exit 7) the agent's skill interprets, not a crash.

**Headless-vs-full mode (the dev/hermes-1 honesty).** The process launcher **auto-detects** the human-view
stack: when `Xvfb` + `x11vnc` + `websockify` are on `PATH` it runs the **full** headed+noVNC stack (the
hermes-1 target, where the `wpm` human-view bundle installs them, `baseline.md §8`); when they are absent (the
current dev env) it **degrades to headless** Chromium + CDP only, and the noVNC HumanEntrypoint is reported
**unavailable**. The **CDP connector behaves identically** in both modes, so Slice 3's connector behaviour is
tested **for real now** (headless) and the noVNC path is real in hermes-1. Detection happens **at spawn**
(probe for the binaries), so the same artifact upgrades from headless to full the moment the bundle lands —
no code change.

### 1.5 Build / observation plan

| # | Package / adapter | What it adds | Observed by (test) |
|---|---|---|---|
| 1 | `packages/worker` | Spawner Registry, Capsule Lifecycle Manager, Workspace Manager, Cleanup Reconciler — all over kernel ports | UNIT: register/resolve a launcher by name; lifecycle spawn→health→stop; **pluggability** (a 2nd stub launcher needs no session/capsule change); **idempotent reconcile leaves no orphan** |
| 2 | `adapters/launcher-process` | `LauncherPort` T2 — full (Xvfb→headed Chromium→x11vnc→websockify/noVNC) ‖ headless (Chromium+CDP), auto-detected; raw CDP endpoint; bind `127.0.0.1`; kill the process group at stop | CONTRACT (**REAL CDP**, headless): spawn → CDP answers → health up → stop kills the process + wipes the temp profile (**no orphan**, GLA-023 AC#3); **gated full noVNC** test (skips when Xvfb absent) |
| 3 | `adapters/workspace-profile` | `WorkspacePort` — per-session ephemeral profile temp dir; agent-uid mounts; **wiped at reap** | CONTRACT: realize → a real dir; reap deletes it; host mounts survive |
| 4 | `adapters/connector-cdp` | `AgentConnectorPort.attach` → `{type:"cdp", cdp_url, secret_ref}`; **agent-blind** (secret_ref is a cap ref, never raw material) | CONTRACT + **agent-blind scan**: the JSON carries `secret_ref` and **no raw secret/signing key** |
| 5 | `adapters/entrypoint-novnc` | `HumanEntrypointPort.open` → the capsule's internal noVNC ws endpoint; **unavailable in headless mode** | CONTRACT: full → a ws endpoint; headless → reports unavailable |
| 6 | `packages/capability` | `mintConnector(sessionCapToken)` → an **agent-connector** capability (attenuated; agent-blind `secret-ref` ref) | UNIT: the minted ref is a capability reference (child ⊆ parent), never raw signing material |
| 7 | `packages/session` | `provision(task, resolvedSpec)` = the reversible create-saga (mint connector → spawn → attach → `issued→active`; compensate on any failure → `failed`, no orphan); `connector(id)` re-emit, `state.conflict` (exit 7) if no live capsule | UNIT: provision moves to `active` + returns the connector; **saga compensation** (inject spawn failure → `failed`, no orphan); **conflict** on no-live-capsule |
| 8 | `surfaces/cli` | `gla session create` (no `--dry-run`) provisions + prints `{session_id, state, capsule, connector}`; `gla session connector <id>` re-emits (exit 7 if no live capsule) | INTEGRATION: a captured real provision JSON; the connector re-emit; the conflict case |
| 9 | `packages/app` | wire the **real** worker (process launcher + profile workspace + CDP connector + noVNC entrypoint) into the bridge's SessionService | INTEGRATION: end-to-end real provision through the CLI |

### 1.6 Dependencies

- **`playwright-core`** (the launcher + the CDP contract test). The Chromium browser is already present in the
  `ms-playwright` cache (`~/.cache/ms-playwright/chromium-*`); `playwright-core` provides
  `chromium.connectOverCDP()` and a resolvable browser **without** bundling a browser download. The launcher
  spawns Chromium directly via `node:child_process` (full control of the process group for clean reaping and
  CDP-port discovery) and binds only `127.0.0.1`. This is the **browser-runtime** dependency `docs/03 §7/§10`
  classifies as in-tree adapter code over a `wpm`-provided browser; in dev the cached browser stands in for
  the `wpm` bundle. **No other package depends on it** (only the launcher adapter + its test, and `app` which
  imports the launcher).
- The **isolation runtime** (process-tier deps; GLA-009), the **browser runtime** (GLA-007), and the
  **view stack** (noVNC/websockify/Xvfb; GLA-008) are the `wpm` bundles that stand the *full* mode up in
  hermes-1 (`baseline.md §8`). In dev the launcher degrades to headless and runs the CDP path for real.
- Everything else is workspace-internal (`@gla/kernel`, `@gla/worker`, `@gla/session`, `@gla/capability`, …).
  The adapters use Node builtins (`node:child_process`, `node:net`, `node:fs`, `node:os`, `node:path`) for
  process spawn, port probing, the temp profile, and reaping.

---

## 2 · Connector (GLA-024/025) — the agent's agent-blind handle

The connector is the **agent's continuous handle** to the capsule, distinct from the human entrypoint. Slice 3
mints it agent-blind and returns it from the session after provision.

- **Minted as an agent-blind ref, never a raw secret (GLA-024/025 AC#1/#2).** `CapabilityService.mintConnector`
  attenuates from the **session/task** capability into a **`secret-ref`-class** capability — an opaque handle
  (`Ref<"secret-ref">`) the agent passes around but cannot inspect or forge. The connector JSON's `secret_ref`
  is that **capability reference**; the raw CDP `cdp_url` lets the agent *drive* the browser, but **no OPERATOR
  secret / signing material** is ever in the payload. (Scanned by the agent-blind test: the connector JSON +
  the session output contain a `secret_ref` and no raw secret/key.) This is the same agent-blind invariant the
  edge upholds (`baseline.md §4`, `kernel-contracts.md §2.3`): the agent receives capability *references*,
  never raw signing material.
- **The session returns it post-provision.** `provision` returns `connector:{type:"cdp", cdp_url, secret_ref}`
  as part of the provision view; `connector(id)` re-emits it for a live capsule. The connector is **data the
  agent drives off-gla** (`docs/05 §2`), not a `gla` verb.
- **Continuously attached, distinct from the human entrypoint.** Per `capsule.md`, the AgentConnector is
  attached for the capsule's whole life; the HumanEntrypoint is opened only inside handoff windows (Slice 4).
  Slice 3 stands up the connector and (in full mode) the entrypoint, but only the connector is *returned to the
  agent*; the entrypoint is what the gateway will proxy later.

### 2.1 Operating experience

The agent never sees a raw secret on the connector. It reads `connector.cdp_url`, connects its own CDP client
(`connectOverCDP`), and drives the browser; the `secret_ref` is an opaque capability reference it can hand
back to GLA (e.g. to re-emit or to scope a later operation) but can neither read nor forge. On a crash, one
`gla session connector <id>` re-emits the same handle.

### 2.2 Build plan + the connector seam (full-capability)

The connector is the kernel `AgentConnectorPort` (`attach(runtime) → AgentConnector`). The **seam is
full-capability**: `AgentConnector` already carries `{type, cdp_url?, path?, secret_ref?}` — enough to express
a CDP handle, a filesystem-path handle, or a pure `secret_ref` handle — so a **non-browser connector adds with
no seam change** (`docs/03 §7` alternatives: a fs path, a `secret_ref`). The CDP adapter
(`adapters/connector-cdp`) reads the capsule's CDP endpoint off the runtime handle and pairs it with the
minted `secret_ref`. A later fs-path or secret-ref connector is a new adapter behind the same port — no
session/capsule change.

---

## 3 · Build & observation summary

Built bottom-up behind the kernel ports; the whole repo stays `pnpm gate`-green (`tsc -b && biome ci . &&
vitest run`). The **core proof** is the **REAL CDP** contract test (headless Chromium, runs in this dev env):
provision a session → the connector `cdp_url` answers → `connectOverCDP` → navigate a `data:`/`about:blank`
page → assert it works → `session connector` re-emits → teardown leaves **no orphan process and the temp
profile dir is deleted** (GLA-023 AC#3). The **gated full noVNC** test skips when Xvfb/x11vnc are absent and
runs in hermes-1. The **agent-blind**, **pluggability**, **conflict (exit 7)**, and **saga-compensation**
properties are asserted at the unit/contract level (the security + boundary seams).

## Deferred (Slice 4+)

Handoff windows (mint the recipient-bound grant, mount the route, deliver the link via the channel),
recipient enrollment/verify at the edge, the gateway proxy of the noVNC entrypoint, completion detection, and
teardown-on-task-complete are later slices. Slice 3 leaves the **HumanEntrypoint stood up but not yet
proxied** (the gateway is Slice 4) and the **connector returned** (the agent drives now).

## Build note — BMAD skills actually run

Per Rule-3, recorded for the evidence trail: the BMAD build skills could not run unattended (above); this
slice was implemented directly from the design set. The architect/test-design steering for the create-saga,
the worker/spawner seam, the agent-uid mount realization, the agent-blind connector, and the headless/full
mode detection is this document, grounded in the cited committed docs.

## Cross-references

- `kernel-contracts.md` — §6 LauncherPort / WorkspacePort / AgentConnectorPort / HumanEntrypointPort /
  CapabilityPort (the seams this slice fills); §1.2 the Session lifecycle (`issued → active`); §2 the
  capability classes (the connector's `secret-ref` class, agent-blind).
- `baseline.md` — §1 layout + boundary rules (session/worker depend on ports, app injects adapters), §3 the
  two-actor capsule, §5 the T2 process-tier default + permissive mounts, §6 horizontal extension (a new
  launcher tier changes no core), §8 the `wpm` bundles that stand up full mode.
- `components/{worker-plane,capsule,session-service,capability-service}.md` — the seam responsibilities this
  slice implements.
- `docs/03` §5–§10 — the process tier, noVNC + websockify, CDP, temp profile, Chromium. `docs/04 §6` — mounts
  at the agent uid. `docs/05 §2/§4` — `session create` / `session connector`, the connector as off-gla data,
  the output shape + exit 7.
- `test-strategy.md` — §1 levels, §2 the E2E harness (Phases 3–4), the package-to-level map (`worker`,
  `launcher-process`, `connector-cdp`, `workspace-profile`, `entrypoint-novnc`).
