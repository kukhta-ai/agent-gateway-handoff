# Provider Install And Update UX

> **Status:** provider graph UX specification for `GLA-107.12`.
> **Scope:** the operator/operator-agent experience for choosing, configuring, verifying, updating, and rolling back
> provider sets, profiles, overlays, and host dependency evidence on a concrete host. This is a distinct UX flow from
> provider authoring and runtime consumption. Write permissions, guarded operations, and rollback limits are
> constraints inside the journey, not the journey structure.

## 1. Protagonist And Job

The protagonist is the operator, often represented by an operator-agent running on the operator's VPS. Their job is
to turn a reviewable provider package or template package into a selected, boot-verified provider graph on this host.

This flow starts from a provider-authoring readiness handoff or an already trusted provider-set update. It is not
trying to create package source or run a runtime session proposal. The UX answers one question:

> Can I safely choose a named provider profile, apply approved overlays, satisfy host dependencies, boot/doctor the
> daemon, and keep a rollback path if the update fails?

## 2. Entry Points

The target surface should be command-first because install/update touches files, WPM receipts, daemon boot, and doctor
evidence. These are UX command names, not the current executable `gla` CLI contract; today's CLI must report the
provider-set, profile, and provider-graph doctor command groups as deferred until the install/update surface is
implemented. A UI can wrap these commands later, but it must preserve the same plan -> verify -> apply -> doctor state
model.

| Entry point | Purpose | Primary output |
|---|---|---|
| `gla provider-set inspect <path>` | Review a trusted provider-set update before selecting it. | Provider modules, package ids, named profiles, defaults, and declared dependencies. |
| `gla profile list` | Show named profiles in the trusted provider set. | Profiles with purpose, selected providers, dependency posture, and default explanations. |
| `gla profile show <profile>` | Explain one named profile before applying it. | Provider selections, profile-specific defaults, required dependencies, secret refs, and expected doctor checks. |
| `gla profile validate <profile-or-overlay>` | Validate one profile or overlay document. | Stable diagnostics for inheritance, family ids, provider ids, config refs, secret refs, and guarded fields. |
| `gla profile overlay validate <overlay>` | Validate an operator overlay before it can be applied. | Stable diagnostics for inheritance, family ids, provider ids, config refs, secret refs, and guarded fields. |
| `gla provider-set plan --profile <profile> [--overlay <file>]` | Plan an install/update without mutating the daemon. | Diff from the active profile, dependency/WPM checklist, restart impact, rollback snapshot requirement. |
| `wpm bundle detect|setup|adopt|verify|record <bundle>` | Satisfy host-touching dependencies named by providers/templates. | Structured `DependencyBinding` evidence and inverse-operation notes. |
| `gla provider-set apply --profile <profile> [--overlay <file>] --restart` | Apply the selected provider graph after validation and WPM evidence. | Daemon boot attempt, applied profile id, rollback snapshot id, and doctor run id. |
| `gla doctor provider-graph` | Verify current boot-time registration, dependency evidence, and probes. | PASS/DEGRADED/FAIL report for install convergence and runtime health. |
| `gla provider-set rollback <snapshot>` | Return to a previous selected provider graph when the update fails. | Restored profile/config where possible plus explicit manual repair limits. |

The exact target command names can evolve. The UX contract is fixed: inspect profiles, validate overlays, plan,
satisfy WPM, apply with snapshot, doctor, then hand off to runtime consumption.

## 3. Inputs

The install/update flow consumes:

- trusted provider-set package or distribution entrypoint;
- named `ProviderProfile` selected by the operator;
- zero or more operator-approved `ProviderProfileOverlay` files;
- profile-specific defaults and provider-owned config, expressed with secret refs rather than raw secret values;
- provider/template dependency requirements from the catalog package manifests;
- WPM bundle metadata and `DependencyBinding` receipt evidence;
- current GLA runtime probes and doctor output;
- public-edge transport evidence when a template requires public reachability;
- rollback snapshot of previous selected provider set/profile/config plus WPM inverse-operation notes.

