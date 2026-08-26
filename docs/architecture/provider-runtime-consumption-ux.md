# Provider Runtime Consumption UX

> **Status:** executable runtime-consumption UX for `GLA-110.10`.
> **Scope:** the runtime-agent experience for discovering registered providers and templates, understanding schemas
> and skills, dry-running a session proposal, submitting a session, and returning to task execution. This is a
> distinct UX flow from provider authoring and operator install/update. Write restrictions are constraints inside
> the journey, not the journey structure.

## 1. Protagonist And Job

The protagonist is the runtime agent executing a task after an operator install/update flow has selected and
doctor-verified a provider graph on this host. Its job is to inspect what this install can do, compose a bounded
`AssemblySpec`, dry-run admission, submit a session proposal, and then continue the task through the returned
connector and handoff surfaces.

The runtime agent is not trying to create provider package source, select app deployment config, satisfy host
dependencies, write WPM receipts, or mutate daemon boot config. Those belong to earlier flows. Runtime consumption
answers one question:

> Can I discover the active provider/template graph, understand the allowed parameters and skills, prove my proposal
> will be admitted, create the session, and continue the task without changing the install?

## 2. Entry Points

The primary surface is agent-facing CLI and equivalent MCP reads/mutations over the same primitives. The runtime
agent should be able to recover from interruption by re-reading the same entities.

| Entry point | Purpose | Primary output |
|---|---|---|
| `gla whoami` | Identify the connected agent and allowed operation set for this install. | Identity, connection mode, and allowed task/session/handoff operations. |
| `gla catalog list --kind <family> [--available]` | Discover capsule providers by runtime family (`launcher`, `entrypoint`, `connector`, `workspace`, `detector`). | Provider ids, families, capabilities, availability states, dependency evidence, provenance, selected-default source, and diagnostic summaries. |
| `gla catalog show <provider-id>` | Inspect one registered provider before selecting or overriding it. | Provider manifest projection, family, capabilities, dependency/probe status, typed `config_schema`, provenance, selected-default source, resolved config, browser-client asset provenance/readiness, and diagnostics. |
| `gla template list [--available]` | Find assemblable capsule templates in the active graph. | Template ids, purpose, dependency posture, and availability. |
| `gla template show <id>` | Inspect a template before composing a session. | Required parts, fixed/open parts, per-part default provider ids, per-part `defaultSource`, `defaultSources`, compatible providers, template dependencies, and diagnostics. |
| `gla schema session create` | Load the machine-readable input/output and error contract for session proposal. | `AssemblySpec` shape, command flags, exit codes, and stable error codes. |
| `gla skill list [--for <template>]` | Discover procedural knowledge relevant to the selected surface. | Skill ids and summaries keyed to templates/providers. |
| `gla skill show <id>` | Load recovery and use instructions for the task. | Skill body with provider/template usage and recovery guidance. |
| `gla session create ... --dry-run` | Check admission without provisioning a capsule. | Accepted/rejected outcome with stable diagnostics and recovery pointers. Capsule overrides are only `--launcher`, `--entrypoint`, `--connector`, `--workspace`, and `--detector`, or their equivalent `AssemblySpec` fields. |
| `gla session create ...` | Submit the same accepted proposal for provisioning. | Session id, state, capsule descriptor, and connector descriptor with secret refs. |
| `gla session get <id>` / `gla session connector <id>` | Resume after interruption. | Current session state and connector descriptor for a live capsule. |

The entry points above are current executable CLI commands unless this document explicitly marks a target command name.
The UX contract is fixed: discover, inspect, compose, dry-run, submit, and resume.

## 3. Read Surfaces

Runtime consumption reads the active graph. It does not mutate the graph.

| Surface | What the agent learns |
|---|---|
| Catalog | Provider/template ids, families, capabilities, selected-default projection, availability, dependency/probe summaries, and diagnostic codes. |
| Provider detail | One provider's manifest projection, typed `config_schema`, compatibility relations, dependency/probe status, and skills/docs links. |
| Template | Fixed parts, open parameters, defaulted parts, compatible providers, template dependencies, and skills/docs links. |
| Schema | `AssemblySpec` shape, provider-detail output, provider `config_schema` bounds, command flags, output shapes, exit-code taxonomy, and error code names. |
| Skill | Procedural instructions and recovery paths for the selected template/provider combination. |
| Session | Existing task/session state, live connector descriptors, and redacted lifecycle diagnostics for resuming work. |

