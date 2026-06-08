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

## 2 · The authentication flow: passkey AND password, emitting a distinguishing `amr` (§3.2 — the critical one)

- [ ] The provider's **authentication flow** presents **both** a **passkey/WebAuthn** stage **and** a
      **password** stage (plus any MFA the operator wants); an Identification stage routes to a WebAuthn-validator
      stage and/or a Password stage, and the user **chooses**.
- [ ] **The flow emits an `amr` (or `acr`) in the id_token that distinguishes passkey from password.** authentik
      2025.10 emits `amr: []` (empty) by default and does NOT distinguish them out of the box (PROVEN in the
      GLA-074 rehearsal) — so this is a **REQUIRED** step, not an assumption. Apply this bundle's
      **`amr-scope-mapping.py`** as a custom OAuth2 provider scope mapping (`scope_name: "openid"`, attached to
      GLA's provider's property mappings; see `amr-scope-mapping.md`). It populates `amr` from authentik's
      recorded login method:
      - a **passkey** login → `["swk"]` (in GLA's webauthn set `{hwk, swk, webauthn, fido}`) → strength **`webauthn`**;
      - a **password** login → `["pwd"]` (with/without MFA companions `{mfa, otp, sms}`) → strength **`password`**.
      (The map is `adapters/auth-authentik/src/strength.ts` `DEFAULT_METHOD_MAPS` — which the expression matches,
      so no `GLA_AUTHENTIK_AMR_MAP` override is needed. Proven live: a real password login → `amr:["pwd"]`.)
- [ ] If this instance's labels differ, `GLA_AUTHENTIK_AMR_MAP` / `GLA_AUTHENTIK_ACR_MAP` are set to the **actual**
      labels — but the flow **must emit something** separating the two tiers. **Verify against the running
      instance** (a real passkey login → `webauthn`, a real password login → `password`); never assume defaults.
- [ ] **Degradation is safe, not silent:** if the flow cannot be made to distinguish the methods, the integration
      falls back to **`password`-only** (the adapter **never up-maps** a missing/ambiguous method to `webauthn`),
      and the operator is **warned** in the receipt.

## 3 · A stable, immutable subject (§3.3)

- [ ] The provider's **subject mode** yields a **stable, immutable `sub`** — based on the user's **UUID / hashed
      id**, **not** username or email (which can change). The recipient is enrolled against this `sub`; every
      later step-up checks `id_token.sub === the bound sub`. A mutable `sub` silently breaks re-verification.
- [ ] Verified by **enroll → re-authenticate the same user → same `sub`**.

## 4 · The origin agreement (§5)

- [ ] The `redirect_uri` (above), the authentik registered redirect URI, and the GLA-served callback page are
      **one and the same URL** on **GLA's own public origin** (so the callback's same-origin state works and the
      GLA grant never travels to authentik — only the OIDC `code`/`state` do). See
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
