# GLA — Architecture Baseline (GLA-001)

> **Status:** Build-baseline. **Scope:** the one architectural shape every later task conforms to.
> This is the *realization* layer for THIS build (TypeScript/Node 22, modular monolith). It **conforms to**
> the committed spec — it does not redesign it. The spec is fixed; cross-references (`see docs/<x>`) are the
> source of truth, and where this doc names a concrete package or tool it is *concretizing* an "open to
> refinement" detail, never overriding a goal, user-problem, vocabulary, or invariant.
>
> **Reading order assumed:** `docs/01-architecture-overview.md` (north star), then `docs/00`, `02`, `03`,
> `04`, `05`, `docs/actors-and-personas.md`, `docs/components/*`, `docs/scenario-01-unified.html`.

## How this baseline was produced (Rule-3 note)

The BMAD `bmad-create-architecture` skill **was invoked** (it is available to this subagent and loaded), but
its workflow is an **interactive, human-in-the-loop facilitator**: step-01-init declares "NEVER generate
content without user input … YOU ARE A FACILITATOR, not a content generator", gates on a `<critical>` "confirm
with the user" step, and hard-stops without a PRD. It **cannot run unattended** in this subagent context. Per
`AGENTS.md` Rule 3's explicit allowance, that path was stopped, the blocker named, and this artifact was driven
**from the committed design set** as the stated fallback. The full Rule-3 evidence is in the task handoff.

**Load-bearing build decisions** folded in here (already decided; integrated, not relitigated): TS/Node 22;
pnpm-workspaces modular monolith; quality gate `tsc --noEmit` + `biome ci .` (incl. import-boundary lint) +
`vitest run`; Playwright for E2E and as the CDP driver; **Capsule Launcher default = local-process tier (T2)**
with Docker (T4) a registered alternative; **AuthProvider default = in-tree WebAuthn** (`@simplewebauthn/server`),
authentik the heavyweight alternative; **Channel default = Telegram + a local/CLI fallback**; deploy target =
GLA on `:3000` inside LXD `hermes-1`, fronted by host Caddy at `https://57.131.31.126/`.

---

## §1 · Macro decomposition — the modular monolith (AC #1)

One deployable Node process; **strict internal seams** enforced by a Biome import-boundary rule (not a service
mesh). Three rings: a **narrow stable core**, **adapters/providers** behind ports, and **edges**. The hourglass
waist is the core (`see docs/01 §3.1, §7`). Horizontal growth happens only in the adapter ring (§6).

### Workspace / package layout (pnpm workspaces)

