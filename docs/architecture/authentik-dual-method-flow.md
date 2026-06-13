# GLA — Passkey-and-Password Authentication Flow (GLA-071)

> **Status:** Solution-design sub-doc (the dual-method step-up + strength-gating contract **GLA-072**
> conforms to). **Scope:** fix how a recipient satisfies a step-up with **either a passkey or a password**
> under the delegated authentik provider, how each method maps to `AuthStrength`, how an enforcement point
> gates on a minimum strength, and — the load-bearing decision — **the concrete browser mechanism** by which
> the OIDC redirect flow is served (finalizing the open tension in `authentik-integration.md §2`). **Planning
> only:** it builds no code and touches no backlog.
>
> **Sub-doc of `docs/architecture/authentik-integration.md`** (the OIDC flow `§2`, the method→strength map
> `§4`) and a sibling of `docs/architecture/authentik-enrollment.md` (the shared callback). Those are
> **referenced, not restated**. The fixed core — the identity/auth **model + vocabulary**
> (`see docs/components/identity-and-auth.md`, `docs/01-architecture-overview.md §6`) — is held invariant;
> only the realization is designed. GLA-068 (adapter) and GLA-070 (service-layer enrollment) are **merged**,
> so this plan is grounded in the **real** code.

## How this was produced (Rule-3 note)

