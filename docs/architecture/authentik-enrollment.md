# GLA — Recipient Enrollment with a Delegated Identity Provider (GLA-069)

> **Status:** Solution-design sub-doc (the enrollment-shape contract **GLA-070** conforms to). **Scope:** fix
> how a recipient becomes *verifiable* when the **provider (authentik) owns the credential** — i.e. enrollment
> for the delegated `@gla/auth-authentik` provider, behind the **unchanged** `AuthProviderPort` and the
> **unchanged** gateway `/enroll` routes. **Planning only:** it builds no code and touches no backlog.
>
> **This is a sub-doc of the master `docs/architecture/authentik-integration.md`.** The credential-authority
> shift (`§5`) and the OIDC flow (`§2`/`§3`) are decided there and are **referenced, not restated**. This doc
> extends only the enrollment slice. The fixed core — the identity/auth **model + vocabulary**
> (`see docs/components/identity-and-auth.md`, `docs/architecture/kernel-contracts.md §7`) — is held
> invariant; only the realization behind the port is designed (`AGENTS.md`: "specify the seam, leave the
> stuffing"). GLA-068 (the adapter) is **built and merged**, so this plan is grounded in the **real** code.

## How this was produced (Rule-3 note)

Same established reality as the master doc and `kernel-contracts.md`: the BMAD architecture workflow
(`bmad-create-architecture`) is hard-gated interactive (its `step-01-init` mandates *"NEVER generate content
without user input"*, casts the agent as *"a FACILITATOR, not a content generator,"* and ends every step on
*"Do NOT proceed until the user selects 'C'"*) and **cannot run unattended** in this subagent context. Per
`AGENTS.md` Rule 3's explicit allowance, that path was **stopped, the blocker named**, and this artifact was
driven **docs-first from the committed design set** plus a direct read of the now-real adapter
(`adapters/auth-authentik/src/{index.ts,stores.ts,strength.ts}`), the identity service
(`packages/identity/src/index.ts`), and the gateway enrollment path
(`packages/gateway/src/{index.ts,enroll-page.ts}`) as the stated fallback.

---

## §0 · The reader's map — section → acceptance criterion

| AC | What it fixes | Section |
|---|---|---|
| #1 | The delegated enrollment **contract** (begin → authentik → finish → fact) on the real adapter | **§2** |
| #2 | The **binding** recipient → `userId` → stable `sub`, layer by layer | **§3** |
| #3 | The single-use **operator-discharge grant**'s role; the gateway stays the only public entry | **§4** |
| #4 | The **first-run experience**; what an un-enrolled recipient sees | **§5** |
| #5 | The model **preserves the invariants** (verifiable-only-after-enrollment, one-time, operator-initiated) | **§6** |
| #6 | The **GLA-070 build plan** + outside-observable enrolled-vs-not | **§7** |

§1 is the one-paragraph background (what changes vs the in-tree default); §8 is the seam tension / risks
GLA-070 must watch.

---

## §1 · Background — what enrollment must establish now (vs the in-tree default)

With the in-tree default, enrollment **registers a WebAuthn passkey GLA holds** (the public key + counter live
in `@gla/auth-webauthn`'s credential store; `see adapters/auth-webauthn/src/index.ts`). With the delegated
provider, **authentik owns the credential** (passkey / password / MFA, in authentik's own store) and the only
durable thing GLA records is the **stable OIDC subject (`sub`)** the recipient is bound to
(`see authentik-integration.md §5`). So "enrolled" stops meaning *"GLA stored a passkey for this recipient"*
and starts meaning *"this recipient's `UserIdentity` is bound to a known authentik subject, established once
through a verified OIDC round-trip."* Everything below specifies that, in terms of the **real** adapter
methods GLA-068 already shipped.

---

## §2 · The delegated enrollment contract (AC #1)

Enrollment is the **precondition** that makes a later step-up possible. For the delegated provider it is a
one-time OIDC round-trip that ends in a recorded **fact**, expressed entirely on the real port methods
(`AuthProviderPort`, `see packages/kernel/src/ports.ts`; the adapter at
`adapters/auth-authentik/src/index.ts`; the service at `packages/identity/src/index.ts`):

| Step | Real call | What happens |
|---|---|---|
| **1. begin** | `IdentityService.enrollmentOptions(recipient, discharge)` → `provider.beginEnrollment(userId, discharge)` | the adapter mints PKCE + one-time `state`/`nonce`, stores a **`register`-kind** `PendingAttempt` keyed by `state`, and returns the opaque `RedirectChallenge` `{kind:"redirect", authorizeUrl}` (the authorization request to authentik's `/authorize`). `discharge` is the operator-discharge grant the gateway already verified; the adapter does **not** re-check it (`§4`). |
| **2. authenticate at authentik** | *(browser, at authentik — not GLA)* | the operator-invited recipient authenticates **once** at authentik (passkey / password / MFA, authentik's own flow). GLA never sees the credential. authentik redirects back to the adapter callback with `?code&state`. |
| **3. finish** | `IdentityService.enrollComplete(recipient, attestation)` → `provider.finishEnrollment(userId, attestation)` where `attestation = {code, state}` | the adapter consumes the `register` attempt by `state` (one-time), exchanges `code`+PKCE at the token endpoint, **validates** the `id_token` (signature via JWKS, `iss`, `aud`, `nonce`, `exp`/`iat`/`nbf`), and — **only on a verified token** — **atomically binds** the subject: `subjects.set(userId, {sub})`. Returns `{credentialId: sub, authStrength}`. On **any** failure it **throws and binds nothing** (the no-half-bound property). |
| **4. record the fact** | `IdentityService.enrollComplete` writes the `EnrollmentRecord` | on the adapter's success the service records, keyed by `userId`, `EnrollmentRecord{ credentialId: sub, authStrength, enrolledAt }` — the identity-level **fact** that makes `isEnrolled(recipient)` true. It commits this **only after** the provider returns a verified result (atomic; `see packages/identity/src/index.ts` `enrollComplete`), so a failed ceremony leaves no half-bound identity. |

**Why this satisfies "can later be verified."** Step-up (`see authentik-integration.md §3`) does
`challenge(userId)` → (the adapter throws unless a subject is bound) → `verifyAssertion(userId, {code,state})`
→ exchange/validate → **`id_token.sub === subjects.get(userId).sub`**. That check can only pass because
enrollment **bound that `sub`**. Enrollment establishes the subject; step-up matches against it — the two are
the begin/end of the same binding. The fact returned (`{credentialId, authStrength}`) is the **same shape**
the in-tree provider returns (`see adapters/auth-webauthn/src/index.ts` `finishEnrollment`), so
`IdentityService` is provider-agnostic and **unchanged**.

> The adapter already ships steps 1 and 3 (`beginEnrollment`/`finishEnrollment`, GLA-068). **What is not yet
> wired is the browser path between them** — the redirect + the callback that carries `{code,state}` back to
> `enrollComplete`. That is the seam tension `§8` and the GLA-072 dependency `§4`/`§8`.

---

## §3 · The binding — recipient → userId → stable subject, layer by layer (AC #2)

A later step-up must resolve to the **same** recipient that enrolled. That holds because three layers each own
exactly one mapping, composed end to end. **Be precise about which layer holds what:**

| Layer | Type / store | Key → value it holds | Owns |
|---|---|---|---|
| **Channel binding** | `RecipientBinding` (kernel; `see kernel-contracts.md §7`) | `recipient` (e.g. `"tg:user:123"`) → `userId` (+ `provenance`, `authStrength`) | the **channel→identity** mapping. Narrow-only, derived from the channel (`IdentityService.bind`/`bindFromInbound`, via `deriveUserId(recipient) = "user:<recipient>"`). |
| **Identity-level fact** | `EnrollmentRecord` (identity service; `packages/identity/src/index.ts`) | `userId` → `{ credentialId: sub, authStrength, enrolledAt }` | the **enrolled fact** — that this `userId` is enrolled, how strongly, when. `credentialId` carries the **`sub`** under the delegated provider (the field is provider-opaque: *"the credential id the provider registered"*). This is what `isEnrolled`/`getCredential` read. |
| **Provider-durable binding** | `BoundSubject` in the adapter's `subjects` store (`adapters/auth-authentik/src/stores.ts`) | `userId` → `{ sub }` | the **userId↔authentik-subject** binding — the delegated analogue of WebAuthn's credential store. The **only** durable fact the adapter holds (no secret, no key — authentik holds those). What `challenge`'s precondition and `verifyAssertion`'s step-(e) `subject_mismatch` check read. |

**Composition (the resolution path).** Inbound: `recipient → userId` (RecipientBinding). Step-up:
`verifyAssertion(userId, …)` resolves `userId → {sub}` (adapter `subjects`) and asserts the token's `sub`
equals it. So a forwarded link, a wrong recipient, or a valid authentik login by the **wrong person** all fail
— the chain only closes when the **same** `userId` that bound the **same** `sub` presents a token for that
`sub`. The `EnrollmentRecord` is the *fact* the gateway/identity consult to decide "is this recipient enrolled
at all" before step-up is even attempted; the `subjects` store is the *cryptographic* binding the assertion is
checked against. **Two stores, one truth, distinct jobs** — the same split the in-tree provider uses
(identity holds the fact; the adapter holds the credential), with `{sub}` substituted for the passkey.

> **No kernel/type change (master AC #1).** `RecipientBinding`, `UserIdentity.enrolledCredentialId`, and the
> identity `EnrollmentRecord` keep their shapes; only what fills `credentialId`/`enrolledCredentialId` changes
> (a `sub`, not a passkey handle) — exactly as `authentik-integration.md §5` fixed.

---

## §4 · The operator-discharge grant in the delegated case (AC #3)

**Enrollment still cannot be initiated without a single-use `operator-discharge` grant, and the gateway still
verifies it before any identity code is reached — the delegated provider changes none of this.** Confirmed
against the real gateway (`see packages/gateway/src/index.ts`):

- The gateway's existing `/enroll` routes are **provider-agnostic** — they verify the grant and then call the
  injected identity seam; they name no provider. `GET /enroll?grant=…` and `POST /enroll/options` do a
  read-only `verifyEnrollmentGrantToken` (signature, recipient caveat, TTL, single-use-not-spent, class +
  `purpose=enroll`); `POST /enroll/verify` does the **atomic** `tryConsumeEnrollmentGrantToken` (verify **and**
  mark the single-use nonce spent in one un-interleavable step), runs the identity step, and `unspend`s on
  failure so a genuine retry stays possible. **No public path bypasses the grant** (`access-gateway.md`
  invariant: *"No public path bypasses it"*).
- This is **unchanged** for authentik: the operator-discharge grant gates *whether enrollment may start*; the
  OIDC round-trip is *how the credential is established* once it has started. The two are orthogonal — the
  grant authorizes the *operation*, authentik authenticates the *human*.

**The one delegated difference, and the boundary it must respect.** The in-tree flow completes in-page
(`navigator.credentials.create` → POST the attestation). The OIDC flow adds an **authentik round-trip** (a
top-level redirect to authentik and back). That round-trip **must NOT add a second public entry** — the
**Access Gateway remains the sole public door** (`baseline.md §3`, `access-gateway.md`: *"the only door open
to the public internet"*). The adapter's callback is therefore an **adapter-owned endpoint fronted by the same
host Caddy** (never a new gateway route, never the local bridge), exactly as `authentik-integration.md §2`
decided. **That callback listener + the step-up/enroll page redirect is GLA-072's deliverable**
(`see authentik-integration.md §2`; and the adapter's own header note — *"the browser callback LISTENER +
step-up-page redirect … are GLA-072"*). GLA-069/070 depend on it for the **browser** path but not for the
**service** path (`§7`, `§8`): the operator-discharge gate, the `/enroll` routes, and the single-public-entry
invariant are all already satisfied and unchanged.

---

## §5 · First-run experience — un-provisioned → verifiable (AC #4)

**The happy path (operator-initiated, one-time).** Identical operator ergonomics to the in-tree default — the
operator action is provider-agnostic (`see packages/app/src/index.ts`/`daemon.ts` `enrollInvite`):

1. **Operator invites.** `enrollInvite(recipient)` mints a single-use operator-discharge grant bound to the
   recipient and **delivers the enrollment invite link over the channel** (recipient-bound; the CLI/Telegram
   channel). This is operator-side, **never** on the agent surface (`docs/05 §3`).
2. **Recipient completes the one-time authentik enrollment.** The recipient opens the link; the gateway
   verifies the grant and serves the enrollment page; the page (under the delegated provider) **redirects the
   recipient to authentik** (`authorizeUrl` from `beginEnrollment`); the recipient authenticates once at
   authentik; authentik redirects back to the adapter callback; `enrollComplete(recipient, {code,state})`
   validates and **binds the subject** (`§2`).
3. **Bound.** `IdentityService.isEnrolled(recipient)` is now `true`; the recipient is verifiable for later
   handoffs. The grant is spent (single-use) — re-running needs a fresh invite (recovery = re-enrollment,
   which **replaces** the prior record; `see packages/identity/src/index.ts` `enrollComplete`).

**What an un-enrolled recipient sees before then (verifiable-only-after-enrollment).** A handoff/step-up for a
not-yet-enrolled recipient is **denied** — confirmed at three layers, all already real and provider-agnostic:

- **Gateway:** on a handoff link, `stepUp.isEnrolled(recipient)` is false → the gateway serves a **catchable
  refusal page** ("This recipient is not enrolled. Ask the operator to enroll first."), not a crash
  (`see packages/gateway/src/index.ts` `handleHandoffPage`; `GLA-035 AC#4`); `POST /handoff/auth/options`
  returns `auth.insufficient` ("recipient is not enrolled").
- **Identity service:** `authenticationOptions(recipient)` **throws** `auth.insufficient` for an un-enrolled
  recipient, and `verifyAuthentication(recipient, …)` returns `{ ok:false, authStrength:"none" }` directly
  (`see packages/identity/src/index.ts`).
- **Adapter:** `challenge(userId)` **throws** ("cannot challenge an un-enrolled user (no bound authentik
  subject)") when no `BoundSubject` exists, and `verifyAssertion` returns `subject_mismatch` → `{ok:false}`
  if somehow reached (`see adapters/auth-authentik/src/index.ts`).

So a recipient is **inert until enrolled** and **verifiable after** — the first-run flow is the *only* path
from one state to the other, exactly as the in-tree default behaves.

---

## §6 · Preserved invariants — the delegated flow does not weaken them (AC #5)

The frozen invariants (`see docs/components/identity-and-auth.md`, `docs/architecture/kernel-contracts.md §7`)
all hold under delegation; each is shown satisfied by the **real** flow above:

| Invariant (frozen) | How the delegated flow upholds it |
|---|---|
| **A recipient is verifiable only if previously enrolled.** | Step-up requires a `BoundSubject`; `challenge` throws and `verifyAssertion` fails (`subject_mismatch`) without one (`§5`). Enrollment is the *only* writer of `subjects` (`finishEnrollment`, atomic-on-verified). |
| **Enrollment is one-time and operator-initiated, `operator-discharge`-authorized.** | Gated by the single-use grant the gateway verifies+consumes (`§4`); initiated by the operator's `enrollInvite`, never the recipient or agent unprompted. Re-enrollment needs a fresh grant. |
| **Enrollment is never a per-task / per-handoff step.** | The OIDC round-trip happens **only** in the enrollment flow (`register`-kind attempts). A handoff step-up is a **separate** ceremony (`authenticate`-kind) against the **already-bound** subject — it never enrolls. The two attempt kinds are distinct and not cross-usable (`wrong_attempt_kind`; `see adapters/auth-authentik/src/stores.ts`). |
| **The agent never enrolls recipients and never sees credentials.** | Enrollment is operator-side (`enrollInvite`, not the agent CLI; `docs/05 §3`); the credential lives in authentik (GLA never sees it); the adapter holds only a `sub`. |
| **Recipient-binding originates from the channel and is only ever narrowed.** | `RecipientBinding` is still derived from the channel (`bind`/`bindFromInbound`); delegation adds a `sub` binding **under** the `userId` but never widens the channel binding. |
| **The verifier reports facts, not decisions.** | `finishEnrollment`/`verifyAssertion` return `{credentialId/ok, authStrength}` facts; the gateway owns the allow/deny (`strengthSufficient`). Unchanged from the in-tree default. |

**Net:** delegation moves *where the credential lives* (authentik, not GLA) and *what GLA records* (a `sub`,
not a passkey), but the **shape and guarantees** of enrollment are identical — verifiable-only-after-enrollment
is enforced by the subject binding instead of the passkey store, one-time + operator-initiated is enforced by
the same grant, and the no-half-bound atomicity is preserved by the adapter throwing (binding nothing) on any
failure, mirrored by the identity service recording nothing.

---

## §7 · Implementation plan for GLA-070 (AC #6)

GLA-070 builds *enrolling a recipient through authentik* — the **service-layer subject-linking + the
enrolled-fact recording**, wired to the real adapter, with enrolled-vs-not observable from outside. Concrete
steps:

1. **Wire the delegated provider into enrollment composition.** In `packages/app` (`createEnrollmentStack`
   and the `createProvisioningBridge` handoff/enroll wiring), when `GLA_AUTH_PROVIDER=authentik`
   (`see authentik-integration.md §7`), construct `new AuthAuthentikProvider(<oidc config>)` and inject it
   into `new IdentityService({ authProvider })` — **the same injection line** as the WebAuthn default (both
   implement `AuthProviderPort`), so nothing downstream changes. (The switch itself is the master §7 plan;
   GLA-070 uses it for the enrollment path.)
2. **Confirm `enrollComplete` maps onto `finishEnrollment`'s `{code,state}` assertion.** The service's
   `enrollComplete(recipient, attestation)` already calls `provider.finishEnrollment(userId, attestation)` and
   records the fact only on success (`see packages/identity/src/index.ts`). Under authentik, `attestation` is
   `{code,state}` (not a WebAuthn attestation). GLA-070 verifies the service path is provider-shape-agnostic
   (it is — `attestation: unknown` is passed through) and that the recorded `EnrollmentRecord.credentialId`
   is the `sub`. **No `IdentityService` change should be required** beyond confirming this; if any
   WebAuthn-specific assumption is found in the enrollment path, that is a defect to fix here.
3. **Provide the enrollment round-trip path** — the begin (redirect) + the callback that delivers `{code,state}`
   to `enrollComplete`. **This is shared with GLA-072's callback machinery** (`§4`, `§8`): GLA-070 must either
   (a) consume the GLA-072 callback for the `register` case, or (b) if sequenced before it, test the
   service-layer binding directly against the adapter (the adapter's `beginEnrollment`/`finishEnrollment` +
   the `fake-authentik` test seam, `see adapters/auth-authentik/src/fake-authentik.ts`) and leave the
   browser-callback wiring to 072. **Recommended:** build/test the *service* slice now (deterministic,
   no browser), and make the *browser* enrollment path land with 072's callback — coordinated, not duplicated.
4. **Record the binding atomically.** Ensure the success path writes `subjects[userId]={sub}` (adapter) and
   `EnrollmentRecord[userId]` (identity) and the failure path writes **neither** (the adapter throws → the
   service records nothing). This is already the adapter/service behavior; GLA-070's tests must **prove** it
   (a failed/invalid id_token leaves `isEnrolled(recipient)` false and retryable).
5. **Tests (the acceptance evidence).** End-to-end (with `fake-authentik` standing in for authentik):
   enroll a recipient → `isEnrolled(recipient)` true, `getBoundSubject(userId).sub` set, the
   `EnrollmentRecord.credentialId === sub`; a step-up for that recipient now resolves (subject matches); a
   **failed** enrollment (bad token / wrong nonce) leaves `isEnrolled` false; an enrollment-then-handoff
   reuses the same subject.

**Enrolled-versus-not is observable from outside (AC #6's core).** After a successful bind,
`IdentityService.isEnrolled(recipient)` returns `true` (and `getCredential(recipient)` returns the record with
`credentialId === sub`); the adapter's `isEnrolled(userId)`/`getBoundSubject(userId)` corroborate at the
provider layer. Before it — or after a failed ceremony — `isEnrolled(recipient)` is `false`, and a **step-up
attempt for that recipient is denied** at the gateway (catchable refusal / `auth.insufficient`) and the
identity/adapter layers (`§5`). These are the same external observables the in-tree default exposes, so the
existing enrollment/handoff E2E shape carries over with the provider swapped.

**What GLA-070 must build vs what GLA-068 already provides.**

| Already provided by the adapter (GLA-068, merged) | GLA-070 must build / wire |
|---|---|
| `beginEnrollment(userId, discharge)` → `{kind:"redirect", authorizeUrl}` (`register` attempt) | the `packages/app` composition that selects+injects the authentik provider into the **enrollment** stack (§7.1) |
| `finishEnrollment(userId, {code,state})` → atomic `subjects.set` → `{credentialId: sub, authStrength}` | confirming `IdentityService.enrollComplete` records the `sub`-fact correctly under the delegated provider (§7.2) and the no-half-bound proof (§7.4) |
| the `subjects`/`attempts` stores, PKCE/state/nonce, id_token validation, `isEnrolled`/`getBoundSubject` | the enrollment **round-trip browser path** — coordinated with GLA-072's callback (§7.3, §8) — or the service-layer tests if sequenced first |
| `fake-authentik` test seam for deterministic E2E | the GLA-070 **enrollment tests** that assert the external observables (§7.5) |

---

## §8 · Seam tension / risks GLA-070 must watch

1. **The `enrollComplete` ↔ `finishEnrollment` assertion shape, and the callback that feeds it (the central
   tension).** `IdentityService.enrollComplete(recipient, attestation)` passes `attestation` straight to
   `provider.finishEnrollment(userId, attestation)`; the authentik adapter requires `attestation = {code,
   state}` (the OIDC callback params), **not** a WebAuthn `RegistrationResponseJSON`. But the gateway's
   **served `enrollPageHtml` posts a WebAuthn attestation** to `/enroll/verify`
   (`see packages/gateway/src/enroll-page.ts`). So OIDC enrollment needs the **browser-redirect + adapter-owned
   callback** that delivers `{code,state}` to `enrollComplete` — **the same machinery GLA-072 builds for
   step-up** (`§4`; the adapter header: *"the browser callback LISTENER + … redirect … are GLA-072"*). The
   service-layer mapping is sound and provider-agnostic **today** (068's port shape); the **browser** path is
   the open dependency. GLA-070 must **coordinate with GLA-072 rather than duplicate or fork** a callback, and
   must **not** edit the gateway to special-case OIDC (that would touch the fixed core — a scope surface; stop
   and surface). The clean split: **070 owns the service slice + tests (deterministic), 072 owns the shared
   browser callback** — and 070's browser-enrollment E2E lands on 072's callback.
2. **Backlog edge: 070 ← {068,069}, not 070 ← 072.** The dependency graph does **not** encode 070's reliance
   on 072's callback for the *browser* path. This is acceptable because 070's **acceptance evidence is the
   service-layer observables** (`isEnrolled`, the recorded `sub`-fact), provable with the `fake-authentik`
   seam **without** a browser. GLA-070 should **note this explicitly** (`backlog task edit … --notes`) so the
   browser-enrollment E2E is understood to land with/after 072, not block 070's service deliverable. If the
   team wants the full browser enrollment inside 070, that is a re-sequencing decision to **surface**, not to
   decide silently.
3. **Subject stability.** The whole binding rests on the OIDC `sub` being **stable** across logins
   (`BoundSubject.sub` doc-comment flags it). authentik must be configured (GLA-073/074) so `sub` is the
   immutable user id, not a mutable email/username — else re-verification silently breaks. GLA-070's tests
   should assert the enrolled `sub` equals the step-up `sub` for the same recipient.
4. **No-half-bound under partial failure.** The atomicity depends on the adapter **throwing** (binding nothing)
   on any id_token failure and the identity service recording nothing on a throw. GLA-070 must test the
   failure path (invalid token / nonce mismatch / token-exchange failure) leaves `isEnrolled(recipient)` false
   and the recipient retryable with a **fresh** grant (the spent grant is single-use).
5. **Re-enrollment / recovery semantics.** `enrollComplete` **replaces** a prior `EnrollmentRecord`, and
   `finishEnrollment` **overwrites** the `subjects` entry. Recovery = a fresh operator invite + a new authentik
   round-trip → a (possibly new) `sub` bound. GLA-070 should confirm a re-enroll cleanly rebinds and that a
   stale `attempts` entry cannot bind (TTL + one-time-consume already enforce this in the adapter).

---

## §9 · Conformance summary (the contract this doc fixes)

1. Delegated enrollment is `beginEnrollment` (→ authentik redirect) → one-time authentik login →
   `finishEnrollment({code,state})` (validate id_token → **atomically bind `sub`**) → `IdentityService` records
   the **enrolled fact** (`§2`).
2. The binding is three composed layers: `RecipientBinding` (recipient→userId) · `EnrollmentRecord`
   (userId→fact, `credentialId=sub`) · adapter `subjects` (userId→`{sub}`); step-up resolves `sub` against the
   adapter binding (`§3`).
3. The single-use operator-discharge grant **still** gates enrollment and is verified+consumed by the gateway
   before identity is reached; the gateway stays the **sole public entry**; the OIDC round-trip adds **no**
   second public door (the callback is GLA-072's, adapter-owned, behind the same Caddy) (`§4`).
4. First-run: operator `enrollInvite` → recipient completes the one-time authentik enrollment → bound; before
   that, a step-up for an un-enrolled recipient is **denied** at gateway + identity + adapter (`§5`).
5. All frozen invariants hold under delegation — verifiable-only-after-enrollment (subject binding), one-time +
   operator-initiated (same grant), never-a-handoff-step (distinct attempt kinds), agent-blind (`§6`).
6. GLA-070 builds the service-layer subject-linking + enrolled-fact recording (provider injected, atomic,
   tested via `fake-authentik`); enrolled-vs-not is observable via `IdentityService.isEnrolled` (true after
   bind; a step-up for an un-enrolled recipient denied), coordinating the browser-callback path with GLA-072
   (`§7`, `§8`).

## Related

`docs/architecture/authentik-integration.md` (the master — `§2` OIDC flow, `§3` step-up contract, `§5`
credential-authority shift, `§7` selection surface) · `docs/components/identity-and-auth.md` (the frozen
identity/auth model + enrollment invariants) · `docs/components/access-gateway.md` (the sole-public-entry +
Phase-E enrollment role) · `docs/architecture/kernel-contracts.md §7` (recipient-identity & enrollment types) ·
`adapters/auth-authentik/src/index.ts` (`beginEnrollment`/`finishEnrollment`, `isEnrolled`/`getBoundSubject`) ·
`adapters/auth-authentik/src/stores.ts` (`BoundSubject`, the `subjects`/`attempts` stores) ·
`adapters/auth-authentik/src/fake-authentik.ts` (the deterministic test seam GLA-070 uses) ·
`packages/identity/src/index.ts` (`enrollmentOptions`/`enrollComplete`/`isEnrolled`/`EnrollmentRecord`) ·
`packages/gateway/src/index.ts` + `enroll-page.ts` (the `/enroll` routes, the operator-discharge gate, the
in-page ceremony the OIDC path replaces with a redirect).
