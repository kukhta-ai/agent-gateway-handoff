# GLA — Slice 7: tear down the session and revoke everything (scenario-01 Phase 15)

> **Status:** Slice design + build note. **Satisfies the PLAN task** GLA-064 and **frames the IMPL task** GLA-065.
>
> **Scope:** the *terminal* teardown — `gla task complete` / `gla task revoke` — that closes the whole goal and
> leaves **nothing live**: no capsule process, no route, no grant, no verifying capability. This is the closing
> guarantee of scenario-01 (Phase 15). Much of the machinery already exists and is **reused, not rebuilt**:
> Slice 3's **Cleanup Reconciler** (stop the capsule, reap the workspace, no orphan) + the lifecycle `teardown`,
> and Slice 5's **close-window** path (unmount the route, revoke the grant, force-close the WS) — note that
> close-window deliberately leaves the capsule **running**; Slice 7 wires the **terminal** teardown that actually
> **stops** it. The one new mechanism is the **task-level terminal transition** that orchestrates the per-session
> teardown and performs the **single cascade revoke** (revoke the task cap → every descendant stops verifying).
>
> This conforms to the committed spec; cross-references (`see docs/<x>`) are the source of truth and are not
> restated. Where this names a concrete package it concretizes a `baseline.md §1` layout slot, never overriding a
> goal, vocabulary, or invariant.
>
> **Reads against:** `scenario-01-unified.html` Phase 15; `docs/05-cli-and-entities.md` (`task complete`/`task
> revoke`, `session revoke`); `components/{task-service,session-service,worker-plane,capability-service,route-
> controller}.md`; `docs/architecture/kernel-contracts.md` §1 (Task/Session lifecycles), §2 (the lineage cascade);
> `docs/04-capsule-assembly.md` §6 (ephemeral-vs-persisted); `slice-3-provision-connector.md` (the Cleanup
> Reconciler) and `slice-5-completion.md` (the close-window step it is distinct from).

## Rule-3 note

The BMAD dev workflow was attempted for the IMPL build (`bmad-dev-story`). It activated, but its Step 1 **requires a
BMAD story spec file** discovered from `_bmad-output/implementation-artifacts/sprint-status.yaml` (or an explicit
`--story` path); this project tracks stories as **Backlog.md tasks**, not a BMAD story set, so that file does not
exist and the workflow **HALTs** ("No ready-for-dev stories found"), prompting interactively to run `create-story`
or supply a path. It **cannot run unattended** here — the same spec-exists situation recorded for every prior slice.
Per `AGENTS.md` Rule-3's explicit allowance, that path was stopped, the blocker named, and this slice was driven
**directly from the committed design set** as the stated fallback (recorded here and in the per-task notes).

---

## §the shape of the closing guarantee — one terminal transition, three layers below it

`gla task complete <T>` is a **terminal Task transition** (`active → completed`; `task revoke` is the same to the
non-success terminal `revoked`). It is the single entry point the agent calls (`docs/05`, scenario-01 Phase 15);
everything below it is orchestration the agent never sees. The contract, top to bottom (the exact Phase-15 diagram):

```
gla task complete T
  └─ Task.complete(T)                                   [packages/task]   — TERMINAL transition
       ├─ for each session S in T.sessions:
       │     Session.teardownSession(S, "completed")    [packages/session]— TERMINAL (stops the capsule)
       │       ├─ cancel any OPEN handoff window         (reverse-of-open: force-close WS, revoke grant, unmount route)
       │       ├─ CleanupReconciler.reconcile(S)        [packages/worker] — STOP capsule + REAP workspace + revoke connector
       │       └─ Session → completed; clear the runtime handle (no live capsule)
       ├─ CapabilityPort.revoke(T.taskCapabilityRef)    [kernel]          — ONE revoke; cascade by LINEAGE
       └─ Task → completed
```

