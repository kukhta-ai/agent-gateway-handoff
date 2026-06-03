# Boundary actors & externals

The lanes in scenario 01 that are **not** GLA components. We do not build these; this doc records the *contract* and the *assumptions* at each boundary — what GLA expects of them, what they expect of GLA, and the trust posture. Each is a subsection rather than a full component doc.

---

## User (human recipient)

**Kind:** human actor — the bound recipient.
**Trust posture:** outside the security boundary until authenticated; nothing is assumed about them until step-up proves they are the bound recipient.
**Contract:** GLA reaches them only through a channel, binds a recipient to them, and exposes a capsule to them only after a verified grant + sufficient `auth_strength`. They drive the human entrypoint during handoff windows.
**In scenario 01:** requests the task in chat (P0), proves identity (P6), fills the form and enters the code in the live browser (P7, P12).

## Passkey / authenticator

**Kind:** device — a platform (or roaming) WebAuthn authenticator, e.g. the laptop fingerprint sensor.
**Trust posture:** the private key never leaves the device; GLA never sees it.
**Contract:** on a step-up challenge it signs an assertion; Identity + Auth verifies that assertion against the registered credential. The fallback is username + password (lower `auth_strength`).
**In scenario 01:** signs the WebAuthn challenge in P6.

## Telegram (transport)

**Kind:** external channel app + Mini App webview.
**Trust posture:** an untrusted transport — recipient-binding and grant verification, not the channel, carry the security.
**Contract:** the GLA Channel adapter fronts it; it carries handoff links (Mini App button, plain-link fallback) and progress to the user, and inbound messages back. It is one of several interchangeable channels (Slack, Email, CLI).
**In scenario 01:** delivers/opens the handoff links (P0, P5, P6, P11, P12) and the closing message (P15).

## Agent runtime (Hermes)

**Kind:** the *client* — an MCP-or-CLI-speaking agent runtime. In the reference deployment it is installed alongside GLA by `work-package-manager`, but GLA does not build it.
**Trust posture:** **untrusted and unprivileged**, and the place **all cognition lives**.
**Contract — what GLA expects of it:** hold an `agent-authority` capability; assemble *concrete* session proposals; drive the agent connector; interpret rejection codes via skills; resume on completion. **What it expects of GLA:** a Bridge (MCP + CLI with parity), capability references, read-models (catalog, status, skills), and normalized completion. It never receives raw secrets or privileged paths.
**In scenario 01:** the driver of the entire flow — connects (P1), proposes (P2), drives the browser (P4, P9, P14), requests handoffs (P5, P11), resumes on completion (P8, P13), and closes the task (P15).
**Authentication:** whether GLA authenticates this runtime is a deployment-profile decision — see `identity-and-auth.md` and `agent-bridge.md`.

## Website (third party)

**Kind:** the third-party registration target; entirely outside GLA's control.
**Trust posture:** untrusted external system; GLA cannot change its behavior.
**Contract:** the capsule's browser interacts with it; completion detection (`url-watcher`) *infers* state from its URLs (`/verify`, `/dashboard`) rather than from any cooperation by the site.
**In scenario 01:** serves the home/register/verify/dashboard pages, accepts the submission and the code, and sends the verification email (P4–P14).

## Email inbox (third party)

**Kind:** the user's out-of-band mailbox.
**Trust posture:** external; GLA **cannot read it** — which is precisely why a second handoff exists.
**Contract:** the website delivers a code to it; only the human can retrieve that code and bring it into the capsule. This is the generic "a gate only the human can pass" trigger.
**In scenario 01:** receives the code (P10) and the user reads it from it (P12).

---

## Note

These boundaries are where GLA's guarantees stop and assumptions begin. Two are worth carrying into the security doc: the agent runtime is untrusted-by-design (so the whole control plane is built to not rely on it), and the website/email are uncontrolled (so completion is inferred mechanically and the human is the only bridge to out-of-band facts).
