---
name: authentik-standup
description: "Install-time helper for the identity-provider bundle's authentik branch. Active while identity-provider is in focus and GLA_AUTH_PROVIDER=authentik. Guides the agent to stand up OR adopt an authentik IdP at the right ownership mode, configure the OIDC relying-party application + a passkey-and-password flow that emits distinguishing amr/acr plus GLA's UV proof claim, wire the same-origin redirect_uri callback, and verify+record the DependencyBinding — outcome-level, not a click-script."
---

# authentik standup (identity-provider · authentik branch)

You are working the **authentik branch** of the `identity-provider` bundle (install-backlog tasks
`identity-provider-4` detect → `-5` setup → `-6` verify+record). This branch runs **only** when the operator
selected the delegated provider (`GLA_AUTH_PROVIDER=authentik`); for the in-tree WebAuthn default it is a
no-op and tasks `1..3` are the whole story (do nothing here). This helper gives you the **outcomes** to reach
and **how to verify** them — not a brittle UI click-path. authentik's own docs deliberately enumerate few
fields, which is exactly why this is verify-driven: discover the actual UI/API on the instance in front of you
and confirm the end-states below hold.

The design contract you are realizing is `docs/architecture/authentik-service-standup.md` (read it; §1 where it
runs, §2 footprint, §3 config outcomes, §5 the redirect_uri callback, §7 the probes, §8 the risks). The runtime
it serves is already built and merged: the OIDC relying-party adapter (`adapters/auth-authentik/src/oidc.ts`
discovery/exchange/validate), the `amr`→strength map (`adapters/auth-authentik/src/strength.ts`), the
dual-method flow + same-origin callback page (GLA-072), and the `FakeAuthentik` test double.

## Step 0 — confirm scope, then DETECT before changing anything (task 4)

1. **Selection gate.** Proceed only if `GLA_AUTH_PROVIDER=authentik`. If the default is in effect, record
   "authentik not selected — nothing to set up" and stop. The default WebAuthn path is untouched and unburdened.
2. **Detect an adequate existing authentik (adopt-before-install).** The delegated model is network-mediated:
   GLA dials authentik's OIDC endpoints, never co-locates with it. So look for one that already answers and is
   already configured for GLA:
   - run `installer-scripts/probe-authentik.mjs <issuer-url>` (see "The probes") — does the discovery doc
     answer, do token+JWKS answer?
   - is a relying-party application for GLA already registered (an `/authorize` request with GLA's `client_id`
     + `redirect_uri` is accepted, not unknown-client/bad-redirect)?
   - does its flow already emit a distinguishing `amr` and a stable `sub`?
   - If **all** hold → **adopt**: record the binding, change nothing. This is the Local-External reference path.