```
gla/                         # repo root: pnpm-workspace.yaml, tsconfig base, biome.json (boundary rule), vitest
├─ packages/
│  ├─ kernel/                # CORE · pure domain: entities, ports (interfaces), error taxonomy, caveat model
│  ├─ task/                  # CORE · Task aggregate + state machine                  (docs/components/task-service.md)
│  ├─ session/              # CORE · Session aggregate + issue→mount→spawn saga      (session-service.md)
│  ├─ capability/           # CORE · mint/attenuate/verify/revoke; revocation cache  (capability-service.md)
│  ├─ route/                # CORE · Route controller (program/unmount/reconcile)    (route-controller.md)
│  ├─ completion/           # CORE · validate signal vs detector contract; normalize (completion-service.md)
│  ├─ audit/                # CORE · append-only trail, indexed by task, egress-redacted (cross-cutting, docs/01 §4)
│  ├─ admission/            # CORE-adjacent · mutate→validate pipeline; policy PORT   (admission-and-policy.md)
│  ├─ catalog/              # CORE-adjacent · Store→Ingester→Index; registry of all families (catalog.md, docs/02)
│  ├─ identity/             # CORE-adjacent · UserIdentity, RecipientBinding, auth_strength; AuthProvider PORT (identity-and-auth.md)
│  ├─ worker/              # CORE-adjacent · Spawner Registry, Lifecycle, Workspace, Cleanup; Launcher PORT (worker-plane.md)
│  ├─ gateway/             # EDGE(core-owned) · Access Gateway: stateless verify + proxy (access-gateway.md)
│  ├─ bridge/              # EDGE · Agent Bridge core: routes ops → admission/task/session, serves read-models (agent-bridge.md)
│  ├─ assembly/            # SHARED · AssemblySpec schema + resolver (template overlay → resolved spec) (docs/04)
│  └─ app/                 # COMPOSITION ROOT · wires ports→adapters, boots the :3000 process, the only place adapters are imported
├─ adapters/                # ADAPTER/PROVIDER ring — each registers against a kernel PORT; core never imports these
│  ├─ policy-cedar/         # in-tree Cedar (forbid-wins) behind the policy port      (docs/03 §11, GLA-006)
│  ├─ auth-webauthn/        # DEFAULT AuthProvider · @simplewebauthn/server in-tree   (docs/03 §4)
│  ├─ auth-authentik/       # ALT AuthProvider · managed IdP behind same seam        (alternative)
│  ├─ launcher-process/     # DEFAULT Launcher · local-process T2 (Playwright Chromium + Xvfb/x11vnc/websockify) (docs/03 §5, §6)
│  ├─ launcher-docker/      # ALT Launcher · container T4                             (alternative)
│  ├─ entrypoint-novnc/     # HumanEntrypoint · noVNC stream                          (docs/03 §6)
│  ├─ connector-cdp/        # AgentConnector · CDP via Playwright                     (docs/03 §7)
│  ├─ workspace-profile/    # Workspace · browser-profile-temp (ephemeral)           (docs/03 §8)
│  ├─ detector-url/         # CompletionDetector · url-watcher (+ user-done)          (docs/03 §9)
│  ├─ channel-telegram/     # DEFAULT ChannelAdapter · Telegram Bot + Mini App       (docs/03 §2)
│  └─ channel-cli/          # FALLBACK ChannelAdapter · local/CLI for headless tests  (docs/03 §2)
├─ surfaces/
│  ├─ cli/                  # EDGE · `gla` command tree over bridge core             (docs/05)
│  └─ mcp/                  # EDGE · MCP server over bridge core — PARITY with cli    (docs/01 §3.11, docs/05)
└─ wpm/                      # the installer PROJECT (bundles) — NOT a runtime package (docs/01 §8; see §8 below)
```

### Boundary rules (the seams the import-lint enforces)

| Ring | Packages | May import | May **not** import |
|---|---|---|---|
| **Core** | kernel, task, session, capability, route, completion, audit | kernel + each other via kernel ports | any `adapters/**`, `surfaces/**`, concrete deps (cedar, playwright, telegraf, …) |
| **Core-adjacent** | admission, catalog, identity, worker, assembly | core + kernel ports | concrete adapters (they hold the *ports*; impls are injected) |
| **Edge** | gateway, bridge, surfaces/cli, surfaces/mcp | core, assembly | adapters directly (wire via `app`) |
| **Adapter/Provider** | everything under `adapters/**` | kernel ports + the one dep it wraps | other adapters; core internals |
| **Composition root** | `app` | everything | — (sole place adapters meet ports; `new CedarPolicy()` lives here, injected inward) |

**Core vs adapter/provider vs edge — the classification.** *Core* = the six narrow-waist concerns the spec
freezes (`Task, Session, Capability, Route, Completion, Audit`) plus the things they act on (`Recipient`,
`Capsule`) — pure domain, zero third-party imports (`GLA-004 AC#7`). *Core-adjacent* = traditional GLA code
that owns a **port** but no concrete dependency (admission, catalog, identity, worker, assembly). *Adapter/
provider* = a concrete dependency behind a port, each a self-registering family member (`docs/02`). *Edge* =
the only entry points (Agent Bridge MCP+CLI, Channel adapters, Access Gateway, read-only Doctor/probe).
`why pnpm:` workspace protocol + strict `node_modules` hoisting makes the package graph the boundary, so a
forbidden cross-ring import fails install/typecheck, not just lint — the strongest cheap enforcement.

---

## §2 · Cognition-vs-enforcement invariant (AC #2)

**Invariant: the agent is untrusted at every enforcement seam.** Cognition (understanding what the user wants)
lives entirely in the agent and its skills; enforcement (what is *safe/allowed*) lives entirely in code that
assumes the agent is hostile (`see docs/01 §2–§3, docs/04 §5, docs/actors-and-personas.md`). The seam is drawn
at install-time by a trusted author, never negotiated at runtime.