Same established reality as the master/sibling docs: `bmad-create-architecture` is hard-gated interactive
(`step-01-init`: *"NEVER generate content without user input … a FACILITATOR, not a content generator … Do NOT
proceed until the user selects 'C'"*) and **cannot run unattended** here. Per `AGENTS.md` Rule 3's explicit
allowance, that path was **stopped, the blocker named**, and this artifact was driven **docs-first** plus a
direct read of the real gateway (`packages/gateway/src/{index.ts,handoff-page.ts,enroll-page.ts}`) and adapter
(`adapters/auth-authentik/src/{index.ts,oidc.ts,strength.ts}`).

---

## §0 · The reader's map — section → acceptance criterion

| AC | What it fixes | Section |
|---|---|---|
| #1 | Both methods offered; authentik hosts both; GLA = redirect → read → gate | **§2** |
| #2 | Auth-strength per method (passkey > password), onto master §4 | **§3** |
| #3 | The strength-gating contract — the **existing** gateway mechanism, unchanged | **§4** |
| #4 | The recipient experience (choose / no-passkey / failed) | **§6** |
| #5 | The GLA-072 build plan + the observable acceptance evidence | **§7** |

**§5 is the load-bearing decision** (the served-page mechanism — finalizing `authentik-integration.md §2`'s
open tension); **§8** is the risk set the GLA-072 security review must focus on.

---

## §1 · Background — what "the flow" is under delegation

Under the in-tree default the step-up is a **same-page WebAuthn ceremony**: the gateway serves
`handoffPageHtml`, which POSTs `/handoff/auth/options` → runs `navigator.credentials.get(options)` in the page
→ POSTs the assertion to `/handoff/auth/verify` (`see packages/gateway/src/handoff-page.ts`). Under the
delegated authentik provider the step-up is **not** a same-page ceremony — it is a **top-level redirect to
authentik's hosted login** (which presents passkey and/or password) **and back**. GLA's job shrinks to three
verbs: **redirect → read the result (`amr`→strength) → gate**. Everything below specifies that flow and the
one realization change it forces.

---

## §2 · Both methods offered — authentik hosts them; GLA redirects, reads, gates (AC #1)

**Key framing:** under the authentik provider, **both the passkey and the password fallback are hosted BY
authentik.** GLA never runs either ceremony itself — it **always redirects** to authentik's flow, which
presents a passkey stage and/or a password stage; **the human chooses**; authentik authenticates them and
returns an `id_token` whose **`amr`** says which method was used. So *"offer both methods"* resolves to:
**authentik's flow offers both; GLA's job is redirect → read result → gate.** Concretely, on the **real**
adapter (`see adapters/auth-authentik/src/index.ts`):

1. **Redirect.** `challenge(userId)` builds the OIDC authorization request and returns the opaque
   `RedirectChallenge` `{kind:"redirect", authorizeUrl}`. The page top-level-navigates to `authorizeUrl`
   (`§5`). authentik renders **its** login (passkey + password + MFA stages, per the flow GLA-073/074
   configures).
2. **The human picks a method at authentik.** A recipient with a passkey uses it; one without uses the
   password stage. GLA is not involved — the credential lives in authentik (`see authentik-integration.md
   §5`).
3. **Read.** authentik redirects back to the adapter callback with `?code&state`;
   `verifyAssertion(userId, {code,state})` exchanges + validates the `id_token`, checks `sub` against the
   binding, and **derives provider-neutral assurance from `amr`/`acr`** (`§3`). Either method, validated,
   **independently satisfies the step-up** under the right policy — the gateway sees `{ok, authStrength,
   assurance?}` facts and never inspects the provider-local method values.
4. **Gate.** The gateway compares the common assurance fact to the route's policy (`§4`).

**Contrast with the in-tree default** (so the difference is explicit): there, passkey is an **in-page**
`navigator.credentials.get`, there is no password fallback in one provider, and there is no redirect. The
authentik provider trades the same-page ceremony for a redirect **precisely because** it gets *both* methods
(and MFA) in one hosted flow — the whole point of the delegated provider (`see authentik-integration.md`).

> **No provider-specific gateway knowledge.** "Both methods" is entirely an authentik-flow + adapter concern.
> The gateway only ever sees provider-neutral facts (`authStrength` plus optional `AuthAssuranceEvidence`) — the
> same boundary the WebAuthn provider uses — so the dual-method capability adds **zero** method-awareness to core
> (`§4`, `§5`).

---

## §3 · Auth-strength per method — passkey ranked stronger than password (AC #2)

Each method yields a strength via the master map (`see authentik-integration.md §4`; the pure function
`adapters/auth-authentik/src/strength.ts`), keyed on the `id_token`'s **`amr`** (RFC 8176), with **`acr`** as
the coarse fallback:

| Method the human used at authentik | `id_token.amr` (canonical tokens) | → `AuthStrength` |
|---|---|---|
| **Passkey** (phishing-resistant key) | any of `{hwk, swk, webauthn, fido}` (or `acr` ∈ `{phr}`) | **`webauthn`** (strongest) |
| **Password** (typed) | `{pwd}` — including `["pwd","mfa"]`/`["pwd","otp"]` (MFA on a password is still **not** key auth) | **`password`** |
| valid token, method not resolvable to either tier | neither set matches | **`password`** (the floor for a valid login; **never** silently `webauthn`) |
| token invalid / exchange failed / `sub` mismatch | — | **`none`** (with `ok:false`) |

The ranking is GLA's frozen total order **`none < password < webauthn`** (`see docs/components/identity-and-auth.md`;
`AuthStrength` in `kernel-contracts.md §7`). **Passkey > password** is therefore a fact the gating contract
(`§4`) reads directly. The mapping's hard rule (`strength.ts`): **never up-map** — a missing/ambiguous method
must never become `webauthn` (that would silently weaken the phishing-resistance guarantee); the floor is
`password` for a valid token, `none` for an invalid one. The method→token map is operator-overridable
(deployments whose authentik labels differ) but the defaults above are the **contract**, and GLA-073/074 must
configure authentik to **emit** an `amr` that distinguishes the two (`§8` risk).

---

## §4 · The strength-gating contract — the EXISTING gateway mechanism, unchanged (AC #3)

An enforcement point can **require a minimum strength**, so a step demanding the stronger method **rejects a
password-only result**. This is **already** the gateway's mechanism and needs **no change** — confirmed in the
real code (`see packages/gateway/src/index.ts`):

**Where the requirement is set.** The Access Gateway carries an `AuthAssurancePolicy`, constructed from the
deployment profile in `packages/app` and defaulting to **`phishing-resistant`**. A deployment that wants to
*permit* the password fallback sets **`GLA_AUTH_ASSURANCE_POLICY=password-permitted`**; one that demands
phishing-resistance leaves the default. The older `requiredAuthStrength` input is now only a compatibility
translation layer (`"webauthn"` → `phishing-resistant`, `"password"` → `password-permitted`).

**How it gates.** `strengthSufficient(assurance)` delegates to the kernel's provider-neutral assurance policy
evaluation (`none < password < phishing-resistant`; `webauthn` projects to phishing-resistant when legacy
providers omit explicit evidence). In
`POST /handoff/auth/verify` the gateway calls
`stepUp.verifyAuthentication(recipient, body.assertion)` → `{ok, authStrength, assurance?}` and then:

