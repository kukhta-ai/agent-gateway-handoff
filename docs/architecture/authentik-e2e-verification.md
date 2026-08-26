# GLA — End-to-End Verification of the Delegated Provider (both methods) (GLA-075)

> **Status:** Solution-design sub-doc (the verification-shape contract **GLA-076** conforms to). **Scope:** fix
> **what proves, end to end, that the delegated authentik provider covers BOTH a passkey and a password behind
> the auth seam with no gateway change** — the capstone verification design. **Planning only:** it builds no
> test, runs nothing, and touches no backlog.
>
> **Sub-doc of `docs/architecture/authentik-integration.md`** and a sibling of `authentik-dual-method-flow.md`
> (the page mechanism + observable evidence, `§5`/`§7`) and `authentik-enrollment.md` (the enroll-then-step-up
> precondition). It builds on `docs/architecture/test-strategy.md` (the scenario-01 E2E harness, S-1, S-10).
> Those are **referenced, not restated**. The fixed core — the identity/auth **model + vocabulary** and the
> **security invariants** (`see docs/01-architecture-overview.md §6`, `docs/components/identity-and-auth.md`) —
> is held invariant; only the realization (the verification) is designed. GLA-068/070/072/074 (adapter,
> enrollment, dual-method flow, installer) are **merged**, so everything this verification exercises is real.

## How this was produced (Rule-3 note)

Same established reality as the master/sibling docs and the existing capstone: the BMAD E2E/test-design
workflows (`bmad-qa-generate-e2e-tests`, `bmad-testarch-test-design`) are hard-gated interactive (they greet
the user and **block on a mandatory scope/mode selection** — the same blocker recorded in
`test-strategy.md` and `packages/app/src/scenario-01-e2e.test.ts`) and **cannot run unattended** here. Per
`AGENTS.md` Rule 3's explicit allowance, that path was **stopped, the blocker named**, and this artifact was
driven **docs-first** plus a direct read of the real capstone (`packages/app/src/scenario-01-e2e.test.ts`,
GLA-066) and the test double (`adapters/auth-authentik/src/fake-authentik.ts`).

---

## §0 · The reader's map — section → acceptance criterion

| AC | What it fixes | Section |
|---|---|---|
| #1 | Two full handoffs — a **passkey run** AND a **password run** — each reaching the capsule via authentik | **§2** |
| #2 | The **seam invariant** observable: same gateway path for in-tree + delegated, composition-only swap | **§3** |
| #3 | **Strength-gating** observable E2E: `"webauthn"` route admits passkey, rejects password; `"password"` admits both | **§4** |
| #4 | The **negatives**: a recipient the provider does not vouch for does not reach the capsule | **§5** |

**§1** is the harness model (the concrete GLA-076 target); **§6** is the in-dev-vs-deploy split (the substance
GLA-076 asserts in dev vs the live confirmation deferred to hermes-1); **§7** is the risk set.

---

## §1 · The harness model — the GLA-066 capstone, with the authentik provider

The model is the existing **`packages/app/src/scenario-01-e2e.test.ts`** (GLA-066) — the **cold** scenario-01
capstone driving Phases E, 0–15 (`see docs/scenario-01-unified.html`, `test-strategy.md §2`) through **real**
modules (real `gla` CLI thread, real `channel-cli`, real `launcher-process` capsule, real headless Chromium,
real gateway) with the **in-tree WebAuthn provider** via a Playwright **virtual authenticator**. **GLA-076
builds the authentik analogue:** the **same full handoff thread**, composed with `createProvisioningBridge`,
but wired with the **delegated authentik provider** (`AuthAuthentikProvider`) instead of `AuthWebauthnProvider`,
and the OIDC ceremony stood in for by **`FakeAuthentik`** (the controllable OIDC double from GLA-068).

