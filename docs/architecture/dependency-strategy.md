# GLA — Dependency & Ownership Strategy (GLA-005)

> **Status:** Classification artifact (the basis for the dependency tasks GLA-006–011). **Scope:** enumerate
> every external piece the scenario-01 slice needs, classify each by the ownership rule, name the in-tree
> candidate or the `wpm` package, map the five ownership modes for the reference profile, and state the seam
> each plugs into so an alternative can later replace it with **no core change**.
>
> **This is classification, not integration.** It installs/integrates nothing (that is GLA-006–011 and the
> per-step build). It conforms to the fixed spec (`docs/02`, `docs/03`, `docs/01 §7–§8`) and the realization
> choices in `docs/architecture/baseline.md`; cross-references are the source of truth and are not restated.

## How this was produced (Rule-3 note)

Same as the companion artifact: the BMAD architect persona (`bmad-agent-architect`) **was invoked** and is
available, but it activates as an **interactive menu-driven persona** ("Stop and wait for input") dispatching
into the human-in-the-loop `bmad-create-architecture` workflow — it **cannot run unattended**. Per `AGENTS.md`
Rule 3's explicit allowance, that path was stopped, the blocker named, and this artifact was driven **from the
committed design set** as the stated fallback.

---

## §1 · Dependency vs Provider — the two concepts (do not conflate)

`see docs/01 §7, docs/02 §6`. Two things register the same way and must stay distinct:

- A **Dependency** is *external software/resource* (Caddy, the isolation runtime, Chromium, noVNC, a WebAuthn
  IdP, Telegram). It carries a **binding**, a **health/probe**, and an **ownership mode**.
- A **Provider** is the *GLA-side adapter* (in-tree code) that integrates a dependency in a **role/seam**
  (`LauncherPort`, `HumanEntrypointPort`, `AuthProviderPort`, `ChannelPort`, …).

One dependency can back several provider roles; one role can be backed by several dependencies. This document is
about the **dependencies**; the seams they plug into (the ports) are fixed in `kernel-contracts.md §6`.

---

## §2 · The ownership rule, and the two integration paths (AC #2)

**The rule (`docs/01 §8`):** *if it runs as a long-lived process inside the GLA deployment, GLA owns it as
traditional in-tree code; if it has to touch the operator's specific host or wire into the operator's specific
agent, `wpm` owns it as an instruction bundle.* The runtime half is pre-testable and identical on every install
→ code. The setup half is unknowable in advance and differs per host → a backlog the operator's agent reasons
over.

