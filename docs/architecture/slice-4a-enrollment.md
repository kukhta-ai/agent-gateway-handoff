# GLA — Slice 4a: Recipient Enrollment (scenario-01 Phase E)

> **Status:** Slice design + build note. **Satisfies the PLAN task GLA-012 (plan the recipient-enrollment
> step)** and frames the IMPL task **GLA-013 (enroll a recipient so they can later be verified).** **Scope:**
> the one-time, operator-initiated enrollment that establishes a recipient's WebAuthn passkey bound to their
> `UserIdentity` and records `auth_strength = webauthn` — the **precondition** every later handoff
> verification (Slice 4b / Phase 6) relies on. It builds on Slice 1's `RecipientBinding`, Slice 3's shared
> `HmacCapabilitySigner` (Slice 3 unified on ONE signer; this slice reuses it), and the kernel's
> `IdentityPort` / `AuthProviderPort` / `CapabilityPort` (`kernel-contracts.md §6–§7`).
>
> This conforms to the committed spec; cross-references (`see docs/<x>`) are the source of truth and are not
> restated. Where this names a concrete package it concretizes a `baseline.md §1` layout slot, never
> overriding a goal, vocabulary, or invariant.
>
> **Reads against:** `components/{identity-and-auth,access-gateway,capability-service,channel-adapter}.md`;
> `kernel-contracts.md` §2 (the `operator-discharge` class + recipient-binding), §6 (IdentityPort,
> AuthProviderPort, CapabilityPort, ChannelPort), §7 (enrollment model + invariants); `baseline.md` §3–§5
> (the two-actor capsule, the `:3000` Access Gateway, in-tree WebAuthn default); `dependency-strategy.md` §4
> D6 (WebAuthn in-tree default → GLA-011 only for the authentik alt); `docs/00`, `docs/01 §5` (the
> enrollment precondition); `docs/05 §3` (enrollment is NOT on the agent surface).

## Rule-3 note

`bmad-dev-story` (and `bmad-quick-dev`) **were loaded** (the skills activate) but cannot run unattended for
these tasks. `bmad-dev-story` SKILL.md Step 1 (`tag="sprint-status"`) reads
`{implementation_artifacts}/sprint-status.yaml` to find the next ready story and then opens a context-filled
per-story spec file; in this repo `_bmad-output/implementation-artifacts/sprint-status.yaml` and any per-story
`*-*-*.md` spec file **do not exist** (the directory is empty), so the workflow hits its interactive `<ask>Choose
option [1]/[2]/[3]/[4]</ask>` HALT and cannot continue. Per `AGENTS.md` Rule-3's explicit allowance, that path
was stopped, the blocker named, and this slice was implemented **directly from the committed design set** as the
stated fallback — the same posture Slices 1–3 record. The skills actually run per task are recorded in the build
note (below) and each task's `--notes`.

---

## 1 · The shape — three doors, one precondition

Enrollment is the **one-time setup** that turns an *un-enrolled* recipient (bound to a channel, `auth_strength
= none`) into an *enrolled* one (a passkey bound to their identity, `auth_strength = webauthn`). It is **not**
part of any task/session/handoff flow and **never on the agent's CLI** (`docs/05 §3`, kernel invariant 8). Four
components cooperate, each owning exactly its committed responsibility:

```
OPERATOR ──enrollInvite(recipient)──▶ Capability svc: mint single-use operator-discharge grant (purpose=enroll)
                                          │
                                          ▼
                                      Channel adapter: deliver the invite link (carrying the grant) to EXACTLY the bound recipient
                                          │
   RECIPIENT ──taps link──▶ Access Gateway (SOLE public entry, :3000)
        GET /enroll?grant=… ─▶ verify grant (sig, recipient caveat, TTL, single-use NOT-spent) ─▶ serve the enrollment web page
        POST /enroll/options ─▶ Identity+Auth → AuthProvider.beginEnrollment → registration options (challenge), bound to the recipient
        POST /enroll/verify  ─▶ Identity+Auth → AuthProvider.finishEnrollment → verify attestation
                                  → ATOMIC store the credential bound to the UserIdentity + set auth_strength=webauthn
                                  → mark the grant SPENT (single-use; a reused token now fails verify)
```

