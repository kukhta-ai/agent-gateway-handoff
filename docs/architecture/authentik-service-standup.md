# GLA — authentik Service Standup & Configuration (GLA-073)

> **Status:** Solution-design sub-doc (the standup-shape contract **GLA-074** conforms to). **Scope:** fix how
> the external authentik IdP (server + worker + PostgreSQL [+ Redis on older versions]) is **stood up and
> configured on the operator host**, slotting into the existing `wpm/wip/bundles/identity-provider` bundle as its
> **authentik alternative** — the installer half of the delegated provider. **Planning only:** it builds no
> code, stands nothing up, and touches no backlog.
>
> **Sub-doc of `docs/architecture/authentik-integration.md`** (the deployment boundary `§6`, which already
> **names GLA-074**) and of `docs/architecture/dependency-strategy.md` (the ownership modes + the
> `DependencyBinding` receipt). Those are **referenced, not restated**. The fixed core — the identity/auth
> **model + vocabulary** and the **GLA↔`wpm` boundary** (`see docs/01-architecture-overview.md §7–§8`,
> `docs/components/identity-and-auth.md`) — is held invariant; only the realization (the host standup) is
> designed. GLA-068/070/072 (adapter, enrollment, dual-method flow) are **merged**, so the runtime side this
> standup serves is real.

## How this was produced (Rule-3 note)