3. **Decide the ownership mode from the host environment** (`§1`, the load-bearing decision):

   | Mode | When | What you do |
   |---|---|---|
   | **Local-External** *(hermes-1 reference)* | the GLA container cannot run a Compose stack (nested-Docker storage driver broken — `installer-scripts/check-nested-docker.sh` returns NESTED_DOCKER_BROKEN) but Docker works at the **VPS host** (it already runs Caddy + LXD) | **guide + verify** the operator/agent standing authentik up **at the host level** (beside Caddy), adopt it over the LXD/host network. The bundle does **not** own its lifecycle (adopted, no inverse op for the service). |
   | **Remote-External** | authentik already runs off-box, or the operator wants it elsewhere | **connection-only**: configure GLA to point at it; verify reachability + the RP app. Adopted. |
   | **Managed-in-container** | **only** where `check-nested-docker.sh` returns NESTED_DOCKER_OK (a different target) | stand the Compose stack up in place from `payload/templates/authentik-compose.yml.tmpl` and carry the **inverse op** (the teardown) in the receipt. |

   **Never** attempt a Managed in-container standup when nested Docker is broken — it fails at `overlayfs` and
   leaves a half-built stack (task-5 AC#8). On such a host, drive adopt-at-host or Remote-External, and if
   neither is possible, **stop with a clear, recoverable failure** recommending a host-level / off-box
   authentik — leave nothing behind.
4. **Establish the reachable issuer address.** Record an issuer GLA-in-the-container can actually dial (a host
   IP / LXD-bridge address), **not** a host-only `localhost` (`§8` reachability). Verify the container can reach
   it.

## Step 1 — SETUP: bring authentik to the required state + point GLA at it (task 5)

Reach these **outcomes** on whichever authentik you adopted/stood up. The exact authentik UI/API path is yours
to find on the instance; `payload/templates/oidc-app-and-flow.outcomes.md` is the end-state checklist.

- **An OIDC relying-party application for GLA** — a **confidential client** with a client id + client secret,
  whose **single allowed redirect URI equals** GLA's configured callback on **GLA's own public origin** (the
  `GLA_AUTHENTIK_REDIRECT_URI`, e.g. `https://<gla-public-host>/auth/callback`). authentik exact-matches the
  redirect URI. Turn **"include claims in id_token"** on so `sub`, `amr`/`acr`, `gla_uv`, `nonce`, `aud`, `exp` ride in
  the **id_token** (the adapter validates the id_token, not a userinfo round-trip). Scope `openid profile`
  suffices. The discovery doc's `issuer` must **equal** `GLA_AUTHENTIK_ISSUER_URL` (the adapter validates `iss`).
- **An authentication flow offering passkey AND password**, emitting a **distinguishing `amr` and UV proof** — an
  Identification stage leading to a WebAuthn-validator stage **and** a Password stage (plus any MFA), the user
  chooses. Then the **critical, version-sensitive, LOAD-BEARING** part (`§3.2`/`§8.2`), confirmed by the GLA-074
  rehearsal: **authentik 2025.10 emits `amr: []` (empty) by default** and only a generic `acr` — it does **not**
  distinguish passkey from password out of the box, so without this step GLA floors every login to `password`
  (the dual-method *strength* claim can't be realized). The **REQUIRED, PROVEN fix** ships in this bundle: apply
  **`payload/templates/amr-scope-mapping.py`** as a **custom OAuth2 provider scope mapping** (`scope_name:
  "openid"`, attached to GLA's provider's property mappings). Its expression reads authentik's recorded login
  method and populates `amr` plus GLA's UV proof claim: a **password** login → `["pwd"]` + `gla_uv:false` →
  `password`; a **passkey** login through a UV-required WebAuthn/passkey stage → `["swk"]` + `gla_uv:true` →
  `webauthn`. (See `amr-scope-mapping.md` for how to apply it via the API.) This **matches GLA's default method map**
  (`adapters/auth-authentik/src/strength.ts` `DEFAULT_METHOD_MAPS`: `{pwd}→password`, WebAuthn labels require
  `gla_uv:true` before they become `webauthn`), so **no adapter change and no `GLA_AUTHENTIK_AMR_MAP` override** is
  needed for this recipe. If the instance's labels differ, tune the expression's branches (and/or set the map) —
  but the flow **must** emit *something* separating the two tiers and `gla_uv:true` only for a UV-required passkey
  stage. **Verify the emitted `amr` and `gla_uv` against the running instance** (Step 2), never assume. **Proven live
  (authentik 2025.10.4):** after applying it, a real password login yielded `amr:["pwd"]`
  and GLA resolved `{ok:true, authStrength:"password", methodResolvable:true}`. If it cannot be made to
  distinguish the methods, the integration **safely degrades to `password`-only** (the adapter never up-maps) and
  the operator must be **warned**.
- **A stable, immutable `sub`** — set the provider **subject mode** to the user's **UUID / hashed id**, never
  username or email (which change). The recipient is enrolled against this `sub`; every later step-up checks
  `id_token.sub === the bound sub`. A mutable `sub` silently breaks re-verification.
- **The same-origin redirect_uri callback** (`§5.1`, from GLA-072) — wire Caddy so the `redirect_uri` resolves
  to a **GLA-served page on GLA's own origin** (the snippet in `payload/templates/caddy-authentik-callback.snippet`).
  The callback runs the page's return-detection that re-POSTs `{code,state}` to the gateway's **unchanged**
  `/handoff/auth/verify` (resp. `/enroll/verify`). **No grant leak:** the GLA grant rides only between GLA's page
  and GLA's own options/verify routes (same-origin browser state); GLA disables referrers on its HTML; authentik
  sees only the OIDC `code`/`state`. The callback is on GLA's origin, **not** authentik's, and is **not** the local
  bridge (the S-6 guard keeps the bridge local).
- **A declared invitation enrollment method policy** — record the safe descriptor that GLA reads as
  `GLA_AUTH_ENROLLMENT_POLICY_JSON`. It is **not** an authentik secret and it is **not** an access decision; it is
  operator-visible deployment evidence for `gla auth diagnostics`. The descriptor names the authentik enrollment
  flow, authentication flow, invitation stage, user-write/login stages, recipient-owned password setup stage,
  WebAuthn/passkey setup stage, configured OAuth/SAML source stages, required method ids, optional recipient
  choice groups, and MFA/recovery factors as provider evidence. Do **not** encode generated recipient passwords,
  invitation tokens, OAuth/SAML tokens, TOTP seeds, recovery codes, or client secrets. If the configured
  password/passkey/source methods cannot satisfy the selected `GLA_AUTH_ASSURANCE_POLICY`, the diagnostic must
  report a concern before the operator relies on invites for handoff. Every optional choice and required method id
  must be backed by a listed credential setup stage, source, or MFA/recovery method; unsupported choices are a
  diagnostic concern and must not be advertised as recipient-selectable.
- **First-boot bootstrap (to configure UNATTENDED)** — creating the OIDC provider/app + the `amr` scope mapping
  via the API needs an admin + an API token. authentik reads **`AUTHENTIK_BOOTSTRAP_PASSWORD`** (the initial
  `akadmin` password) and **`AUTHENTIK_BOOTSTRAP_TOKEN`** (an initial API token) **on first boot only**. The
  compose template (`payload/templates/authentik-compose.yml.tmpl`) already wires these as **optional,
  env-sourced (empty default) on the `server` AND the `worker`** (the same pattern as `PG_PASS`). Set
  `AK_BOOTSTRAP_PASSWORD` / `AK_BOOTSTRAP_TOKEN` in the `.env` / secret store **for the first boot**, run the
  configure step (create the provider/app, apply the `amr` scope mapping, attach it), then **unset them** (they
  have no effect after the initial bootstrap). They are **secret-bearing → never inline**. (The rehearsal injected
  exactly these to configure authentik 2025.10.4 unattended via the API.)
- **Point GLA at it** — write the connection config GLA reads: `GLA_AUTHENTIK_ISSUER_URL`,
  `GLA_AUTHENTIK_CLIENT_ID`, `GLA_AUTHENTIK_REDIRECT_URI`, and the **client secret via the secret seam** (a
  secret-ref), **never** a literal in any file/receipt/log (`§8.5`).
- **Version-branch the stack** (Managed/host-standup only) — authentik **≥2025.10 removes Redis**
  (caching/tasks/WebSocket moved to PostgreSQL); older versions need it. The compose template is parameterized;
  **omit Redis** on ≥2025.10 (`§2 A4`/`§8.3`). Detect the target version and compose accordingly. (The rehearsal
  ran the **Redis-free 2025.10.4 path** — postgres + server + worker only — successfully.)

## Step 2 — VERIFY end-to-end, then RECORD the DependencyBinding (task 6)

**Verify before record** (the bundle DoD). Prove it works against the **running** instance, then write the
receipt. Use the probes (next section); the acceptance evidence (`§7`):

- the discovery doc answers + token/JWKS answer → **the provider answers**;
- an `/authorize` request with GLA's `client_id`+`redirect_uri` is **accepted** → **the RP app exists**;
- a **passkey** login → `id_token.amr` plus `gla_uv:true` maps to `webauthn`; a **password** login → maps to
  `password` → **both methods AND the distinction**;
- **enroll → re-auth → same `sub`** → **stable subject**;
- `gla auth diagnostics` against the running daemon reports the declared enrollment flow/stages/sources/choices,
  `gla auth diagnostics --recipient <recipient-ref>` reports the concrete GLA-side binding state, provider-local
  authentik accounts are not conflated with GLA recipient bindings, no secrets are emitted, and the selected
  assurance profile has no concern (or a clear concern/action when the configured methods are too weak);
- GLA's `doctor`/`probe` reads the binding and reports `identity-provider` **available** → **the loop closes**.

Then **record the `DependencyBinding`** — the receipt that crosses the GLA↔wpm seam
(`payload/templates/dependency-binding.example.json` is the shape):

```
dependency:    "identity-provider"
ownershipMode: "local-external" | "remote-external" | "managed"   // reference: local-external
connection:    { issuer, clientId, redirectUri /*, scopes?, amrMap? */ }   // NO clientSecret here
enrollmentPolicyRef: <safe descriptor handle or literal summary>           // NO credential/token material
clientSecretRef: <secret-ref handle>            // the secret lives behind the secret seam, never inline
installed:     false   // local/remote-external = adopted; true only for a Managed standup
inverseOp:     <teardown step>   // present ONLY for a Managed (installed) stack
lastProbe:     { at, result: "available" | "degraded" | "unavailable", detail }
```

Record **only what inspection cannot recover**: installed-vs-adopted, the inverse op (Managed only), the chosen
issuer/redirect_uri/clientId, the safe enrollment-policy descriptor, and the `amrMap` if you tuned it. GLA's
runtime **reads** this and re-verifies it at runtime; **availability is system-derived** from the latest probe
(a down authentik → `unavailable`, admission/step-up fails closed).

**Honest deferral.** A real authentik cannot be stood up in a constrained build/sandbox (it is a multi-container
heavyweight stack). Where one is not available to probe, **record the end-to-end method-distinguishing proof and
the immutable-`sub` proof as deferred to the real deployment** — do **not** mark them satisfied (task-6 AC#8).
The deterministic strength behavior they rely on is already proven by the runtime adapter's own tests against
`FakeAuthentik`; the *real-instance* proof lands at the hermes-1 deploy (GLA-076).

## The probes (`installer-scripts/`)

Real, runnable logic an operator's agent runs against the live instance:

- **`check-nested-docker.sh`** — decides the ownership mode: prints `NESTED_DOCKER_OK` if a Compose stack can
  run here, `NESTED_DOCKER_BROKEN` if the storage driver is broken (the hermes-1 case → do not attempt Managed).
- **`probe-authentik.mjs <issuer-url> [clientId] [redirectUri]`** — the §7 probe table: `GET
  <issuer>/.well-known/openid-configuration` (expect 200 + a valid discovery doc), fetch the advertised JWKS
  (expect signing keys), confirm the `issuer` field matches, and (when given a `clientId`+`redirectUri`) shape
  the `/authorize` request and report whether the client+redirect are accepted vs unknown-client/bad-redirect.
  Exits non-zero with a typed reason on any failure so the verify step can branch.
- **`smoke-amr-strength.mjs`** — proves the `amr`/`acr` + `gla_uv`→strength mapping logic the flow must feed: it
  mints `FakeAuthentik`-style id_tokens for a passkey `amr` (`["swk"]`) with `gla_uv:true`, a passkey label
  without UV proof, and a password `amr` (`["pwd"]`), then asserts they map to `webauthn`, password floor, and
  `password` respectively (the deterministic stand-in for the real-instance proof, which the verify step runs
  against the live flow at deploy).

Keep the recipe and the probes correct so an operator's agent **can** run them against a real authentik — the
real host standup + the live OIDC proof is the deploy's job, not this build's.