- if `!factResult.ok || !this.strengthSufficient(factResult.assurance ?? factResult.authStrength)` → **refuse**:
  HTTP **403** with
  `{ error: { code: "auth.insufficient", message: "step-up did not satisfy the selected auth assurance policy" } }`, and
  **the grant is NOT added to `authorizedGrants`** — so the subsequent WS upgrade is refused (401) and the
  capsule is never reached;
- else → `authorizedGrants.add(grantId)`, record the recipient-level auth-reuse validity, and respond `200
  { authorized: true, auth_strength: factResult.authStrength }`.

**What a rejected result looks like, end to end.** A recipient who used the **password** stage under the
default `phishing-resistant` policy produces `{ok:true, authStrength:"password"}`;
`strengthSufficient("password")` is **false** → 403 `auth.insufficient`, grant unauthorized, WS upgrade
refused, the gateway serves the catchable refusal (`§6`). A **passkey** result under the same policy produces
`{ok:true, authStrength:"webauthn"}` → sufficient → authorized, WS proxied. **Both methods independently
satisfy** the `password-permitted` profile; **only the passkey/phishing-resistant result** satisfies the
default profile.

> **The authentik password-only result yields `authStrength:"password"`** (`§3`), which the gateway rejects
> under `phishing-resistant` and accepts only under `password-permitted`. The gating is provider-agnostic by
> construction: it reads the common assurance contract, never the raw method or provider.

---

## §5 · THE LOAD-BEARING DECISION — the served-page mechanism (finalizing `authentik-integration.md §2`)

`authentik-integration.md §2` left a choice between **(i)** the adapter callback re-POSTs `{code,state}` to
the **existing** `/handoff/auth/verify` (so the gateway verify path is literally unchanged) and **(ii)** a
generic page branch on the opaque options' shape. Reading the real code shows **the two are not exclusive —
the honest, complete mechanism is (i) PLUS a minimal (ii)**, and that is what is **finalized here** so GLA-072
does not re-decide.

### §5.1 · Why a page change is unavoidable, and why it is small

The gateway **serves** `handoffPageHtml`/`enrollPageHtml` (compiled into `packages/gateway`), and that page's
*completion mechanism* is hardcoded to the WebAuthn same-page ceremony (`navigator.credentials.get` /
`navigator.credentials.create`). An OIDC flow needs a **top-level redirect** instead. The opaque options the
gateway already passes to the page (`stepUp.authenticationOptions(recipient)` → `unknown`; under authentik,
the `RedirectChallenge` `{kind:"redirect", authorizeUrl}`) **can carry the discriminant**, so the page change
is a **one-time, provider-agnostic generalization**, not authentik logic.

### §5.2 · The finalized mechanism (what GLA-072 builds)

**Which gateway files GLA-072 touches, and how:**

1. **`packages/gateway/src/handoff-page.ts`** — generalize the page's completion step to **branch on the
   options' shape it already receives** (the `/handoff/auth/options` response):
   - `if (options.kind === "redirect")` → `location.assign(options.authorizeUrl)` (start the OIDC redirect);
   - `else` → the **existing** in-page `navigator.credentials.get(options)` → POST `/handoff/auth/verify`.
   The branch is **generic** (a discriminant on the opaque options); **the WebAuthn provider flows through the
   `else` arm unchanged**. Selecting authentik adds **no** authentik-specific code to the gateway — it merely
   makes the `if` arm reachable.
2. **`packages/gateway/src/enroll-page.ts`** — the **same** generic generalization for the enrollment page
   (`navigator.credentials.create` ↔ `location.assign(authorizeUrl)`), since delegated **enrollment** needs
   the identical redirect (this is the shared browser path `authentik-enrollment.md §8` flagged — GLA-072
   builds it once, GLA-070's service slice consumes it).
3. **The adapter-owned callback listener** — a small HTTP endpoint **owned by `@gla/auth-authentik` and stood
   up in `packages/app` composition**, fronted by the **same host Caddy** at a distinct path (e.g.
   `/auth/callback`), **NOT a new gateway route** (`§8`). It receives `?code&state` and **re-POSTs
   `{code,state}` to the gateway's existing `/handoff/auth/verify`** (for step-up) or `/enroll/verify` (for
   enrollment) **as the opaque `assertion`/`attestation`** — i.e. **option (i)**. After the gateway authorizes
   the grant, the callback bounces the browser back to the handoff route so the existing WS-open path resumes.