Provider-specific details belong in catalog, schema, template, and skill output. Task/session commands should not
grow provider-specific flags for app infrastructure providers. The runtime override surface is intentionally limited to
capsule providers: `launcher`, `entrypoint`, `connector`, `workspace`, and `detector`. `AuthProvider`,
`ChannelAdapter`, and `SecretStore` are deployment selections and are rejected if they appear in an `AssemblySpec` or
as command flags.

## 4. Runtime Consumption Journey

1. **Receive task context.** The agent starts from an operator/user task or resumes an existing task. It reads
   `whoami` and current task/session state when needed.
2. **Discover available shapes.** The agent lists templates and catalog entities, usually with `--available` first,
   then widens the view if it needs to understand why an expected option is absent.
3. **Inspect the candidate template.** `template show` explains required parts, fixed parts, open parameters,
   compatible providers, selected defaults, each default's source, dependency posture, diagnostics, and skill pointers.
4. **Read provider details, schemas, and skills.** The agent loads `catalog show` for any provider it may select or
   override, `gla schema session create`, provider/template schemas, and relevant skills before writing a proposal.
5. **Compose the `AssemblySpec`.** The agent starts from a trusted template, fills open parameters, chooses only
   compatible registered capsule providers where the template allows selection, and supplies only provider-declared
   typed config values. The only runtime provider override fields are `launcher`, `entrypoints`, `connector`,
   `workspace`, and `detectors`.
6. **Dry-run admission.** `session create --dry-run` runs mutate-defaults plus validate without provisioning. The
   agent fixes schema, compatibility, dependency, policy, or template-fixed errors before trying again.
7. **Submit the proposal.** The agent submits the same accepted spec without `--dry-run`. Admission resolves template
   defaults plus runtime parameters against the active graph and provisions the session.
8. **Resume task execution.** The agent receives the connector descriptor, drives the capsule through its own tooling,
   opens and waits handoffs when needed, inspects completion, and completes or revokes the task/session.

The success path is deliberately ordinary: the agent should not need to know which provider is the default provider
globally. It sees named ids, compatibility, schema, availability, and the selected default projection.

## 5. Provider And Template States

Availability language must let the runtime agent branch correctly without hiding install/update problems.

| State | Runtime explanation | Expected runtime action |
|---|---|---|
| `available` | The provider/template is registered, compatible with its required graph, dependency evidence is accepted, current probes pass, and policy allows use. | The agent may select it or rely on the template default. |
| `degraded` | The entity is visible, but install convergence, runtime health, public-edge evidence, or a non-critical dependency is impaired. | The agent may continue only when the template/policy allows it; otherwise choose an available option or escalate. |
| `unavailable` | The provider/template cannot be used because it is unregistered, missing dependency/WPM evidence, disabled, failed a required probe, or depends on an unavailable node. | Choose another available compatible option or hand off to operator install/update. |
| `incompatible` | The selected provider/template relation fails explicit compatibility, has an ambiguous required relation, or violates a family contract. | Remove the override, choose a compatible provider, or choose a different template. |
| `policy-rejected` | The proposal is structurally known, but policy, capability scope, mount bounds, template-fixed fields, assurance posture, or other security constraints forbid it. | Repair within the allowed surface or escalate; do not try to bypass policy by changing graph state. |

These states may appear in catalog reads, template reads, dry-run diagnostics, and doctor-linked summaries. They must
be redacted and machine-branchable.

## 6. Diagnostics And Recovery

Diagnostics should include a stable code, a field/path where possible, redacted detail, retryability, and a skill
pointer when procedural recovery is useful.