**Why `FakeAuthentik`, and exactly what it doubles** (`see adapters/auth-authentik/src/fake-authentik.ts`). It
is an in-process double (no real network, no real authentik) that:
- provides `endpoints()` + `jwks` to inject into the adapter (so discovery is skipped and signatures verify
  against the fake's local key),
- provides a `fetch` seam that fakes **only the token endpoint** (`code` → a staged id_token / HTTP error /
  no-token), asserting the relying-party sent `client_secret` + PKCE `code_verifier` (so a broken adapter call
  surfaces),
- **mints a signed id_token with a chosen `amr`** via `mintIdToken({sub, amr, nonce, …})` /
  `stageValidLogin(code, claims)` — so a **passkey run** stages an `amr` in GLA's webauthn set (e.g. `["swk"]`
  → `webauthn`) and a **password run** stages `amr:["pwd"]` (→ `password`),
- mints negative tokens (`mintBadlySignedIdToken`, `mintNoneAlgIdToken`, `mintHmacIdToken`, a wrong `sub`, a
  wrong/absent `nonce`, expired) and `stageHttpError`/`stageNoIdToken` for the negative cases (`§5`).

**The one compositional subtlety GLA-076 must handle (the load-bearing harness fact).** `FakeAuthentik`
doubles the **token endpoint + JWKS** but **stands up no `/authorize` browser server**. In production the
recipient's browser top-level-redirects to authentik's real `/authorize` and authentik redirects back to the
callback with `?code&state`. In the dev harness there is **no real authorize server to redirect to**, so the
harness **intercepts the redirect and synthesizes the callback**: when the gateway's provider-agnostic page
branch starts the redirect (`location.assign(authorizeUrl)`, `see authentik-dual-method-flow.md §5.2`), the
harness reads `state`/`nonce`/`redirect_uri` out of the `authorizeUrl`, **stages a valid login for the chosen
`code` with `{sub: <the enrolled subject>, amr: <chosen>, nonce: <the attempt's nonce>}`**, and **drives the
callback** (lands on GLA's callback page / re-POSTs `{code,state}` to the **unchanged** `/handoff/auth/verify`
exactly as the real callback would). From the gateway's and adapter's view this is indistinguishable from a
real authentik round-trip — the only thing faked is the human-at-authentik leg and the network (the same
posture the MVP used: a virtual authenticator + a stub site stand in for the real passkey device + real
website, `see test-strategy.md §2.3`).

**The seam table delta** (vs `test-strategy.md §2.3`): the `AuthProviderPort` row changes from
"`auth-webauthn` + virtual authenticator" to "**`auth-authentik` + `FakeAuthentik`** (token/JWKS doubled, the
authorize→callback leg synthesized by the harness)"; **every other row is identical** (real `channel-cli`,
real `launcher-process` capsule, real `entrypoint-novnc`, real `policy-cedar`, real gateway, the local
`acme.example` stub). That identity is itself part of the proof (`§3`).

---

## §2 · Two full handoffs — passkey run AND password run, each reaching the capsule (AC #1)

GLA-076 drives **two end-to-end runs of the real handoff thread through the authentik provider**, each
reaching the capsule, differing only in the method `FakeAuthentik` reports:

**Precondition (both runs): enrollment.** The recipient is first **enrolled through authentik** (the GLA-070
service path): `FakeAuthentik` stages a valid `register`-leg login, `finishEnrollment` binds
`subjects[userId]={sub}`, `IdentityService.isEnrolled(recipient)` becomes true (`see authentik-enrollment.md
§2`). Enrollment is the precondition every step-up rests on; the harness performs it once per run (cold).

**Run A — passkey.** Open a handoff window (the real `gla handoff open` saga: mint a recipient-bound grant,
program the route, deliver the link). The "human" Playwright client opens the link → the gateway verifies the
grant + serves the step-up page → **the page's provider-agnostic branch starts the redirect** (`kind:"redirect"`
→ `location.assign(authorizeUrl)`, `see authentik-dual-method-flow.md §5.2`) → the harness synthesizes the
callback with `amr:["swk"]` (passkey) and the enrolled `sub`/attempt `nonce` → the **unchanged**
`/handoff/auth/verify` exchanges+validates via `FakeAuthentik` → `verifyAssertion` returns
`{ok:true, authStrength:"webauthn", assurance:{level:"phishing-resistant"}}` → the gateway's auth assurance policy passes → the grant is
authorized → the **WS upgrade is proxied to the capsule's noVNC endpoint** (HTTP 101). The human reaches the
capsule.