**The gateway's verify path stays UNCHANGED.** `POST /handoff/auth/verify` already takes `body.assertion` as
**opaque `unknown`** and passes it straight to `stepUp.verifyAuthentication(recipient, body.assertion)`
(`see packages/gateway/src/index.ts`). Receiving `{code,state}` instead of a WebAuthn assertion requires **no
edit** — the adapter's `verifyAssertion` consumes exactly that shape. The handoff verify **response already
echoes the recorded strength** (`{ authorized: true, auth_strength: factResult.authStrength }`,
`index.ts:752`) — already provider-agnostic.

4. **One carry-over fix (from GLA-070), provider-agnostic.** `POST /enroll/verify` currently **hardcodes** its
   success response: `this.sendJson(res, 200, { enrolled: true, auth_strength: "webauthn" })`
   (`index.ts:592`). When GLA-072 generalizes the pages it must also make this response **echo the recorded
   strength** (the strength the identity service/provider actually returned — `"webauthn"` for a passkey
   enrollment, `"password"` for a password-only delegated enrollment), generically — so the enroll response is
   truthful under either provider. (The handoff response at `:752` is already correct; only the enroll
   response is hardcoded.)

### §5.3 · Why this preserves the gateway's security invariants

The generalization touches **only the served page's *completion mechanism*** and the **shape of an opaque
payload** — **none of the security-critical paths** (`docs/components/access-gateway.md`,
`docs/01-architecture-overview.md §6`):

- **Sole public entry — preserved.** The gateway remains the only door; the callback is an **adapter-owned**
  endpoint behind the **same** Caddy, not a second gateway door and **never** the local bridge
  (`daemon.ts`'s S-6 guard keeps the bridge local). It is a *new public surface* — the one genuinely new thing
  — so `§8` treats it as a first-class review target.
- **Grant-verify-every-request — preserved.** The page change cannot bypass anything: `/handoff/auth/options`,
  `/handoff/auth/verify`, and **every WS upgrade** still verify the recipient-bound grant statelessly
  (signature, recipient caveat, TTL, scope, revocation) **before** anything else, exactly as today. The
  callback's re-POST to `/handoff/auth/verify` **carries the grant** and is verified like any other request —
  it is not a privileged path.
- **SSRF-closed WS proxy — preserved.** The proxy still opens only to a **mounted route's** `internalEndpoint`,
  replays only handshake-relevant headers (dropping `Cookie`/`Authorization`/`X-Forwarded-*`), with connect +
  idle timeouts. The page generalization touches none of this.
- **Agent-blind — preserved.** The agent still has no path through the gateway; the connector is still
  suspended while a window is open. Untouched.
- **Recipient-binding — preserved.** The binding is still enforced cryptographically every request/upgrade and
  re-checked at step-up (`sub` vs the bound subject, in the adapter). The page cannot widen it.

### §5.4 · Is this within "selecting it changes no gateway code"?

**Honest framing.** Strictly, GLA-072 **does** edit two gateway files (`handoff-page.ts`, `enroll-page.ts`)
plus the one-line enroll-response fix — so "selecting authentik changes no gateway code" is true **only after**
a **one-time, provider-agnostic generalization**. This is **sanctioned** under `AGENTS.md`'s
fixed-vs-refinable split: the served page is **realization** ("open to refinement"), **not** the fixed core
(goals / model / vocabulary). The generalization is the *good* kind — after it lands, **provider selection
changes nothing**: the WebAuthn provider and the authentik provider both flow through the same generic
`options.kind` branch, and a *third* future provider that is also redirect-based reuses it for free. This is
exactly the master `§1`/`§9` intent ("a one-time provider-agnostic generalization, after which provider
selection changes nothing") realized concretely.

**What is NOT a scope surface:** the generic options-shape branch and the opaque-payload pass-through — these
are refinement of realization, the BMAD `architect`/review loop's job.

**What the GLA-072 security review MUST verify (the gate on this being legitimate, not a smuggled
special-case):** that the page branch is **genuinely provider-agnostic** (no string `"authentik"`, no
issuer/endpoint, no method names in `packages/gateway`; the discriminant is a *generic* `kind`), that the
**verify path is byte-for-byte unchanged**, and that the security invariants above **hold unchanged** (`§8`).
If the review finds any authentik-specific branch leaking into the gateway, **that** is the scope surface —
stop and surface it; do not let provider knowledge into core.

---

## §6 · Recipient experience (AC #4)

The flow is designed for three cases (the page + authentik render these; GLA gates the result):

- **Choosing a method.** The recipient opens the handoff link; the gateway verifies the grant and serves the
  step-up page; the page **redirects to authentik's hosted login**, which presents the configured stages
  (passkey and/or password, MFA). The recipient **chooses** — tap the passkey, or fall back to the password
  field. On success authentik returns; the gateway gates and, if sufficient, opens the secure session. The
  recipient sees authentik's branded login (not GLA's) for the credential step — a deliberate consequence of
  delegation (the credential lives there).
- **A recipient with no passkey.** They use authentik's **password stage** (+ any MFA the operator
  configured). The result is `authStrength:"password"`. Under the explicit `password-permitted` policy the
  session opens; under the default `phishing-resistant` policy they are **refused** with the catchable "did not
  satisfy the selected auth assurance policy" message (`§4`) — the design lets the *operator* decide per deployment whether
  the password fallback is acceptable, by setting the policy.
