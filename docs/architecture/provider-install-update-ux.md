# Provider Install And Update UX

> **Status:** executable operator UX for `GLA-110.09`.
> **Scope:** the operator/operator-agent experience for adding, updating, checking, activating, and rolling back
> trusted provider and template packages on a concrete deployment. This is a distinct UX flow from provider
> authoring and runtime consumption.

## 1. Protagonist And Job

The protagonist is the operator, often represented by an operator-agent running on the operator's VPS. Their job is
to turn trusted provider-package and template-package artifacts into an active, doctor-verified deployment inventory.

The same physical agent on a VPS may also perform provider authoring or runtime capsule consumption, but this flow is
the operator/deployment-agent UX. It works with installed package evidence, deployment defaults, capsule defaults,
dependency receipts, and rollback state. It does not create provider source and it does not propose a runtime session.

The UX answers one question:

> Can I safely activate this provider inventory on this deployment, see exactly what would change, and restore the
> previous inventory if activation is rejected or later rolled back?

## 2. Executable Entry Points

The current executable CLI is JSON-first and file-backed:

| Entry point | Purpose | Primary output |
|---|---|---|
| `gla provider-install plan <candidate.json> [--state <active.json>]` | Preview an install/update without mutating operator state. | Activation readiness, registry/default/template/evidence diff, diagnostics, and provider-graph doctor report. |
| `gla provider-install apply <candidate.json> --state <active.json>` | Activate a verified candidate inventory into an operator-owned state file. | Applied active inventory plus rollback snapshot, or rejection diagnostics with the previous state unchanged. |
| `gla doctor provider-graph <active.json>` | Check the currently active inventory. | Installed provider inventory, selected app deployment providers, selected capsule defaults, template defaults, compatibility, evidence, and unresolved graph problems. |
| `gla provider-install rollback <snapshot.json> --state <active.json>` | Restore a rollback snapshot produced by apply. | Restored inventory and restored summary. |

The active state file is an operator-owned deployment artifact. `plan` and `doctor` are read-only. `apply` writes only
the explicit `--state` path and only after the candidate has a ready-to-apply plan. A rejected `apply` emits the same
diagnostics as `plan` and leaves the previously active inventory observable and unchanged.

## 3. Inputs

The candidate and active files use the same deployment inventory shape:

- trusted provider package wrappers, each with package content plus `signed: true` and `verified: true` evidence;
- trusted template-package wrappers, each with package content plus `signed: true` and `verified: true` evidence;
- `appDeployment` defaults for `AuthProvider`, `ChannelAdapter`, and `SecretStore`;
- `capsuleDefaults` for `Launcher`, `Workspace`, `HumanEntrypoint`, `AgentConnector`, and `CompletionDetector`;
- optional structured `dependencyBindings` produced by WPM receipts;
- optional `inventoryId` and `profileId` labels for operator audit and rollback summaries.

Provider authoring produces package content and readiness handoff data. The install/update flow consumes that data
only after package trust and verification evidence exists.

## 4. Activation Preview

`provider-install plan` reports the observable changes before activation:

- registry entries added, removed, or updated;
- app deployment defaults changed for auth, channel, and secret-store providers;
- capsule default providers changed for launcher, workspace, entrypoint, connector, and detector;
- capsule template defaults supplied by template packages;
- compatibility relations for open template parts;
- provider and template evidence requirements and whether matching dependency bindings are present;
- a provider-graph doctor report built from the same projection used by catalog, admission, and app boot.

This preview is the operator review surface. It must be possible to decide from this output whether the change is a
package update, a deployment default change, a capsule default change, a dependency/evidence problem, or a graph
compatibility problem.

## 5. Rejection And Diagnostics

The install/update flow rejects before activation when any of these are true:

- a package is unsigned or unverifiable;
- provider ids, provider versions, or template ids collide;
- selected providers are unknown, in the wrong family, or unavailable;
- compatibility relations are ambiguous or unresolved;
- host-touching dependency evidence is missing or current probes make a dependency unavailable;
- package fields are inert, unsupported, or fail authoring handoff validation.

Diagnostics name the affected provider id, family, package, template, dependency, and layer where that information is
available. They are safe for operator egress and do not echo secrets.

## 6. Doctor Output

`gla doctor provider-graph <active.json>` reports:

- installed registry entries and template packages;
- selected app deployment defaults;
- selected capsule defaults;
- template defaults and compatibility constraints;
- package provenance, docs, tests, and evidence posture where available;
- unresolved provider graph, dependency, compatibility, and evidence diagnostics.

Doctor is read-only. A FAIL report blocks handoff to runtime consumption until the operator repairs, chooses another
candidate, or restores a rollback snapshot.

## 7. Rollback

`provider-install apply` returns a rollback snapshot containing the previously active inventory and summary. Rollback
restores only GLA-owned deployment selection state. It does not pretend to undo remote IdP state, third-party channel
state, manual service changes, or host changes whose WPM bundle did not record a safe inverse operation.

## 8. UX Boundaries

Allowed inside this flow:

- validate trusted package handoff data;
- compare candidate and active deployment inventories;
- activate a verified candidate inventory into the operator-owned state file;
- run provider graph doctor;
- restore a rollback snapshot.

Not allowed inside this flow:

- author provider package source or contract tests; use `gla provider ...` or `gla template-package ...`;
- let runtime users change `AuthProvider`, `ChannelAdapter`, or `SecretStore` deployment selection;
- hand-write WPM receipts or raw secret values;
- register executable provider code after daemon boot;
- replace Access Gateway grant, recipient, revocation, or assurance checks with public-edge transport evidence.

The handoff to runtime consumption is read-only. Runtime agents inspect catalog, template, schema, skill, dry-run, and
doctor surfaces against the active inventory; they do not write provider packages, deployment defaults, WPM receipts,
daemon config, or rollback state.

## Related

`provider-layer-refactor-contract.md` defines the target provider-layer entities. `provider-authoring-ux.md` defines
the upstream package-authoring flow. `provider-runtime-consumption-ux.md` defines the downstream runtime-agent
discovery and selection flow. `catalog-dependency-bindings.md` defines WPM receipt evidence and availability rules.
