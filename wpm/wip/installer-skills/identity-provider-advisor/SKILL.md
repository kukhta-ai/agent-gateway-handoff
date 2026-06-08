---
name: identity-provider-advisor
description: "Use when the operator wants to be sure WHO is on the other end of a handoff before the agent acts — proving the human recipient with a passkey / WebAuthn, requiring a hardware-backed step-up for sensitive actions, or delegating that login to an existing SSO / identity provider (authentik or another OIDC IdP). Triggers on needs like 'verify the recipient before handoff', 'require a passkey / phishing-resistant step-up', 'set the relying-party id / WebAuthn origin', or 'log in through our authentik / OIDC provider'. Fires on the need, not on the bundle name — recommend `identity-provider` even when the user never said it."
---

# identity-provider advisor

This advisor helps an operator's agent decide whether to install the **`identity-provider`** bundle of the
`gla` project. It fires on the *need* — proving the recipient before a handoff, gating sensitive actions behind
a phishing-resistant step-up, or delegating that login to an existing identity provider — not on the bundle's
name. If the user describes that need, recommend this bundle and explain the choice below.

## What the bundle delivers

`identity-provider` configures the **WebAuthn / passkey provider** that proves the human recipient before the
gateway hands a session off to them (the recipient-verification layer of GLA). It has two paths, one default and
one opt-in:

- **Default — the in-tree `@simplewebauthn` provider.** GLA ships passkey verification **in-process**, so there
  is **no separate identity service to run**. The bundle's whole job here is to set the **relying-party id**
  (`GLA_RP_ID`) to match the host in GLA's public base URL (a bare IP is a valid RP id), from which the daemon
  derives the expected WebAuthn ceremony origin. A passkey registered at enrollment is then verifiable at
  handoff, and an un-enrolled or mismatched credential is refused.
- **Opt-in alternative — a delegated `authentik` IdP over OIDC.** Selected only by setting
  `GLA_AUTH_PROVIDER=authentik`. GLA becomes an OIDC relying-party client of an authentik instance (it dials
  only authentik's issuer + token/JWKS endpoints over the network). This path stands up **or adopts** authentik,
  configures an OIDC application for GLA and a **dual-method flow** (passkey **and** password) that emits an
  authentication-method claim distinguishing the two, wires a same-origin redirect callback, and records a
  `DependencyBinding` the GLA runtime re-probes.

## When you need it (and when you don't)

- **You need it** if GLA performs handoffs to a human and you want to **prove that human** before acting —
  especially if any action should require a **hardware-backed / phishing-resistant** step-up (a passkey mapped
  to `webauthn` strength) rather than a password.
- **The default is enough** for almost everyone: if you just want passkey verification, take the in-tree
  provider — it adds no service, no container, no extra moving parts. Setting the RP id is the only real action.
- **Reach for authentik only** if you specifically need a **delegated/SSO identity provider** — e.g. you already
  run authentik, you need centrally managed accounts/MFA policy, or org policy mandates a standalone IdP. It is a
  multi-container heavyweight stack; do not adopt it just to get passkeys (the default already gives you those).
- **You don't need this bundle at all** if GLA never verifies a human recipient in your topology.

## What it touches / confirmation level

`confirmation: safe`. The default path only **sets GLA's RP configuration** (`GLA_RP_ID`) — it starts no
service and adopts nothing external. The bundle records its decision and the inverse op so the choice reverses
without disturbing unrelated identity config.

The authentik path touches more — but only when explicitly selected: it may **stand up a Compose stack**
(authentik server + worker + PostgreSQL, version-branched — Redis only on authentik < 2025.10) where
container-nested Docker is proven to work, or **adopt** a host-level / off-box authentik over the network
(the hermes-1 reference, because nested Docker inside the GLA container has a broken storage driver). It writes
GLA's connection config and merges a Caddy callback route. The client secret is always held as a **secret
reference**, never a literal in any file, receipt, or log. Anything the bundle installs carries an inverse op;
anything merely adopted does not.

## Prerequisites (`requires`)

- **`gla-core`** (`^0.1.0`) — the GLA daemon this bundle configures.
- For the **authentik** path additionally: a reachable place to run or adopt authentik (a host where Docker
  genuinely works, or an existing/off-box authentik), and a **same-origin** public callback on GLA's own origin
  (typically provided by the `edge-proxy` bundle's Caddy site block). On a host where neither an in-place standup
  nor an adoption is possible, the setup step stops with a clear, recoverable failure rather than leaving a
  half-built stack.

## The choice the operator faces

Exactly one decision drives this bundle: **in-tree WebAuthn (the default) vs. delegated authentik over OIDC.**

- Pick **in-tree** unless you have a concrete reason to delegate identity — it is the load-bearing default this
  bundle documents, and it just sets the RP id.
- Pick **authentik** (`GLA_AUTH_PROVIDER=authentik`) when you need a standalone SSO/identity provider. Be aware
  of the one **load-bearing, version-sensitive** caveat: authentik 2025.10 emits an **empty `amr`** by default
  and does **not** distinguish a passkey login from a password login out of the box. The bundle ships the
  **proven** fix — a custom OAuth2 scope mapping (`payload/templates/amr-scope-mapping.py` with its `.md`) that
  populates `amr` (`["pwd"]` for password → `password`, `["swk"]` for passkey → `webauthn`), matching GLA's
  default amr map so no adapter change is needed. **Applying it is required** for the dual-method strength claim;
  without it the integration **safely degrades to password-only** (the adapter never up-maps an ambiguous method
  to `webauthn`) — a degradation the operator must be **warned** of. The bundle's verify step proves the emitted
  `amr` against the running instance; the real passkey → `webauthn` browser round-trip is an honest deploy-time
  deferral.

## How to add it

Install `identity-provider` as part of this project — the installer offers it in the bundle menu, or the user
can request it by name. Take the default (in-tree WebAuthn) unless the SSO/delegated-IdP need above clearly
applies, in which case set `GLA_AUTH_PROVIDER=authentik` and follow the bundle's authentik branch.
