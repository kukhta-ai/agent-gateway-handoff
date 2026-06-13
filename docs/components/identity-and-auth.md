# Identity + Auth

**Zone:** Config / Edge
**Kind:** GLA component (traditional code) + pluggable Auth Providers
**Scenario-01 lane:** Identity + Auth

> Establishes *who* a principal is and *how strongly* — the authentication authority for both humans (recipients) and, where a profile requires it, agents.

## Role

Identity + Auth maps channel-specific recipients to stable `UserIdentity` records, tracks the provenance and strength of each binding, and triggers step-up authentication through a pluggable Auth Provider. It also owns **enrollment** — the one-time, operator-initiated registration that establishes a recipient's credential (a passkey, or a password) bound to their identity, the precondition that makes any later verification possible. It is the single place credentials and assertions are verified. It is *not* a policy decision point — it answers "who is this, and how sure are we," never "is this allowed." Deployment-facing requirements are expressed as provider-neutral **auth assurance policy profiles** (`phishing-resistant`, `password-permitted`) over those facts.

## Responsibilities (owns)

- Map a channel-specific recipient → `UserIdentity`; maintain `RecipientBinding` with provenance and `auth_strength`.
- **Enroll** a recipient — register a credential (a WebAuthn passkey, or a password) bound to their `UserIdentity`, establishing the binding and its initial `auth_strength`. This is a one-time, operator-initiated precondition, *not* part of any task flow, and its first-run experience (invite, registration, recovery) is a first-class UX surface.
- Trigger step-up via the configured Auth Provider (gateway-identity-only, webauthn-internal, OIDC, authentik, Authelia — each ships as a plugin).
- Verify credentials/assertions and report the result — *ok + auth_strength + identity* — back to whichever enforcement point asked; adapters may additionally project provider evidence into the common auth-assurance evidence shape for diagnostics.
- On the agent side, where a profile requires it: verify the agent credential and resolve the matched `AuthorityProfile`.

## Interfaces

**Receives** — from the Access Gateway: "verify this recipient / a challenge is required"; from the Agent Bridge: "verify this agent under profile X"; and the credential/assertion from the principal.
**Produces** — the auth result (`ok`, `auth_strength`, the resolved identity/profile) back to the calling enforcement point.

## What it does NOT do

It is **not** a policy decision point (that is Cedar, in Admission — authentication ≠ authorization). It does **not** mint capabilities (Capability service). It does **not** decide *when* to demand authentication at run time — the enforcement points and the deployment auth-assurance policy do that; Identity + Auth supplies the *mechanism* and the `auth_strength` / assurance evidence facts.

## Entities & data

`UserIdentity`, `RecipientBinding`, `auth_strength`, `AuthAssuranceEvidence`, `AuthAssurancePolicy`, the enrolled credential (a passkey or password, established at enrollment); `AuthorityProfile` (resolved for an authenticated agent). Auth Providers are catalog plugins.

## Auth-Assurance Evidence

`auth_strength` is a compatibility fact. `AuthAssuranceEvidence` is the enforcement-facing fact shape. A provider may
call something WebAuthn, passkey, hardware key, OIDC `amr`, or a future factor name, but before that factor can satisfy
the strongest gateway policy the adapter must translate it into provider-neutral evidence:

- **User presence** means the authenticator ceremony observed local interaction with the authenticator. Presence alone
  is not enough for the strongest profile.
- **User verification** means the ceremony proved the user was verified locally or by an equivalent configured provider
  proof, such as a passkey PIN/biometric/platform verification or an authentik flow that is explicitly configured and
  verified to require that proof.
- **Phishing-resistant evidence** means explicit user verification plus recipient/relying-party binding plus a
  replay-resistant challenge, nonce, state, or counter check. For WebAuthn this comes from the verified assertion; for
  authentik it comes from the validated OIDC token, subject/audience binding, one-time state/nonce/PKCE, and the
  deployment-owned UV proof claim.
- **Password-grade evidence** means a typed password, ambiguous valid provider evidence, or a WebAuthn/passkey-labelled
  method that lacks the required user-verification proof. It can satisfy only the explicit `password-permitted` profile.

Ambiguous or provider-specific authenticator evidence fails closed: it either degrades to password-grade with redacted,
operator-actionable diagnostics such as `missing-user-verification` or `method-unresolved`, or it is refused as
`ok:false`. Gateway authorization must never branch on raw provider fields such as `amr`, `acr`, WebAuthn flags, or
concrete provider names.

Legacy `auth_strength: "webauthn"` without an `AuthAssuranceEvidence` object is not sufficient for the default
`phishing-resistant` profile. The compatibility string may identify the broad method for old surfaces, but strongest
enforcement requires explicit user-verification, recipient-binding, and replay-resistant proof fields.

## In scenario 01

Phase E (one-time prerequisite) — recipient enrollment: the operator invites the recipient, who registers a passkey; Identity + Auth stores the credential bound to the recipient identity. This is the precondition Phase 6 relies on. Phase 6 — the user's step-up: the passkey path verifies the WebAuthn assertion against that registered credential and records `auth_strength = webauthn`; the password fallback yields `auth_strength = password`. The default `phishing-resistant` policy accepts only passkey-grade assurance; `password-permitted` is the explicit profile that admits password-grade evidence. Phase 12 — asked whether the recipient's auth is still valid; if so, no re-prompt, else re-auth.