**Run B — password.** Identical thread, except the harness synthesizes the callback with `amr:["pwd"]`
(password) → `verifyAssertion` returns `{ok:true, authStrength:"password", assurance:{level:"password"}}` → under the explicit
`password-permitted` policy the assurance gate passes → the grant is authorized → the **WS upgrade
reaches the capsule**. The human reaches the capsule via the password fallback.

**Observable (per `authentik-dual-method-flow.md §7`):** for each run, `gateway.isGrantAuthorized(grantId)`
is true and the **WS upgrade succeeds (101, the noVNC stream opens)** — the same observables the WebAuthn
capstone asserts at Phase 6 (`see test-strategy.md §2.4` Phase 6). The two runs together prove **both methods,
independently, drive the real gateway → real capsule through the delegated provider**. (The full thread may
also continue through completion/teardown, reusing the existing capstone's later phases unchanged — the
load-bearing new evidence is the **step-up-via-authentik reaching the capsule for each method**.)

---

## §3 · The seam invariant is observable (AC #2)

The seam invariant — **the same gateway code path serves both the in-tree (WebAuthn) and the delegated
(authentik) provider, selected only by composition** — is the provider-swap / S-10 invariant
(`see test-strategy.md §3 S-10`, `authentik-integration.md §1`) lifted to the auth seam. GLA-076 makes it
**observable** three ways:

1. **The same thread runs under both providers, swap = composition only.** The **same harness** (the same
   handoff thread, the same gateway, the same capsule, the same assertions) runs once with
   `GLA_AUTH_PROVIDER=webauthn` (the existing GLA-066 capstone, `auth-webauthn` + virtual authenticator) and
   once with `GLA_AUTH_PROVIDER=authentik` (`auth-authentik` + `FakeAuthentik`). The **only** difference is
   which adapter `packages/app` constructs and injects (`see authentik-integration.md §7`: the
   `GLA_AUTH_PROVIDER` switch + the OIDC config) — **no gateway/core source differs between the two runs.**
   Both reach the capsule; the gateway behaves identically.
2. **The static "no provider in core" check (carried from GLA-072).** GLA-076 re-asserts the
   `authentik-dual-method-flow.md §5.4`/`§8.1` gate: **no `"authentik"` string, no issuer/endpoint, no method
   name in `packages/gateway`** (a grep/static check; the page branch is a generic `options.kind` discriminant
   through which the WebAuthn provider flows). This proves the gateway is provider-agnostic **by construction**,
   not merely by behavior. (The repo already has the import-boundary selftest, `test-strategy.md §1.1`; this is
   the auth-seam analogue at the source level.)
3. **The gateway verify path is byte-identical across the swap.** The diff that introduced authentik touched
   **only** the provider-agnostic page branch + the GLA-served callback page + composition — **not**
   `/handoff/auth/verify`'s logic (`see authentik-dual-method-flow.md §5.2`). GLA-076 observes that the **same**
   `/handoff/auth/verify` handler (taking an opaque `assertion`, gating via `strengthSufficient`) serves the
   `{code,state}` assertion and the WebAuthn assertion alike.

**The conclusion the observation licenses:** the auth seam is **full-capability** — a whole new IdP, covering
two methods, slots in behind `AuthProviderPort` with a composition-only change, exactly as
`docs/01-architecture-overview.md §7` ("horizontal extension changes no core code") and `test-strategy.md
S-10` require. This is the headline thing GLA-076 proves.

---

## §4 · Strength-gating is observable end to end (AC #3)

The gating contract (`see authentik-dual-method-flow.md §4`: provider-neutral `AuthAssurancePolicy` +
`strengthSufficient`) is proven **end to end** through the real thread:

| Auth assurance policy | Passkey run (`amr:["swk"]` → `webauthn`) | Password run (`amr:["pwd"]` → `password`) |
|---|---|---|
| **`phishing-resistant`** (the default; demand the stronger method) | **admitted** → grant authorized → **WS reaches the capsule** | **rejected** → **403 `auth.insufficient`**, grant **not** authorized, **WS upgrade refused (401)**, capsule **not** reached |
| **`password-permitted`** (permit the fallback) | **admitted** | **admitted** — grant authorized → WS reaches the capsule |

**Observable.** Under the default `phishing-resistant` policy, the password run ends with `gateway.isGrantAuthorized(grantId)`
**false** and the WS upgrade **refused** (the gateway's `handleHandoffAuthVerify` returns 403 `auth.insufficient`
and never adds the grant — `see packages/gateway/src/index.ts`, `authentik-dual-method-flow.md §4`/`§7`),
**while** the passkey run on the same route ends authorized + WS-proxied. Under `password-permitted`,
**both** runs end authorized. This is **the same gate, same code**, gating an authentik result — proving the
strength contract holds end to end: a step requiring the stronger method **admits
the passkey run and rejects the password-only run**.

> This is the E2E lift of the in-dev gating evidence `authentik-dual-method-flow.md §7` already specified at
> the adapter+gateway layer — here driven through the **full** handoff thread to the real capsule, so the
> rejection is observed as "the human never reaches the capsule," not merely "the verify call returned 403."

---

## §5 · The negatives — a recipient the provider does not vouch for does not reach the capsule (AC #4)

GLA-076 covers, through the real thread, that **a recipient authentik does not vouch for never reaches the
capsule** — the delegated lift of S-1 (recipient-binding fail-closed) and S-10 (a forwarded link is useless,
`see test-strategy.md §3`). Each is staged via `FakeAuthentik` / the harness and asserts **the WS upgrade is
refused and the capsule receives no traffic**:

| Negative case | How it is staged | Observable (does NOT reach the capsule) |
|---|---|---|
| **Un-enrolled recipient** | a handoff for a recipient with no bound subject (no enrollment) | the adapter's `challenge` throws / the gateway serves the "not enrolled" catchable refusal (`auth.insufficient`); grant not authorized; WS refused (`see authentik-enrollment.md §5`) |
| **`subject_mismatch`** | `FakeAuthentik` mints a valid id_token with a **different `sub`** than the recipient's bound subject | `verifyAssertion` → `subject_mismatch` → `{ok:false}` → 403; grant not authorized; WS refused. **A valid authentik login by the WRONG person fails for THIS recipient** (`see adapters/auth-authentik/src/index.ts` step-(e)). |
| **Invalid / expired id_token** | `mintBadlySignedIdToken` / `mintNoneAlgIdToken` / `mintHmacIdToken` / a wrong-or-absent `nonce` / an expired `exp` / `stageHttpError` | `verifyAssertion` → `bad_signature`/`nonce_mismatch`/`expired`/`token_exchange_failed` → `{ok:false}` → 403; grant not authorized; WS refused |
| **Forwarded link (wrong recipient) — the S-10 lift** | the harness opens the **grant-bound link in a second context as a different recipient** (as the WebAuthn capstone does, `see test-strategy.md §3 S-10`); even a *valid* authentik login there resolves to a `sub` not bound to the grant's recipient | the recipient caveat on the grant + the `subject_mismatch` check both fail closed → WS refused; the capsule receives **no** traffic from the second context |

**The unifying property:** the gateway authorizes a grant **only** on a provider `{ok:true}` that **also**
meets the selected auth assurance policy **and** resolves to the grant's bound recipient's subject — so anything authentik
does **not** vouch for (un-enrolled, wrong subject, invalid token, forwarded link) yields `{ok:false}` (or a
recipient-caveat failure) → the grant stays unauthorized → the WS upgrade is refused → **the human does not
reach the capsule.** Fail-closed is preserved under delegation, end to end.

---

