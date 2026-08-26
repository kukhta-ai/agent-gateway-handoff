# The `amr` scope mapping — the REQUIRED step for the dual-method strength claim (identity-provider · GLA-074)

This note accompanies `amr-scope-mapping.py` (the proven expression). It is the **load-bearing** configuration
the architect flagged (authentik-service-standup.md §3.2/§8.2) and the rehearsal confirmed.

## The problem it solves (proven against real authentik 2025.10.4)

authentik **2025.10 emits `amr: []` (empty) by default** and only a generic `acr`
(`goauthentik.io/providers/oauth2/default`) — it does **not** distinguish a passkey login from a password login
out of the box. GLA's adapter reads `amr`/`acr` plus the GLA-owned `gla_uv` proof claim to derive
`AuthStrength`:

- **Without** this mapping → `amr` is empty and `gla_uv` is absent, GLA **floors every login to `password`** and
  **never up-maps** (the safe failure). The integration runs as **password-only**: a passkey login cannot reach
  `webauthn` strength, so a route requiring phishing-resistant assurance would reject even a real passkey.
  **Warn the operator.**
- **With** this mapping → a password login emits `amr: ["pwd"]` → `password`; a passkey login emits
  `amr: ["swk"]` and `gla_uv: true` → `webauthn`. The dual-method strength gate then works as designed.

This is the single most authentik-version-sensitive outcome and **must be verified against the running
instance** (the verify task), never assumed.

## What it is

A **custom OAuth2 provider scope mapping** (`PropertyMapping`, provider/scope) named e.g. `gla-amr-claim`, with
`scope_name: "openid"` (so it rides with the always-requested `openid` scope — no extra scope to request),
whose **Expression** is the body of `amr-scope-mapping.py`. It populates `amr` from the login method authentik
recorded and emits `gla_uv:true` only for the configured WebAuthn/passkey branch, then **attached to GLA's
OAuth2 provider's property mappings** (alongside the standard `openid`/`profile` scopes).

**The mechanism (important — the naive approach does NOT work).** authentik 2025.10 does **not** expose the
login method on `request.context['auth_method']` inside a scope-mapping expression (that is empty — which is
*why* the default `amr` is `[]`). The reliable, **proven** source is the user's **most recent LOGIN Event**:
authentik records the method in the LOGIN event's `context['auth_method']`, so the expression reads it from
`authentik.events.models.Event` (the current user's latest LOGIN). This is the exact expression verified live
(it produced the real `amr:["pwd"]`); the `.py` body is the source of truth.

## How to apply (unattended)

1. Ensure first-boot bootstrap is available (an admin + an API token) — see the `AUTHENTIK_BOOTSTRAP_PASSWORD` /
   `AUTHENTIK_BOOTSTRAP_TOKEN` seam in `authentik-compose.yml.tmpl`.
2. Create the scope mapping via the API:
   `POST /api/v3/propertymappings/provider/scope/` with `{ name: "gla-amr-claim", scope_name: "openid",
   expression: <the .py body> }` (PATCH the same endpoint by `pk` to make it idempotent on re-run).
3. **Attach** the returned `pk` to GLA's OAuth2 provider's `property_mappings` (merge with the standard scopes;
   PATCH the provider).
4. Verify the emitted claims end-to-end: drive a real password login → the id_token carries `amr: ["pwd"]` and
   no UV proof; a real passkey login through a UV-required WebAuthn/passkey stage → `amr: ["swk"]` and
   `gla_uv: true`.

## Adapter alignment — no adapter change

GLA's default method map (`adapters/auth-authentik/src/strength.ts` `DEFAULT_METHOD_MAPS`) recognizes
`{hwk, swk, webauthn, fido}` as WebAuthn/passkey labels and `{pwd}` as password, but a WebAuthn/passkey label
becomes strongest assurance only with `gla_uv:true`. This expression emits exactly that shape, so
`GLA_AUTHENTIK_AMR_MAP` needs **no override** for this recipe. The adapter already handled both the empty-`amr`
floor and the explicit `["pwd"]` correctly (proven in the rehearsal); GLA-091 additionally requires the UV proof
claim for passkey-grade assurance.

If a deployment's flow records a different method label, tune the expression's branches (and/or set
`GLA_AUTHENTIK_AMR_MAP` to the actual labels) — but the flow **must emit something** separating the two tiers
and must emit `gla_uv:true` only when the passkey/WebAuthn stage is configured to require user verification.

## Rehearsal evidence (real authentik 2025.10.4)

Live `id_token` after applying this mapping (a real password login through authentik's hosted flow):
`{ "amr": ["pwd"], "gla_uv": false, "acr": "goauthentik.io/providers/oauth2/default",
"gla_auth_method": "password", "sub": "6bd4…9a33" }` → GLA `verifyAssertion` →
`{ ok: true, authStrength: "password" }` with `methodResolvable: true`. The passkey arm
(`amr: ["swk"]`, `gla_uv:true` → webauthn) is the same mechanism; its real round-trip is the deploy's job
(task identity-provider-6 AC#8 keeps that an honest deferral).
