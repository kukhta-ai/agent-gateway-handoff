# authentik OIDC app + dual-method flow — the OUTCOMES to reach (identity-provider · authentik branch, GLA-074)

This is an **end-state checklist**, not a click-script (authentik-service-standup.md §3): the exact authentik
UI/API path is the installer agent's to discover on the instance in front of it; what matters is that **these
conditions hold** and are **verified against the running instance** (the verify task probes them). Each maps to
an `identity-provider-5`/`-6` acceptance criterion.

## 1 · The OIDC relying-party application for GLA (§3.1)

- [ ] An authentik **OAuth2/OIDC provider + application** exists for GLA, as a **confidential client** (it has a
      **client id** and a **client secret**).
- [ ] Its **allowed redirect URI** is exactly GLA's configured callback on **GLA's own public origin**
      (`GLA_AUTHENTIK_REDIRECT_URI`, e.g. `https://<gla-public-host>/auth/callback`). authentik **exact-matches**
      the redirect URI — one value, no trailing-slash drift.
- [ ] **"Include claims in id_token"** is on, so `sub`, `amr`/`acr`, `nonce`, `aud`, `exp` are present in the
      **id_token itself** (the GLA adapter validates the id_token, not a userinfo round-trip).
- [ ] **Scope** `openid profile` is sufficient (the adapter default).
- [ ] The provider's **issuer** equals `GLA_AUTHENTIK_ISSUER_URL`, and its `.well-known/openid-configuration`
      advertises the **authorization** (`/application/o/authorize/`), **token** (`/application/o/token/`), and
      **JWKS** (`/application/o/<app-slug>/jwks/`) endpoints — the exact endpoints the adapter discovers/dials
      (`adapters/auth-authentik/src/oidc.ts` `resolveEndpoints`/`buildAuthorizeUrl`).

## 2 · The authentication flow: passkey AND password, emitting `amr` plus `gla_uv` (§3.2 — the critical one)

- [ ] The provider's **authentication flow** presents **both** a **passkey/WebAuthn** stage **and** a
      **password** stage (plus any MFA the operator wants); an Identification stage routes to a WebAuthn-validator
      stage and/or a Password stage, and the user **chooses**.
- [ ] **The flow emits an `amr` (or `acr`) and `gla_uv` in the id_token that distinguish passkey from password and
      prove user verification.** authentik
      2025.10 emits `amr: []` (empty) by default and does NOT distinguish them out of the box (PROVEN in the
      GLA-074 rehearsal) — so this is a **REQUIRED** step, not an assumption. Apply this bundle's
      **`amr-scope-mapping.py`** as a custom OAuth2 provider scope mapping (`scope_name: "openid"`, attached to
      GLA's provider's property mappings; see `amr-scope-mapping.md`). It populates `amr` from authentik's
      recorded login method:
      - a **passkey** login through a UV-required WebAuthn/passkey stage → `["swk"]` and `gla_uv:true` → strength
        **`webauthn`**;
      - a **password** login → `["pwd"]` and no UV proof (with/without MFA companions `{mfa, otp, sms}`) → strength
        **`password`**.
      (The map is `adapters/auth-authentik/src/strength.ts` `DEFAULT_METHOD_MAPS` — which the expression matches,
      so no `GLA_AUTHENTIK_AMR_MAP` override is needed. Proven live: a real password login → `amr:["pwd"]`.)
- [ ] If this instance's labels differ, `GLA_AUTHENTIK_AMR_MAP` / `GLA_AUTHENTIK_ACR_MAP` are set to the **actual**
      labels — but the flow **must emit something** separating the two tiers and `gla_uv:true` only for a
      UV-required passkey/WebAuthn result. **Verify against the running instance** (a real passkey login →
      `webauthn`, a real password login → `password`); never assume defaults.
- [ ] **Degradation is safe, not silent:** if the flow cannot be made to distinguish the methods, the integration
      falls back to **`password`-only** (the adapter **never up-maps** a missing/ambiguous method to `webauthn`),
      and the operator is **warned** in the receipt.