Same established reality as the master/sibling docs: `bmad-create-architecture` is hard-gated interactive
(`step-01-init`: *"NEVER generate content without user input … a FACILITATOR, not a content generator … Do NOT
proceed until the user selects 'C'"*) and **cannot run unattended** here. Per `AGENTS.md` Rule 3's explicit
allowance, that path was **stopped, the blocker named**, and this artifact was driven **docs-first** from the
committed design set + the deployment-target notes, the real adapter (`adapters/auth-authentik/src/oidc.ts` —
the endpoints it expects), and the existing bundle (`wpm/wip/bundles/identity-provider/`), with **authentik's own
deployment + OIDC docs consulted** to ground the config-outcomes (see Sources). Config is kept **outcome-level
(what must be true)**, never a click-by-click script — fitting `wpm`'s "thin builder, fat agent" model.

---

## §0 · The reader's map — section → acceptance criterion

| AC | What it fixes | Section |
|---|---|---|
| #1 | Host footprint enumerated + classified by ownership mode | **§2** |
| #2 | The configuration as **outcomes** (RP app + passkey/password flow + `amr`/`acr` + stable `sub`) | **§3** |
| #3 | Lives in a wpm package: detect-before-change, receipt (`DependencyBinding`), idempotent | **§4** |
| #4 | RP identity ties to the operator's public URL (issuer / `redirect_uri` / origin all agree) | **§5** |
| #5 | The in-tree WebAuthn default needs NONE of it; authentik only when selected | **§6** |
| #6 | The GLA-074 build plan + the observability ("provider answers + RP app + flow exist") | **§7** |

**§1** is the deployment reality the whole standup is designed around (the load-bearing constraint); **§8** is
the risks/unknowns GLA-074 must handle.

---

## §1 · The load-bearing deployment reality — WHERE authentik runs (the constraint that shapes everything)

The reference target is **hermes-1**: an **LXD unprivileged container (Ubuntu 24.04)** on an OVH VPS, where
**GLA listens on `:3000`** behind the **host Caddy** (`https://57.131.31.126/` → host `:443` → host
`127.0.0.1:13000` → LXD forkproxy → `hermes-1:3000`; `see` the deployment-target notes). **The critical
constraint:** **nested Docker inside hermes-1 has a broken storage driver** (`FAIL: unknown driver
'overlayfs'`) — the same constraint that already forced GLA's capsule launcher to the process tier
(`see dependency-strategy.md §4 D4`, `baseline.md §5`). **authentik ships as a multi-container stack (server +
worker + PostgreSQL [+ Redis]) and needs working Docker/Compose + persistent volumes.** Therefore:

> **authentik very likely CANNOT run as Managed-compose *inside* hermes-1** — the broken nested-Docker storage
> driver makes a Compose stack non-startable there. This is not a tuning problem; it is the same hard
> environment limit the launcher decision already encodes.

**The reference decision (where authentik runs).** GLA reaches authentik **over the network via OIDC** — the
delegated model is network-mediated by construction (`see authentik-integration.md §2`/`§3`: the adapter is an
OIDC relying-party client that only needs an issuer URL + token/JWKS endpoints, never co-location). So the
standup leans on that:

| Option | Where authentik runs | Reachability from GLA (in hermes-1) | Verdict for the **reference** |
|---|---|---|---|
| **Local-External** *(reference default)* | the **VPS host level** (outside hermes-1, where Docker/LXD work), **alongside the host Caddy** | over the **LXD/host network** (the host IP / an LXD bridge address) via OIDC | **RECOMMENDED for hermes-1.** Docker works at the host (it already runs Caddy + the LXD daemon); authentik is one more host-level Compose stack; GLA dials it over the network. The bundle **adopts** an operator-run authentik (installed by the operator/agent at the host, not inside the container). |
| **Remote-External** | a **separate host / a managed authentik** elsewhere | over the public/private network via OIDC | **Supported alternative.** Cleanest isolation; GLA configures connection-only. Best when the operator already runs authentik or wants it off-box. |
| **Managed-compose-in-container** | inside hermes-1 via the bundle | local | **NOT viable in the hermes-1 reference** (broken nested Docker). Only where nested Docker genuinely works (a different target) — then the bundle may stand it up Managed. |

**Why Local-External (host-level), not Managed-in-container, for the reference.** (1) It is the only place
Docker reliably works on this target (the host already runs Docker for LXD + Caddy). (2) It keeps authentik's
heavyweight footprint **off** the GLA container. (3) It mirrors the **Caddy** decision exactly — Caddy is also
**Local-External** at the host in hermes-1 (`see dependency-strategy.md §4 D5`), adopted not installed-by-GLA;
authentik sits **beside** it. (4) The delegated model only needs OIDC reachability, which the LXD/host network
already provides. **Trade-off:** Local-External means the bundle **adopts** (does not own the lifecycle of) the
authentik the operator stands up — so its receipt is "adopted," not "installed-by-us-with-an-inverse-op"
(`§4`); standing the Compose stack up at the host is an operator/agent step the bundle **guides + verifies**
rather than performs in-container.

**Footprint note (resources).** authentik is heavyweight: server + worker + PostgreSQL (+ Redis on <2025.10)
plus their persistent volumes. The GLA container already needs **≥2GB free** for Node + Chromium
(`see` the deployment-target notes); authentik's stack is a **separate** budget (Postgres data, image layers)
that — under the reference Local-External decision — lands on the **VPS host**, not inside hermes-1, so it does
not compete with the capsule's `/dev/shm`/disk. A Managed-in-container standup (non-reference) would add that
budget on top of the container's, another reason it is wrong for hermes-1.

---

## §2 · Host footprint — enumerated + classified by ownership mode (AC #1)

The external pieces the authentik standup needs, each classified by the dependency-strategy ownership modes
(`see dependency-strategy.md §4 legend, §5`; `01-architecture-overview.md §7` modes table). **Bold = the
reference-profile mode** (per `§1`):

| # | Piece | What it is | Reference-profile ownership mode | Notes |
|---|---|---|---|---|
| A1 | **authentik server** | the IdP web/API + the OIDC provider endpoints (`/authorize`, `/token`, `/jwks`, `/.well-known`) | **Local-External** (host-level, adopted) · Remote-External (off-box) · Managed (only where nested Docker works) | the endpoint GLA's adapter dials |
| A2 | **authentik worker** | background tasks (flow execution support, outpost, migrations) — same image as the server | **Local-External** (stood up beside the server) · Remote-External · Managed | part of the same Compose stack as A1; not separately reachable by GLA |
| A3 | **PostgreSQL** | authentik's primary datastore (users, flows, the credential store, sessions) | **Local-External** (the stack's own DB) · Remote-External (a managed PG) · Managed | persistent volume required; holds the credential authentik owns (`see authentik-integration.md §5`) |
| A4 | **Redis** | cache / task broker — **version-dependent** | **Local-External** · Remote-External · Managed · **N/A on authentik ≥2025.10** | **As of authentik 2025.10 Redis is REMOVED** (caching/tasks/WebSocket migrated to PostgreSQL). GLA-074 must branch on the authentik version: include Redis for older versions, **omit it** for ≥2025.10. |