The flow does not consume runtime session payloads. Runtime agents may inspect the result later, but they do not
write these install/update inputs.

## 4. Named Profiles And Defaults

The install/update UX must avoid global default ambiguity. A default is always default **inside a named profile**.
The profile surface should answer:

- what the profile is for, such as `local-dev`, `single-operator`, `scenario-01`, or `hardened-idp`;
- which provider id is selected for each canonical family;
- which template defaults are profile-specific;
- which host dependencies and public-edge evidence are required;
- which profile is currently active and what would change if this one is applied;
- why a selected provider is available, degraded, unavailable, or blocked on WPM evidence.

The copy should never say "the default provider" without naming the profile. It should say "`single-operator`
selects `auth-webauthn`" or "`hardened-idp` selects `auth-oidc-acme`." When two profiles select different auth or
launcher providers, the UX should present that as a posture choice, not a conflict to be solved by hidden preference.

## 5. Install/Update Journey

1. **Receive the readiness handoff.** The operator-agent starts from a package readiness report or trusted
   provider-set update. Missing package evidence sends the work back to provider authoring.
2. **Choose the named profile.** The operator compares profiles by purpose, selected providers, dependency posture,
   and expected runtime consumption surface.
3. **Review or create overlays.** The operator validates overlay inheritance, canonical families, provider ids,
   config refs, disabled/null choices, and secret refs before any daemon mutation.
4. **Plan the graph.** The plan shows profile/overlay diff, provider ids, template defaults, dependency
   requirements, public-edge evidence needs, restart impact, and rollback snapshot requirement.
5. **Satisfy host dependencies through WPM.** WPM detects, sets up or adopts dependencies, verifies them, records
   machine-readable receipts, and stores inverse-operation notes where possible.
6. **Review secrets and public edge.** The operator verifies secret refs resolve through the selected secret store
   and public-edge evidence reaches Access Gateway without replacing grant, recipient, revocation, or assurance
   checks.
7. **Apply with snapshot.** The tool snapshots the previous selected graph/config, writes the approved profile and
   overlays to the operator-owned boot config, and restarts or boots the daemon.
8. **Doctor the graph.** Doctor checks provider registration, catalog availability, WPM install convergence, current
   runtime probes, template dependencies, public-edge transport, and redacted diagnostics.
9. **Decide active, degraded, or rollback.** PASS hands off to runtime consumption. DEGRADED requires an explicit
   operator decision or repair. FAIL rolls back when the snapshot and inverse operations are sufficient.
10. **Hand off to runtime consumption.** The runtime agent sees read-only catalog/schema/template/skill surfaces and
    dry-run diagnostics for the active profile.

## 6. States

| State | Operator sees | Exit condition |
|---|---|---|
| `ready-to-plan` | Provider package/update evidence exists, but no host change has been planned. | A named profile and overlay set are selected for planning. |
| `plan-blocked` | Profile, overlay, secret ref, or package evidence is invalid. | Blocking diagnostics are fixed or the update is abandoned. |
| `wpm-pending` | Host-touching dependencies need detect/setup/adopt/verify/record. | WPM receipts satisfy all required machine-readable fields. |
| `ready-to-apply` | Plan, overlay validation, WPM receipts, secret refs, and rollback snapshot are ready. | Operator applies with restart/boot. |
| `booting` | Daemon is registering provider modules and deriving catalog availability. | Doctor returns PASS/DEGRADED/FAIL. |
| `active` | Selected profile is booted and doctor PASSes. | Runtime consumption can begin. |
| `degraded` | Install converged but runtime probes or edge evidence are degraded. | Operator repairs, waives with explicit note, or rolls back. |
| `rolled-back` | Previous provider graph/config was restored where possible. | Doctor verifies the restored graph or names manual repair. |

## 7. Diagnostics And Recovery

Diagnostics must separate install convergence from runtime health. They should name the profile/overlay/dependency,
the evidence field or probe that failed, and the next recovery action. They must not echo raw secrets.

