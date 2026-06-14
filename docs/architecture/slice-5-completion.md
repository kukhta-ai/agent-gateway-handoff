# GLA — Slice 5: Work agent-blind + detect completion + close the window (scenario-01 Phases 7–8)

> **Status:** Slice design + build note. **Satisfies the PLAN tasks GLA-040 (plan the human-works-agent-blind step),
> GLA-042 (plan the completion-detection step), and GLA-044 (plan the close-window-and-resume step),** and frames the
> IMPL tasks **GLA-041 / GLA-043 / GLA-045.** **Scope:** the recipient working agent-blind inside the live capsule
> (the human's keystrokes — a chosen secret — reach the site, never the agent), the capsule EMITTING a completion
> signal that the Completion service VALIDATES against the declared detector contract and NORMALIZES to an envelope
> (an out-of-contract signal is REJECTED), and the Session service CLOSING the window on a validated completion (or a
> TTL expiry) — the reverse of `openHandoff` at the same seams — returning the session to `active` with the capsule
> still running. It builds on Slice 4b's open-window saga + the live grant verify + WS proxy + force-close, Slice 3's
> live capsule + CDP connector, and the kernel's `CompletionEnvelope` + `CompletionDetectorPort` + the
> `HandoffWindow` close transitions (`open → completed | expired`).
>
> This conforms to the committed spec; cross-references (`see docs/<x>`) are the source of truth and are not
> restated. Where this names a concrete package it concretizes a `baseline.md §1` layout slot, never overriding a
> goal, vocabulary, or invariant.
>
> **Reads against:** `components/{completion-service,capsule,session-service,capability-service,route-controller}.md`;
> `kernel-contracts.md` §1 (the `CompletionEnvelope` + the handoff close transitions `open → completed | expired`),
> §6 (the `CompletionDetectorPort`); `test-strategy.md` §3 (S-2 agent-blind, S-8 out-of-contract completion
> rejected); `docs/05` (`handoff wait` returns `{status, result, next?}`, exit 6 on timeout/expiry); `docs/03 §9`
> (url-watcher); `scenario-01-unified.html` Phases 7/8.

## Rule-3 note

`bmad-dev-story` (and `bmad-quick-dev`) **were loaded** (the skills activate) but cannot run unattended for these
tasks. `bmad-dev-story` Step 1 (`tag="sprint-status"`) reads `{implementation_artifacts}/sprint-status.yaml` to find
the next ready story and open a context-filled per-story spec file; in this repo
`_bmad-output/implementation-artifacts/` is **empty** (no `sprint-status.yaml`, no per-story `*-*-*.md` spec) — work
is tracked in Backlog.md, not BMAD per-story files — so the workflow hits its interactive
`<ask>Choose option [1]/[2]/[3]/[4]</ask>` HALT and cannot continue. Per `AGENTS.md` Rule-3's explicit allowance,
that path was stopped, the blocker named, and this slice was implemented **directly from the committed design set**
as the stated fallback — the same posture Slices 1–4b record. The BMAD skills actually run per task are recorded in
the build note (below) and each task's `--notes`.

---

## §agent-blind — the recipient works inside the capsule, the agent never sees the secret (GLA-040/041)

The capsule is a two-actor shell over **one** shared state (`capsule.md`): a Human Entrypoint (noVNC) the human drives
during a window, and an Agent Connector (CDP) the agent drives outside windows. The S-2 invariant (`docs/01 §6`,
`baseline.md §2`, `test-strategy.md §3 S-2`) is that the human's input — **a chosen password, a verification code** —
reaches the **site**, never the **agent**: it never crosses into any agent-readable channel, log, completion envelope,
or audit egress.

### The capsule input path — human keystrokes reach the site, never the agent

The human's keystrokes flow **human → gateway → noVNC → browser → site** (`scenario-01-unified.html` Phase 7: "the
password reaches the site, never the agent, agent-blind"). The noVNC stream is the gateway's transparent WS conduit
(Slice 4b `§reach`): the gateway proxies bytes to the capsule's noVNC endpoint and **nothing else** — it drops client
`Cookie`/`Authorization`/`X-Forwarded-*` headers and never tees the stream anywhere agent-readable. The agent's CDP
connector is a **separate** interface onto the same browser; it receives **no** human keystroke events (CDP input
events the human generates over noVNC are X-server input to the headed browser, not CDP protocol messages — the
connector observes page state, not the human's typing). The completion envelope and the audit trail carry **no**
secret (the envelope is the detector-shaped `result` validated against the contract — a URL, not a password; the audit
detail is redacted on egress — `kernel-contracts.md §1.7`).

### Recipient UX, incl. secret entry the agent cannot observe

The recipient opens the handoff link, steps up (Slice 4b `§verify`), and reaches the live form over noVNC. They type a
password and submit; the site responds "check your email" (`/verify`). At no point is the secret exposed to the agent:
the agent is **waiting** (`gla handoff wait` blocks — Phase 7), and — see the enforcement below — its CDP connection is
**severed** for the duration of the window, so there is no agent-readable channel onto the capsule while the human is
mid-entry. The agent learns the step **completed** (the normalized envelope), never **what** was typed.

### The enforcement — broker the agent's CDP through GLA so a window can truly SEVER it

A flag consulted only at `attach` is **not** enough: it would refuse a *fresh* attach but leave the agent's
**already-open** CDP socket from Phase 4 intact — a real agent keeps that socket and reads the password field over CDP
through Phases 7-8. S-2 (a frozen GLA commitment) requires the live connection to be **cut**. So the agent's CDP is
**tunnelled through a GLA-side broker** (`adapters/connector-cdp/cdp-broker.ts`) — this resolves the `docs/05 §7`
"connector brokering" open question in favour of **tunnelling**, which is what agent-blind requires.

The broker is a tiny local forwarder (the same `node:net` raw-pipe pattern the Access Gateway's WS proxy uses,
`packages/gateway`) bound to **127.0.0.1 only** (`baseline.md §3`): it forwards the agent's CDP HTTP requests (`/json*`)
and the CDP WebSocket upgrade to Chromium's **real** `ws://127.0.0.1:<cdpPort>/...`, and **tracks every live socket per
capsule.** `attach` returns a `cdp_url` that points at the **broker**, never directly at Chromium; the agent connects
**through** GLA. Concretely (`packages/session` + `adapters/connector-cdp`):

- On `openHandoff`, the Session service calls `ConnectorControlPort.suspend(sessionId)`; the connector adapter calls
  `broker.suspend(capsule)`, which **DESTROYS every live agent↔broker socket for that capsule** (exactly like the
  gateway's `forceCloseGrant`) **and blocks new connections.** So while the human is entering a secret (Phase 7), the
  agent's **existing CDP connection is cut THIS INSTANT** — a read over it fails — and a fresh attach/`gla session
  connector` re-emit returns the (stable) brokered url but the broker refuses the connection. There is **no** live
  channel onto the capsule.
- On the window's **close** (completion or expiry), the close path calls `ConnectorControlPort.resume(sessionId)`
  (`broker.resume(capsule)`); connections are re-allowed and the agent **re-attaches onto the SAME brokered `cdp_url`**
  and drives again (Phase 8/9, reads the `/verify` page over CDP). The connector is active **outside** windows
  (Phases 4/9/14). The `cdp_url` and the `secret_ref` are **stable** across suspend/resume.

The capsule is **never** stopped by a window close — only teardown stops it (`session-service.md` invariant), so the
agent's brokered CDP resumes onto the **same** live capsule. Suspend/resume are **best-effort + idempotent**.

### Build / observation plan — the LIVE-SOCKET severance made observable

The headline S-2 proof exercises the **real threat**: a live, already-open agent CDP socket is **cut** during the
window. In `packages/app/src/completion-e2e.test.ts` (REAL, gated on Chromium): provision a real capsule → **the agent
opens a CDP client over the brokered `cdp_url` BEFORE the window (Phase 4) and reads the page** → open a window → the
agent's already-open socket is **severed** (the broker's live-socket count for the capsule drops to **0**, and a read
over **that same connection** — `apage.evaluate("document.title")` — **FAILS**) → the **"human" reaches the browser over
a separate, non-brokered interface** (CDP **direct** to Chromium, modelling noVNC, which the agent-sever leaves intact)
and submits a **known secret** to the stub site → the url-watcher fires → `gla handoff wait` returns the envelope → the
window closes → **the agent re-attaches onto the SAME brokered url and reads `/verify`** (Phase 9) → **scan every
agent-readable output** (the connector JSON, the `gla` results, the completion envelope, the events/audit surfaces, the
delivered link, all stdout/stderr) for the known secret — assert the **occurrence count is ZERO**, while the **site**
did receive it (the human path works). The **live-socket severance** is also proven deterministically at the
contract level against a stub CDP upstream (`adapters/connector-cdp/test/contract/connector-cdp.test.ts`): an agent's open
brokered socket is destroyed on `suspend` (the socket is `destroyed`, the count is 0), a fresh connection while
suspended is refused, and `resume` re-allows it.

### The input path is full-capability — any human entrypoint upholds it

The guarantee holds for **any** human-entrypoint surface (GLA-041 AC#4): the gateway proxies whatever `internalEndpoint`
the route carries, and the agent-blind input path is a property of the **two-actor capsule** (a separate human
interface over the shared state) plus the **brokered-CDP severance**, neither of which names a concrete entrypoint. A
different view surface (KasmVNC / Guacamole / Xpra — `docs/03 §6`) is a new `HumanEntrypoint` adapter behind the kernel
`HumanEntrypointPort`; **no session/connector core edit** upholds the same S-2 invariant.

---

## §detect — the capsule emits, the Completion service decides (GLA-042/043)

Completion is **mechanical detection**, not semantic judgement (`completion-service.md`): "did registration *really*
work" is the agent's cognition over the connector; the Completion service only confirms a **signal matches its declared
contract** and normalizes it.

### The capsule emits per its detectors and does NOT decide

The capsule (here, the browser) **emits** a raw signal per its declared `CompletionDetector`s; it does **not** decide
completion (GLA-043 AC#2). The reference detector is the **url-watcher** (`docs/03 §9`, `adapters/detector-url`): it
implements `CompletionDetectorPort` — it declares its typed `contract` (`complete_on` required, an optional
`intermediate`, both `^/` paths) and `watch`es the capsule's **live URL over CDP** (it reads the active page target's
URL off `http://127.0.0.1:<cdpPort>/json`, polling on a short interval). It **emits** a `RawCompletionSignal`
(`status: "url-intermediate" | "url-complete"`, a detector-shaped `result: {url, match}`) on the first match of the
declared `intermediate` (e.g. `/verify`) then the `complete_on` (e.g. `/dashboard`) — at most once per fragment, then
the watch completes. The watcher reads the **CDP port directly** (GLA-internal completion machinery — NOT through the
agent's broker), so it keeps working while the **agent's brokered CDP is severed** (S-2): detection is GLA's, not the
agent's.

### The Completion service contract — validate vs the detector contract, normalize to an envelope

The Completion service (`packages/completion`) is the checkpoint between the raw signal and a trustworthy completion:

- **`validate(rawSignal, detectorContract)`** — checks the signal's shape against the **declared detector contract**:
  the signal's `detector` matches the contract's detector; its `status` is one the contract **admits**; and (when a
  `resultSchema` is declared) its `result` conforms to that typed `config_schema` (reusing the kernel `validateConfig`
  — the same offline validator admission uses). The contract is the **allowlist-by-construction**: the trusted
  detector/template author declares which mechanical statuses are valid and how each **normalizes** to the
  caller-facing envelope.
- **`normalize(rawSignal, detectorContract)`** — maps a **valid** signal to a stable `CompletionEnvelope`
  `{status, result?, next?, detector, at}`: the contract's caller-facing `status` (`submitted` / `verified`), the
  detector-shaped `result`, the optional `next` hint, the detector name, the `at` stamp. The envelope shape is
  **stable across detectors** (`kernel-contracts.md §1.6`).
- **An out-of-contract signal is REJECTED** (S-8 / GLA-043): a spoofed status, a signal from the wrong detector, or a
  malformed result is **not** normalized — `process()` returns `{ok:false, error}` (a typed `state.conflict`), the
  window does **not** complete, and the session does **not** advance to `completed`. A spoofed "done" cannot advance
  the flow.

The Completion service makes **no semantic judgement** and **orchestrates no close** — it **informs** the Session
service (`completion-service.md`: "It does not itself close routes or revoke grants").

### The session receives + routes to close

The Session service is the conductor: it **watches** the declared detector for each open window (a fire-and-forget
`watch()` consumer) and feeds each emitted raw signal to the Completion service. On a **validated** completion it runs
the close-window step (`§close`). The mapping is data-driven: the app builds the detector contract from the session's
assembly (the url-watcher's two mechanical statuses → the scenario-01 envelope statuses — `/verify` → `submitted` +
next `email-verification`; `/dashboard` → `verified`). The **first** in-contract completion closes the window —
scenario-01 Phase 8 closes the **first** handoff on the `/verify` **intermediate** with `submitted` (the human's form
step is done; the agent reads the code next); Phase 13 closes the **second** handoff on the `/dashboard` complete with
`verified`.

### Operating experience — the agent learns the step completed without seeing the secret

The blocked `gla handoff wait` **RETURNS** the normalized envelope on a validated completion — `{status: "submitted",
next: "email-verification"}` (Phase 8) or `{status: "verified"}` (Phase 13). The agent learns the step **completed**
(and an optional **next** hint), never **what the human typed**. The envelope's `result` is a URL, not a secret.

### A non-firing detector → expiry (not a false completion)

A detector that **never** matches does **not** falsely complete (GLA-043 AC#3): the watch emits nothing, the window's
**TTL elapses**, and the window closes by **expiry** (`§close`). `gla handoff wait` then returns **exit 6**
(timeout/expiry), never a fabricated completion.

### The detector seam is full-capability

A new detector **type** (exit-code / dom-watcher / user-done — `docs/03 §9`) plugs in via the **same** seam with **no
capsule change** (GLA-043 AC#4): each is a separate `adapters/detector-*` package behind the kernel
`CompletionDetectorPort`, validated through the **same** Completion service path (the contract is passed in), wired at
`app`. The capsule/session/completion core names **none** of them; the import-boundary lint proves it.

---

## §close — completion-or-expiry → close the window, the reverse of open (GLA-044/045)

A window closes on **a validated completion** OR a **TTL expiry**; both run the **same** close-window step — the
**reverse of `openHandoff` at the same seams** (`session-service.md`, `route-controller.md`, `capability-service.md`).

### The close trigger

- **Completion:** the Session service's `deliverCompletion(windowId, signal)` validates + normalizes the raw signal
  (`§detect`); on a validated completion it records the envelope and runs the close with disposition `completed`.
- **Expiry:** the TTL timer armed at `openHandoff` fires; the Session service runs the close with disposition
  `expired`. A **non-firing** detector → expiry (GLA-043 AC#3).

### The session close-window step — unmount route + revoke grant + return to `active`, capsule running

The close path (the reverse of the open saga) runs, idempotent and best-effort to converge:

| # | Close step | The seam (reverse of open) |
|---|---|---|
| 1 | **Force-close the live WS** at the edge so the surface is unreachable immediately (GLA-039 AC#3) | Capability/Gateway `forceCloseGrant(grantId)` |
| 2 | **Revoke the grant** (a revoked grant fails the next stateless verify; cascades to descendants) | Capability `revoke(grantId)` |
| 3 | **Unmount the route** (force-closing any residual WS bound to it) | Route controller `unmount(windowId)` |
| 4 | **Resume the agent connector** (S-2: the agent itself resumes) | ConnectorControl `resume(sessionId)` |

It then transitions the window to its terminal state (`completed` | `expired`) and returns the **session to
`active`** with the **capsule still running** (GLA-044/045 AC#2/#3): the window's grant/route are cleared off the
session, but the runtime stays pinned — closing a window does **not** kill the capsule; **only teardown** stops it
(`session-service.md` invariant). **Re-open onto the same capsule still works** (the second handoff is a re-opened
window on the same runtime — Slice 4b `§open`).

### Grant no longer verifies + live connection force-closed; route no longer resolves

After the close: the grant is **revoked** (the next stateless verify at the gateway fails — `auth.revoked`); the live
WS is **force-closed** (the severed socket cannot be re-opened); the route is **unmounted** (a fresh request to the
window's path is **not** resolved — 404). The recipient link no longer reaches the capsule (the surface is reachable
**only** within an open authorized window — GLA-039 AC#2). This is exactly the inverse of what open programmed.

### Operating experience — the agent observes window-closed + itself resumed

`gla handoff wait` returns (the envelope on completion; **exit 6** on expiry). `gla handoff get`/`gla events`/`gla
audit list` reflect the close (the window `completed`/`expired`, the grant revoked — **redacted**, no secret). The
agent's connector **resumes** (`gla session connector` works again onto the same capsule), and the agent drives the
capsule over CDP (Phase 9: read the `/verify` page). The close is the reverse of open at the same seams — nothing
half-open remains.

### The route + grant + connector seams are full-capability

The close programs the **abstract** edge (`RouteGatewayPort.unmount` + `forceCloseGrant`), so a reverse-proxy
dependency (Caddy — `dependency-strategy.md §4 D5`) satisfies the **same** close with **no session/route core edit**;
grant verification stays in the Access Gateway (the PEP). A different human-entrypoint surface changes no close code
(the route carried whatever `internalEndpoint`). Only `app` imports adapters; the import-boundary lint proves the
session/completion/gateway name none.

---

## Build / observation plan (feeds GLA-041/043/045)

Built bottom-up behind the kernel ports; the whole repo stays `pnpm gate`-green (`tsc -b && biome ci . && vitest
run`). The **core proof** is the **REAL url-watcher over REAL CDP** (a real headless-Chromium capsule driven to a stub
site `/register → /verify → /dashboard`, the watcher firing on `/verify` then `/dashboard` for real) and the **REAL
completion + close + agent-blind-SEVERANCE** end-to-end test (a live agent CDP socket is **cut** during the window; the
secret scan = 0); both run in this dev env. The **noVNC** human surface needs the X stack (absent in dev), so the
real-noVNC proxy is **gated for hermes-1**, the open-window path uses a stub entrypoint, and the "human" drives the
capsule over a **non-brokered** CDP-direct interface that the agent-sever leaves intact (modelling noVNC).

| # | Package / adapter | What it adds | Observed by (test) |
|---|---|---|---|
| 1 | `adapters/detector-url` | the **url-watcher**: `CompletionDetectorPort` — declares its typed `contract`; `watch`es the capsule's live URL over CDP; **emits** a raw signal on the `intermediate` then `complete_on` match (at-most-once per fragment; capsule does not decide) | CONTRACT: declares the contract; scripted-URL fire sequence (intermediate → complete, at-most-once); **non-firing → emits nothing**; **REAL CDP**: drive a capsule `/register→/verify→/dashboard`, the watcher fires on `/verify` then `/dashboard` for real |
| 2 | `packages/completion` | the **Completion service**: `validate(rawSignal, contract)` (detector/status/result vs the declared contract) + `normalize` (→ a stable `CompletionEnvelope`) + `process` (validate-then-normalize) | UNIT: in-contract signals validate + normalize (stable envelope across detectors); **OUT-OF-CONTRACT REJECTED** (spoofed status / wrong detector / malformed result → not normalized, no envelope — S-8) |
| 3 | `packages/session` | wire **completion → close**: `deliverCompletion` (validate via the Completion port → on accept run the close-window step) + the detector **watch** per open window + the connector **sever/resume** (S-2) + carry the envelope on the view | UNIT (STUB seams): completion CLOSES (route unmounted, grant revoked, WS force-closed, session `active`, **capsule running**); **out-of-contract → window stays open**, session does not advance; **close-on-expiry** releases route+grant the same way; the connector is **severed on open, resumed on close**; a wired detector drives the close; a non-firing detector does not complete |
| 4 | `adapters/connector-cdp` (+ `cdp-broker.ts`) | broker the agent's CDP through a GLA-side `node:net` forwarder (bound 127.0.0.1) so a window can **truly SEVER** the live socket; `attach` returns the **brokered** `cdp_url`; `suspend` destroys live agent↔broker sockets + blocks new ones; `resume` re-allows | CONTRACT (stub CDP upstream): `attach` returns a brokered url (not Chromium's port); the brokered url is **stable** across suspend/resume; **suspend DESTROYS a live agent socket** (the socket is `destroyed`, live count → 0) + refuses a fresh connection; **resume** re-allows it |
| 5 | `packages/catalog` | add the url-watcher's `intermediate` param to its `config_schema` (the scenario-01 `/verify` intermediate) | INTEGRATION (admission): an assembly with `{complete_on, intermediate}` is admitted |
| 6 | `packages/bridge` + `surfaces/cli` | `gla handoff wait` **RETURNS** the normalized envelope `{status, result, next?}` on completion; **exit 6** on expiry | INTEGRATION: `handoff wait` returns `{status, result, next}` (exit 0); a timeout/expiry → exit 6; the JSON/exit contract preserved |
| 7 | `packages/app` | wire the **REAL** completion pipeline (the url-watcher + the Completion service + the connector sever/resume via the broker) into the SessionService's open-window saga; derive the detector contract + params from the assembly | INTEGRATION + **REAL completion + agent-blind SEVERANCE**: provision a real capsule → **the agent opens a live CDP client over the brokered url + reads the page** → open a window → the agent's **live socket is SEVERED** (count → 0; a read over the SAME connection FAILS) → the human (over a non-brokered interface) submits a **known secret** + reaches `/verify` → the url-watcher fires → `gla handoff wait` returns `{submitted, next}` → the window closes (route unmounted, grant revoked, **capsule running**) → **the agent RE-ATTACHES onto the SAME brokered url and reads `/verify`** → **the secret appears in ZERO agent-readable outputs** |

### A note on the grant lineage (surfaced by the first full-app handoff with a real task)

This slice is the first to run the **full app handoff with a real task capability** (Slice 4b's app test used a
stubbed session). The handoff grant **attenuates from the session's task capability** (so revoking the task cascades to
the grant — `kernel-contracts.md §2.4`). Two consequences were reconciled so the chain stays ⊆-parent:

- The grant's **scope** nests **under** the task scope: the route/grant path is `/task/<taskId>/handoff/<sessionId>`
  (the gateway proxies whatever path is mounted, so the nesting is transparent to the human/edge). A sibling
  `/handoff/<sessionId>` scope would **widen** the task's `/task/<taskId>` scope.
- The grant carries **no separate `audience` caveat**: it is session-bound via its **scope** path. A second, different
  `audience` would **widen** the exact-match audience dimension the task cap inherits from the agent-authority's
  identity. The gateway verifies the grant by **recipient + scope + class**, never `audience`, so dropping it changes
  no edge behaviour (the session-grant contract test was updated to match).

## Dependencies

- **`@gla/completion` / `@gla/detector-url` / `@gla/session` / `@gla/bridge`** are workspace-internal; the url-watcher
  reads the capsule's CDP `/json` with **only the global `fetch`**, and the **CDP broker** (`adapters/connector-cdp/
  cdp-broker.ts`) uses **only Node builtins** (`node:http`, `node:net`) — the same raw-WS-proxy pattern the gateway
  already uses, **no new runtime dependency** (the same dependency-frugality as Slices 3/4b).
- **`playwright-core` + Chromium** are the **test-only** harness for the REAL url-watcher + the REAL completion E2E
  (already present for Slices 3/4a/4b; added to `adapters/detector-url` as a **devDependency** for its REAL CDP test).
  No new runtime dependency.
- The **noVNC/websockify/Xvfb human-view stack** (`wpm` GLA-008) stands the *full* human surface up in hermes-1
  (`baseline.md §8`); in dev the open-window path uses a stub entrypoint and the human drives the capsule over a
  separate CDP connection. **No new `wpm` task is required by Slice 5.**

## Deferred (Slice 6+)

- **The second handoff (Slice 6 deltas — Phases 9–14).** Phase 8 (the first close, on the `/verify` intermediate,
  `submitted` + next) is done; Phase 9 (the agent reads `/verify` over the **resumed** connector), Phase 11 (re-open a
  **second** window on the **same** capsule — already supported by the re-open saga), Phase 12 (the human enters the
  code; **auth reused** — no re-prompt within the credential TTL), and Phase 13 (the **second** close, on the
  `/dashboard` complete, `verified`) are the second-handoff thread. The close-on-`/dashboard`-complete path and the
  `verified` envelope are already built and unit-proven; Slice 6 drives the **two-handoff** sequence end to end (auth
  reuse + the second completion).
- **Teardown (Slice 7 — Phase 15).** `gla task complete` tears the capsule down (stop + reap), revokes the grant +
  connector + task capabilities (the lineage cascade), and asserts no orphan process / no leftover temp profile
  (`test-strategy.md §5`). The close-window step leaves the capsule **running** by design; teardown is the separate,
  terminal stop.
- **The agent-blind secret-entry flow (a `secret_ref` the human fills).** This slice proves the input-path invariant
  (keystrokes reach the site, never the agent) and the brokered-CDP **severance** enforcement; a future surface where
  the human fills a GLA-injected `secret_ref` (Vault/tmpfs injection — `kernel-contracts.md §6 SecretStorePort`) is a
  later delta.

## Build note — BMAD skills actually run

Per Rule-3, recorded for the evidence trail: the BMAD build skills could not run unattended (above); this slice was
implemented directly from the design set. The architect/test-design steering for the agent-blind input-path invariant
+ the brokered-CDP **severance** enforcement (tunnel the agent's CDP through GLA so a window cuts the live socket), the
url-watcher emitting per detectors (capsule does not decide), the Completion service's validate-vs-contract + normalize
(out-of-contract rejected), the session's completion-or-expiry close (reverse-of-open at the same seams, capsule
running), the `handoff wait` envelope return, and the REAL-CDP url-watcher + REAL completion + live-socket-severance +
agent-blind-scan observation plan is this document, grounded in the cited committed docs.

## Cross-references

- `kernel-contracts.md` — §1.6 the `CompletionEnvelope` (stable across detectors; out-of-contract rejected); §1.3 the
  `HandoffWindow` close transitions (`open → completed | expired`); §1.2 the session returns to `active` on a window
  close (the capsule lives on); §2.4 the lineage-revocation cascade; §6 the `CompletionDetectorPort` (emits a raw
  signal the Completion service validates) + `HumanEntrypointPort` (agent-blind input path) + `ChannelPort`.
- `baseline.md` — §1 layout + boundary rules (session/completion depend on ports, app injects adapters), §2 the
  agent-blind invariant, §6 horizontal extension (a new detector / surface changes no core).
- `components/{completion-service,capsule,session-service,capability-service,route-controller}.md` — the seam
  responsibilities this slice implements.
- `test-strategy.md` — §3 S-2 (the secret-scan agent-blind invariant) + S-8 (out-of-contract completion rejected);
  §1.2 the package-to-level map (`completion` UNIT, `detector-url` CONTRACT).
- `docs/03 §9` — the url-watcher (+ user-done) detector. `docs/05 §3/§4/§5` — `handoff wait` returns `{status, result,
  next?}` + exit 6. `scenario-01-unified.html` — Phases 7/8 (the human works agent-blind, completion-1 closes the
  first window).
- `slice-4b-handoff.md` — the open-window saga + the grant verify + WS proxy + force-close this slice reverses.