## 2.5 · The invitation enrollment policy descriptor (GLA-085)

- [ ] The active invitation enrollment flow is recorded as a provider-extensible
      `GLA_AUTH_ENROLLMENT_POLICY_JSON` descriptor. This is not a secret and not an access decision; it is the
      operator-visible evidence that `gla auth diagnostics` reads.
- [ ] The descriptor names the selected enrollment flow, authentication flow, invitation stage, User Write stage,
      and User Login stage when present.
- [ ] The descriptor lists every credential setup path the recipient can use inside the configured flow:
      recipient-owned password setup as `authStrength:"password"`, WebAuthn/passkey setup as
      `authStrength:"webauthn"` / `assuranceLevel:"phishing-resistant"`, and any configured OAuth/SAML source as
      an `externalSources[]` entry.
- [ ] If a single authenticator validation requirement lets the recipient choose among multiple configured setup
      stages, the descriptor records one `optionalRecipientChoices[]` group. Recipients can choose only among
      these configured choices; unsupported methods must not appear, and every choice must be backed by a
      credential setup stage, external source, or MFA/recovery method listed in the descriptor.
- [ ] TOTP, email OTP, SMS OTP, static backup codes, Duo, and similar factors are recorded under
      `mfaRecoveryMethods[]` as provider evidence/recovery/MFA, not as passkey-grade GLA assurance by default.
- [ ] The verify task runs `gla auth diagnostics` against the daemon after writing the descriptor, and
      `gla auth diagnostics --recipient <recipient-ref>` when validating a concrete recipient. Confirm: no concerns
      when the descriptor can satisfy `GLA_AUTH_ASSURANCE_POLICY`; an actionable concern when it cannot; concrete
      recipient output distinguishes provider-local account state from the GLA enrollment binding; no client
      secret, grant, invitation token, or password material in output.

## 3 · A stable, immutable subject (§3.3)

- [ ] The provider's **subject mode** yields a **stable, immutable `sub`** — based on the user's **UUID / hashed
      id**, **not** username or email (which can change). The recipient is enrolled against this `sub`; every
      later step-up checks `id_token.sub === the bound sub`. A mutable `sub` silently breaks re-verification.
- [ ] Verified by **enroll → re-authenticate the same user → same `sub`**.

## 4 · The origin agreement (§5)

- [ ] The `redirect_uri` (above), the authentik registered redirect URI, and the GLA-served callback page are
      **one and the same URL** on **GLA's own public origin** (so the callback's same-origin state works and the
      GLA grant never travels to authentik — only the OIDC `code`/`state` do). GLA HTML disables referrers, and
      delegated enrollment consumes the GLA grant before redirecting away from GLA. See
      `caddy-authentik-callback.snippet`.
- [ ] The discovered `issuer` agrees with `GLA_AUTHENTIK_ISSUER_URL` (the adapter validates the id_token `iss`).

## What GLA is configured with (the connection — §3.4 / authentik-integration.md §7)

| GLA env | Value |
|---|---|
| `GLA_AUTH_PROVIDER` | `authentik` (the selection that gates this whole branch) |
| `GLA_AUTHENTIK_ISSUER_URL` | the issuer (e.g. `https://idp.<host>/application/o/gla/`) — must equal the discovery `issuer` |
| `GLA_AUTHENTIK_CLIENT_ID` | the OIDC application's client id (the id_token `aud`) |
| `GLA_AUTHENTIK_CLIENT_SECRET` | **a secret-ref**, held behind the secret seam — **never** a literal in any file/receipt/log |
| `GLA_AUTHENTIK_REDIRECT_URI` | the same-origin callback on GLA's public origin (= authentik's allowed redirect URI) |
| `GLA_AUTHENTIK_SCOPES` *(optional)* | default `openid profile` |
| `GLA_AUTHENTIK_AMR_MAP` / `_ACR_MAP` *(optional)* | only if the instance's `amr`/`acr` labels differ from the defaults |
| `GLA_AUTH_ENROLLMENT_POLICY_JSON` | verified descriptor for the active enrollment flow/stages/sources/choices |