**The whole authentik stack is one Dependency** from GLA's view (the `identity-provider` dependency,
`see dependency-strategy.md §4 D6`): GLA reaches **only A1's OIDC endpoints**; A2–A4 are authentik-internal and
never directly contacted by GLA. So the **single `DependencyBinding`** (`§4`) describes the *provider service*
(its issuer + OIDC connection), not four separate bindings — the datastores are authentik's own composition,
behind its service boundary. (This mirrors how GLA treats Caddy as one edge dependency, not "nginx + its
config + its certs.")

> **Classification justification (the ownership rule, `01-architecture-overview.md §8`):** standing
> authentik+datastores up *touches the operator host* → it is a **`wpm` bundle**, never inline (`§4`); GLA's
> runtime never installs it. Whether that bundle **installs** (Managed) or **adopts** (Local/Remote-External)
> is the mode — and the reference is adopt-at-the-host (`§1`).

---

## §3 · The configuration the integration needs — as OUTCOMES (AC #2)

Specified as **end-states that must hold** (not steps), grounded in how authentik actually models OIDC
(provider + application, flows→stages→policies, scope/property mappings, subject mode — see Sources) and in
what the **real adapter** requires (`adapters/auth-authentik/src/{index.ts,oidc.ts,strength.ts}`):

### §3.1 · A relying-party (OIDC) application GLA authenticates against
- An authentik **OAuth2/OIDC provider + application** exists for GLA, **confidential client**, with a **client
  id** and **client secret**, and a **redirect URI** equal to GLA's configured `GLA_AUTHENTIK_REDIRECT_URI`
  (`§5`). Multiple redirect URIs / exact-match validation as needed.
- Its **issuer** is reachable and serves a valid **`.well-known/openid-configuration`** advertising the
  **authorization** (`/application/o/authorize/`), **token** (`/application/o/token/`), and **JWKS**
  (`/application/o/<app-slug>/jwks/`) endpoints — **exactly the endpoints the adapter discovers/dials**
  (`see adapters/auth-authentik/src/oidc.ts` `resolveEndpoints`/`buildAuthorizeUrl`). The discovered `issuer`
  must equal what GLA is configured with (`GLA_AUTHENTIK_ISSUER_URL`), since the adapter validates the
  `id_token` `iss` against it.
- **`id_token` carries the needed claims:** "include claims in id_token" is on, so `sub`, `amr`/`acr`, and any
  `nonce`/`aud`/`exp` the adapter validates are present in the **`id_token`** itself (the adapter validates the
  `id_token`, not a userinfo round-trip). Scope `openid profile` (the adapter default) suffices.

### §3.2 · An authentication flow offering passkey AND password — emitting a distinguishing `amr`/`acr`
- The provider's **authentication flow** presents **both** a **passkey/WebAuthn** stage **and** a **password**
  stage (and any MFA the operator wants), so a recipient can use either (`see authentik-dual-method-flow.md
  §2`). authentik's flow/stage model supports this (an Identification stage → a WebAuthn-validator and/or a
  Password stage; the flow lets the user choose).
