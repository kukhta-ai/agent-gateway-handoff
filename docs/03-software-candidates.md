# 03 · Software candidates per layer

GLA leans on third-party software only at its **edges**. Everything the system depends on a third party for is a **pluggable layer**: a catalog kind (see `02-provider-and-extension-model.md`) with one concrete dependency filling it. The capsule itself is **assembled from separate local layers** — a browser and its automation engine, the human-view stack, and the agent-control protocol — composed at provision time, **not shipped as one prebuilt image**; the system around it (edge, identity, isolation, channel) is layered the same way.

This document records, per layer, the concrete software the **reference slice** (scenario-01, the same-session browser handoff) uses, the researched **alternatives**, and how each is **owned** — integrated as in-tree code, or installed onto the operator host as a `work-package-manager` (`wpm`) package, per the rule in `01-architecture-overview.md` §8. Swapping any one is *"install a different provider plugin"*: **horizontal extension that changes no core code**, and no change to the `gla` commands the agent runs.

> The alternatives are real, maintained projects chosen to bracket the design space — simpler ↔ stronger-isolation, self-hosted ↔ protocol-only. They are candidates, not commitments; the operator's environment and threat model decide which fills each seam.

## 1. The reference slice at a glance

| Layer | Capability needed | Catalog kind | Reference slice | Researched alternatives | Owned as |
|---|---|---|---|---|---|
| Delivery / channel | reach & receive the human | `ChannelAdapter` | **Telegram** (Bot API + Mini App) | Slack · Email · local CLI | in-tree (remote-external) |
| Public edge | verify grant & proxy | reverse-proxy dependency | **Caddy** | nginx · Traefik | `wpm` package |
| Identity / auth | prove the recipient | `AuthProvider` | **WebAuthn / passkeys** via **authentik** | Authelia · generic OIDC | `wpm` package + in-tree adapter |
| Capsule runtime / isolation | run & isolate the capsule | `Launcher` (Spawner) | **Docker** (container tier) | Podman · rootless · Firecracker · remote-worker | `wpm` package |
| Human entrypoint / surface | the user-facing live view | `HumanEntrypoint` | **noVNC + websockify** (over a VNC server + Xvfb) | KasmVNC · Apache Guacamole · Xpra | `wpm` package |
| Agent connector | the agent's handle to the capsule | `AgentConnector` | **CDP** (driven by Playwright) | filesystem path · `secret_ref` | in-tree (browser runtime via `wpm`) |
| Workspace | the live-state volume | `Workspace` | **browser-profile-temp** (ephemeral) | staged-copy · persistent | in-tree |
| Completion detection | know the step is done | `CompletionDetector` | **url-watcher** (+ user-done) | exit-code · dom-watcher | in-tree |
| Browser (in capsule) | the thing being acted on | template-bundled | **Chromium** | Firefox · WebKit | template, installed via `wpm` |
| Policy engine *(embedded)* | deterministic authorization | *GLA core — not pluggable* | **Cedar** (forbid-wins) | — | in-tree library |

The rows below describe each candidate. The nine pluggable layers map one-to-one to the provider-labelled lanes in `scenario-01-unified.html`; the embedded policy engine and the non-pluggable pieces are called out in §11–§12.

## 2. Delivery / channel — `ChannelAdapter`

**Reference: Telegram.** Reaches the recipient over the Bot API and delivers the recipient-bound handoff link as a **Mini App** the user opens inside the messenger. Chosen for the reference because it gives both a messaging channel and an embedded web surface in one place.

**Alternatives:** **Slack** (Block Kit messages carrying the link), **Email** (SMTP out for the invite/link, IMAP in for replies), a **local CLI** channel for headless or operator-only use.

**Owned as** in-tree code talking to a remote service (remote-external ownership) — no host install, so it is folded into the inbound step rather than shipped as a `wpm` package.

## 3. Public edge — reverse-proxy dependency

**Reference: Caddy.** Terminates inbound TLS, verifies the grant at the edge, and proxies the authorized WebSocket upgrade to the capsule's human entrypoint. Chosen for automatic HTTPS and a small configuration surface.

**Alternatives:** **nginx** (ubiquitous, mature, manual TLS/ACME), **Traefik** (dynamic, label-driven routing well suited to container fleets).

**Owned as** a `wpm` installer package that provisions the proxy on the operator host; the GLA Route controller programs grant-bound routes onto whatever proxy fills the seam.

## 4. Identity / auth — `AuthProvider`

**Reference: WebAuthn / passkeys, verified through authentik** (a self-hostable identity provider). The recipient registers a passkey once at enrollment; the gateway requires and checks it before forwarding anywhere. Chosen for phishing-resistant, hardware-backed proof behind a self-hosted IdP.

**Alternatives:** **Authelia** (lightweight self-hosted authentication and SSO), **generic OIDC** against an identity provider the operator already runs.

**Owned as** a `wpm` installer package (the IdP service) behind an **in-tree adapter** at the `AuthProvider` seam, so the auth strength and provider can change without touching the gateway.

## 5. Capsule runtime / isolation — `Launcher` (Spawner)

**Reference: Docker.** Runs the capsule as an isolated container the agent does **not** run as. Chosen as the most available container tier for the single-operator reference profile.

**Alternatives:** **Podman** (daemonless containers), **rootless containers** (no privileged daemon), **Firecracker** (microVM — VM-grade isolation for stronger threat models), a **remote-worker** launcher (capsule runs off-host and shares no host paths).