## §6 · In-dev assertions (the substance) vs deploy-deferred confirmation (be honest)

**The full thread against `FakeAuthentik` is fully testable IN DEV** — no real authentik is needed, exactly as
the MVP proved the WebAuthn path with a virtual authenticator + a stub site (`see test-strategy.md §2.3`,
`packages/app/src/scenario-01-e2e.test.ts`). `FakeAuthentik` doubles the only external leg (the IdP's
token/JWKS + the human-at-authentik step); **everything GLA owns is real** (the gateway, the adapter's full
OIDC validation pipeline, the capsule, the strength gate, the recipient binding). So the **substance is an
in-dev proof**, and a **live real-authentik round-trip is a deploy-time confirmation**.

**What GLA-076 asserts IN DEV (the substance — the GLA-side proof, all of §2–§5):**

- **Both methods reach the capsule** through the delegated provider: the passkey run and the password run each
  end with the grant authorized + the **WS upgrade proxied to the capsule** (`§2`).
- **The seam invariant:** the same thread under `GLA_AUTH_PROVIDER=webauthn` and `=authentik` with **no
  gateway/core source difference**, plus the **static no-`"authentik"`-in-`packages/gateway`** check, plus the
  byte-identical verify path (`§3`).
- **Strength-gating end to end:** a `"webauthn"`-required route admits the passkey run and **refuses** the
  password-only run (WS refused, capsule not reached); a `"password"`-required route admits both (`§4`).
- **The negatives:** un-enrolled / `subject_mismatch` / invalid-or-expired id_token / forwarded link each fail
  closed — the WS upgrade is refused and the capsule receives no traffic (`§5`).
- **Agent-blind (carried):** the human's authentik credential and the OIDC secrets never appear in any
  agent-readable output/audit (the S-2 scan the capstone already runs, `see test-strategy.md §3 S-2`).

