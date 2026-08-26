# GLA — Slice 4b: The Handoff (scenario-01 Phases 5–6, plus 8/11/12/13)

> **Status:** Slice design + build note. **Satisfies the PLAN tasks GLA-032 (plan the open-a-recipient-bound-window
> step), GLA-034 (plan the user-authenticates-at-the-edge step), and GLA-038 (plan the verified-human-reaches-the-
> capsule step),** and frames the IMPL tasks **GLA-033 / GLA-035 / GLA-039.** **Scope:** the handoff itself — open a
> recipient-bound window onto a live capsule (mint the short-TTL single-recipient grant, program a grant-bound route,
> deliver the link), verify the bound recipient at the edge (stateless grant verify + WebAuthn step-up against the
> credential Slice 4a enrolled), and let the verified human reach the capsule's noVNC surface (proxy the authorized
> WS, and nothing else; force-close on revoke/expiry). It builds on Slice 3's live capsule + connector, Slice 4a's
> Access Gateway + the enrolled credential, and the kernel's `HandoffWindow` lifecycle + the recipient-bound
> `session` grant class.
>
> This conforms to the committed spec; cross-references (`see docs/<x>`) are the source of truth and are not
> restated. Where this names a concrete package it concretizes a `baseline.md §1` layout slot, never overriding a
> goal, vocabulary, or invariant.
>
> **Reads against:** `components/{access-gateway,route-controller,session-service,capability-service,identity-and-
> auth,capsule,channel-adapter}.md`; `kernel-contracts.md` §1 (HandoffWindow lifecycle `open→completed|expired|
> cancelled`), §2 (the recipient-bound `session`/grant caveat class, attenuation, stateless verify), §6 (ports);
> `docs/05` (`handoff open|wait|get|list|cancel`, output shape, exit codes); `slice-4a-enrollment.md` (the gateway +
> the stored credential it builds on); `dependency-strategy.md §4 D5` (edge-proxy = Caddy, GLA-010 — transport, not
> the PEP); `scenario-01-unified.html` Phases 5/6/8/11/12.

## Rule-3 note

`bmad-dev-story` (and `bmad-quick-dev`) **were loaded** (the skills activate) but cannot run unattended for these
tasks. `bmad-dev-story` SKILL.md Step 1 (`tag="sprint-status"`) reads `{implementation_artifacts}/sprint-status.yaml`
to find the next ready story and then opens a context-filled per-story spec file; in this repo
`_bmad-output/implementation-artifacts/` is **empty** (no `sprint-status.yaml`, no per-story `*-*-*.md` spec), so the
workflow hits its interactive `<ask>Choose option [1]/[2]/[3]/[4]</ask>` HALT and cannot continue. Per `AGENTS.md`
Rule-3's explicit allowance, that path was stopped, the blocker named, and this slice was implemented **directly from
the committed design set** as the stated fallback — the same posture Slices 1–4a record. The skills actually run per
task are recorded in the build note (below) and each task's `--notes`.

---

## §open — open a recipient-bound window onto the capsule (GLA-032/033)

A handoff is the **act of exposing a live capsule to one human, briefly** (`kernel-contracts.md §1.3`, `capsule.md`:
"the human entrypoint is opened only inside recipient-bound handoff windows"). The Session service, as conductor,
runs the **ordered, reversible open-window saga** — the inverse of the provision saga — and surfaces the window to
the agent as its own noun.

### The bridge handoff-open contract