| Diagnostic area | Example defect | Runtime recovery path |
|---|---|---|
| Unavailable provider | Selected `auth-oidc-acme` has no accepted WPM evidence or its required probe fails. | Choose an available compatible provider/template default or request operator install/update repair. |
| Not installed provider | A provider id named by `catalog show` or an assembly override is not registered in this install. | Re-read `catalog list --kind <family>` and choose an installed provider, or request operator install/update. |
| Incompatible selection | Template requires a connector transport that the selected entrypoint provider does not support. | Remove the selection, choose a compatible provider from `template show`, or choose another template. |
| Ambiguous default | A template open part requires explicit compatibility evidence but no relation proves the default safe. | Choose a provider from a compatible template, or hand the package back to operator install/update/provider authoring for repair. |
| Schema error | `AssemblySpec` contains an unknown field, wrong type, out-of-range value, or provider config outside `config_schema`. | Re-read `gla schema`, fix the field, and dry-run again. |
| Template-fixed override | The proposal tries to override fixed isolation tier, assurance policy, namespace posture, public-edge route shape, or another fixed part. | Remove the override or choose a template that exposes the desired part as open. |
| Missing skills | A selected template/provider has no skill or recovery pointer for the agent-facing behavior it exposes. | Use schema/template data only if sufficient; otherwise report an authoring or install/update gap. |
| Client asset problem | An entrypoint client asset is a local override, mutable, missing, or unverifiable instead of packaged or WPM-evidence-backed read-only assets. | Do not treat it as packaged immutable evidence; choose another compatible entrypoint or escalate to operator install/update. |
| Dry-run admission failure | Admission rejects because of policy, dependency, capability, compatibility, not-found, conflict, or mount constraints. | Branch on the stable code, repair the proposal locally when possible, then retry dry-run before real submission. |
| Policy-rejected provider/template | The selected graph exists, but the current task/capability/policy cannot use it. | Select an allowed option or escalate; runtime consumption cannot rewrite policy or daemon config. |
| Resume failure | `session connector <id>` cannot return a live connector because the session is terminal or no capsule exists. | Read `session get`, create a new admitted session if the task still allows work, or report terminal state. |

The diagnostic copy should say what the agent can do next. If the fix belongs to another flow, name that flow:
provider authoring for missing package docs/tests/skills, operator install/update for deployment/WPM/daemon repair.

## 7. Write Restrictions As UX Constraints

The runtime flow is not organized around permission categories, but write restrictions must appear at the moment a
runtime action would cross into another flow.

Allowed inside runtime consumption:

- write a local `AssemblySpec` draft and task-owned scratch artifacts;
- create, read, complete, or revoke task/session/handoff entities through admitted runtime commands;
- attach host mounts only when the agent already has filesystem access and policy/admission allows them;
- read catalog, template, schema, skill, and session surfaces; event and audit reads are future/deferred unless
  promoted into the current executable CLI contract;
- submit dry-run and real session proposals against already registered providers.

Not allowed inside runtime consumption:

- write provider code, provider package manifests, contract tests, or skill/docs source;
- write app deployment config, capsule template defaults, provider inventory, or rollback snapshots;
- write WPM receipts, dependency binding evidence, daemon config, boot config, route config, or public-edge setup;
- load executable provider code or register provider modules after daemon boot;
- select or override `AuthProvider`, `ChannelAdapter`, or `SecretStore` through runtime session creation;
- edit provider-owned state namespaces except through the provider-neutral runtime operations that own that state;
- bypass Access Gateway grants, recipient binding, revocation, auth assurance, or admission policy by selecting a
  different provider id.

When the agent attempts one of these guarded actions, the UX should explain the nearest valid next step, not expose a
new journey: go to provider authoring for package changes, operator install/update for selected graph and host
dependency changes, or runtime proposal repair for schema/template/policy issues.

## 8. Success State And Task Handoff

Runtime consumption succeeds when dry-run admission accepts and the real `session create` returns a live session:

- the accepted `AssemblySpec` resolved to available compatible providers and templates;
- template defaults and runtime parameters were canonicalized;
- policy and capability checks passed;
- dependency and probe evidence was sufficient for admission;
- the session id, capsule descriptor, connector descriptor, and redacted diagnostics were returned;
- the agent can re-read session state and connector data after interruption.

This success state hands back to task execution. The agent drives the capsule through the connector, opens
recipient-bound handoffs when needed, waits for completion, inspects results, and completes or revokes the task. If a
later handoff/session step fails, recovery starts from task/session state and the relevant skill, not by changing the
provider graph.

## 9. Non-Goals

- No provider package source authoring.
- No app deployment config selection, profile overlay application, WPM receipt writing, daemon restart, or rollback.
- No marketplace/version solver.
- No dynamic provider hot-loading.
- No provider-specific task/session command surface.
- No visual styling decisions; this story specifies runtime workflow behavior and diagnostics for an agent-facing UX.

## Related

`provider-graph-defaults-and-extension-plan.md` defines the three separate UX flows and provider graph direction.
`provider-install-update-ux.md` defines the upstream operator flow that produces the active graph.
`provider-authoring-ux.md` defines the package-authoring flow. `../04-capsule-assembly.md` defines the
`AssemblySpec`, template delta model, and dry-run assembly flow. `../05-cli-and-entities.md` defines the current and
target agent-facing CLI surfaces.