**What is a DEPLOY-TIME confirmation (deferred, recorded — per GLA-074 task-6 AC#8):**

- A **live OIDC round-trip against a real authentik** (the host-level Local-External standup GLA-074 stands up,
  `see authentik-service-standup.md §1`): a real passkey login and a real password login at the real authentik
  flow, each producing a real `id_token` whose **real `amr`** maps to `webauthn`/`password`, driving a real
  handoff to a real capsule on hermes-1 behind the host Caddy. This confirms the **`amr`-emission config** and
  the **same-origin `redirect_uri`/no-grant-leak** routing in the actual environment (the
  `authentik-service-standup.md §8.2`/`§8.6` risks) — things `FakeAuthentik` **assumes** (it mints whatever
  `amr` it is told). It is **recorded-as-deferred** (the GLA-074 installer verify step + its task-6 AC#8 own
  the live proof), not a GLA-076 in-dev gate, because it needs the real heavyweight stack that cannot run in
  CI/dev.
- The deploy-time proof is recorded as redacted `loginMethodProofs[]`: password, WebAuthn/passkey with UV, and
  configured external/social/enterprise sources each carry only descriptor-safe fields (`method`, `kind`, `label`,
  `stage`, `source`, `status`, `authStrength`, `assuranceLevel`, `observedAt`, `subjectStable`, `evidence`,
  `diagnostics`). The evidence object may include safe claim labels such as `amr:["pwd"]` or
  `amr:["swk"],gla_uv:true,recipientBound:true,replayResistant:true`, but never raw id_tokens, access tokens,
  OIDC codes, code verifiers, grants, passwords, source tokens, or passkey material.

> **The honest split:** GLA-076 proves **the GLA side is correct and the seam holds** (both methods, gating,
> negatives, swap) deterministically in dev with `FakeAuthentik`; the **deploy** confirms **authentik is
> actually configured to emit the distinguishing `amr` and the routing agrees on one origin** in the live
> environment. Neither substitutes for the other; together they are the complete proof.

### §6.1 · GLA-093 proof-quality labels

GLA-093 tightens how the proof is reported and tested. The evidence labels are:

| Evidence class | What it proves | Current owner |
|---|---|---|
| **Synthetic OIDC proof** | `FakeAuthentik` signs deterministic id_tokens, stages token/JWKS behavior, and lets the GLA adapter/gateway/session/capsule thread prove strength mapping, recipient binding, failure reasons, and replay behavior without a live IdP. | `adapters/auth-authentik/src/auth-authentik.test.ts` and synthetic branches of `packages/app/src/authentik-scenario-e2e.test.ts` |
| **Browser-level GLA proof** | A real Chromium page opens the GLA handoff page, receives the delegated redirect challenge, is redirected back to the **GLA-served** `/auth/callback` URL, and the callback page posts `{code,state}` to the unchanged verify route before the grant can reach the capsule. | `packages/app/src/authentik-scenario-e2e.test.ts` |
| **Gateway/capsule no-leak proof** | Refused flows assert explicit upstream connection and byte counters, not only absence of a marker string. Positive flows assert the counters increase. Wrong-recipient and upstream-leak canaries intentionally fail the suite when enabled. | `packages/app/src/authentik-scenario-e2e.test.ts` and `pnpm run gate:e2e-proof-canaries` |
| **Deployed-provider proof** | Real authentik login flows, real emitted `amr`/`acr`/`gla_uv`, real sources, and same-origin Caddy routing are verified in the WPM/deployment layer and recorded as redacted `loginMethodProofs[]`. | GLA-074 installer/deployment verification and GLA-086 diagnostics |

These labels prevent over-claiming. A green in-repo gate proves the GLA-side contract and browser callback
handling; it does **not** by itself prove that a particular deployed authentik instance exposes every intended
login method or emits the production claims correctly.

---

## §7 · Risks GLA-076 must watch

1. **Composing `FakeAuthentik` with the real capsule/handoff thread (the central harness risk).**
   `FakeAuthentik` doubles the token/JWKS but **not the `/authorize` browser leg**, so the harness must
   **synthesize the callback** (read `state`/`nonce`/`redirect_uri` from the intercepted `authorizeUrl`, stage
   a valid login for the chosen `code` with the **enrolled `sub`** and the **attempt's `nonce`**, then drive
   the callback into the **unchanged** `/handoff/auth/verify`) (`§1`). The fidelity hinges on getting the
   `nonce`/`sub` binding right — a mismatch makes the adapter (correctly) reject, so the harness must thread the
   real attempt's `nonce` (e.g. via the adapter's injected randomness/diagnostic seam or by reading the
   `authorizeUrl`) rather than guessing. This is realization work the GLA-076 author must get exactly right;
   the adapter's existing unit tests (`auth-authentik.test.ts`) show the precise staging pattern to mirror.
