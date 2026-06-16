# Gateway Live Access (GLA) — documentation

**GLA is a self-hostable control plane that sits between an AI agent and a human, opening temporary, scoped, recipient-bound surfaces for the moments an agent cannot or must not act alone** — an OAuth/2FA login, an agent-blind secret entry, a document review, an approval, a live browser handoff. *GLA is to agent↔human handoffs what MCP is to tool calls.* The reference slice throughout these docs is **scenario-01**: a Telegram-reachable agent registering a user on a website through a same-session browser handoff, with two recipient-bound windows, agent-blind secret entry, completion detection, and clean teardown.

It is **not** a planner, a chatbot framework, a workflow engine, an identity provider, or an agent runtime — it mediates between those and owns none of them. For the full product framing — what it is for, the single loop, and what it is not — start with `00-product-overview.md`; for the people and systems involved, see `actors-and-personas.md`.

This folder is the documentation for that system. Read it in order; each document assumes the vocabulary of the ones before it.

## Document map

| # | File | What it covers |
|---|---|---|
| 00 | `00-product-overview.md` | What GLA is and is *for*, the single loop, the palette of surfaces a capsule can be, the UX stance, and what it is **not**. **Read this first.** |
| — | `actors-and-personas.md` | The cast: the **operator**, **recipient**, and **provider-author** personas, and the external actors (agent runtime, channel, authenticator, target site, inbox) with their trust postures. |
| 01 | `01-architecture-overview.md` | What GLA is and is not; the two-actor capsule; the principles; the component architecture; the runtime loop; the authorization & security model; the boundary with `work-package-manager`; what is committed vs deferred; the vocabulary. Start here for the architecture. |
| 02 | `02-provider-and-extension-model.md` | How pluggability works: inversion of control, the uniform provider contract and typed `config_schema`, the catalog/registry and ingest pipeline, dependency-vs-provider, and the capsule runtime as a `Launcher`. |
| 03 | `03-software-candidates.md` | The concrete software filling each **pluggable layer** in the reference slice, the researched **alternatives**, and how each is **owned** (in-tree vs a `wpm` installer package). |
| 04 | `04-capsule-assembly.md` | How the agent authors a session: the `AssemblySpec` as a *delta over a trusted template*, the five-move authoring flow, the typed/provider-declared option set, and the host-mount model. |
| 05 | `05-cli-and-entities.md` | The agent-facing surface: the entity model, the command tree, output/error shapes, the exit-code taxonomy, and scenario-01 mapped to the CLI. |
| — | `architecture/provider-host-extension-architecture.md` | Migration architecture for turning static manifests plus app-level adapter wiring into a generic internal Provider Host, without introducing a public plugin ABI or dynamic hot-loading. |
| — | `architecture/provider-graph-defaults-and-extension-plan.md` | Canonical provider graph direction: default-provider packaging, provider profiles, graph validation, and the horizontal extension workflow for user-facing layers. |
| — | `architecture/provider-layer-refactor-contract.md` | GLA-110 target contract and migration map for replacing broad ProviderSet/Profile layering with ProviderRegistry, AppDeploymentConfig, CapsuleTemplate/AssemblySpec, CapabilityCatalog, and Admission Resolver responsibilities. |
| — | `architecture/provider-author-workflow.md` | Concrete workflow and boundary rules for adding a provider package without editing runtime narrow-waist packages. |
| — | `architecture/provider-authoring-ux.md` | Provider-authoring UX spec: protagonist, entry points, package inputs, diagnostics, guarded operations, and handoff to operator install/update. |
| — | `architecture/provider-install-update-ux.md` | Operator install/update UX spec: trusted package activation, deployment/capsule defaults, WPM evidence, doctor checks, rollback, and handoff to runtime consumption. |
| — | `architecture/provider-runtime-consumption-ux.md` | Runtime-agent consumption UX spec: catalog/template/schema/skill discovery, dry-run repair, session proposal, and handoff back to task execution. |
| — | `components/` | One document per architecture component (start with `components/README.md`). Each maps to a lane in the diagram and to a zone in doc 01. |
| — | `scenario-01-unified.html` | The reference scenario end to end in one diagram: the internal protocol between services, the agent's concrete `gla` commands, and the concrete provider per pluggable layer — including the one-time enrollment that precedes any handoff. |

## Core principles — the rules every design preserves

These are the load-bearing commitments. Each is stated in full where noted; this list is the canonical index to them.

1. **Cognition vs enforcement.** Delegate *what to do* (cognition) to the agent; never delegate *enforcement, trust, isolation, secrets, or bookkeeping* — those stay in code, and **the agent is untrusted at every enforcement seam**. The agent assembles a concrete proposal; GLA validates, enforces, hosts, and returns completion, and never models the user's intent. → 01 §3, §6; 04 §5.
2. **Two-actor capsule, one public entry.** Agent and human meet at a single capsule. The agent enters **unprivileged** via the Agent Bridge; the human enters via the **Access Gateway, the sole public entry**, which every public request transits. The agent plane holds no privileged path. → 01 §2, §3.5.
3. **Capabilities are the one authorization primitive.** Signed, caveated bearer credentials (Macaroon-style), **verified statelessly at the edge** with central revocation. **Recipient-bound grants** (a forwarded link is useless to anyone else) and **agent-blind `secret_ref`s** are system-wide invariants — raw secrets never enter the agent's address space, chat, prompts, logs, or evidence. → 01 §3.3–3.6, §6.
4. **Enrollment precedes any handoff.** A recipient is registered once by the operator — a passkey bound to their identity — carried by a single-use **operator-discharge** grant that the Access Gateway still verifies, so **enrollment does not bypass the gateway**. → 01 §5; `components/identity-and-auth.md`, `components/access-gateway.md`, `components/capability-service.md`.
5. **The capsule is assembled, not imaged.** A capsule is composed at provision time from **separate local layers** — browser + automation, the human-view stack, the agent-control protocol — **not shipped as one prebuilt image**. → 03; 04 §1.
6. **Mounts run at the agent's own authority.** The agent attaches host paths it can already reach, **with its own uid** (DAC fails closed), bounded by an operator allowed-set and a catastrophic-path denylist; GLA never mounts its own agent-blind resources, and a launcher that cannot share the host accepts no mounts. → 04 §6.
7. **Horizontal extension only.** A new capability is a new provider or dependency **registered against an existing seam**; it **changes no core code**. The narrow waist (a tiny stable core, everything else a replaceable adapter) is what makes growth additive. → 01 §3.1, §7; 02; 03.
8. **The GLA ↔ `work-package-manager` boundary — one rule.** Long-lived code *inside the deployment* is GLA core; anything that *touches the operator host or wires the operator's agent* ships as a **`wpm` installer package**, never an inline install. GLA *declares* dependency-ownership modes; `wpm` *satisfies* them. → 01 §8; 03 §13.
9. **Borrow proven patterns; don't invent standards or over-engineer.** K8s admission (mutate → validate), Backstage/Kubernetes catalog shapes, macaroons, the Spawner/launcher model, Cedar forbid-wins, Pod Security Standards profile tiers — reused, not reinvented — and anything a real failure mode hasn't demanded is deferred. → 01 §3, §9.

## Notes

- The reference scenario picks one concrete provider per layer; doc 03 lists those choices and their alternatives. Every such choice is swappable under principle 7.
- Task-authoring conventions and the MVP backlog are shipped separately, alongside the backlog package; they are not part of this architecture set.