- **(Critical — from `authentik-dual-method-flow.md §3`/`§8` and `authentik-integration.md §4):** the flow
  **emits an `amr` (or `acr`) in the `id_token` that distinguishes passkey from password**, so GLA's
  pure-function strength map yields **`webauthn`** for a passkey login and **`password`** for a password login.
  Concretely: a **custom scope/property mapping** populates `amr` from the authentication context — a passkey
  login → an `amr` token in GLA's webauthn set (`{hwk, swk, webauthn, fido}`), a password login → `{pwd}`
  (`see adapters/auth-authentik/src/strength.ts` `DEFAULT_METHOD_MAPS`). The operator-overridable map
  (`GLA_AUTHENTIK_AMR_MAP`/`_ACR_MAP`) absorbs label differences across authentik versions, **but the flow
  MUST emit *something* that separates the two tiers** — without it, the integration degrades to `password`-only
  (the `never-up-map` floor; `§8` risk). This is the single most authentik-version-sensitive outcome and the
  one GLA-074 must **verify against the running instance**, not assume.

### §3.3 · A stable subject (`sub`)
- The provider's **subject mode** yields a **stable, immutable `sub`** — authentik's "based on the User's
  **UUID**/hashed id" rather than username or email (which can change). This is the binding the recipient is
  enrolled against (`see authentik-enrollment.md §3`/`§8.3`): enrollment stores `subjects[userId]={sub}` and
  every later step-up checks `id_token.sub === that sub`. A mutable `sub` would silently break re-verification,
  so **immutable-`sub`** is a required outcome, verified by GLA-074 (enroll → re-auth → same `sub`).

> All three are **outcomes the bundle verifies**, not a script. The exact authentik UI/API path is the
> installer agent's to discover (the docs deliberately enumerate few fields — see Sources — which is *why* the
> bundle is agent-native verify-driven, `§4`/`§7`).

---

## §4 · The standup lives in a wpm package — detect-before-change, receipt, idempotent (AC #3)

The standup is the **authentik branch of the existing `wpm/wip/bundles/identity-provider` bundle** (it already
exists and **names authentik as its alternative** — `see wpm/wip/bundles/identity-provider/bundle.yml` + the three
install-backlog tasks `identity-provider-1..3`, which today do the in-tree WebAuthn RP config). GLA-074 adds
the authentik path under the **same detect → setup → verify → record** loop (`see` the bundle's `AGENTS.md`;
`dependency-strategy.md §2`/`§5`):

- **Detect before changing anything (idempotent / Repair).** The setup step (extending
  `identity-provider-1`'s detect + `identity-provider-2`'s setup) first **detects** whether an authentik that
  satisfies `§3` already answers (issuer reachable? RP app present? flow emitting `amr`? — `§7`). If so, it
  **adopts** (records the binding, changes nothing) — the Local-External reference path (`§1`). Re-running is
  **Repair**, converging to the same end-state without duplicating providers/applications.
- **Record a receipt — the `DependencyBinding`** (`see dependency-strategy.md §5`; the artifact that crosses
  the GLA↔`wpm` seam). For the `identity-provider` dependency it carries:
  ```
  dependency:    "identity-provider"
  ownershipMode: "local-external" | "remote-external" | "managed"   // reference: local-external
  connection:    { issuer, clientId, redirectUri /*, scopes, amrMap? */ }   // clientSecret NOT in the receipt — a secret-ref (§8)
  installed:     false   // local/remote-external = adopted; true only for a Managed standup (carries inverseOp)
  inverseOp:     <uninstall/teardown step>   // Managed only — the wpm receipt for what it installed
  lastProbe:     { at, result: "available"|"degraded"|"unavailable", detail }
  ```
  GLA's runtime **reads** this binding and re-verifies it (`doctor`/`probe`); **availability is system-derived**
  from the latest probe — a down authentik shows `unavailable` and admission/step-up fails closed
  (`see dependency-strategy.md §5`; the adapter already surfaces a down provider as a catchable refusal).
- **Idempotent on re-run.** Each task is detect-guarded (skip if satisfied), honors the bundle's DoD (the
  receipt is a precondition for Done — `see` the bundle's `install-backlog/config.yml`), and contains failure
  to this bundle (never reaches into another's state). The **load-bearing decision** the bundle records (the
  in-tree-default-unless-selected choice, `identity-provider-2` AC#2/#3) is unchanged; GLA-074 fills the
  "authentik selected" branch those ACs already reserve.

> **Division of labor (must not merge, `dependency-strategy.md §5`):** GLA never installs authentik at runtime;
> the bundle never models a GLA session. `wpm verify`/Repair proves the *install* converged; GLA `doctor`
> proves the *runtime* is healthy now. Same binding, different question, different time.

---

## §5 · The RP identity ties to the operator's public URL (AC #4)

Provider and GLA must **agree on one origin** — the same origin GLA's gateway is reached at. Concretely, all of
these resolve to / agree with **`GLA_PUBLIC_BASE_URL`** (in hermes-1, `https://57.131.31.126/`):

- **The OIDC `redirect_uri`** (`GLA_AUTHENTIK_REDIRECT_URI`, `see authentik-integration.md §7`) is a URL on
  **GLA's public origin and under `GLA_PUBLIC_BASE_URL`'s public path prefix** — the **callback path GLA
  serves** (the same-origin return-detection page, `§5.1`), e.g.
  `https://57.131.31.126/auth/callback` for a root deployment or
  `https://gla.example/team-a/auth/callback` when
  `GLA_PUBLIC_BASE_URL=https://gla.example/team-a/`. The authentik RP app's allowed redirect URI **equals**
  this exact value (authentik exact-matches it).
- **The authentik issuer** (`GLA_AUTHENTIK_ISSUER_URL`) is wherever authentik answers (a host/subdomain reached
  over the network — `§1`). It need not be the *same* origin as GLA, but the adapter validates the `id_token`
  `iss` against this configured value, and the discovery doc's `issuer` must match it. (Operators commonly give
  authentik its own subdomain fronted by the same host Caddy; the bundle records whatever the operator chose.)