| Decision | **Agent decides (cognition)** | **Code enforces (enforcement seam)** | Enforcing component |
|---|---|---|---|
| What the capsule is for | intent, target site, success URL | — (opaque label only) | task/session |
| Which parts | picks providers *by capability* | must be **registered + `available`** | catalog · admission |
| Provider options | sets values within `config_schema` | rejects anything off the typed schema, **offline** | admission (validate) |
| Template fields | fills *open* params only | overriding a *fixed* field = reject (not silent) | admission (mutate→validate) |
| Authorization | presents a capability | verifies signature + caveats; child ⊆ parent | capability · gateway |
| Recipient | passes through binding (narrow-only) | recipient caveat enforced every request/upgrade | gateway · identity |
| Secrets | references a `secret_ref` | raw value never enters agent space; redaction on egress | capability · audit · worker |
| Host mounts | which path, which mode (`ro`/`rw`) | runs as **agent's own uid**, priv-esc off (DAC fails closed); allowed-set + denylist + launcher cap | worker · admission |
| Completion | judges *semantic* success over connector | validates only the *mechanical* signal vs contract | completion |
| Policy | — | Cedar forbid-wins, deterministic, order-independent | admission/policy-cedar |

**Three rejections that prove the line:** a missing completion detector is a *reject*, not an inferred guess
(`admission-and-policy.md`); a "done" signal that doesn't match its declared contract cannot advance the flow
(`completion-service.md`); a mount path the agent itself can't read fails closed at spawn, with no separate
check for admission to get right (`worker-plane.md`). The Agent Bridge **grants nothing and enforces nothing on
its own** — it is a thin transport over server-side admission/policy/capability (`docs/05 §1`).

---

## §3 · The two-actor capsule (AC #3)

Two completely separate doors meeting at exactly one object (`see docs/01 §2, docs/components/capsule.md`).

```
AGENT  ──(unprivileged)──▶  Agent Bridge (MCP + CLI, parity)  ──▶  Control plane ──┐
                                                                                    ├─▶  CAPSULE
HUMAN  ──(taps link)─────▶  Access Gateway (SOLE public entry) ───────────────────┘   one workspace +
                            (stateless macaroon verify + proxy)                        one launcher +
                                                                                       1..N HumanEntrypoints +
                                                                                       AgentConnector(s)
```

- **Agent door = Agent Bridge** (`bridge` + `surfaces/{cli,mcp}`): the agent is *unprivileged* — never the
  Docker socket, the gateway admin API, or raw secrets; it gets capability references and structured results.
  It directs which of its **own** host paths to mount (its own authority), never reaching GLA-blind resources.
- **Human door = Access Gateway** (`gateway`): the **only** publicly reachable surface; every public request
  transits it and passes capability+policy verification on every request and WS upgrade. In `hermes-1`, host
  **Caddy** is the TLS edge in *front* of this — Caddy terminates TLS at `https://57.131.31.126/` and proxies
  to GLA's own Access Gateway logic on `:3000`; the Access Gateway remains the authorization PEP (Caddy is
  transport, GLA is the membrane). Nothing else is bound publicly (a Doctor probe asserts the Bridge is never
  on `0.0.0.0` — `identity-and-auth.md`).
- **They meet at one capsule** (`worker` + adapters): a capsule is *not* a container — a container is one way
  to isolate one. AgentConnector attached continuously; HumanEntrypoint opened only inside recipient-bound
  handoff windows. One capsule per session; a session may re-open its window many times (scenario-01's two
  handoffs are one capsule, two windows).

---

## §4 · Capability as the single authorization primitive (AC #4)

One primitive everywhere: a **signed bearer credential with HMAC-chained caveats**, minted/verified/revoked
only in `capability` (`see docs/01 §6, docs/components/capability-service.md`). One verifier shape, distributed
verification, central revocation. **The kernel models the caveat/attenuation contract independently of any
signing mechanism** (so the macaroon library is an adapter detail — `GLA-002 AC#2`).

