# Agent Bridge

**Zone:** Edge
**Kind:** GLA component (traditional code)
**Scenario-01 lane:** Agent Bridge

> The agent's single door to GLA: a trust boundary, a protocol adapter, and a delivery surface — and nothing more. It holds no cognition.

## Role

The Bridge is where a capable-but-untrusted agent expresses intent to the control plane. It exposes two equivalent surfaces — an MCP server and a CLI command tree — backed by the same primitives, admits the agent connection, routes every operation into validation, and serves back facts and the skill manifest. It decides nothing and holds no model of what the user wants. In ports-and-adapters terms it is a driving adapter; in zero-trust terms it is the agent's policy-enforcement point.

## Responsibilities (owns)

- Expose two equivalent surfaces (MCP server + CLI command tree) with strict parity.
- Admit the agent connection: bind it to an `AuthorityProfile` and orchestrate minting of the `agent-authority` capability (via the Capability service).
- Route every operation — create/get/revoke task and session, setup primitives — into Admission, Task, and Session.
- Serve read-models: available templates, bindings state, task/session status, the skill manifest, individual skills, audit.
- Deliver normalized completion back to the agent.

## Interfaces

**Receives** — from the agent runtime: connect; MCP tool calls / CLI commands; queries.
**Produces** — to the agent: the `agent-authority` capability, operation results, read-models, completion; to the control plane: admission / task / session operations.

## What it does NOT do

No cognition: no intent planning, no template matching or suggestion, no "helpful" auto-repair or retry. It does **not** verify credentials itself — authentication is Identity + Auth's mechanism (see below). It does **not** mint or verify capabilities — that is the Capability service. It does **not** enforce recipient-binding — that is the Access Gateway. A rejection is relayed as a stable namespaced *code*; the *advice* on how to recover is a skill, not Bridge logic.

## Entities & data

`agent-authority` capability (anchored here); `AuthorityProfile` (catalog, matched at admit); `SkillManifestEntry` records (served).

## In scenario 01

Phase 1 — agent connects, `agent-authority` is anchored, the skill manifest + catalog are served. Phase 2 — `create_task` and `create_session` are routed to Task and Admission. Phases 8 / 13 — completion is delivered to the agent. Phase 15 — the task is completed.

## Role in authenticating the agent

The Bridge is the agent's enforcement *point*, exactly as the Access Gateway is the user's. It does **not own** authentication. Its role is narrow:

1. **Trigger** — where the deployment profile requires the agent to authenticate, the Bridge asks Identity + Auth to verify the agent's credential.
2. **Admit** — on success (or, in the trusted-local profile, on verified network isolation with no credential), it admits the connection.
3. **Anchor** — it orchestrates minting of the `agent-authority` capability, bound to the matched `AuthorityProfile`, as the root every later capability is attenuated from.

The substance — whether to authenticate at all, the credential types (mTLS / signed token), `auth_strength`, and the four triggers that make authentication necessary — lives in `identity-and-auth.md`. This component only performs *trigger → admit → anchor*.

### Trusted-local bridge profile

The reference profile deliberately keeps the local agent path credential-free: a same-user CLI or MCP client connects to the Agent Bridge without `gla auth login`, bearer tokens, mTLS, or per-call credentials. That is safe only because the endpoint is a verified local OS boundary, not because path possession is treated as a universal identity proof.

For the default Unix-domain socket profile, the daemon must refuse to serve until the runtime directory and socket path are owned by the daemon user and permissioned so other local users cannot pre-create, replace, or open the socket. Symlinks, regular files, directories, wrong-owner paths, unsafe writable parents, and already-active sockets are startup failures. A same-owner stale socket left by a crashed daemon may be removed only after it no longer accepts connections.

Loopback TCP (`127.0.0.1:<port>`, `[::1]:<port>`, or `localhost:<port>`) is a development/advanced fallback. It is local in the network sense and still must never be exposed through Caddy, authentik, or `0.0.0.0`, but it is not equivalent to a private Unix socket for cross-user isolation because the filesystem permission boundary is absent.

This profile does **not** defend against a compromised process running as the same UID as the daemon/agent. Same-UID compromise, remote Bridge access, multiple agent principals, hostile co-tenants, multi-tenant operation, per-agent audit attribution, and per-agent revocation require a separate authenticated-agent profile in Identity + Auth.

## Failure modes

A malformed proposal is rejected by Admission with a stable reason that the Bridge merely relays. The Bridge being unreachable blocks the agent (but it is never publicly exposed, so this is an internal-availability concern, not a security one). MCP/CLI surface drift is caught by the parity test suite.

## Invariants

Surface parity — every operation in one surface exists in the other with identical authority, validation, audit, and outcome. The agent receives only capability references, never raw secrets or privileged paths. The Bridge holds no business logic and no model of user intent. Admission is the only path from a proposal to provisioning.

## Related

`identity-and-auth.md` (authentication mechanism), `capability-service.md` (minting), `admission-and-policy.md` (validation), `completion-service.md` (results), `boundary-actors.md` (the agent runtime).