- **A failed attempt.** A cancelled/failed authentik login, an authentik error, or **no valid `id_token`**
  (bad signature / wrong `nonce` / expired / `sub` mismatch / token-exchange failure) yields **`ok:false`**
  from `verifyAssertion` → the gateway's `auth.insufficient` **catchable refusal** (the same "Verification was
  not completed — try again" / "This link is invalid…" posture the WebAuthn path already uses,
  `see packages/gateway/src/handoff-page.ts`), the grant **not** authorized, the capsule **not** reached. The
  adapter classifies *which* check failed via its typed `AuthFailReason` + diagnostic sink (for
  operator/test observability), but the recipient sees only a generic, non-leaking refusal.

The un-enrolled case is unchanged from `authentik-enrollment.md §5` (no bound subject → `challenge` throws →
the gateway's "not enrolled" refusal). Auth-reuse (Phase 12) is unaffected: a successful step-up of **either**
method records the recipient's strength for reuse on a later window, and the second window honors the same
requirement (`see packages/gateway/src/index.ts` `recordRecipientAuth`/`recipientAuthValid`).

---

## §7 · Implementation plan for GLA-072 (AC #5)

GLA-072 builds *both passkey and password step-up via authentik* — the dual-method flow + the shared redirect
machinery, with the two acceptance properties observable. Concrete steps:

1. **Generalize the served pages (provider-agnostic).** In `handoff-page.ts` and `enroll-page.ts`, branch on
   the opaque options' shape: `kind:"redirect"` → `location.assign(authorizeUrl)`; else the existing in-page
   WebAuthn ceremony (`§5.2`). No provider name enters the gateway.
2. **Build the adapter-owned callback** (in `@gla/auth-authentik` + `packages/app` composition): a small public
   endpoint behind the same Caddy that takes `?code&state` and **re-POSTs `{code,state}`** to the **existing**
   `/handoff/auth/verify` (step-up) or `/enroll/verify` (enroll) as the opaque assertion, then bounces the
   browser to the handoff route (`§5.2`, option (i)). This is the **shared** callback `authentik-enrollment.md
   §8` flagged — built once here, consumed by both step-up and enrollment.
3. **Make the `/enroll/verify` response echo the recorded strength** (`index.ts:592`), provider-agnostically
   (`§5.2.4`).
4. **Wire the policy.** Confirm `GLA_AUTH_ASSURANCE_POLICY` / `authAssuranceProfile` flows from composition
   (`packages/app`) and that a deployment can set `password-permitted` (permit the fallback) or leave
   `phishing-resistant` (demand passkey-grade evidence). `requiredAuthStrength` remains only a compatibility
   translation layer.
5. **Tests (the acceptance evidence)** — with `FakeAuthentik` (`see adapters/auth-authentik/src/fake-authentik.ts`)
   minting `id_token`s with chosen `amr`:
   - **Both methods independently satisfy a step-up:** a passkey `amr` (`["swk"]`) → `webauthn` → authorized;
     a password `amr` (`["pwd"]`) → `password` → authorized **under `password-permitted`**. Both reach
     the WS-proxy authorized state.
   - **A too-weak result is rejected where a stronger one is required:** under `phishing-resistant`, a password
     `amr` (`["pwd"]`) → `password` → **403 `auth.insufficient`**, grant **not** in `authorizedGrants`,
     WS upgrade **refused** — while a passkey `amr` on the same route is authorized.
   - **Failed attempt:** an invalid `id_token` (bad nonce/signature) → `ok:false` → catchable refusal, grant
     unauthorized.
   - **Provider-agnostic page proof:** the WebAuthn provider's E2E still passes through the generalized page
     unchanged (the `else` arm); a static check (or review) confirms no `"authentik"`/issuer string in
     `packages/gateway`.

**How the two required properties are OBSERVED (acceptance evidence):**

| Property (AC #5) | Observable |
|---|---|
| **Both methods independently satisfy a step-up** | with `authAssuranceProfile:"password-permitted"`, a passkey result *and* a password result each end with the grant in `authorizedGrants` (gateway `isGrantAuthorized(grantId)` true) and the WS upgrade proxied; the verify response is `{authorized:true, auth_strength:"webauthn"|"password"}`. |
| **A too-weak result is rejected where a stronger one is required** | with the default `authAssuranceProfile:"phishing-resistant"`, a password result → `verifyAuthentication`→`{authStrength:"password", assurance:{level:"password"}}` → gateway 403 `auth.insufficient`, `isGrantAuthorized(grantId)` **false**, the WS upgrade refused (401); the passkey result on the same route → authorized. |

**What GLA-068/070 already provide vs what GLA-072 builds.**

| Already provided (GLA-068 adapter / GLA-070 service) | GLA-072 builds |
|---|---|
| `challenge`→`{kind:"redirect",authorizeUrl}`, `verifyAssertion({code,state})`→`{ok,authStrength,assurance?}`, the `amr`/`acr`→assurance map (`strength.ts`), `FakeAuthentik` | the **generic page branch** in `handoff-page.ts`/`enroll-page.ts` (provider-agnostic) |
| the gateway's provider-neutral `AuthAssurancePolicy` / `strengthSufficient` gating | the **adapter-owned callback** that re-POSTs `{code,state}` to the unchanged verify routes (shared with enroll) |
| service-layer enrollment + `isEnrolled` (GLA-070) | the **`/enroll/verify` strength-echo** fix (`:592`) + the dual-method E2E tests |

---

## §8 · Risks the GLA-072 security review must focus on

The dual-method flow itself is low-risk (it reads a fact and gates on the existing mechanism). The risk is
concentrated in the **redirect/callback realization** — the review must prove these:

1. **The page generalization is genuinely provider-agnostic (the central review gate).** No `"authentik"`
   string, no issuer/endpoint URL, no method/`amr` name, and no provider-specific branch in `packages/gateway`.
   The discriminant must be a **generic** `options.kind` (the WebAuthn provider flows through the same code).
   If anything authentik-specific leaks into the gateway, that is a **scope surface** — stop and surface
   (`§5.4`).
2. **The verify path is unchanged.** `/handoff/auth/verify` must still take an opaque `assertion` and gate via
   `strengthSufficient`; confirm the diff there is **empty** (only the page + callback + the enroll-response
   echo change).
3. **Open-redirect / redirect-target integrity.** The `authorizeUrl` is built by the adapter from the
   **operator-configured** `authorizationEndpoint` (discovered from the issuer or explicitly overridden) and
   the **fixed** `redirectUri` — **never** from request/client input (`see adapters/auth-authentik/src/oidc.ts`
   `buildAuthorizeUrl`/`resolveEndpoints`). The review must confirm **no request parameter can influence the
   redirect target** (no `?next=`, no client-supplied `redirect_uri`), so the page's `location.assign` cannot
   be turned into an open redirect.
4. **State/nonce/PKCE binding across the redirect (CSRF/replay).** Confirm the `state`→`PendingAttempt`→`nonce`
   chain is intact across the round-trip: `state` is one-time-consumed on callback (a replayed/forged `state` →
   `state_unknown` → refused), the attempt's `userId` is re-checked (`user_mismatch`), the `nonce` is verified
   **inside** the `id_token`, PKCE `code_verifier` never leaves GLA and is required at exchange. The adapter
   burns `state` **on claim** (before the network round-trip) — confirm a concurrent/replayed callback can't
   double-spend (`see adapters/auth-authentik/src/index.ts` `runVerify` "FIX 2").
5. **The callback as a NEW public surface.** It is the one genuinely new internet-reachable endpoint. The
   review must confirm: it does **only** the re-POST (no other capability), it carries and the gateway
   **re-verifies** the grant (the callback is not a privileged bypass), it is fronted by the same Caddy at a
   non-colliding path, it is **not** the local bridge (S-6), it leaks no token/secret/`AuthFailReason` to the
   browser (generic refusal only), and a forged callback (bad `code`/`state`) yields a clean refusal that
   authorizes nothing.
6. **Auth assurance policy is honored on the second window (reuse).** Confirm auth-reuse stores the *actual*
   strength and a later window still enforces the selected policy (a reused `password` validity must not open
   under `phishing-resistant`).
7. **`amr` fidelity / never-up-map (carried).** If authentik cannot emit an `amr` that distinguishes passkey
   from password (a GLA-073/074 config matter), a passkey login could be mis-mapped to `password` (a safe
   under-grant, just a UX failure) — but a password login must **never** map to `webauthn`. Confirm the
   `strength.ts` defaults + the "valid-but-unresolvable → `password`" floor hold and are tested.

---

## §9 · Conformance summary (the contract this doc fixes)

1. Both methods are **hosted by authentik**; GLA **always redirects** to authentik's flow (passkey + password
   stages), the human chooses, authentik returns an `id_token` whose `amr` names the method; GLA = redirect →
   read → gate (`§2`).
2. Passkey (`{hwk,swk,webauthn,fido}`) → `webauthn`; password (`{pwd}`) → `password`; `none<password<webauthn`;
   never up-map (`§3`).
3. The strength gate is the gateway's provider-neutral auth assurance policy — `phishing-resistant` by default
   and `password-permitted` only when explicit. A password-only result (`"password"`) is rejected (403
   `auth.insufficient`, grant unauthorized) under the default and accepted only under `password-permitted`; a
   passkey result is accepted under either (`§4`).
4. **Finalized page mechanism = option (i) + a minimal generic (ii):** GLA-072 generalizes
   `handoff-page.ts`/`enroll-page.ts` to branch on the opaque options' `kind` (`redirect` →
   `location.assign(authorizeUrl)`; else the in-page WebAuthn ceremony) — **provider-agnostic** — and builds
   an **adapter-owned callback** that re-POSTs `{code,state}` to the **unchanged** `/handoff/auth/verify` and
   `/enroll/verify`; the gateway verify path is byte-for-byte unchanged; the security invariants hold; the
   review gates on the generalization being genuinely generic (`§5`, `§8`).