**Owned as** a `wpm` installer package. Each launcher **declares its mount capability**; a launcher that cannot share the host (a remote worker) accepts no mounts and the agent falls back to GLA-mediated transfer (see `04-capsule-assembly.md` §6).

## 6. Human entrypoint / surface — `HumanEntrypoint`

**Reference: noVNC + websockify**, serving a VNC server over a virtual display (Xvfb) so the human sees and drives the live browser inside their own browser tab. Chosen as the most portable, browser-native remote view.

**Alternatives:** **KasmVNC** (modern web-native VNC), **Apache Guacamole** (clientless RDP/VNC/SSH gateway), **Xpra** (rootless application forwarding).

**Owned as** a `wpm` installer package — a layer distinct from the browser and the connector. Whatever surface fills the seam, the **agent-blind input path** is upheld: human keystrokes reach the site, never the agent.

## 7. Agent connector — `AgentConnector`

**Reference: CDP (Chrome DevTools Protocol), driven by Playwright.** The agent's continuously-attached, **agent-blind** handle to drive the capsule's browser. Chosen because it pairs directly with the Chromium browser layer.

**Alternatives:** a **filesystem path** or a **`secret_ref`** connector for non-browser capsules.

**Owned as** in-tree adapter code; the browser-plus-automation runtime it talks to is itself a `wpm` package (see §10), so the connector and browser layers are provisioned together.

## 8. Workspace — `Workspace`

**Reference: browser-profile-temp.** An ephemeral browser profile created per session and wiped at teardown, so no recipient state outlives the session by default.

**Alternatives:** **staged-copy** (seed from a known profile), **persistent** (a profile that survives across sessions).

**Owned as** in-tree code. When persistence is wanted, the persisted bytes live on a **host mount** or the outputs/task store — not in the ephemeral workspace, which is destroyed at reap.

## 9. Completion detection — `CompletionDetector`

**Reference: url-watcher (+ user-done).** Completion is recognized when the live page reaches a configured URL (the reference flow's success is the navigation to `/dashboard`, via `/verify`). Chosen because this slice's done-state is a navigation.

**Alternatives:** **exit-code** (a process result), **dom-watcher** (a DOM condition).

**Owned as** in-tree code; the capsule only *emits* signals — every detector is validated against its declared contract by the Completion service.

## 10. Browser (inside the capsule) — template-bundled

**Reference: Chromium.** The browser the human and agent jointly act on, bundled by the capsule template. Chosen for first-class CDP support that pairs with the connector layer.

**Alternatives:** **Firefox**, **WebKit**.

**Owned as** a template-bundled component installed on the host through the same `wpm` **browser-runtime package** that provides Playwright — so the browser (§10) and connector (§7) layers are stood up together.

## 11. Policy engine — Cedar (embedded, not a swappable layer)

**Cedar** is the deterministic, **forbid-wins** policy engine evaluated inside admission: every proposal is checked against policy before anything is minted or run. It is listed here because it is third-party software, but it is **GLA core, integrated in-tree behind the policy port** — not an operator-facing provider. Swapping it is an internal port substitution, not a catalog/provider choice, which is why the stack table marks it *not pluggable*.

## 12. Not pluggable here

Two parts of the reference are deliberately **not** layers with provider markers:

- **GLA core (our code, not a dependency):** Admission + Policy (with Cedar embedded), the Task / Session / Capability / Route / Completion services, and the Worker plane. They appear as their own lanes in `scenario-01-unified.html` but carry no provider label because they are not swappable dependencies.
- **External (not a GLA dependency at all):** the agent runtime (Hermes), the website being acted on (`acme.example`), and the user's email inbox.

## 13. How a layer is swapped

Because each layer sits behind a catalog kind and an internal seam, changing one is *install a different provider plugin and register it* — GLA core and the agent's `gla` commands are untouched. This is the inversion-of-control model in `02-provider-and-extension-model.md`: providers are composed **by capability**, and the concrete dependency behind each capability is the operator's choice, discovered at runtime through the catalog.

How that dependency is stood up in a given environment is governed by its **ownership mode** — Managed / Local-External / Remote-External / Manual-BYO / Disabled — which GLA *declares* and `work-package-manager` *satisfies* (`01-architecture-overview.md` §7–§8). A new candidate for any layer therefore lands as either an in-tree adapter (when it is long-lived code inside the deployment) or a `wpm` installer package (when it touches the operator host) — never as an inline, hand-run install.

## Provenance

**Grounded in the source docs:** the per-layer provider stack — the same nine layers, their catalog kinds, and the concrete-vs-alternative choices — from the reference-scenario diagram (`scenario-01-unified.html`) and `02-provider-and-extension-model.md`; the in-tree-vs-`wpm`-package ownership split from `01-architecture-overview.md` §7–§8 and the dependency-strategy work.

**Synthesized here:** the consolidation of that research into one per-layer reference with a short description of each candidate, and the explicit **Owned as** column tying every layer to its integration path (in-tree adapter or `wpm` package). No layer choice is changed from the source; this document only gathers and explains them.

## Related

`02-provider-and-extension-model.md` (how layers self-register and are consumed registry-driven) · `04-capsule-assembly.md` (how the agent composes these layers into a session) · `01-architecture-overview.md` §7–§8 (providers, dependencies, ownership modes, the `wpm` boundary) · `components/worker-plane.md`, `components/capsule.md`, `components/access-gateway.md`, `components/identity-and-auth.md`, `components/channel-adapter.md`, `components/completion-service.md` (the components that consume each layer) · `scenario-01-unified.html` (the layers in a full end-to-end run).