- **The RP/origin agreement:** the browser leaves GLA's origin (the handoff/enroll page) → authentik's origin
  (login) → **back to GLA's origin** (the `redirect_uri` callback). The **return must land on GLA's origin** so
  the callback page's same-origin state (the `state`/return-detection it needs) works (`§5.1`). The configured
  `redirectUri` (sent in the authorization request), authentik's registered redirect URI, and GLA's served
  callback path are **one and the same URL**.

### §5.1 · The Caddy routing (carried from `authentik-dual-method-flow.md §5`) — GLA-074 owns it
The redirect path the operator configures as `redirect_uri` must resolve to a **GLA-served page on GLA's own
origin** — so the callback runs the return-detection that re-POSTs `{code,state}` to the gateway's unchanged
verify route (`see authentik-dual-method-flow.md §5.2`). GLA-074's Caddy/route wiring must make:

- **GLA `:3000`** (the gateway / sole public entry) reachable at `GLA_PUBLIC_BASE_URL` — **already true**
  (the existing host-Caddy → `:3000` mapping, `see` deployment-target notes; GLA-010/edge-proxy).
- **authentik's endpoints** reachable at the issuer host (the operator's authentik origin) — Caddy at the host
  proxies to the host-level authentik stack (`§1`).
- **The `redirect_uri` callback** served **by GLA on GLA's origin** (the gateway callback page,
  `authentik-dual-method-flow.md §5.2`) — so it is **same-origin** with the gateway (sessionStorage/state work)
  and the **grant never leaks to authentik**: the grant rides only between GLA's page and GLA's verify route;
  authentik sees only the OIDC `code`/`state`, never the GLA grant. The callback path is on GLA's origin,
  **not** authentik's, and is **not** the local bridge (S-6). This is the one piece of routing GLA-074 wires
  that is specific to the authentik path (the gateway/`:3000` mapping already exists).

For subpath/custom-base deployments, the public base path is part of this same agreement. A recommended Caddy
shape is `handle_path /team-a/*` → `reverse_proxy <gla-upstream>` with `X-Forwarded-Prefix: /team-a`, so
recipient URLs are `/team-a/enroll`, `/team-a/handoff/...`, and `/team-a/auth/callback` while GLA receives its
root-shaped internal routes. This strip-prefix shape requires `GLA_TRUST_FORWARDED_PREFIX=true` **only behind an
edge that overwrites/sanitizes client-supplied `X-Forwarded-Prefix`**; otherwise a client could spoof an unprefixed
alias. Existing exposure layers that preserve the prefix are also valid when `GLA_PUBLIC_BASE_URL` contains the
same prefix and do not need the trust flag. In both cases Caddy is transport/path routing only; the Access Gateway
remains the authorization membrane for grants, recipient caveats, auth assurance, and WebSocket reach.

> **No grant leak:** the OIDC `state`/`nonce`/`code` flow to/from authentik; the **GLA grant** is confined to
> GLA's own origin (handoff page → callback → `/handoff/auth/verify`). authentik never receives it. (This is
> the security property `authentik-dual-method-flow.md §8.3/§8.5` requires the review to confirm.)

---