The division of authority is the spec's, verbatim: the **gateway verifies** (it neither mints nor runs the
ceremony); **Capability** mints the grant and owns the spent-set; **Identity+Auth** owns the credential, its
storage, and `auth_strength`; the **AuthProvider** (in-tree WebAuthn) runs the cryptographic ceremony behind
its port; the **channel** delivers to exactly the bound recipient.

---

## 2 · Identity + Auth — credential registration + storage + `auth_strength` (GLA-012 AC#1)

`identity-and-auth.md` makes Identity+Auth the owner of **enrollment**: "register a credential … bound to their
`UserIdentity`, establishing the binding and its initial `auth_strength`." Slice 1 implemented only `bind`
(narrow-only, `auth_strength = none`); Slice 4a turns `enroll` real and adds the credential store, as a
**contract** (not a transcript of a library call):

| Operation | Contract | Notes |
|---|---|---|
| `enrollmentOptions(recipient)` | → registration options (a challenge) from the AuthProvider, **bound to the recipient's `UserIdentity`** | delegates to `AuthProviderPort.beginEnrollment(userId, discharge)`; records the pending challenge transiently (not yet a binding) |
| `enrollComplete(recipient, attestation)` | verify the attestation via the AuthProvider; on success **ATOMICALLY** store the credential bound to the `UserIdentity`, set `enrolledCredentialId`, and record `auth_strength = webauthn` | delegates to `AuthProviderPort.finishEnrollment`; on a failed/abandoned ceremony stores **nothing** (no half-bound identity — GLA-013 AC#4) |
| `isEnrolled(recipient)` | → `true` iff a credential is stored for the recipient's identity | the **outside-observable** enrolled-vs-not fact (AC#6) |
| `getCredential(recipient)` | → the stored credential (public key + counter) for a later verify, or undefined | used by Slice-4b authentication |
| `verifyAuthentication(recipient, assertion)` | → `{ ok, auth_strength, userId }`; **deny** if not enrolled | the precondition gate — un-enrolled ⇒ deny (GLA-013 AC#3) |

**Atomicity (the load-bearing AC#4).** The credential is committed to the store **only** after
`finishEnrollment` returns a verified credential. A throw, an out-of-contract attestation, or an abandoned
ceremony leaves `isEnrolled = false`; the recipient simply retries with a fresh grant and succeeds (idempotent
re-enrollment). There is no intermediate state where an identity is "partly enrolled."

**`auth_strength` as a contract.** The strength is a **fact**, not a decision (`identity-and-auth.md`
invariant): enrollment sets `webauthn`; the verifier reports it; the *enforcement point* (the gateway, in
Slice 4b) decides whether that strength is sufficient. Identity+Auth never makes an allow/deny.

**Re-enrollment / recovery.** Enrollment is idempotent at the identity level: a second successful enrollment
(authorized by a fresh operator-discharge grant) **replaces** the stored credential (e.g. a lost passkey). The
operator re-issues an invite; the recipient registers a new passkey; the old credential is overwritten. No
special "recover" path is needed — recovery *is* re-enrollment with a new grant.

---

## 3 · The Access Gateway — fronting enrollment, no bypass (GLA-012 AC#2)

`access-gateway.md`: the gateway is the **sole public entry**; "no public path bypasses it"; for Phase E it
"verifies the single-use `operator-discharge` enrollment grant the invite carries, then forwards passkey
registration to Identity+Auth." Slice 4a stands up the **real HTTP server** (`packages/gateway`, `node:http`,
bind host configurable — default `0.0.0.0:3000` for hermes-1; tests bind `127.0.0.1:<ephemeral>`):

| Route | Behaviour | Refusals (stable reason) |
|---|---|---|
| `GET /enroll?grant=<token>` | verify the grant via `CapabilityPort.verify` (signature, `recipient` caveat, `ttl`) **+** the single-use spent-set (not-yet-spent) **+** class=`operator-discharge`, purpose=`enroll`; on success serve a minimal **HTML+JS page** that runs `navigator.credentials.create` | absent → **400** `usage.bad_argument`; invalid/forged/wrong-recipient → **403** `auth.recipient_mismatch` / `auth.malformed`; expired → **403** `auth.expired`; reused (spent) → **403** `auth.revoked` |
| `POST /enroll/options` | body carries the grant; re-verify it, then return `Identity.enrollmentOptions(recipient)` (the registration challenge) | same refusals as GET (grant re-checked — every request) |
| `POST /enroll/verify` | body carries the grant + the WebAuthn attestation; re-verify the grant, call `Identity.enrollComplete`; on success **mark the grant spent** and return `{ enrolled: true, auth_strength }` | same refusals; **a direct POST with no/invalid grant is refused** (no-bypass, GLA-012 AC#2) — and on a refusal **no credential is stored** |

**No bypass is structural, not incidental.** *Every* enrollment route verifies the grant first; there is no
route that reaches `Identity.enrollComplete` without a passing grant check. A direct `POST /enroll/verify`
without a valid grant returns 401/403 and stores nothing (proven by a dedicated test). The grant is re-checked
on the options call AND the verify call (not just the initial GET), so a stale page cannot complete after the
grant expires or is spent.

**Stateless verify in the common path.** Grant signature/recipient/TTL verification is the kernel's pure
`verify()` against a pushed revocation snapshot — no DB round-trip (`kernel-contracts.md §2.3`). The
*single-use* dimension is the one piece of mutable edge state: a small **spent-set** the Capability service
owns (a reused nonce fails). This mirrors how revocation rides the snapshot — single-use is "revoke-on-first-
use," consulted the same cheap way.

**The gateway verifies; it does not mint or run the ceremony.** It calls `CapabilityPort.verify` (never
`mint`) and forwards the ceremony to Identity+Auth / the AuthProvider (it never calls `@simplewebauthn`
itself). It depends only on **kernel ports + injected seams** — it imports no adapter (the boundary lint
proves it); `app` injects the real WebAuthn provider, the identity service, and the capability service.

---

## 4 · Capability service — the single-use operator-discharge enrollment grant (GLA-012 AC#3)

`capability-service.md` + `kernel-contracts.md §2.1`: `operator-discharge` is one of the six classes, minted
**out-of-band by the operator**, carrying `single-use`, `purpose=enroll`, and `ttl` caveats — **distinct from a
handoff grant** (a `session`-class grant carrying `recipient`/`ttl`/`scope`/`net-confine`). Slice 4a adds to
`CapabilityService`:

- `mintEnrollmentGrant(recipient, ttl?)` → an `operator-discharge` capability whose caveats are
  `{ recipient }` (bound to exactly this recipient — a forwarded invite is useless in another's hands),
  `{ purpose: "enroll" }`, `{ single-use: nonce }` (a fresh random nonce), and `{ ttl }` (short, default 1h).
  Returns `{ capability, token }` — the token is what the invite link carries.
- A **spent-set** (`markSpent(nonce)` / `isSpent(nonce)`): the consumed-nonce registry. `verifyEnrollmentGrant`
  checks it; `enrollComplete` success calls `markSpent`. A reused token then fails verify with a stable reason.
- `verifyEnrollmentGrant(token, { recipient, now })` → a `VerifyResult`-shaped check that runs the kernel
  `verify()` (signature, recipient caveat, TTL) **and** asserts class=`operator-discharge`, purpose=`enroll`,
  and `not isSpent(nonce)` — so the gateway calls one method and gets one fact.

**Why distinct from a handoff grant.** A handoff grant (`session` class) authorizes *reaching a live capsule*
inside a window; an enrollment grant (`operator-discharge`) authorizes *one* identity-registration ceremony.
Different class, different caveat set (`purpose=enroll` + `single-use`, no `scope`/`net-confine`), different
lifecycle (single-use vs revocable-window). The kernel's caveat algebra (`caveats.ts`) already treats
`single-use` and `purpose` as first-class caveat kinds; this slice only adds the **service-level** mint +
spent-set bookkeeping the kernel deliberately leaves to "the services that care" (the HMAC signer's `verify()`
carries `single-use`/`purpose` in the signed chain but does not interpret them at the edge — by design).

---

## 5 · Channel adapter — the invite reaches exactly the intended recipient (GLA-012 AC#4)

`channel-adapter.md`: "Handoff links are delivered only to the bound recipient." The enrollment invite is the
same shape — `channel-cli`'s `deliver(recipient, link, delegation)` writes the recipient-bound invite link to
its sink (the E2E "human" polls it; in hermes-1 the Telegram adapter sends a Mini-App button). The link is
`http(s)://<gateway-host>/enroll?grant=<token>` — it carries the single-use grant, and the grant's `recipient`
caveat means even if the link leaks, the gateway refuses it for anyone but the bound recipient. The adapter
**never widens the binding** (it transports; it does not authenticate — identity proof happens when the link is
opened, at the gateway).

---

## 6 · The enrollment UX, end to end (GLA-012 AC#5)

Designed at the level of *what the recipient experiences*, the first-class first-run surface
`identity-and-auth.md` calls for:

1. **Invite.** The operator (via their agent's `enrollInvite`, or a `gla operator enroll` subcommand)
   triggers a mint+deliver. The recipient receives one message in their channel: "Register your passkey for
   <service>:" + a link (a Telegram Mini-App button, or a plain link on CLI/email). One tap.
2. **First-time registration.** The link opens the gateway's enrollment page. The page shows a single
   "Register passkey" button; tapping it runs `navigator.credentials.create` with the options the gateway
   fetched (bound to the recipient). The OS passkey UI appears (Touch ID / Windows Hello / a security key);
   the recipient confirms. The page POSTs the attestation; on success it shows "✓ Enrolled — you can close
   this." The recipient is now enrolled with `auth_strength = webauthn`.
3. **Failure (what the user sees).** A refused/expired/reused grant renders a plain, stable message — "This
   enrollment link is invalid or has already been used. Ask the operator for a new one." — never a stack
   trace, never a partial success. A ceremony the user cancels (or that the authenticator rejects) leaves the
   page on the "Register passkey" button with "Registration was not completed — try again," and **nothing is
   stored** (the identity stays un-enrolled; the same grant, if still valid and un-spent, can be retried).
4. **Recovery / re-enrollment.** A lost passkey is recovered by the operator re-issuing an invite (a fresh
   single-use grant). Completing it **replaces** the stored credential. There is no separate recovery flow —
   recovery is re-enrollment, which keeps the model small (one ceremony, one grant class).

The page is intentionally minimal (HTML + a few dozen lines of vanilla JS, no framework, no build step) — it
runs the WebAuthn ceremony and POSTs results; all trust decisions are server-side at the gateway.

---

## 7 · Build / observation plan (GLA-012 AC#6 — feeds GLA-013)

Built bottom-up behind the kernel ports; the whole repo stays `pnpm gate`-green
(`tsc -b && biome ci . && vitest run`). **Enrolled-vs-not is observed from outside** three ways: (a) the
`isEnrolled(recipient)` fact; (b) a successful vs refused `POST /enroll/verify` over the real HTTP server;
(c) a later `verifyAuthentication` succeeding for an enrolled recipient and denying for an un-enrolled one.

| # | Package / adapter | What it adds | Observed by (test) |
|---|---|---|---|
| 1 | `adapters/auth-webauthn` | the kernel `AuthProviderPort` over `@simplewebauthn/server`: `beginEnrollment` → `generateRegistrationOptions`; `finishEnrollment` → `verifyRegistrationResponse` → a stored credential (id, public key, counter); `challenge` → `generateAuthenticationOptions`; `verifyAssertion` → `verifyAuthenticationResponse` → `{ ok, auth_strength }` | UNIT (server-side, no browser): a fixed registration response verifies and yields a credential; a tampered one is rejected — proves the verify logic regardless of the browser path |
| 2 | `packages/identity` | enrollment + store on `IdentityService`: `enrollmentOptions` / `enrollComplete` (atomic) / `isEnrolled` / `getCredential` / `verifyAuthentication`; an injected `AuthProviderPort` (kernel port, not the adapter) | UNIT: enroll → `isEnrolled` true + `auth_strength=webauthn`; a failed `finishEnrollment` leaves `isEnrolled` false (atomic, AC#4); `verifyAuthentication` denies an un-enrolled recipient (AC#3) |
| 3 | `packages/capability` | `mintEnrollmentGrant(recipient,ttl?)` (operator-discharge; recipient + purpose=enroll + single-use + ttl), the spent-set (`markSpent`/`isSpent`), `verifyEnrollmentGrant(token,{recipient,now})` | UNIT: a fresh grant verifies; a wrong-recipient / expired / spent grant fails with the right stable reason; the grant is distinct (class/caveats) from a session grant |
| 4 | `packages/gateway` | the **real HTTP server** (`node:http`): `GET /enroll`, `POST /enroll/options`, `POST /enroll/verify`; grant-verify on every route; serve the enrollment page; mark-spent on success; depends on injected seams (verifyEnrollmentGrant, identity, deliver-nothing) — **no adapter import** | CONTRACT (real server on `127.0.0.1:<ephemeral>`): grant enforcement (absent/wrong/expired/reused each refused, stable reason, **no credential stored**); **no-bypass** (direct `POST /enroll/verify` without a grant refused); the page is served only on a valid grant |
| 5 | `adapters/channel-cli` | reuse `deliver` for the recipient-bound invite link (no new code beyond the invite-link shape) | INTEGRATION: the invite link is written to exactly the bound recipient's sink |
| 6 | `packages/app` | `enrollInvite(recipient)` (operator action: mint grant → deliver invite); wire the gateway with the real WebAuthn provider + identity + capability + channel | INTEGRATION + **REAL WebAuthn**: see §8 |

---

## 8 · Tests — REAL WebAuthn via a virtual authenticator (GLA-013 AC#1/#2/#3/#4/#5)

The security seam is proven with **negatives covered**. The headline test exercises a **real** WebAuthn
ceremony — Chromium (Playwright) driving a **CDP virtual authenticator** (`WebAuthn.addVirtualAuthenticator`),
which is installed and verified working in this environment:

- **REAL enrollment + authentication (AC#1/#3), in `packages/app`** (it already has `playwright-core` + imports
  `auth-webauthn`): boot the real gateway on an ephemeral loopback port; `enrollInvite(recipient)` mints an
  operator-discharge grant and delivers the invite link; launch headless Chromium with a virtual authenticator;
  navigate the invite link; click "Register passkey" → `navigator.credentials.create` runs against the virtual
  authenticator → POST the attestation → assert `isEnrolled(recipient)` is true with `auth_strength = webauthn`.
  Then drive a later `challenge` + `verifyAuthentication` (a `navigator.credentials.get` assertion) against the
  **same** virtual authenticator → assert it succeeds. If the virtual-authenticator path cannot run for any
  reason, it is **gated** (`it.runIf`) and the **server-side `@simplewebauthn` verify is unit-tested with fixed
  fixtures** (test #1 above) so enrollment logic is proven regardless.
- **Grant enforcement (AC#2):** four distinct gateway tests — enrollment refused for an **absent**,
  **wrong-recipient**, **expired**, and **reused** (already-spent) grant — each a stable refusal, each asserting
  **no credential stored**.
- **No bypass (GLA-012 AC#2):** a direct `POST /enroll/verify` with no valid grant → refused.
- **Half-bound (AC#4):** a failed/abandoned registration leaves `isEnrolled = false` and is safely retryable (a
  second attempt with a fresh grant succeeds).
- **Un-enrolled can't verify (AC#3):** `verifyAuthentication` for a recipient who never enrolled → deny.
- **Swap IdP (AC#5):** `identity` and `gateway` depend on `AuthProviderPort` (a kernel interface), not on
  `auth-webauthn`; **only `app` imports the adapter** — asserted by the import-boundary lint (`biome ci .`) and
  by a structural check that the gateway/identity sources name no `@gla/auth-webauthn` import.

---

## 9 · Dependencies (GLA-012 AC#7) — the identity provider, named + classified

`dependency-strategy.md §4 D6` is the binding classification: the **default identity/auth verifier is in-tree
WebAuthn** (`@simplewebauthn/server`) behind the kernel **`AuthProviderPort`** — an **in-tree adapter** (a
library inside the GLA process, no host service), classified **Managed as part of `gla-core`**. The
**heavyweight alternative** (authentik / a standalone IdP) is host-touching → the **`wpm` installer-package task
GLA-011**, which applies **only when the authentik/OIDC alternative is selected**. So:

| Dependency | Seam | Path | `wpm` task | Reference mode |
|---|---|---|---|---|
| `@simplewebauthn/server` (WebAuthn verifier, **default**) | `AuthProviderPort` | **in-tree adapter** (`adapters/auth-webauthn`) | — (part of `gla-core`) | **Managed** (in-tree) |
| authentik / OIDC (alt IdP) | `AuthProviderPort` | `wpm` bundle | **GLA-011** | Managed / Local-/Remote-External |
| `playwright-core` + Chromium (REAL WebAuthn test only) | — (test harness) | dev/test dependency | (rides browser-runtime GLA-007 in hermes-1) | dev |

`@simplewebauthn/server` is the one runtime dependency this slice adds (a traditional, in-tree library — no
host standup). `playwright-core` is a **test-only** devDependency (already present for Slice 3's REAL-CDP
test). No new host-touching dependency is introduced, so **no new `wpm` task is required by Slice 4a** (the
authentik alternative's `wpm` task GLA-011 already exists in the backlog).

---

## 10 · The enrollment seam is full-capability (GLA-012 AC#8) — a different IdP, no core change

`AuthProviderPort` (`kernel-contracts.md §6`) carries everything *any* identity provider needs:
`beginEnrollment(userId, discharge)` / `finishEnrollment(userId, assertion)` / `challenge(userId)` /
`verifyAssertion(userId, assertion)` — registration **and** authentication, both returning **facts**
(`{ credentialId, authStrength }` / `{ ok, authStrength }`), never a decision. The assertion/challenge payloads
are `unknown` (adapter-shaped), so a WebAuthn passkey, an authentik OIDC round-trip, or a password record all
fit the **same** four methods. `identity` and `gateway` depend only on this port; `app` injects the concrete
provider. Adding a different IdP = a new `adapters/auth-<x>/` package implementing the port + an `app` wire
change — **no `packages/*` core edit** (the horizontal-extension property, `baseline.md §6`). The MVP proves
the *property*, not a public plugin API (deferred until ≥2 real providers, `docs/02 §9`); `auth-webauthn`
(default) + `auth-authentik` (alt, stubbed) are the two seats.

---

## 11 · Build & observation summary

Built behind the kernel ports; `pnpm gate` + `pnpm gate:selftest` stay green. The **core proof** is the **REAL
WebAuthn** virtual-authenticator test (registration → `isEnrolled` + `auth_strength=webauthn` → authentication
against the same authenticator), which runs in this dev env; the **server-side `@simplewebauthn` verify** is
unit-tested with fixed fixtures so enrollment logic is proven even if the browser path is gated. The
**grant-enforcement** (absent/wrong/expired/reused), **no-bypass**, **half-bound** (atomic), **un-enrolled-deny**,
and **swap-IdP** (boundary) properties are asserted at the unit/contract level — the security + boundary seams.

## Deferred (Slice 4b+)

What the gateway still needs for **Slice 4b** (scenario-01 Phase 6, the user's step-up): **verify a `session`
handoff grant** (recipient caveat, TTL, scope) on every request and WS upgrade; **WebAuthn step-up** at the edge
(trigger `challenge` + `verifyAuthentication` when `auth_strength` is insufficient, reusing the credential this
slice stored); **proxy** the authorized WS upgrade to the capsule's noVNC human-entrypoint (Slice 3 stood the
entrypoint up but left it un-proxied); and **force-close** the WebSocket on revoke. Slice 4a leaves the gateway
HTTP server, the grant-verify primitive, and the stored-credential precondition in place for 4b to build on.

## Build note — BMAD skills actually run

Per Rule-3, recorded for the evidence trail: the BMAD build skills could not run unattended (above); this
slice was implemented directly from the design set. The architect/test-design steering for the enrollment
contract, the grant-verified gateway fronting, the single-use operator-discharge grant, the channel invite,
and the REAL-WebAuthn observation plan is this document, grounded in the cited committed docs.

## Cross-references

- `kernel-contracts.md` — §2 (the `operator-discharge` class + recipient-binding + single-use), §6
  (AuthProviderPort / IdentityPort / CapabilityPort / ChannelPort — the seams this slice fills), §7 (the
  enrollment model + the frozen invariant "a recipient is verifiable only if enrolled").
- `baseline.md` — §1 layout + boundary rules (identity/gateway depend on ports, app injects the adapter), §3
  the two-actor capsule (the gateway is the sole public entry), §5 the in-tree WebAuthn default, §6 horizontal
  extension (a new IdP changes no core).
- `components/{identity-and-auth,access-gateway,capability-service,channel-adapter}.md` — the seam
  responsibilities this slice implements.
- `dependency-strategy.md` — §4 D6 (WebAuthn in-tree default; GLA-011 only for the authentik alt).
- `docs/00`, `docs/01 §5` — the enrollment precondition. `docs/05 §3` — enrollment is NOT on the agent surface.
- `slice-3-provision-connector.md` — the shared `HmacCapabilitySigner` + `CapabilityService` patterns this
  slice reuses (Slice 3 unified on ONE signer).
