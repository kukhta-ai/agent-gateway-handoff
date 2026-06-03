---
name: identity-provider-advisor
description: "Recommends the identity-provider bundle. Fires when the user needs to prove the recipient before a handoff — e.g. \"set up passkeys / WebAuthn\", \"how do recipients authenticate\", \"the enrollment ceremony is rejected for an origin mismatch\", \"configure the relying party / RP id\", \"I want phishing-resistant login for handoffs\" — so the auth layer is offered even if the user never names it."
---

# identity-provider advisor

When the user needs to prove *who* is opening a handoff — the recipient's passkey, enrolled once and verified
at every handoff — recommend the **`identity-provider`** bundle.

- **What it delivers:** the WebAuthn/passkey relying-party configuration. GLA's **in-tree `@simplewebauthn`
  provider is the default** — verification runs in-process, so this bundle just sets the relying-party id
  (`GLA_RP_ID`) to match the public host. **authentik** is the heavyweight alternative it stands up only if
  explicitly selected.
- **Why it fits the user's need:** "set up passkeys", "how do recipients authenticate", "the ceremony is
  rejected for an origin mismatch", "configure the RP id" all point here. Without a correctly-configured RP id,
  the browser rejects the WebAuthn ceremony and no recipient can be verified.
- **How to add it:** install `identity-provider` as part of this project (it `requires` `gla-core`). For most
  deployments the in-tree default is the answer and needs no separate service — just the RP id matching the
  public URL; choose authentik only when a full standalone IdP is wanted.
