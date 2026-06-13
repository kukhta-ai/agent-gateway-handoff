# GLA — authentik Delegated-Identity-Provider Integration (GLA-067)

> **Status:** Solution-design artifact (the integration-shape contract the five implementation tasks
> conform to). **Scope:** fix the shape of integrating **authentik** (a self-hosted IdP: server + worker +
> Postgres + Redis, OIDC/SAML, covering passkey + typed-password + MFA) as a **delegated** auth provider
> **behind the existing `AuthProviderPort` seam** — so GLA gains a phishing-resistant passkey *and* a
> typed-password fallback in **one** provider, selecting nothing in core. **This is planning, not
> implementation:** it builds no adapter, changes no enrollment, adds no dual-method flow, stands no service
> up. Those are **GLA-068 / 070 / 072 / 074 / 076**, each preceded by its plan (**069 / 071 / 073 / 075**).
>
> Conforms to the fixed spec; cross-references (`see docs/<x>`) are the source of truth and are **not**
> restated. The fixed core — the identity/auth **model + vocabulary** (`docs/components/identity-and-auth.md`,
> `docs/architecture/kernel-contracts.md §7`) — is held invariant; only the *realization behind the port*
> is designed here (`AGENTS.md`: "specify the seam, leave the stuffing").

## How this was produced (Rule-3 note)

The BMAD architecture workflow (`bmad-create-architecture`, "Winston") **was invoked** for this task and is
available, but its `step-01-init` mandates *"🛑 NEVER generate content without user input,"* declares the agent
*"a FACILITATOR, not a content generator,"* requires confirming discovered inputs **with the user** before it
will load them, and ends **every** step with *"Do NOT proceed until user explicitly selects 'C'."* It is
hard-gated interactive and **cannot run unattended** in this subagent context — the same established reality
recorded in `kernel-contracts.md` and `dependency-strategy.md`. Per `AGENTS.md` Rule 3's explicit allowance,
that path was **stopped, the blocker named**, and this artifact was driven **docs-first from the committed
design set** (`identity-and-auth.md`, `kernel-contracts.md §6/§7`, `dependency-strategy.md §4 D6`,
`03-software-candidates.md §4`, `slice-4a-enrollment.md`, `slice-4b-handoff.md`) plus a direct read of the
real seam (`packages/kernel/src/ports.ts`), the default adapter (`adapters/auth-webauthn/src/index.ts`), the
gateway step-up path (`packages/gateway/src/index.ts`), the composition root (`packages/app/src/index.ts`,
`daemon.ts`), the identity service (`packages/identity/src/index.ts`), and the installer bundle
(`wpm/wip/bundles/identity-provider/`) as the stated fallback.

---

## §0 · The reader's map — section → acceptance criterion

| AC | What it fixes | Section |
|---|---|---|
| #1 | Seam-preserving: a new adapter only, no gateway/core change | **§1** |
| #2 | Step-up delegation contract on the real port methods | **§3** (+ §2 background) |
| #3 | Method → `AuthStrength` mapping (the exact `amr`/`acr` values) | **§4** |
| #4 | Credential-authority shift to authentik; subject-binding | **§5** |
| #5 | Deployment boundary: runtime code vs the **GLA-074** installer concern | **§6** |
| #6 | Default stays in-tree WebAuthn; authentik opt-in; the named selection surface | **§7** |
| #7 | Build-order plan over the real dependency graph | **§8** |

§2 is shared background (the OIDC delegation decision + the seam tension it creates); §9 lists the open risks
the implementation tasks must watch.

---

## §1 · Seam-preserving integration — a new adapter, nothing else (AC #1)