| Diagnostic area | Example defect | Recovery path |
|---|---|---|
| Unavailable dependency | Required host-touching dependency has no accepted `DependencyBinding`. | Run the WPM bundle, adopt an existing service, or choose a profile that does not require it. |
| Invalid overlay | Overlay has an inheritance cycle, wrong-family provider, unknown provider id, duplicate singleton, or disabled security-critical family. | Fix the overlay or select a different named profile before apply. |
| Unresolved secret ref | Provider config references a missing secret ref or uses a literal/ad-hoc secret value. | Create the secret in the selected secret store or change the overlay to a valid ref. |
| Failed WPM probe | Last WPM install-time probe is degraded or unavailable. | Repair the dependency through WPM and record a new receipt. |
| Degraded runtime probe | Current GLA probe fails after boot. | Inspect provider diagnostics, restart/repair the dependency, or roll back the profile. |
| Unsafe public-edge evidence | Public base URL, route, headers, log-redaction posture, or gateway upstream evidence is missing or unsafe. | Fix the edge proxy/WPM receipt; do not treat Caddy/nginx/Traefik as auth or grant enforcement. |
| Profile ambiguity | The operator tries to apply "the default" without selecting a named profile. | Pick an explicit profile and show its selected providers/defaults before apply. |
| Ambiguous compatibility | Selected providers/templates lack an explicit compatible relation where the family contract requires one. | Select a compatible profile/overlay or fix the provider/template compatibility declaration before apply. |
| Template-fixed override | Overlay or runtime defaults try to change a security-bearing fixed template part. | Remove the override or choose a named profile/template that exposes the intended part as open. |
| Rollback limit | Previous config can be restored but an external dependency or remote service cannot be undone automatically. | Restore what GLA owns, run WPM inverse operation when available, and show manual repair notes. |

## 8. Guarded Operations And Rollback Limits

Allowed inside this flow:

- write operator-owned provider profile/overlay config after validation;
- run WPM dependency detect/setup/adopt/verify/record steps;
- write WPM `DependencyBinding` receipts through WPM, not by hand;
- restart or boot the daemon after an approved plan;
- run doctor and produce install/update evidence;
- roll back to a previous selected graph/config when a snapshot exists.

Not allowed inside this flow:

- author provider package source or contract tests; that belongs to provider authoring;
- accept raw secret values in profiles, overlays, receipts, diagnostics, logs, or public-edge evidence;
- register executable provider code after daemon boot;
- let runtime agents write provider code, profiles, overlays, WPM receipts, daemon config, or rollback snapshots;
- replace Access Gateway grant, recipient, revocation, and assurance checks with public-edge proxy configuration.

Rollback limits must be explicit. GLA can restore its selected provider graph/config and display WPM inverse
operations. It cannot silently undo remote IdP state, third-party channel state, manual external service changes, or
host changes whose WPM bundle did not record a safe inverse operation.

## 9. Success State And Handoff

The install/update flow is successful when the provider graph doctor report returns PASS for the selected profile
(target CLI name: `gla doctor provider-graph`):

- named profile and overlays applied;
- provider modules registered at boot;
- WPM install convergence evidence accepted;
- current runtime probes available;
- template and public-edge dependencies verified;
- rollback snapshot recorded or explicitly unnecessary;
- redacted diagnostics and decision notes stored for audit.

The handoff to runtime consumption is read-only. The runtime agent may inspect catalog/schema/template/skill surfaces,
run dry-run admission, and propose sessions against the active provider graph. It cannot write profiles, WPM receipts,
daemon config, provider code, or rollback state.

## 10. Non-Goals

- No provider package authoring or template-package source creation.
- No runtime session proposal or catalog consumption journey.
- No marketplace/version solver.
- No dynamic provider hot-loading.
- No hidden global default selection.

## Related

`provider-graph-defaults-and-extension-plan.md` defines the three separate UX flows and provider graph direction.
`provider-authoring-ux.md` defines the upstream package-authoring flow. `provider-runtime-consumption-ux.md` defines
the downstream runtime-agent discovery, dry-run, and session proposal flow. `catalog-dependency-bindings.md` defines
WPM receipt evidence and availability rules.