## §6 · The in-tree WebAuthn default needs NONE of this (AC #5)

The standup is **entirely gated on `GLA_AUTH_PROVIDER=authentik`** (`see authentik-integration.md §7`). For the
**default** (`GLA_AUTH_PROVIDER=webauthn`, the reference-profile default, `dependency-strategy.md §4 D6`):

- The `identity-provider` bundle does **only** what it does today — set the WebAuthn **relying-party id**
  (`GLA_RP_ID`) matching the host in the public base URL, for the in-tree `@simplewebauthn` provider, standing
  up **no separate service** (`see wpm/wip/bundles/identity-provider/` tasks `identity-provider-1..3`, whose ACs
  already encode "in-tree provider available by default; alternative only when explicitly selected").
- **None of A1–A4 (`§2`)** is installed, adopted, or required. No authentik, no Postgres, no Redis, no OIDC app,
  no flow config. The default verifier is in-tree library code in `gla-core` (`baseline.md §5`).
- authentik (and everything in `§2`–`§5`) is **required only when the delegated provider is selected** — the
  bundle's authentik branch runs **only** on that selection, exactly as `identity-provider-2` AC#2/#3 already
  reserve. Selecting it is the operator's opt-in; the default install is untouched and unburdened.

> This preserves the master decision (`authentik-integration.md §6`/`§7`): in-tree WebAuthn stays the default;
> authentik is the heavyweight, opt-in alternative — and its **installer cost is paid only on opt-in**.

---

## §7 · Implementation plan for GLA-074 + observability (AC #6)

GLA-074 builds the **authentik branch of the `identity-provider` bundle** — the detect→setup→verify→record path
that stands authentik up (or adopts it) and configures `§3`, recording the `DependencyBinding`. Concrete steps:

1. **Extend the detect step** (`identity-provider-1`): detect selection (`GLA_AUTH_PROVIDER=authentik`) and
   whether an authentik satisfying `§3` already answers (issuer reachable, RP app present, flow emits `amr`,
   stable `sub`). Record findings.
2. **Extend the setup step** (`identity-provider-2`, authentik branch): for the **reference (Local-External)**,
   **guide + verify** the operator/agent standing authentik up **at the VPS host** (the Compose stack, where
   Docker works — `§1`) and configuring the RP app + the passkey/password flow + the `amr` mapping + the
   immutable subject mode (`§3`); for **Remote-External**, configure connection-only; for **Managed** (only
   where nested Docker works), stand the Compose stack up and carry the inverse op. Point GLA at it (write the
   env/connection). **Detect-before-change** so a present authentik is adopted, not duplicated.
3. **Wire the Caddy `redirect_uri` callback** on GLA's origin (`§5.1`) — same-origin, no grant leak.
4. **Verify step** (`identity-provider-3`, authentik branch): prove the provider works end-to-end (below).
5. **Record the receipt** — the `DependencyBinding` (`§4`), the client secret as a **secret-ref** not a
   literal (`§8`), the ownership mode + (Managed only) the inverse op.