**The six classes** (one shape): `agent-authority` (root, anchored at the Bridge) · `task` (parent =
agent-authority) · `session`/**grant** (recipient-bound, short TTL) · `secret-ref` (agent-blind) ·
`channel-delegation` (outbound sends) · `operator-discharge` (single-use, authorizes one-time enrollment).

**System-wide invariants (frozen):**
- **Recipient-bound grants** — a grant carries a recipient *caveat* (not a convention); the Access Gateway
  enforces it on every request and WS upgrade, and force-closes WebSockets on revoke. A forwarded link is
  useless in another's hands.
- **Agent-blind secrets** — the agent receives only a `secret_ref`; the raw value never enters chat, prompts,
  transcripts, logs, evidence, or the agent's address space; redaction scanners guard every egress; secrets
  flow `tmpfs`/injected-at-boundary and are **never mountable by request** (the confused-deputy line, `docs/04 §6`).
- **Attenuation only** — a child capability can never be broader than its parent.
- **Stateless edge verification** — the gateway verifies cryptographically with no DB round-trip in the common
  path; revocation rides a small replicated cache pushed from `capability`.

---

## §5 · Deployment-profile model (AC #5)

A profile selects **which enforcement seams are load-bearing**. The MVP target is the **local single-operator
reference** on LXD `hermes-1` (operator = agent-owner = recipient may be one person). Seams are pluggable,
profile-selected (`see docs/01 §7 ownership modes, identity-and-auth.md "Authenticating the agent", docs/04 §6`).

| Enforcement seam | Local single-operator (MVP) | Strict / multi-tenant (deferred) |
|---|---|---|
| Access Gateway grant verify (recipient caveat, TTL, scope) | **LOAD-BEARING** — the whole guarantee for the remote human | load-bearing |
| Recipient WebAuthn step-up at the edge | **LOAD-BEARING** — in-tree WebAuthn (`@simplewebauthn/server`) | load-bearing (may be authentik) |
| Agent-blind secret_ref + redaction | **LOAD-BEARING** | load-bearing |
| Cedar policy (forbid-wins) in admission | **LOAD-BEARING** (minimal policy set) | load-bearing (rich policy) |
| Capsule isolation tier | **T2 local-process** (the reliable default; Docker storage driver is broken in `hermes-1`) | T4 container / T5 remote-worker |
| Host-mount allowed-set | **permissive (up to `*`)** — operator's own machine; denylist seatbelt on (Docker socket, `~/.ssh`, GLA state dir) | **narrowed**; recipient-scoping turns on |
| **Agent authentication** | **DEFERRED** — replaced by *verified* Bridge network isolation (doctor probe: not on `0.0.0.0`); one agent, trusted by position | **REQUIRED** — mTLS/signed token (multi-agent, network-reachable Bridge, per-agent attribution, hostile co-tenant) |
| Surface-to-surface isolation within a capsule | **DEFERRED** — accepted footprint cost for single-operator | reconsider |
| Reconcilers | **one cleanup reconciler** (+ route-consistency, already kept) | add orphan-detection on a demonstrated failure |

**Why T2 is the MVP default (not Docker):** `hermes-1` is an LXD container with a broken nested-Docker storage
driver, so the **local-process tier is the reliable default**; Docker (T4) is a *registered alternative*
launcher, honoring `docs/01 §9` "start with two spawner tiers (local-process and container)". The agent-blind
input path and uid-scoped mounts hold identically on T2.

---

## §6 · Horizontal-extension principle (AC #6)

**Adding a capability = registering a new provider/dependency against an existing seam, changing no core code**
(`see docs/01 §7, docs/02`). The narrow waist (§1) is precisely what makes this possible; the system grows by
adding adapters at the edges, never by editing the core.

```
new dependency/provider  ──▶  ships a self-describing manifest (identity, capability, config_schema,
                               requires, probe, skills, relations)  ──▶  Catalog Ingester
   (mutate → validate → register code with its family registry → run contract test + probe →
    register skills → index with SYSTEM-DERIVED availability)  ──▶  visible & usable everywhere
   registry-driven (CLI, admission, assembly, worker, doctor, skills) with ZERO core change.
```

- **Mechanically:** a `Launcher` registers with the Spawner Registry, a `ChannelAdapter` with the channel
  registry, an `AuthProvider` behind the auth port — all the same path (the capsule runtime is *not* special-
  cased; `docs/02 §7`). In this repo a new provider is a new `adapters/<name>/` package implementing a kernel
  port + a catalog manifest; `app` injects it; **no `packages/*` core edit**.
- **Two clocks:** the **operator** extends at install-time (trusted, writes the registry via `wpm`); the
  **untrusted agent** only *consumes* the registry at runtime (reads, never registers) — `docs/02 §2`.
- **Availability is system-derived**, never author-declared: a provider whose probe fails is `unavailable`, so
  admission rejects assemblies needing it.
- **The MVP proves the property, not the API.** A *public* plugin API stays deferred until ≥2 real providers
  exist per family (`docs/01 §9`, `docs/02 §9`); the seams are internal. The two registered launchers
  (process default + docker alt) and two channels (telegram + cli) are the first horizontal extensions and the
  living proof.

---

## §7 · Build-order plan (AC #7)

The 66 `GLA-###` tasks form **one epic** delivering scenario-01. Pattern in the backlog: each scenario step is
a **plan** task (even id) then an **impl** task (odd id); plan tasks depend on the contracts (`GLA-002`), impl
tasks on the kernel (`GLA-004`) + their host dependencies. The capstone `GLA-066` depends on every impl step.
This plan **agrees with `backlog sequence list`** (verified) — it is that graph, grouped into waves.

| Wave | What | Tasks (backlog ids) | Gated by |
|---|---|---|---|
| **0 · Architecture** | this baseline — fix the shape | `GLA-001` | — |
| **1 · Foundation plan** | kernel/contracts plan · scaffold+quality gate · dependency strategy | `GLA-002`, `GLA-003`, `GLA-005` | 001 |
| **2 · Foundation build + deps** | implement kernel · the 5 `wpm` packages (browser-runtime, human-view, isolation, edge-proxy, identity) | `GLA-004` (←002,003); `GLA-007..011` (←005) | wave 1 |
| **3 · Cedar + horizontal plans** | Cedar integration · all per-step **plan** tasks | `GLA-006` (←004,005); even plans `GLA-012,014,…,064` (←002) | wave 2 (plans need only 002) |
| **4 · Per-step build** | each scenario step implemented behind real modules, in dependency order | odd impls `GLA-013,015,…,065` (←004 + their deps + their plan) | per-task deps |
| **5 · E2E capstone** | the full scenario-01 thread cold, through real modules | `GLA-066` (←013,015,017,019,021,023,025,027,033,035,039,041,043,045,065) | wave 4 |

**Valid order in one line:** `001 → {002,003,005} → {004, 007–011} → {006, all even plan tasks} → all odd
impl tasks (in backlog sequence order, each after its plan + kernel + host-dep) → 066`.

The per-step impl ordering follows the scenario thread (enroll → connect → orient → propose → admit → provision
→ connector → drive → open-window → verify-at-edge → reach-capsule → work-agent-blind → detect → close/resume →
re-open deltas → tear-down) exactly as the `Sequence 4..16` blocks list; the second-handoff "delta" tasks
(`GLA-046..065`) reuse the same capsule and only add the re-open/reuse-auth behavior.

---

## §8 · Operating experience (AC #8)

Designed at the level of *how it feels*, not the mechanism (`see docs/05` for the agent surface; `docs/01 §8`
+ `actors-and-personas.md` for the operator path).

### The agent's `gla` ergonomics (and MCP parity)

**Agents-first, humans-welcome** (`docs/05 §1`): JSON by default (text only at a TTY); **no interactive
prompts** — a needed human step is a *handoff* (a first-class primitive), never a terminal prompt; **agent-blind
at the interface** (secrets never on argv, only `secret_ref` printed); **errors carry a recovery pointer** —
`{code, message, detail, skill, retryable}`, stable namespaced `code`, the `skill` field names the skill to
load (cognition stays in the agent). Resource-oriented noun-verb tree, every command 1:1 with an MCP tool /
read with an MCP resource (**parity is an invariant**). The seven nouns the agent touches: `task`, `session`,
`handoff`, `template`, `skill`, `event/audit`, `identity/whoami`. The compose loop is **introspect → `--set`/
`-f` → `--dry-run` → submit** against typed schemas (allowlist-by-construction). Scenario-01 in one breath:

```
gla whoami → gla template show browser-handoff → gla skill show browser-handoff
gla session create -f assembly.json --dry-run → … (drop --dry-run) → connector{cdp_url,secret_ref}
[drive over CDP, not gla] → gla handoff open → gla handoff wait → … (2nd window) → gla task complete
```

### The operator's setup path (the `wpm` bundle-project)

The operator never hand-installs; their **agent** runs the `wpm` project (an agent-native installer — "intent +
verification" beats fixed steps because every host is unknown). It offers each bundle's human-readable
`summary`, derives `requires` silently, previews a plan for consent, and works the backlogs. **The rule:** if it
runs as a long-lived process inside GLA it is GLA code; if it touches the operator's host or wires their agent
it is a `wpm` bundle (`docs/01 §8`). The MVP bundle-project for scenario-01:

| Bundle | Stands up | Maps to GLA task |
|---|---|---|
| **gla-core** | the control plane, worker plane, Access Gateway (the `:3000` process) | scaffold/kernel (`GLA-003/004`) |
| **browser-runtime** | Chromium + Playwright on the host | `GLA-007` |
| **human-view stack** | noVNC + websockify + VNC server + Xvfb | `GLA-008` |
| **isolation runtime** | the capsule isolation runtime (process tier deps; container as alt) | `GLA-009` |
| **edge-proxy** | the reverse proxy (Caddy) in front of `hermes-1` | `GLA-010` |
| **identity-provider** | the WebAuthn/passkey provider service | `GLA-011` |
| **telegram-channel** | register the bot, wire the adapter | (channel adapter, in-tree remote-external) |

Each provider bundle carries only parts (3) **dependency standup** and (4) **skill/wiring placement**; parts (1)
**catalog entity** and (2) **adapter code** live in the GLA repo (`docs/01 §8`). A nice property: once
`gla-core` + a channel are up, *later* provider bundles can hand off **through GLA itself** for their own
OAuth/password steps. Maintenance (add-a-provider, update, repair, uninstall) is `wpm`'s per-bundle re-entry;
GLA keeps only a thin read-only **doctor/probe** + **binding-ingest** (`docs/01 §8` — "nothing in GLA's runtime
knows how to install anything").

---

## §9 · Tensions surfaced (spec vs build decisions)

These are recorded for the orchestrator to surface; none is decided here. **No spec goal/vocabulary/invariant is
changed** — each is an "open to refinement" realization choice that *leans away from the reference slice's
default*, which the spec explicitly allows as a provider choice.

1. **Capsule isolation default: process-tier (T2), not Docker.** `docs/03 §1/§5` names **Docker** as the
   reference-slice launcher and the components doc says "start with `local-process` and `container`". The build
   decision makes **local-process (T2) the *default*** and Docker (T4) the registered *alternative*, because
   `hermes-1`'s nested-Docker storage driver is broken. This is consistent with the spec's pluralism (swap =
   install a different `Launcher`, no core change) and with `docs/01 §9` ("start with two spawner tiers"), but
   it **inverts which tier is the reference default** — worth an explicit operator sign-off.
2. **AuthProvider default: in-tree WebAuthn, not authentik.** `docs/03 §4` makes the reference "WebAuthn/
   passkeys **verified through authentik**". The build decision makes **in-tree `@simplewebauthn/server`** the
   default and authentik the heavyweight alternative behind the same `AuthProvider` seam. Same seam, lighter
   default — but it **moves the reference IdP** off a standalone service, so the "owned as `wpm` package + in-
   tree adapter" line in `docs/03 §4` becomes "in-tree adapter is itself the verifier for the default" (the
   `wpm` identity-provider bundle, `GLA-011`, then only applies when authentik/OIDC is selected). Flagging so
   the spec's reference wording and `GLA-011`'s scope can be reconciled.
3. **Caddy as host TLS edge *in front of* the Access Gateway.** `docs/03 §3` casts Caddy as *the* public edge
   that "verifies the grant at the edge". In `hermes-1` the **host's Caddy** is the TLS terminator at
   `57.131.31.126` and **GLA's Access Gateway** remains the grant-verifying PEP on `:3000` behind it. This is a
   layering refinement (transport edge vs authorization edge), not a contradiction — grant verification stays
   in GLA per `docs/01 §5/§6` — but since `docs/03 §3` phrases Caddy as the verifier, the split is worth
   stating so no one expects Caddy to hold capability logic.

No other tension found: the core entities, the two-actor capsule, agent-assembles/GLA-validates, recipient-
bound grants, agent-blind secrets, the single public gateway, capabilities-as-one-primitive, catalog-as-typed-
config, stateless edge verification, the five ownership modes, and the GLA↔`wpm` boundary are all carried
unchanged.