## Authenticating the agent

This is the home for the agent-authentication question. (The Agent Bridge only *triggers* it — see `agent-bridge.md`.)

**Three things get conflated; only one is in question.**
- *Authorization* — the `agent-authority` capability that scopes operations and roots the attenuation chain. Always present (Capability service + `AuthorityProfile`).
- *Isolation* — the agent is unprivileged, reaches GLA only through the Bridge, and every action it proposes is validated regardless of who it is. Always present.
- *Authentication* — proving which agent principal is on the wire. This is the part that is **profile-gated**.

**Why it is not load-bearing in the reference profile.** GLA and the agent are deployed together, by one operator, on one host, and the Bridge is private — *not* the public entry. There is exactly one agent, on a channel trusted by position. "Authenticating" it would mean the operator handing a shared secret to a process they installed, on their own host, reachable only by them — proving nothing an attacker with host access couldn't forge. Identity was never a control the model rests on, so dropping agent authentication here costs zero security. What it really means is *"rely entirely on the Bridge's network isolation"* — which becomes a doctor/probe check (the Bridge is never bound to `0.0.0.0`).

**When agent authentication IS required** — design these as opt-in:

| Trigger | Why |
|---|---|
| More than one agent principal | multiple runtimes/tenants need different `AuthorityProfile`s and separate audit attribution |
| A network-reachable Bridge | network position no longer gates it → mTLS or signed token, like any exposed RPC |
| Per-agent attribution or revocation | compliance must name the principal, or a kill-switch must target one agent |
| A hostile co-tenant | other untrusted processes/containers can reach the socket |

**Mechanism when on:** mTLS or a signed token bound to an `AuthorityProfile`, verified here by an agent Auth Provider — exactly as WebAuthn is verified for users.

**Recommendation:** treat agent identity like the five dependency-ownership modes — a pluggable, profile-selected enforcement seam. Off in the trusted-local profile (replaced by *verified* isolation); required in remote, multi-agent, or multi-tenant profiles.

**Asymmetry with the user (and why it is principled, not lazy).** We authenticate the user — a remote, unknown-at-connect party arriving over the public internet, where recipient-binding is the whole guarantee. In the local profile we do not authenticate the agent — a known, co-deployed, single party on a trusted channel. Each threat surface gets the treatment it actually warrants.

## Failure modes

Auth Provider down → step-up fails → the enforcement point denies. **Recipient not enrolled** → there is no credential to verify → deny, and the recipient must complete enrollment first. Wrong credential / failed assertion → deny, retry within TTL. Stale `auth_strength` → re-prompt.

## Invariants

Authentication ≠ authorization, never conflated. The verifier reports *facts* (ok + `auth_strength` / auth-assurance evidence); it does not make access decisions. Policy profiles are provider-neutral; provider-specific `amr`, `acr`, factor, source, WebAuthn UV flags, or future claims are mapped by the adapter before any enforcement point evaluates sufficiency. Recipient-binding originates from the channel and is only ever narrowed, never widened. A recipient can be verified only if previously **enrolled**; enrollment is one-time and operator-initiated, never a per-task or per-handoff step.

## Adding an Auth Provider

Implement `AuthProviderPort` behind a new adapter package and wire it only from `packages/app`; kernel, identity, and gateway code must not import the concrete provider. The adapter verifies provider-native credentials or tokens, returns the stable `{ok, authStrength}` fact, and maps provider evidence into `AuthAssuranceEvidence` for diagnostics. A new provider that wants to satisfy `phishing-resistant` must expose provider-neutral user-verification, recipient-binding, and replay-resistant facts; unknown, missing, or ambiguous valid evidence must degrade to the lowest safe tier (usually password-grade), never up-map to phishing-resistant.

The installer/doctor path must prove the provider can satisfy the selected `GLA_AUTH_ASSURANCE_POLICY`: default `phishing-resistant` requires passkey/phishing-resistant evidence; `password-permitted` is the explicit fallback profile. Required tests are: adapter evidence mapping, invalid/unknown profile diagnostics, gateway handoff/reuse decisions against the common policy, and a boundary check showing `packages/gateway` contains no provider-specific route logic or raw provider claim checks.

For authentik deployments, the doctor evidence includes redacted `loginMethodProofs[]` for password, passkey/WebAuthn,
and configured external/social/enterprise sources. Those records are operator diagnostics over provider-neutral
facts: safe claim labels live under `evidence`, stable subject proof under `subjectStable`, and mapping output under
`authStrength` / `assuranceLevel`. Gateway authorization still consumes only the common assurance result; it must not
branch on authentik stages, source ids, `amr`, `acr`, or `gla_uv`.

## Related

`access-gateway.md` (the user's enforcement point), `agent-bridge.md` (the agent's enforcement point), `capability-service.md`, `admission-and-policy.md` (the policy decision point), `catalog.md` (`AuthorityProfile` and Auth Provider plugins).