The design choice that keeps this small: **the session teardown is *delegated* (a seam), but the cascade revoke is
the Task service's *own* job.** Revoking the task cap is one call; by lineage it kills the whole subtree — there is
no need to walk and revoke each grant/connector individually (and doing so would be a parallel, drift-prone truth).

---

## §the task complete/revoke contract (GLA-064 AC#1; `components/task-service.md`)

`Task.complete(T)` / `Task.revoke(T)` are the terminal transitions (`kernel-contracts.md §1.1`: `active → completed |
revoked`, both terminal and **cascade teardown + revocation to descendant sessions/capsules**). They:

1. **drive teardown of every session under the task** — for each id in the aggregate's ordered `sessions` chain, run
   the Session service's `teardownSession` (below) to the matching disposition (`completed` for complete, `revoked`
   for revoke). Best-effort per session (one session's reap hiccupping must not strand the rest);
2. **revoke the task capability** via the kernel `CapabilityPort.revoke(taskCapabilityRef)` — see the cascade below;
3. **transition the Task** to its terminal state via the kernel reducer.

**Idempotent (GLA-065 AC#5):** completing/revoking an already-terminal task re-runs the (idempotent) session teardown
and cap revoke but does **not** re-transition (the kernel reducer rejects a terminal→terminal move; we guard on
`TASK_TERMINAL` and skip). **Abort = the same teardown to a non-success terminal state** (GLA-065 AC#6): `revoke`
shares one private `terminate(id, disposition)` with `complete` — identical work, only the terminal label differs.
A **bare task service** (the orient/propose slices, no teardown wired) rejects with `state.conflict` rather than
silently no-op (the seam is required for the terminal verbs).

---

## §the session teardown ordered contract (GLA-064 AC#2; distinct from close-window)

`Session.teardownSession(S, disposition)` is the **terminal** teardown — explicitly **distinct from close-window**
(Slice 5's `closeHandoff`, which reverses an *open window* but leaves the capsule **running** — `session-service.md`
invariant "Closing a handoff window does not kill the capsule"). Teardown **stops** the capsule. The ordered steps:

1. **Cancel any open handoff window** for the session — *reuse* the Slice-5 close path (`closeHandoff(w, "cancelled")`):
   force-close the live WS at the edge, revoke the grant, unmount the route, abort the detector watch, drop the TTL
   timer. Idempotent on an already-closed window. (Its grant also dies by the task-cap cascade below, but unmounting
   the route + force-closing the WS here means **nothing is reachable the instant teardown runs** — GLA-065 AC#3.)
2. **Stop the capsule + reap the workspace + revoke the connector** — *reuse* the worker's **Cleanup Reconciler**
   (`CleanupReconciler.reconcile(S)`, an injected `reconcile` seam): kill the capsule's process group, wipe the
   ephemeral temp profile, revoke + unbind the agent-connector cap, forget the provision bookkeeping (see the worker
   part). Idempotent + restart-safe.
3. **Transition the session terminal** (`completed` | `revoked`) and **clear the runtime handle** + any residual
   grant/route off the aggregate — so `Session.runtime` is gone (no live capsule remains on the aggregate's own view).

Each step is **best-effort + never throws**, so a task-level teardown over many sessions cannot be stranded by one
failing session; the reconciler converges any partial on a later pass. `gla session revoke <S>` is the **one-session**
variant (the same `teardownSession` to `revoked`) — it does **not** revoke the task cap, so other sessions under the
task live on (`docs/05` `session revoke`).

---

## §the capability part — one revoke, the whole subtree stops verifying (GLA-064 AC#3 / GLA-065 AC#2)

Every authorization under a task **descends from the task cap by lineage** (`kernel-contracts.md §2`,
`capability-service.md`): the session **grant** attenuates from the task cap (`slice-4b`), and the **agent-connector**
is minted as a child of the task cap (`slice-3`, Finding #1). The kernel's signed token carries the **full ancestor
lineage**, and `verify()` rejects a token if **its id OR any ancestor** is in the revocation snapshot (`hmac-signer`
`verify`: `for (const id of [p.id, ...p.lineage]) if (revocations.has(id)) return auth.revoked`). Therefore:

> **Revoking the task cap is a single call that makes every descendant capability fail `verify()` with
> `auth.revoked`** — the session grants AND the agent-connector — with no per-capability bookkeeping. This is the
> closing guarantee's enforcement: a forwarded handoff link, a stale connector token, the grant — all dead at once.

The revoke pushes the task-cap id into the replicated **revocation snapshot** the edge verifiers read (the gateway's
grant-verify is stateless and consults the same snapshot), so the edge stops honoring the grant on the next request.
This is **reuse of the existing kernel cascade** — Slice 3 already proved the connector cascades from the task cap;
Slice 7 simply pulls that one lever as the terminal step.

---

## §the worker part — capsule + workspace destroyed; ephemeral-vs-persisted; no orphan (GLA-064 AC#4; `worker-plane.md`)

The STOP-the-capsule step is the worker's **Cleanup Reconciler** (`slice-3`, already built): `reconcile(S)` →
`CapsuleLifecycleManager.teardown(S)` (stop the launcher's process group + reap the workspace) **+** revoke the
connector cap + unbind its `secret_ref` + forget the bookkeeping. Two facts it already guarantees, load-bearing here:

- **Ephemeral is destroyed; persisted survives** (`capsule.md` invariant, `docs/04 §6`). The launcher's `stop` kills
  the whole **process group** (Xvfb/x11vnc/websockify/Chromium — detached at spawn, so `-pid` SIGKILL reaps the
  group, plus the tracked side-pids), leaving **no leftover process**. The workspace `reap` does `rm -rf` on the
  capsule's **own** ephemeral temp profile dir — which removes the mount **symlinks** but never the link **targets**.
  So **host paths the agent mounted and persisted outputs survive on the host** (GLA-065 AC#4): for the process tier,
  teardown deletes only the capsule's own temp profile, never a mounted host path.
- **The reconciler confirms no orphan, and is idempotent + restart-safe** (GLA-065 AC#5). `teardown` drops the
  tracking record *first*, so a re-entrant teardown (or an orphan scan) sees the capsule gone; a partial stop/reap
  still converges. `reconcileOrphans(liveSet)` tears down any tracked capsule whose session is not in the live set —
  the backstop that catches a crash mid-teardown. Re-running `gla task complete` is a clean no-op.

### Cleanup at full capability — reconcile by STATE regardless of launcher (GLA-064 AC#9)

The reconciler routes teardown to the launcher **named in the tracked `CapsuleRecord`**, resolved by name from the
Spawner Registry — never by a per-tier branch. A capsule launched by **any** tier (process, docker, or a brand-new
`remote-worker`-tier launcher the worker has never seen) is torn down by the **same** `reconcile` routine, purely by
its recorded state. So **a new launcher tier is torn down by the same reconciler with no Slice-7 change** — the
pluggability guarantee from `slice-3` extends to teardown. (Proven by a unit test that registers a new-tier launcher
and reconciles a capsule on it identically.)

---

## §the route part — no live route remains (GLA-064 AC#5; `route-controller.md`)

A route exists **only while its window is open** (`route-controller.md` invariant). Teardown's step-1 (cancel the
open window) calls the close path, which **unmounts the route and force-closes the bound WS** at the gateway (the
gateway drops the route from its table and severs any live proxied socket — GLA-039 AC#3). After teardown the
gateway's programmed-route set no longer contains the session's route, and the bound grant is both revoked (cascade)
and force-closed — so **no live route or grant remains**, and a forwarded link hits a route that is simply not there.

---

## §operating experience — the agent and operator observe nothing live remains (GLA-064 AC#6)

- **The agent** issues `gla task complete T` and receives `{task_id, state:"completed"}` on stdout (exit 0). After
  it returns: a `gla session connector <S>` re-emit fails with `state.conflict` (no live capsule); the connector
  token no longer verifies; `gla task get T` / `gla session get S` read the terminal states. The agent's own CDP
  socket is dead (the capsule is gone). There is nothing left for the agent to drive, and nothing it can reach.
- **The operator** observes the closing guarantee structurally: a process scan finds **no leftover capsule process**
  (the process group was killed), the workspace root holds **no temp profile dir** for the session (it was wiped),
  the gateway's route table holds **no route** for it, and the revocation snapshot **contains the task cap id** (so
  the whole capability subtree is dead). The append-only audit trail records the terminal `capability.revoked` /
  session-completed events for review (`kernel-contracts.md §1.7`).

`gla task revoke T` (abort) gives the identical observable end-state, only the terminal label is `revoked`.

---

## §build & observation plan — normal completion AND abort; how no-live-state is observed (GLA-064 AC#7)

The IMPL (GLA-065) is built as: (1) `packages/task` — `complete`/`revoke` + the `TaskTeardownDeps` seam; (2)
`packages/session` — `teardownSession` + the `SessionTeardownDeps` (`reconcile`) seam; (3) `packages/worker` — no
change to the reconciler (already idempotent + launcher-agnostic); the launcher's `stop` already reaps the process
group; (4) `packages/bridge` + `surfaces/cli` — `gla task complete`/`task revoke`/`session revoke`; (5) `packages/app`
— wire the seams (the Task teardown → the SessionService's `teardownSession`; the Session teardown → the Cleanup
Reconciler), reusing the SAME reconciler the saga-compensation/close already use.

**Observation — how "no live state remains" is observed (REAL capsule, both paths):**

- **Normal completion** — provision a REAL headless-Chromium capsule (with a **mounted host file**) → open a handoff
  (route + grant) → `gla task complete T` → assert: the capsule **process is gone** (`process.kill(pid,0)` → ESRCH
  **and** the launcher health = `down`), the **temp profile dir is deleted** (the workspace-root scan finds zero),
  the **route is unmounted** (the gateway's route set no longer has it), the **grant + connector + task caps no
  longer verify** (`auth.revoked` — the cascade), the **session is `completed`**, and the **mounted host file
  SURVIVES** (ephemeral-vs-persisted). Then a **second** `gla task complete` is a clean no-op (idempotent) and an
  orphan scan reports nothing.
- **Abort** — the same provision+open, then `gla task revoke T` → the same teardown to the non-success terminal
  state (`revoked`): capsule gone, profile wiped, caps revoked, session+task `revoked`.

These are real-capsule E2E tests (gated on cached Chromium); the teardown *logic* is additionally proven by unit
tests (the task terminal + cascade, the session ordered contract + idempotency, the worker launcher-agnostic
reconcile, the CLI verbs) that run regardless of Chromium.

---

## §dependencies (GLA-064 AC#8)

Teardown introduces **no new dependency**. It reuses: the kernel `CapabilityPort.revoke` + the signed-lineage
`verify` (the cascade); the worker's Cleanup Reconciler + the process launcher's process-group `stop` (the
`browser-runtime` / `human-view` wpm bundles GLA-007/008, already classified) + the temp-profile workspace's `reap`;
the gateway/route unmount + force-close (the `edge-proxy` bundle GLA-010). All are **traditional, in-tree** seams
already wired in prior slices. No non-traditional dependency → **no new wpm-installer-package task** is required
(AC#8): the closing guarantee is pure orchestration over already-installed runtime pieces.

---

## §what remains (not this slice)

- **GLA-066** — the cold E2E capstone: the full scenario-01 (Phases E, 0–15) in one suite from a fresh checkout,
  asserting all S-1..S-10 invariants — Phase 15 (this slice's teardown) is its closing assertion.
- **wpm bundles GLA-007..011** — the installer packages (browser-runtime / human-view / isolation / edge-proxy /
  identity) for a real `hermes-1` deploy.
- **deploy to hermes-1** — GLA listening on :3000 behind the host Caddy.
