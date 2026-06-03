# Actors & personas

Who relates to GLA, and how. **Personas** are the people GLA serves or is extended by; **actors** are the runtime parties — the agent and the external systems — that appear as lanes in `scenario-01-unified.html`. For the full *contract* at each external boundary (what GLA expects of it, what it expects of GLA, and the trust posture), see `components/boundary-actors.md`; this document is the product-facing cast.

## Personas — the people

### Operator — *the primary product user*

The person who **self-hosts GLA** and owns the deployment. They install it — the agent-run `work-package-manager` bundle stands GLA and its dependencies up on their host — and then they decide how it runs: **which provider fills each layer** (channel, runtime, identity, view — see `03-software-candidates.md`), the **deployment profile** (single-operator, strict, or multi-tenant), and the **mount allowed-set and catastrophic-path denylist** (`04-capsule-assembly.md` §6). They also **enrol recipients** so a handoff can later verify them. In the single-operator reference, the operator, the agent's owner, and the recipient may well be the same person.

*Synthesized from the operator references across `01-architecture-overview.md` §1/§7, `04-capsule-assembly.md` §6, and the enrollment model — not a single source section.*

### Recipient — *the end user*

The human a handoff is for. GLA reaches them only through a channel, **binds a recipient identity** to them, and — once they are **enrolled** with a passkey — verifies them at the edge before any surface opens. They tap the link and perform the human-only step: prove identity, fill a form, enter a code, approve an action. They are **outside the security boundary until authenticated**; nothing is assumed about them until step-up proves they are the bound recipient.

### Provider / plugin author — *the extender*

Whoever adds a capability to GLA: a new `Launcher`, `CapsuleTemplate`, `ChannelAdapter`, `HumanEntrypoint`, `CompletionDetector`, or auth provider. A plugin is a self-contained package — **code + a catalog entity + skills + docs + contract tests** — added through the **contribution workflow** (`02-provider-and-extension-model.md` §8): reviewed, then trusted. The author owns the security-bearing **native base** (the Compose / Pod / Firecracker config) and the **typed option set** the agent may set; the agent only parameterizes within it.

*Synthesized from the contribution-workflow and provider-contract material in `02-provider-and-extension-model.md` §3/§8 and `01-architecture-overview.md` §7.*

## Actors — the agent and the external systems

These are the non-persona lanes in the reference scenario. GLA does not build them; it defines the contract at each edge.

### Agent runtime — *the client (e.g. Hermes)*

The MCP-or-CLI-speaking runtime that **drives the whole flow**, and the place **all cognition lives**. It holds an `agent-authority` capability, assembles *concrete* session proposals, drives the agent connector, interprets rejection codes via skills, and resumes on completion. It is **untrusted and unprivileged by design** — it never receives raw secrets, the container socket, or the gateway admin API — which is exactly why the control plane is built not to rely on it.

### Channel — *the transport (e.g. Telegram)*

Carries the handoff link to the recipient and inbound messages back; one of several interchangeable channels (Slack, Email, CLI). An **untrusted transport** — recipient-binding and grant verification, not the channel, carry the security.

### Passkey / authenticator

A platform or roaming WebAuthn authenticator, e.g. a laptop fingerprint sensor. The **private key never leaves the device**; GLA never sees it. On a step-up challenge it signs an assertion that Identity + Auth verifies against the enrolled credential. The fallback is username + password, at a lower auth strength.

### Target system — *the thing being acted on (e.g. the website)*

The third-party system the capsule operates against, **entirely outside GLA's control**. The capsule's browser interacts with it; completion is **inferred mechanically** — a `url-watcher` keyed on its URLs (`/verify`, `/dashboard`) — never from any cooperation by the site.

### Out-of-band channel — *the gate only the human can pass (e.g. the user's email)*

A channel **GLA cannot read** — which is precisely why a second handoff exists. The site drops a code there; only the human can retrieve it and carry it into the capsule. This is the generic *"a gate only the human can pass"* trigger.

## Trust posture, at a glance

| Party | In the boundary? | Trusted? |
|---|---|---|
| Operator | owns the deployment | trusted — sets the policy |
| Recipient | outside until authenticated | trusted only after step-up proves the binding |
| Provider author | contributes the trusted base | trusted via review |
| Agent runtime | inside, unprivileged | **untrusted by design** |
| Channel | edge transport | untrusted |
| Authenticator | the user's own device | holds a key GLA never sees |
| Target / out-of-band system | external | uncontrolled |

## Related

`components/boundary-actors.md` (the full contract and assumptions at each external boundary) · `00-product-overview.md` (the product loop these parties enact) · `01-architecture-overview.md` §2 (the two-actor capsule) · `components/identity-and-auth.md`, `components/access-gateway.md` (how the recipient is verified and reaches a surface) · `scenario-01-unified.html` (each actor as a lane, end to end).