So every dependency lands on exactly one of two paths — **never an inline, hand-run install** (AC #4):

| Path | When | Artifact |
|---|---|---|
| **In-tree adapter** (traditional code) | long-lived code inside the GLA process; talks to a remote service or an embedded library | a provider package under `adapters/**` behind its port |
| **`wpm` installer bundle** | stands software up on the operator host (binaries, services, system packages) | a Backlog.md bundle (detect → setup → verify → record) that writes a `DependencyBinding` |

A single provider (e.g. browser-handoff) splits across the line: parts **(1) catalog entity + (2) adapter code**
are in the GLA repo (traditional); parts **(3) dependency standup + (4) skill/wiring placement** are a `wpm`
bundle (`docs/01 §8`). The line falls between (2) and (3) — at the GLA process boundary.

---

## §3 · Enumeration of the scenario-01 dependencies (AC #1)

Every external piece the slice needs, **including the capsule's separate layers** — the capsule is assembled
from independent local layers at provision time, **not one prebuilt image** (`docs/03 §1, docs/04 §1`). The
control protocol (CDP) and the browser+automation are distinct layers; the human-view stack is a third.

| # | Dependency | What it is | Capsule layer? |
|---|---|---|---|
| D1 | **Chromium + Playwright** | the browser being acted on + its automation/CDP engine | yes — *browser + automation* layer |
| D2 | **noVNC + websockify + VNC server + Xvfb (+ x11vnc)** | the human-view stack (live browser in the user's tab) | yes — *human-view* layer |
| D3 | **CDP (Chrome DevTools Protocol)** | the agent's control protocol/handle to the capsule | yes — *control protocol* layer (rides on D1) |
| D4 | **Isolation runtime** (process-tier deps default; container runtime as alt) | runs & isolates the capsule | the capsule's *runtime substrate* |
| D5 | **Caddy** | the public edge / TLS terminator in front of the host | no (edge) |
| D6 | **WebAuthn verifier** (`@simplewebauthn/server` default; authentik/OIDC alt) | proves the recipient at the edge | no (identity) |
| D7 | **Telegram** (Bot API + Mini App) | reaches & receives the human | no (channel) |
| D8 | **Cedar** | deterministic forbid-wins policy, embedded in admission | no (core, in-tree library) |

(The macaroon/HMAC signer behind the Capability service is in-tree library code too, behind the capability
adapter — not a host dependency; noted for completeness, not a scenario-01 host piece.)

---

## §4 · Classification, candidate, mode, seam — per dependency (AC #2, #3, #4, #5, #6)

For each: the **ownership-rule classification** (with justification), the **concrete current candidate** (in-tree
ones), the **`wpm` task** (host-touching ones), the **five ownership modes mapped for the reference profile**,
and the **seam** it plugs into.

### Ownership-mode legend (`docs/01 §7, docs/02 §6`)
`Managed` (GLA/`wpm` installs & owns lifecycle) · `Local-External` (operator-run, same host, adopted) ·
`Remote-External` (operator-run elsewhere, connection-only) · `Manual-BYO` (operator wires by hand via a guided
pause) · `Disabled` (capability off). For each dependency the **bold** mode is the **reference-profile default**;
the others are the supported settings the same dependency can take.

---

**D1 · Chromium + Playwright** — *browser + automation layer*
- **Classification:** host-touching (a browser binary + driver installed on the operator host) → **`wpm`
  bundle**. Justification: not a long-lived GLA process; it is software stood up on the host that the launcher
  then drives.
- **Candidate:** Chromium (CDP-first; pairs with the connector). Driven by **Playwright** (also GLA's E2E + CDP
  driver, `baseline.md`).
- **`wpm` task:** **GLA-007** (browser-runtime). Browser + automation are stood up together so D1 and D3 arrive
  as one package.
- **Modes (reference):** **Managed** (the `wpm` browser-runtime bundle installs it). Local-External if already
  on the host; Remote-External n/a (must be local to the capsule); Manual-BYO via guided pause; Disabled if a
  non-browser capsule is used.
- **Seam:** the browser is template-bundled; its automation surfaces as **`AgentConnectorPort` (CDP)** for the
  agent and underlies the **`LauncherPort`** spawn.

**D2 · noVNC + websockify + VNC server + Xvfb (+ x11vnc)** — *human-view layer*
- **Classification:** host-touching (services + a virtual display on the host) → **`wpm` bundle**. Justification:
  a stack of host processes, distinct from the browser and the connector.
- **Candidate:** **noVNC + websockify** over a VNC server on **Xvfb** (most portable, browser-native remote
  view); `x11vnc` exposes the Xvfb display in the process tier. Alternatives: KasmVNC, Guacamole, Xpra.
- **`wpm` task:** **GLA-008** (human-view stack).
- **Modes (reference):** **Managed**. Local-External if present; Remote-External n/a (must reach the capsule's
  display locally); Manual-BYO via pause; Disabled for non-visual entrypoints (a form/doc surface).
- **Seam:** **`HumanEntrypointPort`** (the browser-stream entrypoint). Whatever fills it, the **agent-blind input
  path** is upheld (human keystrokes reach the site, never the agent).

**D3 · CDP (control protocol)** — *control protocol layer*
- **Classification:** **in-tree adapter** (it is a protocol the GLA connector code speaks; the engine that
  serves it, Playwright/Chromium, arrives via D1's `wpm` package). Justification: no separate host install — the
  long-lived code is the connector inside the GLA process.
- **Candidate:** **CDP driven by Playwright**; the in-tree adapter is `connector-cdp`. Alternatives: a filesystem
  path or a `secret_ref` connector for non-browser capsules.
- **`wpm` task:** none of its own — provisioned with D1 (browser-runtime, GLA-007).
- **Modes (reference):** inherits D1's binding; the *adapter* is always present (in-tree). Effectively
  **Managed** via D1.
- **Seam:** **`AgentConnectorPort`**.

**D4 · Isolation runtime** — *capsule runtime substrate*
- **Classification:** host-touching (a runtime/daemon or process-tier facilities on the host) → **`wpm`
  bundle**. Justification: it isolates capsule processes on the operator host; not a GLA process.
- **Candidate / decision:** the **default is the local-process tier (T2)** — Playwright Chromium under Xvfb,
  isolated by OS process/uid boundaries — because `hermes-1`'s nested-Docker storage driver is broken
  (`baseline.md §5, §9.1`). **Docker (T4)** is a **registered alternative** launcher (the spec's reference
  slice; `docs/03 §5`). Other alts: Podman, rootless, Firecracker, remote-worker.
- **`wpm` task:** **GLA-009** (capsule isolation runtime) — installs the chosen tier's host facilities (process-
  tier deps by default; the container runtime when the Docker launcher is selected).
- **Modes (reference):** for the **process-tier default**, the isolation facilities are **Local-External**
  (OS-provided on the host, adopted) and the worker uses them directly; if the **Docker alt** is selected the
  runtime is **Managed/Local-External** depending on whether `wpm` installs or adopts it. Remote-External =
  remote-worker launcher; Manual-BYO via pause; Disabled = the `none` tier (T0).
- **Seam:** **`LauncherPort`** (the Spawner Registry). Each launcher declares its **mount capability**; a
  launcher that cannot share the host accepts no mounts and the agent falls back to GLA-mediated transfer.

**D5 · Caddy** — *public edge*
- **Classification:** host-touching (a reverse proxy in front of the host) → **`wpm` bundle**. Justification: it
  runs as a host service fronting the deployment, not inside the GLA process.
- **Candidate:** **Caddy** (automatic HTTPS, small config surface). Alts: nginx, Traefik. In `hermes-1` the
  **host's Caddy** is the **TLS terminator at `https://203.0.113.10/`**, proxying to GLA's own Access Gateway on
  `:3000`; **grant verification stays in GLA's Access Gateway** (Caddy is transport, GLA is the authorization
  PEP — `baseline.md §3, §9.3`).
- **`wpm` task:** **GLA-010** (edge-proxy).
- **Modes (reference):** **Local-External** in `hermes-1` (the host already runs Caddy as its TLS edge; GLA
  adopts it and the Route controller programs grant-bound routes onto it). Managed when `wpm` stands a proxy up
  fresh; Remote-External if the proxy is elsewhere; Manual-BYO via pause; Disabled n/a (the public entry is
  required).
- **Seam:** the **reverse-proxy dependency** programmed by the **Route controller**; GLA's **Access Gateway**
  (`gateway` package) verifies grants regardless of which proxy fills it.

**D6 · WebAuthn verifier** — *identity/auth*
- **Classification:** **split by the chosen provider.** The **default in-tree WebAuthn** (`@simplewebauthn/
  server`) is **in-tree adapter** code (a library inside the GLA process — no host service). The **heavyweight
  alternative** (authentik / a standalone IdP) is host-touching → a **`wpm` bundle**. Justification: a library
  verifier is long-lived GLA code; a standalone IdP service is host standup.
- **Candidate:** **`@simplewebauthn/server`** in-tree (default; `baseline.md §5, §9.2`); authentik or generic
  OIDC as the managed alternative; Authelia as another alt.
- **`wpm` task:** **GLA-011** (identity provider) — **applies when the standalone IdP (authentik/OIDC) is
  selected**; for the in-tree-WebAuthn default it stands up only what the library needs on the host (e.g. RP
  config), not a separate IdP service.
- **Modes (reference):** for the **in-tree default**, effectively **Managed** as part of `gla-core` (the verifier
  is library code; the credential store is GLA's). For the **authentik alt**: Managed (if `wpm` installs it),
  Local-External (adopt an existing IdP), Remote-External (a hosted IdP, connection-only), Manual-BYO, or
  Disabled (the gateway-identity-only profile).
- **Seam:** **`AuthProviderPort`** (behind Identity + Auth). Auth strength/provider changes without touching the
  gateway.

**D7 · Telegram (Bot API + Mini App)** — *delivery/channel*
- **Classification:** **in-tree adapter** talking to a **remote service** → no host install, so it is **in-tree
  code** (remote-external ownership), folded into the inbound step, **not** a `wpm` package. Justification: the
  long-lived code is the adapter inside the GLA process; Telegram itself is a remote SaaS, not host software.
- **Candidate:** the Telegram Bot API + Mini App, behind the in-tree `channel-telegram` adapter; a **local/CLI
  channel** (`channel-cli`) is the **fallback for headless testing** (`baseline.md`). Alts: Slack, Email.
- **`wpm` task:** none — there is no host dependency to install. (The `telegram-channel` *wiring* — registering
  the bot token, placing skills — is a thin `wpm` concern at install time, but it stands up **no host
  software**; classified remote-external per `docs/03 §2`.)
- **Modes (reference):** **Remote-External** (Telegram is reached over the network; GLA only configures the
  connection/token). Managed/Local-External n/a; Manual-BYO = operator supplies the bot token via a pause;
  Disabled = use the CLI channel instead.
- **Seam:** **`ChannelPort`**.

**D8 · Cedar** — *policy engine (embedded)*
- **Classification:** **in-tree library**, **not a swappable operator-facing provider** (`docs/03 §11`).
  Justification: it is evaluated inside admission as part of GLA core; swapping it is an internal port
  substitution, not a catalog choice.
- **Candidate:** **Cedar** (deterministic, forbid-wins), behind the **`PolicyPort`** as the `policy-cedar`
  adapter. Integrated by **GLA-006**.
- **`wpm` task:** none (it is a bundled library, no host standup).
- **Modes (reference):** **Managed** (bundled in `gla-core`); other modes n/a — it is not host software.
- **Seam:** **`PolicyPort`** (internal). Marked *not pluggable* in the stack table for that reason.

---

## §5 · The `DependencyBinding` contract (written by `wpm`, read + re-probed by GLA)

`see docs/01 §8, docs/02 §6`. The binding is the artifact that **physically crosses the GLA↔`wpm` seam**:
`wpm` *writes* it (connection, ownership, probe result, inverse op live in the bundle's Backlog.md task record);
GLA's probe *reads and re-verifies* it at runtime. The catalog's availability is **derived** from it.

```ts
interface DependencyBinding {
  dependency: string;                 // e.g. "edge-proxy", "browser-runtime", "identity-provider"
  ownershipMode: "managed" | "local-external" | "remote-external" | "manual-byo" | "disabled";
  connection?: Record<string, unknown>;   // endpoint / socket / token-ref — how GLA reaches it
  installed: boolean;                 // managed ⇒ installed-by-us (carries an inverse op); local-external ⇒ adopted
  inverseOp?: string;                 // the uninstall/repair step, for managed only (`wpm`'s receipt)
  lastProbe?: { at: string; result: "available" | "degraded" | "unavailable"; detail?: string };
}
```

GLA-082 refines the runtime side of this sketch: provider manifests now declare static
`DependencyRequirement` entries, while WPM receipts supply dynamic `DependencyBinding` evidence. Host-touching
dependencies are unavailable until a structured `source: "wpm-receipt"` binding proves ownership mode, state,
connection references, typed receipt facts, and a successful WPM probe; GLA then combines that receipt with the
current runtime probe. See `docs/architecture/catalog-dependency-bindings.md` for the exact ingest and diagnostic
rules.

**Division of labor (must not merge):** `wpm verify`/Repair proves the *install converged* (one-time, agent-run);
GLA `doctor`/`probe` proves the *runtime is healthy right now* (continuous, server-side). Same binding, different
question, different time. GLA's runtime **never installs anything**; a `wpm` bundle **never models a GLA
session** (`docs/01 §8`). Availability is **system-derived** from the latest probe — a dependency whose probe
fails shows `unavailable`, so admission rejects assemblies needing it (`docs/02 §4`).

---

## §6 · Summary table — dependency → `wpm` bundle → ownership mode → GLA task (AC #4, #5)

The map the dependency tasks (GLA-006–011) are cut against. **Default reference-profile mode in bold.**

| Dependency | Seam (port) | Integration path | `wpm` bundle (host pieces) | Reference mode | GLA task |
|---|---|---|---|---|---|
| Chromium + Playwright (browser+automation) | AgentConnector / Launcher | `wpm` bundle | **browser-runtime** | **Managed** | **GLA-007** |
| noVNC + websockify + VNC + Xvfb (human-view) | HumanEntrypoint | `wpm` bundle | **human-view stack** | **Managed** | **GLA-008** |
| CDP (control protocol) | AgentConnector | in-tree adapter | (rides on browser-runtime) | Managed via D1 | (in-tree; GLA-007 host pieces) |
| Isolation runtime (T2 process default / T4 docker alt) | Launcher (Spawner) | `wpm` bundle | **isolation runtime** | **Local-External** (process tier) | **GLA-009** |
| Caddy (public edge / TLS) | reverse-proxy ↔ Route ctrl; Access Gateway verifies | `wpm` bundle | **edge-proxy** | **Local-External** (host Caddy in hermes-1) | **GLA-010** |
| WebAuthn verifier (`@simplewebauthn/server` default / authentik alt) | AuthProvider | **in-tree adapter** (default) **/** `wpm` bundle (authentik) | **identity-provider** (only for authentik/OIDC) | **Managed** (in-tree, part of gla-core) | **GLA-011** (for the IdP alt) |
| Telegram (Bot API + Mini App) | Channel | in-tree adapter | — (remote SaaS; token-wiring only, no host software) | **Remote-External** | (in-tree; channel adapter) |
| Cedar (policy, embedded) | Policy (internal, not pluggable) | in-tree library | — | **Managed** (bundled) | **GLA-006** |

**Every non-traditional (host-touching) dependency has a `wpm` task and no inline install** (AC #4): D1→007,
D2→008, D4→009, D5→010, D6(authentik alt)→011. **Every traditional-code dependency is named in-tree with a
concrete candidate** (AC #3): CDP→`connector-cdp` (Playwright), Telegram→`channel-telegram`, WebAuthn-default→
`auth-webauthn` (`@simplewebauthn/server`), Cedar→`policy-cedar`. **Every dependency states the seam it plugs
into** (AC #6), so an alternative replaces it by *installing a different provider plugin* with **no GLA core or
`gla`-command change** (`docs/02 §13, docs/03 §13`).

---

## §7 · Reconciliation with the build decisions (where the reference slice's defaults shift)

Recorded so the dependency tasks inherit the same decisions as `baseline.md §9` (and the orchestrator can
surface them). None changes a spec goal/vocabulary/invariant — each is the spec's own *swap-a-provider*
mechanism choosing a different default for the `hermes-1` target:

- **Isolation default = process-tier T2, Docker = registered alternative** (broken nested-Docker in `hermes-1`).
  GLA-009 installs process-tier host facilities by default; the Docker launcher's container runtime is the
  alternative path.
- **Identity default = in-tree WebAuthn (`@simplewebauthn/server`)**, authentik = heavyweight alternative behind
  the same `AuthProviderPort`. **GLA-011's `wpm` package applies to the authentik/OIDC alternative**; the
  default verifier is in-tree library code in `gla-core`.
- **Edge = host Caddy as TLS terminator (Local-External, adopted)**, GLA's Access Gateway remains the grant-
  verifying PEP. GLA-010 adopts/programs the proxy; it does not put capability logic in Caddy.
- **Channel = Telegram (Remote-External) + CLI fallback (in-tree)** for headless E2E.

All other dependency classifications follow `docs/03`'s reference slice unchanged.