**How "the provider answers AND the RP application AND the flow exist" is OBSERVED (the acceptance evidence).**
The verify step is **probe-driven** (the bundle's "verify before record"):

| Outcome (`§3`) | Observable probe |
|---|---|
| **The provider answers** | `GET <issuer>/.well-known/openid-configuration` responds 200 with a valid OIDC discovery doc; the advertised **token** + **JWKS** endpoints answer (JWKS returns keys). |
| **The RP application exists** | an authorization request to `/authorize` with GLA's `client_id` + `redirect_uri` is **accepted** (authentik recognizes the client + redirect URI), not rejected as unknown-client/bad-redirect. |
| **The passkey/password flow exists + emits a distinguishing `amr`** | an **end-to-end auth** (via the bundle's smoke test, or `FakeAuthentik` for the deterministic unit layer): a passkey login yields an `id_token` whose `amr` maps to **`webauthn`**, a password login yields one mapping to **`password`** — proving the flow offers both **and** the strength map separates them (`§3.2`). |
| **Stable `sub`** | enrolling then re-authenticating the same user yields the **same `sub`** (the subject is immutable — `§3.3`). |
| **GLA agrees on the binding** | GLA's `doctor`/`probe` **reads the `DependencyBinding`** and reports the `identity-provider` dependency **available** (system-derived from the probe) — closing the loop that the runtime adapter can actually reach what the bundle stood up. |

These are the same "the install converged" evidences the existing `identity-provider-3` records for the
WebAuthn default, lifted to the OIDC provider — so GLA-074 reuses the bundle's verify-before-record discipline
with authentik-specific probes.

**What is already provided vs what GLA-074 builds.**

| Already provided | GLA-074 builds |
|---|---|
| the adapter that dials authentik's OIDC endpoints (`oidc.ts` discovery/exchange/validate), the `amr`→strength map (`strength.ts`), the dual-method flow + GLA-served same-origin callback page, `FakeAuthentik` | the **bundle's authentik branch** (detect→setup→verify→record), the **host-level standup/adopt** decision wiring, the **`§3` config outcomes** + their probes, the **Caddy `redirect_uri` route**, the **`DependencyBinding` receipt** |
| the existing `identity-provider` bundle (WebAuthn-default tasks `1..3`) + its DoD-gated receipt model | the authentik tasks/AC under the same loop (the WebAuthn-default path stays unchanged) |

---

## §8 · Risks / unknowns GLA-074 must handle

1. **WHERE authentik runs (the load-bearing unknown).** The reference is **Local-External at the VPS host**
   (`§1`) **because Managed-compose-in-container is non-viable in hermes-1** (broken nested Docker). GLA-074
   must (a) **detect** the environment and **not attempt** a Managed in-container standup where nested Docker
   is broken (it will fail at `overlayfs`), (b) drive the **adopt-at-host** path for the reference, and (c)
   offer Remote-External cleanly. **Document Local-/Remote-External as the hermes-1 reference; treat
   Managed-in-container as a non-reference path only attempted where nested Docker is proven working.** This is
   the single biggest where-it-runs decision and must be surfaced to the operator (a guided pause), not assumed.
2. **The `amr` emission config (the version-sensitive correctness outcome).** authentik must be configured so
   the flow emits an `amr`/`acr` that **separates passkey from password** (`§3.2`); the docs enumerate few
   fields and the exact mechanism (a custom property/scope mapping populating `amr`) varies by authentik
   version. GLA-074 must **verify the emitted `amr` against the running instance** (a real passkey login →
   `webauthn`, a real password login → `password`) and tune `GLA_AUTHENTIK_AMR_MAP` to the actual labels — not
   assume defaults. If the flow cannot be made to distinguish them, the integration **safely degrades to
   `password`-only** (never up-maps), and the operator must be warned.
3. **authentik version drift — Redis present or not.** ≥2025.10 **removes Redis** (`§2` A4); older versions
   require it. GLA-074 must branch the stack composition on the detected/target version (include Redis only
   when needed) and not hard-require a Redis the version doesn't use.
4. **Stable-`sub` configuration.** The subject mode must be immutable (UUID/hashed-id, not email/username —
   `§3.3`); a mis-set subject mode silently breaks re-verification. Verify enroll-then-reauth yields the same
   `sub`.
5. **The client secret handling.** `GLA_AUTHENTIK_CLIENT_SECRET` is `sensitive` — recorded as a **secret-ref**,
   **never** in the `DependencyBinding.connection` literal, the receipt, or any log (`see
   authentik-integration.md §9`; `kernel-contracts.md §1.7` redaction). GLA-074 routes it through the secret
   seam.
6. **The `redirect_uri` / origin agreement + no grant leak (`§5`).** The callback must land **same-origin** on
   GLA (so state works) and the grant must **never** reach authentik. A mis-set `redirect_uri` (wrong origin,
   or pointed at authentik) breaks the callback **and** risks leaking the grant — GLA-074's Caddy wiring + the
   exact `redirect_uri` agreement is the guard (and the GLA-072 review property to re-confirm at deploy).
7. **Reachability over the LXD/host network.** Local-External means GLA-in-hermes-1 reaches host-level
   authentik over the LXD bridge/host IP; GLA-074 must record the **reachable** issuer address (not a
   host-only `localhost` that the container cannot resolve) and verify the container can actually dial it (the
   `doctor` probe).
8. **Heavyweight footprint (`§1`).** authentik + Postgres (+ Redis) is a real resource cost; under the
   reference it lands on the **host**, not hermes-1 — GLA-074 must not co-locate it in the GLA container (both
   the Docker constraint and the resource budget forbid it).

---

## §9 · Conformance summary (the contract this doc fixes)

1. Footprint = authentik **server + worker + PostgreSQL [+ Redis on <2025.10]**, each classified by ownership
   mode; the reference is **Local-External** (host-level, adopted); the whole stack is **one** GLA
   `identity-provider` dependency (GLA dials only the OIDC endpoints) (`§2`).
2. Config **outcomes**: an OIDC **RP app** (client id/secret, redirect URI, issuer, claims-in-`id_token`); an
   **auth flow offering passkey AND password** that **emits a distinguishing `amr`/`acr`** (→ `webauthn` vs
   `password`); a **stable immutable `sub`** (`§3`).
3. The standup is the **`wpm` `identity-provider` bundle's authentik branch** — **detect-before-change**,
   **records a `DependencyBinding`** (issuer/clientId/redirectUri/ownershipMode/installed/inverseOp), **idempotent**
   detect→setup→verify→record (`§4`).
4. The RP identity **ties to `GLA_PUBLIC_BASE_URL`**: the `redirect_uri` callback is served by **GLA on GLA's
   origin** (same-origin, no grant leak), the issuer/`iss` agree with what GLA is configured with, all on one
   agreed origin (`§5`).
5. The **in-tree WebAuthn default needs NONE of it** (the bundle just sets `GLA_RP_ID`); authentik is required
   **only** when `GLA_AUTH_PROVIDER=authentik` (`§6`).
6. GLA-074 builds the bundle's authentik branch; "**provider answers + RP app + flow exist**" is observed by
   the discovery doc + token/JWKS answering, an authorization request accepted for GLA's client/redirect, an
   end-to-end passkey→`webauthn` / password→`password` proof, a same-`sub` re-auth, and GLA's `doctor` reading
   the binding as available (`§7`).

## Sources

- authentik OAuth2/OIDC provider + endpoints (`/application/o/authorize|token|<slug>/jwks/`, `.well-known`):
  [OAuth 2.0 provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2) ·
  [Create an OAuth2 provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/create-oauth2-provider/)
- Custom claims via scope/property mappings (the `amr` mechanism):
  [Provider property mappings](https://docs.goauthentik.io/add-secure-apps/providers/property-mappings/)
- Flows/stages/policies (the passkey + password flow model):
  [Flows, stages, and policies](https://goauthentik.io/blog/2024-08-27-flows-stages-and-policies/)
- Deployment stack + **Redis removed in 2025.10**:
  [Release 2025.10](https://docs.goauthentik.io/releases/2025.10/) ·
  [authentik docker-compose.yml](https://goauthentik.io/version/2025.4/docker-compose.yml) ·
  [Setting Up Authentik with Docker Compose](https://docs.techdox.nz/authentik/)

## Related

`docs/architecture/authentik-integration.md` (the master — `§6` deployment boundary + GLA-074 named, `§7`
selection surface/config envs) · `docs/architecture/authentik-dual-method-flow.md` (`§5` the redirect_uri
callback + same-origin landing, `§3`/`§8` the `amr` distinction) · `docs/architecture/authentik-enrollment.md`
(`§3` the subject binding, `§8.3` stable `sub`) · `docs/architecture/dependency-strategy.md` (the ownership
modes + the `DependencyBinding` receipt + availability=system-derived) · `docs/01-architecture-overview.md
§7–§8` (the dependency/ownership model + the GLA↔`wpm` boundary) · `docs/components/identity-and-auth.md` (the
identity/auth model) · `wpm/wip/bundles/identity-provider/` (`bundle.yml` + `install-backlog/` tasks
`identity-provider-1..3` — the WebAuthn-default config GLA-074 extends with the authentik branch) ·
`adapters/auth-authentik/src/oidc.ts` (the OIDC endpoints/discovery the standup must satisfy) ·
`adapters/auth-authentik/src/strength.ts` (the `amr`→strength map the flow must feed).