2. **Proving the seam invariant rigorously (not just "both pass").** AC #2 needs more than "the authentik run
   also reaches the capsule" — it needs the **swap to be composition-only**. GLA-076 must (a) drive the **same**
   harness/assertions under both providers (not two divergent tests), (b) keep the **static no-provider-string-
   in-`packages/gateway`** check as a hard assertion, and (c) make the byte-identical-verify-path claim
   checkable (the diff that added authentik does not touch `/handoff/auth/verify`'s logic). A weak version
   (two unrelated tests that both happen to pass) does **not** prove the invariant.
3. **The auth assurance policy setup for the gating runs (`§4`).** GLA-076 must construct routes/sessions
   with a **known** policy (`phishing-resistant` vs `password-permitted`) to make the admit/reject matrix
   observable; the harness must set/read `authAssuranceProfile` per run (via the gateway composition options,
   `see packages/gateway/src/index.ts` `GatewayOptions.authAssurancePolicy`) — and the password-run-refused
   assertion must observe the **WS upgrade refusal** (capsule not reached), not merely the 403, to be a true
   end-to-end gate.
4. **Cold/hermetic + capsule reaping (carried from GLA-066).** The run spawns a **real capsule** (gated on
   cached Chromium, `see scenario-01-e2e.test.ts`); GLA-076 must reap the capsule/broker/gateway/browsers in a
   `finally`/`afterAll` and run cold (fresh bridge per test), exactly as the capstone does — and stay green in
   `pnpm gate`.
5. **The negative cases must reach the WS layer (`§5`).** It is not enough that `verifyAssertion` returns
   `{ok:false}` — GLA-076 must assert the **WS upgrade is refused and the capsule receives no traffic** (the
   S-1/S-10 posture), so a regression that authorized a grant despite a bad result would be caught at the edge,
   not just at the adapter.
6. **Don't over-claim the deploy leg (`§6`).** GLA-076 must **explicitly scope** its in-dev assertions to the
   GLA-side proof and **record the live-authentik round-trip as deferred** (GLA-074's verify step owns it) —
   not silently imply a real authentik was exercised. The `amr`-emission + same-origin-routing confirmations
   are deploy-time; conflating them with the in-dev `FakeAuthentik` proof would misrepresent coverage.

---

## §8 · Conformance summary (the contract this doc fixes)

1. GLA-076 drives **two full handoffs through the authentik provider** — a **passkey run** (`amr`→`webauthn`)
   and a **password run** (`amr:["pwd"]`→`password`) — each reaching the real capsule via the real gateway,
   with `FakeAuthentik` doubling the OIDC IdP and the harness synthesizing the callback (`§1`, `§2`).
2. The **seam invariant** is observable: the **same** thread runs under `GLA_AUTH_PROVIDER=webauthn` and
   `=authentik` with **no gateway/core source difference**, plus a **static no-`"authentik"`-in-
   `packages/gateway`** check and a byte-identical verify path — the auth seam is full-capability (S-10 lifted)
   (`§3`).
3. **Strength-gating** holds end to end on the **existing** gate: a `"webauthn"`-required route **admits the
   passkey run and refuses the password-only run** (WS refused, capsule not reached); a `"password"`-required
   route admits both (`§4`).
4. The **negatives** fail closed end to end: un-enrolled / `subject_mismatch` / invalid-or-expired id_token /
   forwarded link → the WS upgrade is refused and the capsule receives no traffic (`§5`).
5. The **substance is an in-dev proof** (`FakeAuthentik`, deterministic, in `pnpm gate`): both methods reach
   the capsule, the seam invariant, the gating matrix, the negatives, agent-blind; a **live real-authentik
   round-trip is a deploy-time confirmation** recorded-as-deferred (GLA-074's verify step, task-6 AC#8) for the
   `amr`-emission + same-origin routing in the real environment (`§6`).

## Related

`docs/architecture/authentik-integration.md` (the master — `§1` seam-preserving, `§7` the `GLA_AUTH_PROVIDER`
switch) · `docs/architecture/authentik-dual-method-flow.md` (`§4` the strength gate, `§5` the page mechanism,
`§7` the observable evidence, `§8` the security-review gates) · `docs/architecture/authentik-enrollment.md`
(`§2`/`§5` the enroll-then-step-up precondition) · `docs/architecture/authentik-service-standup.md` (`§1`/`§7`
the host-level standup + the live-proof the deploy confirms) · `docs/architecture/test-strategy.md` (`§2` the
scenario-01 E2E harness, `§3` S-1/S-2/S-10, `§4.2` the GLA-066 capstone) · `docs/scenario-01-unified.html`
(Phase 6, the handoff step-up) · `docs/01-architecture-overview.md §6`/`§7` (the security model + horizontal
extension) · `docs/components/identity-and-auth.md` (the identity/auth model) ·
`packages/app/src/scenario-01-e2e.test.ts` (GLA-066 — the capstone GLA-076 mirrors) ·
`adapters/auth-authentik/src/fake-authentik.ts` (the controllable OIDC double GLA-076 drives) ·
`adapters/auth-authentik/src/index.ts` (`challenge`/`verifyAssertion`, the `subject_mismatch` check) ·
`packages/gateway/src/index.ts` (`AuthAssurancePolicy`/`strengthSufficient`, the unchanged `/handoff/auth/verify`).