`gla handoff open --session <id> [--reason --recipient --ttl]` (`docs/05 §3`) → `{handoff_id, link, recipient,
expires_at}`. The agent references the window by id and may **open it repeatedly** (the second handoff in scenario-01
is a re-opened window on the **same** capsule, not a new session — GLA-032 AC#8). `handoff get/list` read window
state; `handoff wait` blocks (the long-poll — `§verify`); `handoff cancel` closes early.

### The session open-window saga — reversible on close/failure

`SessionService.openHandoff(sessionId, {recipient, reason, ttl})` runs three ordered forward steps, each with its
compensation (run in reverse on a later failure), and creates the `HandoffWindow` (`open`), advancing the session
`active → opened`:

| # | Forward step | Compensation on a later failure |
|---|---|---|
| 1 | **Mint the recipient-bound grant** (Capability, `mintSessionGrant`) — short TTL, single-recipient caveat, scoped to the session/capsule, **attenuated from the session/task capability** | **Force-close** the grant at the edge + **revoke** it |
| 2 | **Program the grant-bound route** (Route controller, `program`) to the capsule's human entrypoint — a programming failure throws and leaves **no partial route** | **Unmount** the route (force-closing any residual WS) |
| 3 | **Deliver the link** to **exactly** the bound recipient (Channel) | (the channel is the last step; a delivery failure compensates 2 then 1) |

On **any** step failure the saga compensates in reverse, **leaves the session back at `active`** with no window, no
grant, no route, no link, and rethrows the typed error (a retry starts clean — GLA-033 AC#4 is "no partial route";
this generalizes it to "no partial window"). The window exposes the capsule's human entrypoint **only while open**
(GLA-033 AC#2): the session is `opened` only between `openHandoff` and the window's close; closing returns it to
`active` (closing a window does **not** kill the capsule — only teardown stops it, `session-service.md` invariant).
The TTL timer wheel arms on open; on expiry it revokes the grant, force-closes the WS, unmounts the route, and marks
the window `expired`.

### The short-TTL single-recipient grant — never widened by the request

`CapabilityService.mintSessionGrant` produces a **`session`-class** capability (`kernel-contracts.md §2.1`) carrying
a `recipient` caveat (the single-recipient bind — a forwarded link is useless in another's hands), a short `ttl`
(default 15m), a `scope` caveat narrowed to `/handoff/<sessionId>`, and an `audience` caveat naming the session. It
is **attenuated from the session/task capability token** via the kernel's `attenuate` (reject-or-narrow): the added
caveats can only **tighten** the parent — a request can never widen the recipient (re-target), extend the TTL past
the parent, or widen the scope (the kernel throws `auth.attenuation_widened`). The grant descends by lineage, so
revoking the parent (the session/task cap) **cascades** to the grant at the next stateless verify.

### The Route controller programming a grant-bound route + reconcile

`RouteController.program(window, grantId, capsuleEntrypoint, path)` mounts a route on the **abstract edge** bound to
exactly that grant; `unmount(windowId)` removes it and force-closes any live WS; `reconcile(openWindowIds)`
converges the edge's routes to the Session service's truth (one of the few reconcilers the design keeps —
`route-controller.md`). A **programming failure → a typed error with NO partial route** (GLA-033 AC#4): on an edge
`mount` failure the controller best-effort rolls back and rethrows `dependency.unavailable`, leaving the gateway with
no route for the window.

### The gateway as the sole public entry — no agent path

The agent has **NO path through the gateway** (`baseline.md §3`, `docs/01 §2`): the agent enters on the Bridge
(unprivileged); the human enters on the Access Gateway (the only public door). The open-window saga is driven from
the agent's `handoff open`, but what it programs is the **human's** route. The gateway never accepts an agent
request.

### Channel delivery to the bound recipient

The channel adapter delivers the recipient-bound link to **exactly** the bound recipient (`channel-adapter.md`:
"Handoff links are delivered only to the bound recipient"; the adapter **never widens the binding**). The link is
`http(s)://<gateway>/handoff/<sessionId>?grant=<token>` — it carries the grant, and the grant's `recipient` caveat
means even if the link leaks, the gateway refuses it for anyone but the bound recipient (the binding is enforced at
step-up — `§verify`).

### Recipient UX — including forwarded / expired link

The recipient receives one channel message: "Open the secure session shared with you:" + a link (a Telegram Mini-App
button in hermes-1, a plain link on CLI/email). Tapping it opens the gateway's step-up page (`§verify`). A
**forwarded** link in someone else's hands fails the recipient binding at step-up (the assertion is checked against
the bound recipient's credential — a different person has no matching passkey). An **expired** or **revoked** link
renders a plain, stable refusal — "This link is invalid, has expired, or you are not the intended recipient." — never
a stack trace, never a partial reach.

### First-open + re-open onto the same capsule

The first handoff (scenario-01 Phase 5) opens a window onto the freshly-provisioned capsule. After it closes (Phase
8: completion → unmount → revoke → session `active`), the agent works over the connector (Phase 9), then **re-opens**
a second window (Phase 11) onto the **same** capsule — a new grant + a new route + a new window, the same runtime, no
re-spawn (GLA-032 AC#8). The session is the unit of one capsule's lifecycle; multiple human pauses are re-opened
windows, not extra sessions.

### Deps

The **edge-proxy** is the reverse-proxy dependency the Route controller programs (`dependency-strategy.md §4 D5`):
**Caddy** in hermes-1 (the `wpm` task **GLA-010**), **Local-External** (the host's Caddy is the TLS terminator at the
public edge). Caddy is **transport**; **grant verification stays in GLA's Access Gateway** (the authorization PEP) —
a different proxy changes no authorization. The route + grant **seams are full-capability** (`§full-capability`).

---

## §verify — verify the bound recipient at the edge (GLA-034/035)

The gateway is the human's **policy-enforcement point** (`access-gateway.md`): every request and every WS upgrade
verifies the grant cryptographically and requires the bound identity before forwarding. Authentication is
**delegated** to the provider; the gateway **decides**.

### The gateway entry contract — verify grant + require bound identity before forwarding

On a handoff link request (`GET /handoff/<id>?grant=…`) and on a WS upgrade, the gateway: (1) **verifies the grant
statelessly** — signature, `recipient` caveat, `ttl`, `scope` vs the route path, and the revocation snapshot for self
**and every ancestor** — no DB round-trip in the common path (`kernel-contracts.md §2.3`); (2) **requires the bound
identity** — if the recipient's provider-neutral auth assurance is insufficient for the selected deployment policy,
it triggers step-up through the configured Auth Provider. Only after both pass does it forward (`§reach`). **No public path bypasses grant verification** (the no-bypass invariant Slice 4a
established for enrollment, generalized to handoff).

### Identity+Auth verification against the enrolled credential; auth-strength; delegated to the provider

Step-up reuses Slice 4a's `authenticationOptions` + `verifyAuthentication` against the **credential the recipient
enrolled in Phase E** (`identity-and-auth.md`, `slice-4a-enrollment.md §2`). The gateway triggers it; **Identity+Auth
runs the ceremony** through the `AuthProviderPort` (in-tree WebAuthn by default) and reports **facts** — `{ ok,
auth_strength }` plus common assurance evidence, never an allow/deny. The gateway holds the **decision**: the
default `phishing-resistant` policy demands passkey-grade assurance, while `password-permitted` explicitly admits
password-grade evidence; a verified assertion that satisfies the selected policy **authorizes the grant** (a small
per-grant marker — the one piece of mutable edge state the step-up needs, consulted like the revocation cache), so
the next WS upgrade for that grant is forwarded.

### Stateless edge verify — only the bound recipient passes

The grant verify is the kernel's **pure** `verify()` against the pushed revocation snapshot. **Only the bound
recipient passes** (GLA-035 AC#2/#3): an **absent** grant → refused (`usage.bad_argument`); a **wrong-recipient**
grant → refused (`auth.recipient_mismatch`, enforced because the step-up assertion is checked against the recipient
**read from the signed grant** — a tampered recipient breaks the HMAC first); an **expired** grant → refused
(`auth.expired`); a **revoked** grant (or a revoked ancestor) → refused (`auth.revoked`). A refused request **resolves
onward to nothing** — the connection is closed, the capsule never reached.

### The route resolves a verified request to the entrypoint; unverified/expired does not

A verified, in-window, authorized request is resolved to the route's `internalEndpoint` (the capsule's human
entrypoint) and proxied (`§reach`). An **unverified, expired, or un-authorized** request is **not** — it is refused
at the edge and the route resolves to nothing. The route exists **only while its window is open** (`route-
controller.md` invariant): an unmounted route returns 404 (the surface is not reachable outside an open window —
GLA-039 AC#2).

### Recipient auth UX — including un-enrolled / failed

The step-up page shows a single "Verify with passkey" button; tapping it runs `navigator.credentials.get` against the
enrolled credential, and on success opens the secure session. An **un-enrolled** bound recipient (no stored
credential) gets a **catchable refusal** — "This recipient is not enrolled. Ask the operator to enroll first." — a
plain page, **not a crash** (GLA-035 AC#4; a recipient is verifiable only if enrolled). A **failed** assertion (wrong
passkey, cancelled ceremony) leaves the page on "Verification was not completed — try again," the grant **not**
authorized, the capsule **not** reached.

### The auth seam is full-capability

The gateway depends on the kernel `AuthProviderPort` (via Identity+Auth), never on a concrete provider — swapping the
IdP (authentik / OIDC) is a new `adapters/auth-<x>/` package + an `app` wire change, **no gateway/session core edit**
(GLA-035 AC#5; the same swap-IdP property Slice 4a proved, now exercised at the handoff edge). `app` injects the
WebAuthn provider; the import-boundary lint proves the gateway names no adapter.

---

## §reach — the verified human reaches the capsule surface (GLA-038/039)

Once verified, the human reaches **one** surface: the capsule's noVNC human entrypoint, and **nothing else**.

### Verified in-window request proxied to the human entrypoint and nothing else

On an **authorized** WS upgrade (grant verified + the bound recipient stepped up), the gateway **proxies the
WebSocket to the capsule's noVNC endpoint and nothing else** (GLA-038/039 AC#1): it opens a raw TCP connection to the
`internalEndpoint`, replays **only the WS-handshake-relevant headers** (Host set to the upstream, Upgrade, Connection,
`Sec-WebSocket-*` — dropping client `Cookie`/`Authorization`/`X-Forwarded-*`/other hop-by-hop headers so the
capsule-internal endpoint never sees untrusted client headers), and pipes bytes bidirectionally — a transparent
conduit to the noVNC stream. There is no arbitrary-proxy target: only a **mounted route's** path is reachable, and
only to that route's `internalEndpoint`. **Bounded fd lifetime:** the upstream dial carries a **connect timeout** (a
stalled/unreachable capsule endpoint is abandoned → the client upgrade refused 502, no fd pinned waiting on
`connect`), and both proxied sockets carry an **idle timeout** that refreshes on every byte (a stream that stalls
mid-flight is force-closed and untracked, while a live stream is never killed); both are configurable with sane
defaults (~10s connect / ~120s idle). **Agent-blind on secret fields** holds by construction — the human's keystrokes
(a chosen password, a verification code) flow over the noVNC input path to the site, never to the agent
(`capsule.md` invariant).

### The entrypoint exposed only within an open authorized window

The surface is reachable **only within an open authorized window** (GLA-039 AC#2): outside an open window the route
is unmounted (404); inside an open window but without a completed step-up the upgrade is refused (401). The window's
lifecycle (`open → completed | expired | cancelled`) gates reachability end to end.

### Revoke/expire severs the live connection

On grant **revoke** or window **expiry/cancel**, the gateway **force-closes the live WS** so the surface is no longer
reachable (GLA-039 AC#3): the Session service's close path calls the edge's `forceCloseGrant(grantId)` (which destroys
every live socket bound to the grant and drops its auth marker), then revokes the grant and unmounts the route. A
revoked grant fails the next stateless verify; the severed socket cannot be re-opened.

### The entrypoint seam is full-capability

A different view surface (KasmVNC, Guacamole, Xpra — `docs/03`) is a new `HumanEntrypoint` adapter behind the kernel
`HumanEntrypointPort`; the gateway proxies whatever `internalEndpoint` the route carries, so **a different surface
changes no gateway code** (GLA-039 AC#4; the route + grant + entrypoint seams are full-capability — `baseline.md
§6`). Only `app` imports adapters; the structural import-boundary lint proves the session/gateway name none.

---

## Build / observation plan (feeds GLA-033/035/039)

Built bottom-up behind the kernel ports; the whole repo stays `pnpm gate`-green (`tsc -b && biome ci . && vitest
run`). The **core proof** is the **REAL WebAuthn step-up** virtual-authenticator test (registration in Phase E →
`openHandoff` → `navigator.credentials.get` against the enrolled credential → the grant authorized → the authorized
WS proxied), which runs in this dev env. The **noVNC** surface needs the X stack (absent in dev), so the **real-noVNC
proxy is gated for hermes-1** and the proxy logic is **proven against a stub WS upstream** in dev.

| # | Package / adapter | What it adds | Observed by (test) |
|---|---|---|---|
| 1 | `packages/capability` | `mintSessionGrant` (recipient-bound, short-TTL, session-scoped, **attenuated** from the task cap) + `verifySessionGrant{,Token}` (stateless edge verify) | UNIT: the grant is recipient-bound + short-TTL + scope ⊆ session; it **cannot be widened by the request** (wrong recipient / wider scope / longer TTL → `auth.attenuation_widened`); verify passes only the bound recipient; **negatives** (wrong-recipient / expired / revoked / parent-revoked / wrong-class / wrong-scope / forged) each refused with the right stable reason |
| 2 | `packages/route` | the **Route controller**: `program` / `unmount` / `reconcile` over an **abstract** `RouteGatewayPort` | UNIT: program → reachable; unmount → unreachable + WS force-closed; a **programming failure → typed error + NO partial route**; reconcile converges the edge to Session truth; **the edge seam is abstract** (a 2nd gateway needs no controller change) |
| 3 | `packages/gateway` | extend the Access Gateway: **`RouteGatewayPort`** (mount/unmount/force-close) + the handoff page + `POST /handoff/auth/options\|verify` (grant-verify → step-up decision) + the **WS-upgrade proxy** (raw `node:net`, no `ws` dep; **header-stripped** handshake + **connect/idle timeouts**) | CONTRACT (REAL `node:http` server + a STUB WS UPSTREAM): the page is served only on a valid grant; **negatives** (absent/expired/revoked/wrong-recipient/un-enrolled) each refused; the step-up verify decision (ok + sufficient strength → authorize; else refuse); an **authorized** WS upgrade is **proxied** (bytes flow both ways); an un-authorized/expired/revoked/wrong-recipient upgrade is **refused** (resolves to nothing); **unmount/revoke force-closes** the live WS and the surface 404s; a **stalled upstream is reaped** (idle timeout) + a **non-completing dial 502s** (connect timeout) with **no fd leak**, while a live stream is not killed |
| 4 | `packages/session` | `openHandoff` (the reversible open-window saga) + `cancelHandoff` / `completeHandoff` / `handoffGet/List` + the TTL wheel | UNIT (STUB seams): the saga mints → programs → delivers, window `open`, session `active→opened`; **reversible** (route/delivery/mint failure → compensate, NO partial, session back to `active`); **re-open onto the same capsule**; cancel/expiry close-out (revoke + force-close + unmount) |
| 5 | `adapters/channel-cli` | reuse `deliver` for the recipient-bound handoff link | INTEGRATION: the link is delivered to **exactly** the bound recipient (binding not widened) |
| 6 | `packages/bridge` + `surfaces/cli` | `gla handoff open\|wait\|get\|list\|cancel` — JSON/exit contract; `wait` blocks + the **exit-6** timeout re-label | INTEGRATION: a captured real `handoff open` JSON; `wait` returns / times out (exit 6); get/list/cancel; usage errors (exit 2) |
| 7 | `packages/app` | wire the **REAL** handoff pipeline (Access Gateway + Route controller + identity step-up + channel) into the SessionService's open-window saga | INTEGRATION + **REAL WebAuthn step-up**: enroll → openHandoff → step-up against the enrolled credential → the authorized WS proxied to a stub upstream; **negatives** (forged/wrong-recipient refused; **revoke force-closes** the live WS) |

## Dependencies

- **`@gla/route` / `@gla/gateway` / `@gla/capability` / `@gla/session`** are workspace-internal; the gateway's WS
  proxy uses **only Node builtins** (`node:http`, `node:net`, `node:crypto`) — **no `ws` dependency added** (the
  gateway already speaks raw `node:http`; the noVNC stream is a raw WebSocket a TCP-level conduit proxies). This is
  the same dependency-frugality as Slice 4a's gateway.
- **`playwright-core` + Chromium** are the **test-only** harness for the REAL WebAuthn step-up (already present for
  Slices 3/4a). No new runtime dependency.
- The **edge-proxy** (Caddy, `wpm` GLA-010) and the **noVNC/websockify/Xvfb human-view stack** (`wpm` GLA-008) are the
  bundles that stand the *full* edge + surface up in hermes-1 (`baseline.md §8`); in dev the gateway proxies to a stub
  WS upstream and the real-noVNC test is gated. **No new `wpm` task is required by Slice 4b** (GLA-008/010 already
  exist in the backlog).

## Deferred (Slice 5+)

Completion detection makes `handoff wait` **RETURN a completion envelope** (the Completion service validates the
human's done-signal and normalizes it) and **closes the window** (`completeHandoff` is wired now; Slice 5 drives it
from the detector); the agent-blind input path is proven (keystrokes reach the site, never the agent), but the
**agent-blind secret-entry** flow (a `secret_ref` the human fills) is a later surface. Slice 4b leaves the window
saga, the grant verify + step-up, the WS proxy, and the force-close-on-revoke in place for Slice 5 to drive from
completion.

## Build note — BMAD skills actually run

Per Rule-3, recorded for the evidence trail: the BMAD build skills could not run unattended (above); this slice was
implemented directly from the design set. The architect/test-design steering for the open-window saga, the
recipient-bound never-widened grant, the route controller programming an abstract edge, the gateway's stateless grant
verify + WebAuthn step-up + WS proxy, the channel delivery, and the REAL-WebAuthn + stub-upstream observation plan is
this document, grounded in the cited committed docs.

## Cross-references

- `kernel-contracts.md` — §1.3 the HandoffWindow lifecycle (`open→completed|expired|cancelled`); §2.1 the `session`
  grant class (recipient/ttl/scope/net-confine); §2.2 attenuation (child ⊆ parent, never widened); §2.3/§2.4 stateless
  edge verify + the revocation snapshot; §6 the ports (CapabilityPort / AuthProviderPort / HumanEntrypointPort /
  ChannelPort) and §7 the enrollment/verify model the step-up reuses.
- `baseline.md` — §1 layout + boundary rules (session/gateway depend on ports, app injects adapters), §3 the two-actor
  capsule (the gateway is the sole public entry; the agent has no path), §6 horizontal extension (a new proxy /
  surface / IdP changes no core), §8 the `wpm` bundles (edge-proxy GLA-010, human-view GLA-008).
- `components/{access-gateway,route-controller,session-service,capability-service,identity-and-auth,capsule,channel-
  adapter}.md` — the seam responsibilities this slice implements.
- `dependency-strategy.md` — §4 D5 (Caddy edge-proxy = GLA-010, transport not the PEP), D2 (the human-view stack =
  GLA-008).
- `slice-3-provision-connector.md` — the live capsule + connector this slice opens a window onto.
- `slice-4a-enrollment.md` — the Access Gateway HTTP server + the stored credential the step-up verifies against.
- `docs/05 §3/§4/§5` — `handoff open|wait|get|list|cancel`, the output shape, the exit codes (incl. the wait exit-6
  timeout). `scenario-01-unified.html` — Phases 5/6/8/11/12/13 (the two handoffs).