5. The recipient chooses a method at authentik; no-passkey uses the password stage; a failed attempt → a
   catchable refusal; the operator sets the requirement per deployment (`§6`).
6. GLA-072 builds the generic page branch + the shared callback + the `/enroll/verify` strength-echo + the
   dual-method E2E; both-methods-satisfy and too-weak-rejected are observed via `isGrantAuthorized` + the
   verify response + the WS-upgrade outcome, with `FakeAuthentik` minting chosen `amr` (`§7`).

## Related

`docs/architecture/authentik-integration.md` (the master — `§2` OIDC flow, `§4` method→strength) ·
`docs/architecture/authentik-enrollment.md` (the shared redirect/callback dependency, `§8`) ·
`docs/components/identity-and-auth.md` (the `auth_strength` model + invariants) ·
`docs/components/access-gateway.md` (the sole-public-entry + step-up invariants) ·
`docs/01-architecture-overview.md §6` (the authorization & security model) ·
`packages/gateway/src/index.ts` (`AuthAssurancePolicy`/`strengthSufficient`, `/handoff/auth/*`, `/enroll/*`,
the `:592` enroll-response, the `:752` handoff-response) ·
`packages/gateway/src/handoff-page.ts` + `enroll-page.ts` (the served pages GLA-072 generalizes) ·
`adapters/auth-authentik/src/index.ts` (`challenge`/`verifyAssertion`, the `RedirectChallenge`) ·
`adapters/auth-authentik/src/oidc.ts` (`buildAuthorizeUrl`/`resolveEndpoints` — the redirect-target integrity) ·
`adapters/auth-authentik/src/strength.ts` (the method→strength map) ·
`adapters/auth-authentik/src/fake-authentik.ts` (the deterministic test seam GLA-072 uses).