**The contract.** authentik is integrated as a **new provider package, `@gla/auth-authentik`** (today the
10-line stub at `adapters/auth-authentik/src/index.ts`), that **satisfies the existing kernel
`AuthProviderPort`** (`see kernel-contracts.md §6`; `packages/kernel/src/ports.ts`) — the *same* four-method
interface the in-tree default `@gla/auth-webauthn` already implements. Selecting authentik therefore changes
**no gateway code and no core code**: it is a **horizontal extension in the adapter ring**
(`see baseline.md §6`), exactly the swap-IdP property `auth-webauthn`'s header already documents and Slice 4b
already exercised at the handoff edge (`see slice-4b-handoff.md` → "The auth seam is full-capability":
*"swapping the IdP … is a new `adapters/auth-<x>/` package + an `app` wire change, no gateway/session core
edit"*).

**What does NOT change (the proof obligation for GLA-068).**

- **`packages/kernel/**`** — the port is unchanged. `AuthProviderPort`, `IdentityPort`, `AuthStrength`,
  `UserIdentity`, `RecipientBinding` keep their current shapes (`§3` shows they suffice as-is).
- **`packages/gateway/src/index.ts`** — the **sole public entry on `:3000` behind Caddy** stays byte-for-byte
  unchanged. The gateway already depends only on its injected `IdentityStepUpPort` / `IdentityEnrollPort`
  seams (subsets of the Identity service) and **names no concrete provider** — the import-boundary lint
  proves it. (`§2` addresses the one real tension: the gateway's *served step-up page* assumes a same-page
  ceremony; the resolution keeps the gateway code untouched.)
- **`packages/identity/src/index.ts`** — `IdentityService` depends on the kernel `AuthProviderPort` (a
  **port**, never `@gla/auth-webauthn`); injecting `@gla/auth-authentik` instead changes nothing here. (One
  enrollment-semantics refinement is GLA-070's concern, stated in `§5`, and is *additive* to this service,
  not a change to the gateway/kernel.)
- **Every other `adapters/**`, `surfaces/**`, core aggregate** — untouched.

**What is NEW (the entire delta).**

1. **`@gla/auth-authentik`** — the delegated adapter: an in-tree OIDC relying-party client implementing
   `AuthProviderPort` over an OIDC authorization-code + PKCE round-trip to authentik (`§2`, `§3`), plus its
   own small callback listener (`§2`) and its state/nonce/PKCE store.
2. **The composition wiring in `packages/app`** — the one place that *chooses* the adapter
   (`createProvisioningBridge` / `createEnrollmentStack` / `daemon.ts`), extended with a provider switch +
   the authentik OIDC config (`§7`). This is the "`app` wire change," and `packages/app/**` is the *only*
   package the boundary lint exempts from the no-adapter-import rule.

> **Invariant honored:** *Horizontal growth happens only in the adapter ring* (`baseline.md §6`). The kernel
> still **names no concrete dependency** — it is `AuthProviderPort`, not `AuthentikPort` (`kernel-contracts.md
> §6`). The agent's `gla` commands are untouched (`docs/03 §13`).

---

## §2 · Background — the OIDC delegation decision and the one real seam tension

Two facts decide the mechanism. **(a)** `AuthProviderPort` is a **browser-mediated challenge → verify
ceremony** (it was shaped for WebAuthn: `challenge(userId)` issues options the page hands to the browser;
`verifyAssertion(userId, assertion)` checks what the browser returns). **(b)** authentik authenticates a
human through **its own hosted flows** (passkey / password / MFA) and speaks **OIDC**. The natural, standard
delegation that fits (a) onto (b) is an **OIDC Authorization-Code flow with PKCE**:

- **`challenge(userId)` → an OIDC authorization request.** The adapter builds the redirect to authentik's
  `/application/o/authorize/` carrying `response_type=code`, `client_id`, `redirect_uri` (the **adapter's own
  callback**, see below), `scope=openid profile` (+ any operator-added scopes), a per-attempt **PKCE**
  `code_challenge` (`S256`), a one-time **`state`**, and a one-time **`nonce`**. The returned "challenge" is
  this authorization URL (opaque to the kernel — `AuthChallenge = unknown`).
- **The human authenticates AT authentik.** authentik runs the passkey-or-password-or-MFA flow itself; GLA
  never sees the credential (`§5`). On success authentik **redirects the browser back** to the adapter
  callback with `?code=…&state=…`.
- **`verifyAssertion(userId, {code, state})` → exchange + validate → `{ok, authStrength}`.** The adapter
  looks up the pending attempt by `state` (one-time), exchanges `code` + the stored PKCE `code_verifier` at
  authentik's `/application/o/token/` for an **`id_token`**, and **validates** it: issuer == the configured
  authentik issuer, audience == `client_id`, signature via authentik's **JWKS** (`/application/o/<app>/jwks/`),
  `nonce` == the stored nonce, `exp`/`iat`/`nbf` within skew. It then checks the resolved identity (`sub`)
  against the recipient's bound subject (`§3`, `§5`), reads `amr`/`acr` to derive `AuthStrength` (`§4`), and
  returns `{ok, authStrength}`.

**Where the callback lands (the load-bearing decision).** It is an **adapter-owned endpoint, NOT a new
gateway route** — because adding a route to `packages/gateway` would violate AC #1. The composition stands up
a **second, small HTTP listener owned by `@gla/auth-authentik`** (bound LOCAL, fronted by the *same* host
Caddy at a distinct path, e.g. `/auth/callback`, mapped to the adapter's port — an installer/edge concern,
`§6`), whose sole job is to receive `?code&state`, hand them to the pending attempt, and bounce the browser
back to the gateway handoff route so the existing WS-open path resumes. The gateway keeps doing exactly what
it does today: verify the recipient-bound grant, call `stepUp.authenticationOptions` / `verifyAuthentication`,
and proxy the authorized WS — it neither knows nor cares that "options" is now a redirect URL.

**The one real seam tension (GLA-072 must own it).** The gateway today **serves a fixed step-up page**
(`packages/gateway/src/handoff-page.ts` → `handoffPageHtml`) that runs `navigator.credentials.get(options)`
**in the page** and POSTs the assertion to `/handoff/auth/verify`. An OIDC flow is **not** a same-page
ceremony — it is a **top-level redirect** to authentik and back. Because that page is compiled into the
gateway, making the *browser-side shape* provider-specific would touch gateway code. The honest resolution,
fixed here so GLA-068/072 don't re-decide:

> The provider's **`challenge()` return is opaque** (`AuthChallenge = unknown`). For authentik it carries a
> discriminated shape `{ kind: "redirect", authorizeUrl }` (vs WebAuthn's options JSON). The step-up page's
> *contract* — "ask the gateway for options, complete them, tell the gateway the result" — is unchanged; only
> the *completion mechanism* differs (a `location.assign(authorizeUrl)` instead of `credentials.get`). GLA-072
> realizes this **without changing the gateway** by one of two equivalent moves, the choice being GLA-071's to
> finalize: **(i)** the adapter's callback completes the round-trip server-side and **re-POSTs** the
> normalized `{code,state}` to the gateway's *existing* `/handoff/auth/verify` as the opaque `assertion`
> (so the gateway's verify path is literally unchanged and the page only needs to *start* the redirect); or
> **(ii)** a tiny, **provider-agnostic** page-completion seam is introduced once (a branch on the opaque
> options' `kind`) — but if (ii) is taken it must be a *generic* "complete these options" hook, never
> authentik-specific gateway logic. **Decision: prefer (i)** — it keeps `packages/gateway` byte-for-byte
> unchanged and confines every authentik specific to the adapter + composition. GLA-068 builds the adapter +
> callback to support (i); GLA-072 wires the dual-method UX on top.

This is the only place the WebAuthn-shaped ceremony and the OIDC redirect genuinely differ; everything else
(`§3`) maps cleanly onto the unchanged port.

---

## §3 · The step-up delegation contract — onto the real port methods (AC #2)

The step-up is a **contract**: the gateway hands the identity challenge to the external provider and receives
back the **same fact** the in-tree provider produces — `ok` + `auth-strength` + a resolved identity checked
against the recipient's binding. Concretely, against the **real** methods
(`packages/kernel/src/ports.ts`; the gateway calls these via `IdentityStepUpPort` →
`IdentityService.authenticationOptions` / `verifyAuthentication`, `see slice-4b-handoff.md`):

| Port method (kernel) | In-tree WebAuthn (today) | **authentik delegated (this design)** |
|---|---|---|
| `challenge(userId)` → `AuthChallenge` | `generateAuthenticationOptions` (WebAuthn options) | **build the OIDC authorization request** → `{ kind:"redirect", authorizeUrl }` carrying PKCE `code_challenge`, one-time `state`, one-time `nonce`, scopes, `redirect_uri`=the adapter callback. Stores the pending attempt `{userId, state, nonce, codeVerifier}` keyed by `state` (`§2`). |
| `verifyAssertion(userId, assertion)` → `{ok, authStrength}` | `verifyAuthenticationResponse` → bump counter | **assertion = `{code, state}`** (the callback's params). Look up the attempt by `state` (one-time-consume), **exchange** `code`+`codeVerifier` at the token endpoint, **validate** the `id_token` (issuer, audience=`client_id`, signature via **JWKS**, `nonce`, `exp`/`iat`/`nbf`±skew), **check `sub` == the recipient's bound subject** (`§5`), derive strength from `amr`/`acr` (`§4`) → return `{ok, authStrength}`. Any failure → `{ok:false, authStrength:"none"}`. |

**Resolved-identity check (the recipient-binding enforcement — the crux of AC #2).** The gateway already
supplies the `userId` to both calls (it reads the recipient out of the *signed* grant, derives the user, and
passes it down — `see packages/gateway/src/index.ts` `handleHandoffAuthVerify`). So the adapter does **not**
need the port to *return* a resolved userId: it **checks the token's `sub` against the binding for the
supplied `userId`**. The recipient is bound to a **stable provider subject** (`§5`); the adapter asserts
`id_token.sub === boundSubjectFor(userId)`. A token for a *different* authentik subject than the one this
recipient is bound to yields `{ok:false}` — so a valid authentik login by the *wrong* person cannot pass a
handoff for *this* recipient. This is the delegated analogue of WebAuthn's "the assertion is checked against
*this* recipient's registered credential" (`slice-4b-handoff.md`), and it is why **the port shape suffices
unchanged** (the honest seam note `AGENTS.md` asked for: `verifyAssertion` returning only `{ok, authStrength}`
is sufficient because identity arrives *in*, via `userId`, and is *bound* via `sub`).

**The fact returned is identical in kind.** `{ok, authStrength}` is exactly what `auth-webauthn` returns, and
authentik also projects `amr`/`acr` into the provider-neutral `AuthAssuranceEvidence` contract for diagnostics
(`see packages/kernel/src/auth-assurance.ts`, `adapters/auth-authentik/src/strength.ts`). The gateway still
owns the *decision* by evaluating the deployment's `AuthAssurancePolicy`; the provider still reports only
*facts* (`kernel-contracts.md §6/§7`, identity-and-auth.md invariant: *"the verifier reports facts, not
decisions"*). Auth-reuse (Phase 12, GLA-050/051) is unaffected: it keys on the recipient from the signed grant
and the returned strength, both unchanged.

**State / nonce / PKCE storage & one-time use (anti-CSRF / anti-replay).** The adapter holds a transient
**pending-attempt store** keyed by `state` (mirroring `auth-webauthn`'s injectable challenge store; in-memory
default, an injectable `KvStore` seam so `app`/tests can supply a shared/persistent one). Each entry binds
`{userId, state, nonce, codeVerifier, createdAt}`. **`state`** is verified on callback and **consumed once**
(a replayed callback finds nothing → refused), closing CSRF. **`nonce`** is checked **inside** the `id_token`
and consumed, binding the token to *this* authorization request (anti-replay). **PKCE `code_verifier`** never
leaves GLA and is required at token exchange, defeating code interception. Entries **expire** on a short TTL.
This is the OIDC-flow analogue of the single-use TOCTOU discipline the gateway already applies to enrollment
grants (`see packages/gateway/src/index.ts` `tryConsumeEnrollmentGrantToken`).

---

## §4 · Method → `AuthStrength` mapping (AC #3)

authentik reports *how* the human authenticated in the `id_token` claims. GLA must map that onto its frozen
three-value `AuthStrength = "none" | "password" | "webauthn"` (`kernel-contracts.md §7`) so that **a passkey
result yields the strongest strength (`webauthn`)** and **a password result yields a lower one (`password`)**.

**The claim keyed on: `amr` (Authentication Methods References), with `acr` as the fallback.** `amr` is an
OIDC-standard JSON array of method identifiers (RFC 8176); it is the precise, per-method signal. `acr`
(Authentication Context Class Reference) is a coarser single value some flows set; it is the fallback when
`amr` is absent.

**The exact mapping (the values GLA-072 keys on).** Highest matching method wins (a login that did both
password *and* passkey is `webauthn`):

| Condition on the `id_token` | → `AuthStrength` |
|---|---|
| `amr` contains any of **`"hwk"`** (hardware-secured key), **`"swk"`** (software-secured key / passkey), **`"webauthn"`**, or **`"fido"`** | **`"webauthn"`** |
| else `amr` contains **`"pwd"`** (password) — optionally combined with **`"mfa"` / `"otp"` / `"sms"`** (MFA on top of a password is still **not** phishing-resistant key auth, so it stays `password`) | **`"password"`** |
| else, if `amr` absent, `acr` resolves to a configured **passkey/phishing-resistant** context (e.g. an `acr` value the operator maps to passkey, or the OIDC well-known `"phr"` phishing-resistant indicator) | **`"webauthn"`** |
| else, if `amr` absent and `acr` resolves to a **password/phishing-resistant-not-asserted** context (e.g. `"phrh"` is *not* asserted, or an operator-mapped password context) | **`"password"`** |
| token valid but no method claim resolvable to either tier | **`"password"`** (a successful authentik login is at least password-grade; never silently `webauthn`, never `none`) — *and recorded as a CONCERN for the operator (`§9`)* |
| token invalid / exchange failed / `sub` mismatch | **`"none"`** (with `ok:false`) |

**Notes binding this down for GLA-072.**

- The **passkey set** `{hwk, swk, webauthn, fido}` and the **password set** `{pwd}` (+ MFA companions
  `{mfa, otp, sms, hwk-as-second-factor}`) are the canonical RFC 8176 tokens; authentik emits `amr` per its
  configured flow/stages. The exact tokens authentik produces for the GLA flow are **pinned at GLA-073/074**
  (the flow/stage config) and the adapter's table is **driven from a small, operator-visible map** so a
  deployment whose authentik labels differ does not require a code change — but the **defaults above are the
  contract**.
- The mapping is **monotonic with the gateway's provider-neutral assurance policy** (`none < password <
  phishing-resistant`, with `webauthn` projected to phishing-resistant): the default
  `phishing-resistant` profile **rejects** a password-only authentik login and **accepts** a passkey one;
  `password-permitted` is the explicit profile that accepts password-grade evidence. The gateway reads this
  common contract, never provider-specific method names.
- **Never up-map.** A missing/ambiguous method must never yield `webauthn` (that would silently weaken the
  phishing-resistance guarantee); the floor is `password` for a *valid* token, `none` for an invalid one.

---

## §5 · Credential-authority shift — the recipient is bound to a provider subject (AC #4)

With the in-tree default, **GLA holds the credential** (the WebAuthn public key + counter live in
`auth-webauthn`'s credential store; the identity service holds only the enrollment *fact*,
`see adapters/auth-webauthn/src/index.ts`, `packages/identity/src/index.ts`). With the delegated provider,
**authentik holds the credential** (the passkey / password / MFA secret live in authentik's Postgres, never
in GLA). The thing GLA stores instead is a **stable provider subject** — the OIDC **`sub`** — that the
recipient is bound to.

**How the existing types carry it (no kernel change — AC #1).**

- **`UserIdentity.enrolledCredentialId`** (`kernel-contracts.md §7`, `packages/kernel/src/ports.ts`) — already
  *"set once enrollment completes (a passkey, **or a password record**)."* For the delegated provider it holds
  the **authentik subject (`sub`)** (optionally namespaced, e.g. `authentik:<sub>`, to make the authority
  explicit and to coexist with a WebAuthn credential id under the in-tree provider). Its *meaning* widens from
  "a GLA-held credential handle" to "the **stable external subject** this identity is bound to" — which the
  field's own doc already anticipates ("a passkey, or a password record"). **The field shape is unchanged;
  only what fills it differs** — exactly the "specify the seam, leave the stuffing" rule.
- **`RecipientBinding`** (`recipient → userId`, with `provenance` + `authStrength`) — unchanged. The
  channel→identity binding is the same narrow-only mapping; what changes is that the `userId`'s
  `enrolledCredentialId` now points at an authentik subject. `RecipientBinding.authStrength` continues to be
  the *current proof strength* fact (`§4` feeds it).
- **The identity service's `EnrollmentRecord`** (`credentialId`, `authStrength`, `enrolledAt`,
  `packages/identity/src/index.ts`) — its `credentialId` carries the **`sub`** under the delegated provider
  (the field is already provider-opaque: *"the credential id the provider registered"*). The store stays the
  identity-level **fact**; the provider holds the actual secret (here, remotely, in authentik). This is the
  same split the `auth-webauthn` header already describes ("an authentik adapter would hold nothing locally").

**What "enrollment" means for a delegated IdP (the GLA-070 concern, fixed here).** Enrollment stops being "run
a WebAuthn registration ceremony and store a public key" and becomes **"provision/link the authentik subject
and bind it to the recipient's `UserIdentity`."** Two realizations, both behind the **unchanged**
`AuthProviderPort.beginEnrollment` / `finishEnrollment` and the **unchanged** gateway enrollment routes
(`/enroll`, `/enroll/options`, `/enroll/verify`, `see packages/gateway/src/index.ts`):

1. **Link-by-OIDC (recommended default).** `beginEnrollment(userId, discharge)` returns an **OIDC
   authorization request** (same machinery as `§3`, scope includes the subject); the operator-invited
   recipient authenticates at authentik once; `finishEnrollment(userId, attestation={code,state})` validates
   the `id_token` and returns `{credentialId: sub, authStrength}` — the identity service records the binding
   atomically (the **no-half-bound** property is preserved exactly: it commits only on a verified result,
   `see packages/identity/src/index.ts` `enrollComplete`). The single-use `operator-discharge` grant still
   gates it; the agent still never enrolls and never sees a credential (frozen invariants,
   `identity-and-auth.md`, `kernel-contracts.md §7`).
2. **Provision-by-API (alternative).** the installer/operator pre-creates the authentik user and the adapter
   binds the known `sub`; `finishEnrollment` confirms a first successful login. (Heavier; GLA-069 chooses.)

> **Invariant honored:** *a recipient is verifiable only if previously enrolled; enrollment is one-time,
> operator-initiated, `operator-discharge`-authorized, never a handoff step* (`kernel-contracts.md §7`,
> `identity-and-auth.md`). The delegated provider satisfies it by binding the **subject** at enrollment;
> step-up (`§3`) then checks `sub` against that binding. **`finishEnrollment` still returns the compatibility
> facts `{credentialId, authStrength}` and may also include common assurance evidence**; `credentialId` is the
> `sub`.

---

## §6 · Deployment boundary — GLA runtime code vs the installer concern (AC #5)

The integration **splits across the GLA↔`wpm` process boundary** exactly as the ownership rule dictates
(`see dependency-strategy.md §2, §4 D6`, `01-architecture-overview.md §8`): *runtime code that lives inside
the GLA process is in-tree; anything that stands software up on the operator host is a `wpm` installer
bundle.*

**GLA runtime code (in-tree, long-lived inside the GLA process):**

- **`@gla/auth-authentik`** — the delegated adapter: the OIDC relying-party **client** (authorization-request
  builder, token-exchange + `id_token` validation via JWKS, `amr`/`acr`→strength mapper, `sub`-binding check),
  the **pending-attempt store** (`state`/`nonce`/PKCE), and the **adapter-owned callback listener** (`§2`).
- **The composition wiring in `packages/app`** — the provider switch + OIDC config plumbing (`§7`). It reads
  config (issuer URL, client id/secret, redirect URI) and injects the adapter; it stands **no service** up.

**Installer concern (a `wpm` bundle — stands software up on the operator host):**

- **Standing authentik up** — `server` + `worker` + **Postgres** + **Redis** — and **configuring its
  flow/stages** (an OIDC provider + application for GLA, the passkey + password stages, the `amr`/`acr`
  emission the `§4` map keys on), and routing the adapter's callback path through the **same host Caddy**.
  This is host-touching, environment-specific, and **unknowable in advance** — precisely the `wpm` half.

**The named task that stands the provider service up: `GLA-074` — "Build the wpm installer for the authentik
identity provider."** GLA-074 **extends the existing `wpm/wip/bundles/identity-provider` bundle** (today it sets
only `GLA_RP_ID` for the in-tree default and *names authentik as the alternative it would stand up if
selected* — `see wpm/wip/bundles/identity-provider/bundle.yml` + the `install-backlog` tasks
`identity-provider-1..3`). GLA-074 adds the authentik **detect → setup → verify → record** path to that same
recipe: detect an existing/intended authentik; stand up server+worker+Postgres+Redis (Managed) **or** adopt a
running instance (Local-/Remote-External); configure the OIDC application + flow/stages; write the
`DependencyBinding` (`dependency:"identity-provider", ownershipMode, connection:{issuer, clientId,
redirectUri, …}, installed, inverseOp`, `see dependency-strategy.md §5`) that GLA's adapter then **reads** and
GLA's `doctor`/`probe` **re-verifies** at runtime. The existing bundle AC already carries the load-bearing
"in-tree default unless explicitly selected" decision (`identity-provider-2` AC #2/#3); GLA-074 fills in the
"if authentik is selected, stand the standalone service up" branch those ACs already reserve.

> **Division of labor (must not merge, `dependency-strategy.md §5`):** GLA never installs authentik at
> runtime; the `wpm` bundle never models a GLA session. The adapter speaks to authentik over the
> `connection` the bundle recorded; availability is **system-derived** from the latest probe (a down
> authentik shows `unavailable` and admission/handoff fails closed).

---

## §7 · Default-provider decision + the named selection surface (AC #6)

**The decision (unchanged from the spec's reference-profile defaults, `see dependency-strategy.md §4 D6, §7`,
`baseline.md §5`):** the **in-tree WebAuthn provider (`@gla/auth-webauthn`, `@simplewebauthn/server`) stays
the default**; the **delegated authentik provider is opt-in**. authentik is the *heavyweight alternative
behind the same seam*, never the default — the build decision that made in-tree WebAuthn the default
(`baseline.md §5, §9.2`) is **not** reversed here.

**The selection surface (named concretely — inspected, not invented).** Today the provider is selected by a
**hardcoded construction** at the `packages/app` composition root: `createProvisioningBridge` (and
`createEnrollmentStack`) do `const authProvider = new AuthWebauthnProvider({ rpID, rpName, expectedOrigin })`
and inject it into `new IdentityService({ authProvider })`
(`see packages/app/src/index.ts` lines ~326–331 and ~622–628); `daemon.ts` threads `rpID`/`rpName`/
`expectedOrigin` in from `GLA_RP_ID`/`GLA_RP_NAME`/the public-base-URL origin. **There is no provider switch
today — it is always WebAuthn.** This design fixes the switch and the config it gates:

- **`GLA_AUTH_PROVIDER`** (flag `--auth-provider`) — the selection switch, default **`webauthn`**; set
  **`authentik`** to opt in. Added to `ServeOptions` + `parseServeArgs` in `daemon.ts` (alongside the existing
  `GLA_RP_ID`/`GLA_LAUNCHER_MODE` pattern) and branched on in `createProvisioningBridge`/`createEnrollmentStack`:
  `webauthn` → today's `new AuthWebauthnProvider(...)`; `authentik` → `new AuthAuthentikProvider(<oidc config>)`.
  **Both implement `AuthProviderPort`**, so the line that injects into `IdentityService` is identical — the
  swap is one `new …` and nothing downstream changes (`§1`).
- **`GLA_AUTH_ASSURANCE_POLICY`** (flag `--auth-assurance-policy`) — the provider-neutral deployment policy,
  default **`phishing-resistant`**. Leave it unset/default to require passkey/phishing-resistant assurance;
  set **`password-permitted`** only when password-grade evidence is an intentional deployment policy. Unknown
  values are usage errors, not silent fallback.
- **The authentik OIDC config the adapter needs** (only read when `GLA_AUTH_PROVIDER=authentik`; sourced from
  the `DependencyBinding.connection` GLA-074 wrote and/or env, the client secret marked `sensitive` and held
  as a secret-ref, never logged — `kernel-contracts.md §4` `sensitive`):
  - **`GLA_AUTHENTIK_ISSUER_URL`** — the authentik OIDC issuer (e.g. `https://idp.example/application/o/gla/`),
    from which the adapter discovers `/authorize`, `/token`, and JWKS (`.well-known/openid-configuration`).
  - **`GLA_AUTHENTIK_CLIENT_ID`** — the OIDC client/application id (the `id_token` audience).
  - **`GLA_AUTHENTIK_CLIENT_SECRET`** — the client secret for the confidential token exchange (`sensitive`).
  - **`GLA_AUTHENTIK_REDIRECT_URI`** — the adapter callback URL (the `redirect_uri`, `§2`), fronted by the
    same host Caddy (e.g. `https://57.131.31.126/auth/callback`).
  - (optional) **`GLA_AUTHENTIK_SCOPES`** (default `openid profile`) and **`GLA_AUTHENTIK_AMR_MAP`** /
    **`GLA_AUTHENTIK_ACR_MAP`** — the operator-visible overrides for the `§4` defaults.

`rpID`/`expectedOrigin` remain the WebAuthn-path config; under `authentik` they are unused (the ceremony runs
at authentik). The composition records the *chosen* adapter in its `Wiring.auth` field (today
`AUTH_WEBAUTHN_MODULE`; under opt-in, `AUTH_AUTHENTIK_MODULE`) so the wiring record stays truthful.

> **Invariant honored:** changing the provider is *install/select a different plugin* with **no core /
> `gla`-command change** (`docs/03 §13`, `baseline.md §6`). The default is unchanged; the opt-in is a single
> env switch at the one composition root that is already the sole adapter-importing package.

---

## §8 · Build-order plan (AC #7)

The order below sequences the five implementations — **adapter (068) → enrollment (070) → dual-method flow
(072) → installer (074) → verification (076)** — each **preceded by its plan** (069 / 071 / 073 / 075), and is
**consistent with the real backlog dependency graph** (read via `backlog task <id> --plain`):

```
GLA-067 (this plan)        ← GLA-002
  ├─ GLA-068 adapter       ← GLA-067
  ├─ GLA-069 plan-enroll   ← GLA-067
  ├─ GLA-071 plan-flow     ← GLA-067
  ├─ GLA-073 plan-standup  ← GLA-067
  ├─ GLA-070 enrollment    ← GLA-068, GLA-069
  ├─ GLA-072 dual-method   ← GLA-068, GLA-071
  ├─ GLA-074 installer     ← GLA-073, GLA-068
  └─ GLA-076 verify (cap)  ← GLA-070, GLA-072, GLA-074
```

**A valid topological order** (plans before their impls; the **adapter (068) before everything that uses it**;
the **capstone (076) last**):

| # | Task | Kind | Gated by (all Done first) | Why here |
|---|---|---|---|---|
| 0 | **GLA-067** | plan (this doc) | GLA-002 | fixes the integration shape all five conform to |
| 1 | **GLA-068** — integrate authentik as a delegated auth provider | **impl: adapter** | GLA-067 | the adapter is the foundation **everything** else uses; build it first (`§1`–`§4`). Builds the OIDC client, callback, `sub`-binding check, `amr`/`acr`→strength map behind the unchanged port. |
| 2 | **GLA-069** — plan recipient enrollment w/ delegated IdP | plan | GLA-067 | plan the enrollment-as-subject-linking (`§5`) before building it. (Independent of 068; may run in parallel with step 1.) |
| 3 | **GLA-070** — enroll a recipient through authentik | impl: enrollment | GLA-068, GLA-069 | binds the recipient to the authentik `sub` (the precondition for any delegated step-up). Needs the adapter (068) + its plan (069). |
| 4 | **GLA-071** — plan the passkey-and-password flow | plan | GLA-067 | plan the dual-method UX + the redirect-page resolution (`§2` (i)) before building it. (May run in parallel with steps 1–3.) |
| 5 | **GLA-072** — support both passkey & password step-up via authentik | impl: dual-method flow | GLA-068, GLA-071 | the dual-method capability — the point of the integration. Needs the adapter (068) + its plan (071); gates by provider-neutral auth assurance policy (`§4`). |
| 6 | **GLA-073** — plan the authentik service standup & config | plan | GLA-067 | plan the wpm standup (server+worker+Postgres+Redis + flow/stages emitting `amr`/`acr`) before building it. (May run in parallel with steps 1–5.) |
| 7 | **GLA-074** — build the wpm installer for authentik | impl: installer | GLA-073, GLA-068 | extends `wpm/wip/bundles/identity-provider` to stand authentik up + write the `DependencyBinding` (`§6`). Needs its plan (073) + the adapter it verifies against (068). |
| 8 | **GLA-076** — verify the delegated provider covers both methods E2E | impl: verification (**capstone**) | GLA-070, GLA-072, GLA-074 | proves passkey **and** password both work through a real handoff behind the unchanged seam. Composes 070+072+074; **last**. |

**Order property checks:** every plan (069/071/073) precedes its impl (070/072/074); the adapter (068)
precedes 070, 072, 074, and 076 (everything that uses it); the capstone (076) is last; and each row's "gated
by" is a subset of the rows above it — so the sequence is a valid execution of the graph. The three plan tasks
(069/071/073) are mutually independent and independent of 068, so a scheduler may run them concurrently with
the adapter build; the table lists one **legal serialization**.

---

## §9 · Open risks / seam tensions the implementation tasks must watch

1. **The redirect-vs-same-page tension (`§2`)** is the single real seam stress. GLA-068 must build the
   adapter + callback so the gateway's *served* step-up page changes **only** in how it *starts* completion
   (a redirect), and GLA-072 must keep any page-completion branch **provider-agnostic** — never authentik
   logic in `packages/gateway`. If a clean realization of `§2` (i) proves impossible, that is a **scope
   surface** (it would touch the fixed gateway): stop and surface it, do not quietly edit the gateway.
2. **`amr`/`acr` fidelity (`§4`).** authentik must actually **emit** an `amr`/`acr` that distinguishes passkey
   from password for the GLA flow; this is a **flow/stage configuration** owned by GLA-073/074. If a given
   authentik build cannot distinguish them, the `webauthn` tier is unachievable and the integration degrades
   to `password`-only — GLA-075/076 must test this explicitly and the operator must be warned (the `§4`
   "valid token, unresolvable method → `password` + CONCERN" rule).
3. **Subject stability (`§5`).** The binding rests on the OIDC `sub` being **stable** for a recipient across
   logins; GLA-073/074 must configure authentik so `sub` is the immutable user id (not an email/username that
   can change). A mutable `sub` would silently break re-verification.
4. **Callback edge routing (`§2`, `§6`).** The adapter callback must be reachable through the **same host
   Caddy** as the gateway, at a path that does not collide with gateway routes; GLA-074 owns the Caddy mapping
   and must keep the **bridge** local (`daemon.ts` S-6 guard) — the new listener is a *public* edge surface
   like the gateway, never the local bridge.
5. **Confidential-client secret handling.** `GLA_AUTHENTIK_CLIENT_SECRET` is `sensitive` — held as a
   secret-ref, never logged, never in the audit trail (`kernel-contracts.md §1.7` redaction, `§4` `sensitive`).
   GLA-068 must route it through the secret seam, not a plain env echo.
6. **Provider availability fail-closed.** A down authentik (`server`/`worker`/Postgres/Redis) must surface as
   `dependency.unavailable` at step-up (the gateway already maps a provider failure to a catchable refusal,
   `see packages/gateway/src/index.ts`), and the `DependencyBinding` probe must show `unavailable` — never a
   silent pass. GLA-076 must cover the down-provider path.

---

## §10 · Conformance summary (the contract this doc fixes)

1. authentik is a **new `@gla/auth-authentik` adapter** satisfying the provider-neutral `AuthProviderPort`;
   selecting it changes **no gateway/core code** — only the adapter + the `packages/app` wiring (**§1**).
2. Step-up is a **delegation contract** on the real methods: `challenge` → OIDC auth request,
   `verifyAssertion({code,state})` → exchange/validate the `id_token`, **`sub` checked against the binding**,
   returning the **same `{ok, authStrength}` compatibility fact plus optional assurance evidence**; `userId`
   still flows in (**§3**).
3. **`amr`** (fallback **`acr`**) maps to `AuthStrength`: `{hwk,swk,webauthn,fido}` → **`webauthn`**, `{pwd}`
   (+MFA companions) → **`password`**; never up-map (**§4**).
4. The credential authority shifts to **authentik**; the recipient is bound to a **stable `sub`**, carried by
   `UserIdentity.enrolledCredentialId` / the identity `EnrollmentRecord.credentialId` (field shapes
   unchanged); enrollment becomes **subject-linking** (**§5**).
5. **Runtime code** = the adapter + OIDC client + composition; the **installer concern** (server+worker+
   Postgres+Redis + flow/stages) is **GLA-074**, extending `wpm/wip/bundles/identity-provider` (**§6**).
6. In-tree WebAuthn **stays the default**; authentik is **opt-in** via **`GLA_AUTH_PROVIDER`** at the
   `packages/app` composition root, with the authentik OIDC config (issuer / client id / client secret /
   redirect URI), and deployment strength is selected through **`GLA_AUTH_ASSURANCE_POLICY`**
   (`phishing-resistant` default, `password-permitted` explicit fallback) (**§7**).
7. A valid **build order** — 068 → 070 → 072 → 074 → 076, each preceded by 069/071/073/075 — consistent with
   the dependency graph (**§8**).

## Related

`docs/components/identity-and-auth.md` (the frozen identity/auth model + vocabulary) ·
`docs/architecture/kernel-contracts.md §6` (the `AuthProviderPort` seam) + `§7` (recipient identity &
enrollment) · `docs/architecture/dependency-strategy.md §4 D6, §5, §7` (the swap-IdP decision, the
`DependencyBinding`, the reference modes) · `docs/03-software-candidates.md §4` (the authentik candidate) ·
`docs/architecture/slice-4a-enrollment.md` (enrollment at the edge) ·
`docs/architecture/slice-4b-handoff.md` (the handoff step-up + the swap-IdP property at the edge) ·
`docs/architecture/baseline.md §5, §6` (the build decisions + horizontal-extension principle) ·
`adapters/auth-webauthn/src/index.ts` (the default provider this delegated adapter mirrors) ·
`adapters/auth-authentik/src/index.ts` (the stub GLA-068 replaces) ·
`packages/gateway/src/index.ts` (the unchanged gateway step-up path) ·
`packages/identity/src/index.ts` (the identity service the binding fact lives in) ·
`packages/app/src/index.ts`, `packages/app/src/daemon.ts` (the composition root / selection surface) ·
`wpm/wip/bundles/identity-provider/` (the installer bundle GLA-074 extends).
