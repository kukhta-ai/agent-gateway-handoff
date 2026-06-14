# Provider Graph Defaults and Horizontal Extension Plan

> **Status:** canonical architecture direction for default-provider packaging and user-extensible layers.
> **Scope:** generalize "a default package for every layer" into a typed provider graph, selected provider
> profiles, and a repeatable provider-author workflow. This sharpens `docs/02-provider-and-extension-model.md`
> and `docs/architecture/provider-host-extension-architecture.md`; it does not introduce dynamic hot-loading, a
> public plugin ABI, marketplace resolution, or runtime-agent code registration. Capsule templates participate in
> the graph as catalog packages, not Provider Host factories.

## 1. Problem

GLA needs a default implementation for every user-facing layer, but the default path must not become hard-coded
application wiring. The same architecture must also let an operator, or an authorized operator agent, add a provider
for a layer horizontally: add the provider package, satisfy any dependencies, select it in a profile, and use it
through the catalog without editing the kernel, gateway, session, identity, worker core, or generic app composition.

The design target is therefore:

- defaults are ordinary providers, not special cases;
- layer selection is a profile decision, not app code;
- provider dependencies are satisfied through WPM evidence, not inferred from package presence;
- runtime agents can inspect and consume registered providers, but never register executable provider code;
- provider authoring, operator install/update, and runtime consumption are separate UX flows that must each be
  designed and documented, even when the same physical agent performs all three on the operator's VPS;
- the extension surface is strongest for the popular user-facing layers first: channel, auth, human entrypoint,
  capsule templates, completion detectors, agent connectors, workspace, launcher, and secret store.

## 2. Decision

Represent the extension surface as a **typed provider graph** derived from Provider Host and Catalog state.

The graph is not a required graph database. It is the architectural model and validation shape behind the existing
runtime objects: provider modules, manifests, selected profiles, dependency requirements, WPM bindings, probes,
skills, template defaults, and runtime factories. Each runtime flow consumes a projection of the graph:

- Catalog projects discovery, schemas, skills, compatibility, diagnostics, and availability.
- Admission projects a candidate `AssemblySpec` and rejects unavailable or incompatible nodes before session
  creation.
- Provider Host projects selected provider factories and creates runtime ports.
- Doctor projects dependency/probe health.
- The agent-facing CLI projects the provider and template graph as read-only catalog/schema output.

The main direction is:

> Every layer has a `ProviderFamily`. Every implementation, including the default, is a `ProviderPackage`.
> Defaults are selected by a `ProviderProfile` inside a trusted `ProviderSet`. Templates and session assemblies
> resolve to subgraphs over those registered providers.

## 3. Graph Vocabulary

### Nodes

| Node | Meaning |
|---|---|
| `ProviderFamily` | A pluggable layer kind, such as `ChannelAdapter`, `AuthProvider`, `Launcher`, or `HumanEntrypoint`. |
| `ProviderPackage` | The trusted install-time artifact for a runtime provider: manifest, module code, schemas, probes, skills/docs, and tests. |
| `TemplatePackage` | A trusted catalog package for `CapsuleTemplate` entities, schemas, defaults, skills/docs, and tests. It has no Provider Host runtime factory unless it also ships runtime providers. |
| `ProviderManifest` | Static catalog metadata for identity, family, capability, config schema, dependency requirements, probes, skills, and relations. |
| `ProviderModule` | Executable trusted code registered into Provider Host. |
| `ProviderProfile` | The selected default provider id per family plus provider-owned default config/service bindings. |
| `ProviderSet` | A distribution/operator bundle that imports trusted provider modules and exposes one or more selected profiles. |
| `DependencyRequirement` | Static provider or template requirement for external software/resource evidence. |
| `WPMBundle` | The host-touching installer/adopter/verification bundle for a dependency. |
| `DependencyBinding` | Dynamic WPM receipt evidence read by GLA and combined with current runtime probes. |
| `CapsuleTemplate` | Declarative catalog composition that requires providers, capabilities, schemas, and template-level dependencies. |
| `ProviderProbe` | Current health/contract check for a provider or dependency. |
| `ProviderContractTest` | Build-time proof that code, manifest, schema, diagnostics, and runtime behavior agree. |
| `SkillPack` | Agent/operator instructions shipped with the provider and indexed through the Skill Manifest. |
| `StateNamespace` | Provider-owned state area scoped by provider id and schema. |
| `AssetMount` | Provider-owned static browser assets, such as a human-entrypoint client bundle, mounted read-only by generic gateway code. |

### Edges

| Edge | Meaning |
|---|---|
| `provides` | A provider package implements a provider family and declares capabilities. |
| `requires` | A provider or template requires a dependency, provider capability, service binding, or asset mount. |
| `satisfiedBy` | A dependency requirement is satisfied by accepted WPM receipt evidence plus current probe status, using the acceptance rules from `catalog-dependency-bindings.md`. |
| `selectedBy` | A provider profile selects a provider id as the default for a family. |
| `compatibleWith` | A provider or template declares compatible provider families, ids, capabilities, or transport classes. |
| `exposesSchema` | A provider publishes config/factory/session schema visible through catalog/schema reads. |
| `suppliesSkill` | A provider contributes skills/docs for agent and operator use. |
| `suppliesAsset` | A provider contributes reviewed client assets mapped by the selected provider set. |
| `ownsState` | A provider owns state slots under its namespace; app code sees only opaque provider state. |
| `resolvesTo` | An `AssemblySpec` or template default resolves to an available provider subgraph. |

Graph validation must be deterministic and fail closed. Unknown provider ids, unresolved relations, unavailable
host-touching dependencies, failed probes, invalid schemas, missing skills, ambiguous compatibility, or sensitive
literal config all block availability or admission.

## 4. Default Package Rule

For every user-facing runtime `ProviderFamily`, the reference distribution ships at least one first-party default provider
with the same artifact shape expected from custom providers:

- `ProviderManifest`;
- Provider Host module/factory;
- config and optional state schemas;
- probe;
- contract tests;
- skills/docs;
- redacted diagnostics;
- WPM bundle metadata when the provider has host-touching dependencies;
- explicit compatibility relations and template defaults where needed.

Defaults are selected only by `packages/provider-set-reference` and its profile. Generic app composition receives
that provider set/profile from the distribution entrypoint; it does not know which provider is "the" default.

A reference provider set may group default providers for convenience, but it is not a monolithic host installer.
Host-touching dependencies remain separate WPM bundles and become available only through structured WPM receipts
plus current GLA probes. Optional families may use an explicit disabled/null provider only where "absent" is a
valid product behavior; security-critical layers must have a real default or fail closed.

`CapsuleTemplate` follows the same package discipline but not the same runtime-factory rule. A default template is
a `TemplatePackage`: catalog entity, schema, template defaults, compatibility requirements, skills/docs, and
contract tests. It is selected and validated through Catalog/Admission, but Provider Host does not instantiate a
long-lived template factory.

Default means **selected by a named profile**, not globally preferred for all deployments. Compatibility decides
whether a selected set of providers can safely work together; it does not decide which product posture the operator
intended. The reference provider set may therefore expose multiple named profiles:

| Profile | Purpose | Selection posture |
|---|---|---|
| `local-dev` | Fast local and CI exercise of the graph | in-tree/local defaults such as WebAuthn, process launcher, CLI channel. |
| `single-operator` | Default self-hosted VPS posture | local-process or adopted host services where appropriate, with WPM receipts proving host-touching layers. |
| `scenario-01` | Product reference flow for same-session browser handoff | browser-handoff template with channel, auth, launcher, entrypoint, connector, workspace, and detector choices that are mutually compatible and available on the host. |
| `hardened-idp` | Stronger external identity posture | delegated `AuthProvider` such as authentik or OIDC plus compatible edge, assurance, enrollment, and WPM bindings. |

These names are illustrative until encoded as provider-profile manifests, but the rule is fixed: documentation and
implementation must say which profile a "default" belongs to. If two docs disagree about WebAuthn vs authentik or
process launcher vs Docker, that is not solved by a generic default; it is solved by naming the profile and then
checking compatibility and availability inside that profile.

## 5. Provider-Family Contract

Each provider family gets a family contract before it is treated as horizontally extensible. The contract includes:

- the kernel port or provider-neutral resource descriptor;
- the family manifest schema;
- the Provider Host registration method and factory context;
- config/factory/session schema vocabulary;
- state namespace rules;
- dependency requirement vocabulary;
- probe result shape;
- diagnostics and redaction rules;
- skill/doc requirements;
- contract-test harness;
- catalog/schema/read-model projection;
- admission compatibility rules.

The popular user-facing families should be prioritized in this order:

| Priority | Family | Default provider direction | High-value extensions |
|---|---|---|---|
| 1 | `ChannelAdapter` | local/CLI for tests and reference delivery, with Telegram where the reference scenario requires it | Slack, email, WhatsApp/Telegram variants, webhooks. |
| 2 | `AuthProvider` | in-tree WebAuthn/passkey verification for the simple profile | authentik, generic OIDC, Authelia, hosted IdP adapters. |
| 3 | `HumanEntrypoint` | noVNC browser handoff | form surface, file picker, document review/editor, approval dialog, KasmVNC/Guacamole/Xpra. |
| 4 | `CapsuleTemplate` catalog kind | browser handoff template package | secret intake, approval, document review, file selection, app preview. |
| 5 | `CompletionDetector` | URL watcher plus user-done | DOM watcher, exit-code, webhook/callback, manual operator mark-done. |
| 6 | `AgentConnector` | CDP for browser capsules | local HTTP, filesystem, `secret_ref`, typed app protocol. |
| 7 | `Workspace` | temporary browser profile | staged copy, persistent profile, mounted project workspace. |
| 8 | `Launcher` | local-process reference with container/remote alternatives registered | Docker, Podman, rootless, Firecracker, remote worker. |
| 9 | `SecretStore` | minimal local/reference store with secret-ref-only outputs | Vault, 1Password, SOPS, cloud secret managers. |

Public edge remains a dependency/transport layer, not an auth provider family. Caddy, nginx, and Traefik may be
swapped through dependency evidence and route-transport capability, but Access Gateway remains the sole grant,
recipient, revocation, and assurance enforcement point.

## 6. Provider Profiles And Overlays

A profile names the selected provider id for each runtime family needed by the distribution and may provide
provider-owned default config, service bindings, template defaults, and asset mappings.

Profile documents are **operator-owned install/update artifacts**. They live with the provider set or with an
operator-controlled config source loaded at daemon boot. The first phase is boot-time only: changing a profile or
overlay requires the operator install/update flow and daemon restart. A future hot-reload path may exist only if it
uses the same authority checks, validation pipeline, and fail-closed rollback. Runtime request payloads, agent CLI
calls, and catalog reads cannot write profiles or overlays.

Schema rules:

- `kind` is `ProviderProfile` or `ProviderProfileOverlay`.
- `metadata.name` is the stable profile id.
- `spec.extends` may name one base profile; inheritance must be acyclic.
- `spec.select` is a map from canonical family id to provider id. Current canonical family ids are
  `AuthProvider`, `Launcher`, `Workspace`, `HumanEntrypoint`, `AgentConnector`, `CompletionDetector`,
  `ChannelAdapter`, and `SecretStore`.
- Singleton families accept one provider id. Multi-provider families must declare cardinality in their family
  contract before a profile can select more than one.
- `spec.config` is a map from provider id to provider-owned config object, validated against that provider's schema.
- Secret-bearing config uses object refs such as `{ secretRef: "slack-bot-token" }`; literal secret values and
  ad-hoc `secret:*` strings are rejected in profiles.
- Unknown family keys, provider ids that do not register in the selected provider set, disabled security-critical
  families, duplicate selections, and unresolved config refs reject the profile.

Example profile:

```yaml
apiVersion: gla.dev/v1
kind: ProviderProfile
metadata:
  name: local-dev
spec:
  select:
    AuthProvider: auth-webauthn
    Launcher: launcher-process
    Workspace: workspace-browser-profile-temp
    HumanEntrypoint: entrypoint-novnc
    AgentConnector: connector-cdp
    CompletionDetector: detector-url-watcher
    ChannelAdapter: channel-cli
    SecretStore: secret-store-reference
  defaults:
    template.browser-handoff:
      HumanEntrypoint: entrypoint-novnc
      AgentConnector: connector-cdp
      CompletionDetector: detector-url-watcher
```

Operators or their agents should extend by profile overlay, not by modifying generic app composition:

```yaml
apiVersion: gla.dev/v1
kind: ProviderProfileOverlay
metadata:
  name: acme-slack-oidc
spec:
  extends: local-dev
  select:
    ChannelAdapter: channel-slack
    AuthProvider: auth-oidc-acme
  config:
    channel-slack:
      botToken:
        secretRef: slack-bot-token
    auth-oidc-acme:
      issuerUrl: https://idp.acme.example
      clientSecret:
        secretRef: oidc-client-secret
```

An overlay may select registered provider ids and supply provider-owned config/service refs. It must not alter core
authorization semantics, inject executable provider code at runtime, bypass WPM dependency evidence, or introduce
provider-specific imports into app/kernel/gateway/session/identity/worker packages.

## 7. Deterministic Graph Resolution

Provider graph resolution is intentionally simple. This phase has no solver, no marketplace semantics, and no
"best" provider search. Profiles and templates select concrete ids; compatibility and availability validate them.

Resolution order:

1. Register trusted provider modules from the selected provider set.
2. Resolve the base `ProviderProfile` plus zero or more operator-approved overlays. Later overlays may replace a
   provider selection only inside the operator install/update flow.
3. Reject cycles, unknown family keys, unknown provider ids, family mismatches, duplicate provider ids, and multiple
   versions of the same provider id. Version ranges are not solved automatically in this phase; incompatible
   versions reject.
4. Materialize template defaults and selected provider manifests.
5. Validate dependency requirements. Host-touching requirements are unavailable unless accepted WPM receipt evidence
   and current GLA probes satisfy `catalog-dependency-bindings.md`.
6. Evaluate compatibility. Explicit `compatibleWith` entries are allowlists. If either side declares an allowlist for
   a peer family, the selected peer must match it by provider id, capability, or transport class. If a family
   contract marks compatibility as required and no applicable relation exists, the result is ambiguous and rejected.
7. Validate provider config after defaults are merged. Unknown fields, type errors, policy-disallowed fields,
   sensitive literals, and template-fixed overrides reject.
8. Admission resolves an `AssemblySpec` only against this validated graph projection. It never reimplements a second
   availability or compatibility rule.

Config/default precedence is fixed from lowest to highest:

1. Provider `config_schema` defaults.
2. Provider-set `defaultConfig` used to normalize distribution or legacy inputs.
3. Base profile `spec.config`.
4. Approved profile overlay `spec.config`.
5. Template defaults for selected parts and part params.
6. Runtime `AssemblySpec` part params where the family contract permits runtime selection.

WPM `DependencyBinding` evidence is not ordinary config and does not participate in this merge. Provider Host passes
accepted connection refs to provider factories through `ProviderCreateContext.dependencies`. Template-fixed
security-bearing fields, such as isolation tier, privileged mode, namespace posture, assurance policy, and raw edge
authorization semantics, cannot be overridden by an `AssemblySpec`.

## 8. Security-Bearing Subcontracts

### AuthProvider Assurance

Selecting an `AuthProvider` changes the mechanism, not gateway semantics. Each auth provider declares what
provider-neutral `AuthAssuranceEvidence` it can produce. Its adapter maps native claims, methods, stages, WebAuthn
flags, OIDC fields, or IdP-specific proof into the common evidence shape from `components/identity-and-auth.md`.

The selected `AuthProvider` must be compatible with the selected `AuthAssurancePolicy`. Unknown, missing, ambiguous,
or provider-specific evidence degrades to the lowest safe tier or returns `ok:false`; it never silently maps upward
to phishing-resistant assurance. Access Gateway consumes only grant facts, recipient facts, revocation state, route
bindings, and provider-neutral assurance. It must not branch on raw provider ids, `amr`, `acr`, WebAuthn flags,
authentik stage names, or future provider-native labels.

### WPM Satisfaction

The graph's `satisfiedBy` edge inherits the catalog dependency rules verbatim. A host-touching dependency is
available only when all of these are true:

- a structured `DependencyBinding` exists with `source: "wpm-receipt"`;
- ownership mode and state are compatible;
- bundle identity, version, declared requirements, and receipt facts are machine-readable;
- connection facts are refs and secret-bearing facts are `{ secretRef: "..." }`;
- the last WPM install-time probe is `available`;
- the current GLA runtime probe is `available`.

Pure in-tree providers with no host-touching dependency can be available from their own current probe alone.

### Public Edge Transport

Public edge remains dependency/transport evidence. A route-transport dependency descriptor must cover at least:

- dependency id, such as `edge-proxy`;
- public base URL and configured base path refs;
- Access Gateway upstream ref;
- route-programming capability or manual route mode;
- ownership mode and accepted WPM receipt id;
- log-redaction posture for query strings, `Cookie`, `Authorization`, and `Sec-WebSocket-Protocol`;
- current probe showing the public path reaches Access Gateway.

Caddy, nginx, Traefik, or a manual proxy can satisfy this transport descriptor, but none can satisfy recipient
binding, grant verification, revocation, enrollment, or auth-assurance checks. Those remain Access Gateway and
Identity + Auth responsibilities.

### Asset Mounts

Provider-owned browser assets are served through generic gateway asset mounts only after provider-set mapping and
validation:

- asset refs are namespaced by provider id and cannot collide with route, grant, enrollment, callback, or other
  provider asset paths;
- asset roots are read-only, canonicalized, and path traversal is rejected;
- assets are versioned or content-addressed, with content hash recorded for diagnostics;
- provider assets must not contain raw grants, bootstrap tickets, secret refs, operator tokens, or generated
  runtime config;
- gateway responses use `X-Content-Type-Options: nosniff`; security-bearing client surfaces continue to use
  `Cache-Control: no-store` and `Referrer-Policy: no-referrer`;
- CSP/cache policy is declared by the provider family contract and enforced by gateway static hosting, not by
  provider-specific gateway code.

### Provider State

Provider state lives in Provider Host namespaces and follows daemon-state recovery rules:

- state keys are scoped by provider id and schema version;
- sensitive classification is the default unless the provider proves otherwise;
- schema migrations are explicit and fail closed on unknown versions;
- provider namespaces load before public gateway binding when they affect enrollment, auth, grants, routes, or live
  capsule cleanup;
- backup/restore treats provider state under the daemon state root as secret operational data;
- app and core packages may see provider state handles and diagnostics, but not provider-owned implementation types;
- teardown and recovery must be idempotent where provider state references live external resources.

## 9. Horizontal Extension Workflow

There are three UX flows. They may be performed by the same physical agent on the same operator VPS, but they must
be designed as separate experiences because their protagonists, mental models, entry points, success states, and
failure recovery paths are different. Permissions still matter, but they are implementation guardrails for each UX,
not the organizing thesis.

| Flow | Primary UX question | Typical outputs |
|---|---|---|
| Provider authoring | How does a developer or operator agent create a package that is obviously complete, testable, and reviewable? | provider package or template package source, manifest, schemas, probes, skills/docs, tests, optional WPM bundle source. |
| Operator install/update | How does an operator or operator agent choose, configure, verify, and roll back providers on a concrete host? | selected provider set/profile, profile overlays, WPM dependency receipts, daemon config, doctor evidence. |
| Runtime consumption | How does the runtime agent discover what exists, understand schemas and skills, dry-run safely, and propose a session? | read-only catalog/schema/skill/template discovery, dry-run diagnostics, and session proposals against registered providers. |

Each flow needs its own UX spec before the corresponding tooling is built. The specs must describe entry points,
primary commands or screens, expected inputs, validation states, recovery states, diagnostic language, and the handoff
from one flow to the next. Permission boundaries are captured inside those specs as constraints, for example:
runtime consumption cannot write provider code, profiles, WPM receipts, or daemon config.

The provider-authoring flow for adding a provider is:

1. **Scaffold** a provider package or template package for a family/kind, producing manifest, module or catalog
   entity, schemas, probe where applicable, skills/docs, contract tests, and optional WPM bundle skeleton.
2. **Implement** the provider behind the family contract. Provider-specific vocabulary stays inside the package.
3. **Declare dependencies** in the manifest. If a dependency touches the host, provide or reference a WPM bundle.
4. **Validate locally** with provider contract tests, manifest/schema validation, redaction checks, and fake-host
   dependency tests.
5. **Produce a readiness handoff** for operator install/update: package id/version/family, manifest/schema/probe
   summary, skills/docs, test evidence, dependency requirements, optional WPM bundle refs, and provider-set/profile
   staging notes.

The operator install/update flow starts from that readiness handoff. It adds the package to a trusted provider set,
selects it through a profile or overlay, runs WPM for host-touching dependencies, records `DependencyBinding`
evidence, restarts or boots the daemon, and runs doctor so Provider Host registration, Catalog availability, and
current probes are verified.

The runtime-consumption flow starts only after boot/doctor succeeds: the runtime agent reads `catalog`, `schema`,
`template`, and skills, performs dry-run admission, and then submits a real session proposal. It may choose among
already registered provider ids where a surface allows selection, but it cannot create a provider package, change a
provider profile, write WPM receipts, or load executable provider code.

Tooling should make those steps one command path over time, for example `provider scaffold`, `provider validate`,
`profile overlay validate`, and `profile apply --restart`. Those commands are conveniences over the contract above.
The contract is the source of truth.

## 10. Validation Stages

| Stage | What is checked | Failure result |
|---|---|---|
| Build/provider-set validation | manifests, schemas, duplicate ids, family registration, contract tests, skills/docs, boundary imports | provider set cannot pass the quality gate. |
| Profile validation | profile inheritance, canonical family keys, provider ids, cardinality, secret refs, config schemas, compatibility declarations | profile/overlay cannot be applied. |
| Install/WPM validation | host dependency detection, setup/adoption, receipt shape, ownership/state compatibility, last WPM probe, secret refs | dependency binding rejected or marked unavailable. |
| Boot validation | provider modules register, selected profile ids exist, config/state schemas validate, probes run, diagnostics redact | daemon fails closed or provider is unavailable. |
| Catalog validation | availability derives from dependency bindings plus probes; skills/schema/template projections resolve | provider/template is hidden, degraded, or unavailable. |
| Admission validation | template/assembly subgraph resolves to available compatible providers and policy allows it | proposal rejected before task/session/route/capsule creation. |
| Runtime validation | created ports honor provider-neutral descriptors, state namespace, teardown, redaction, and diagnostics | session fails closed with typed outcome. |

## 11. Implementation Plan

1. **Canonicalize graph types.** Add explicit graph vocabulary to Provider Host/Catalog types: family, provider,
   dependency, profile, template, probe, skill, asset, state, and compatibility descriptors.
2. **Separate template packages from runtime providers.** `CapsuleTemplate` packaging gets catalog/schema/tests and
   compatibility requirements, but no Provider Host factory requirement.
3. **Complete default provider packages.** Ensure every selected reference provider has a manifest, module,
   config schema, probe, contract tests, skills/docs, diagnostics, and WPM dependency metadata where needed.
4. **Profile and overlay schema.** Add validation for canonical family ids, provider-id resolution, `extends`, cycle
   detection, unknown keys, disabled/null providers, duplicate selection, config refs, and restart/apply lifecycle.
5. **Graph resolver.** Implement one resolver used by Catalog, Doctor, Provider Host boot, and Admission. It owns
   compatibility, availability, and config-default precedence.
6. **Family contract harnesses.** For each prioritized family, add fake-provider contract tests proving a provider
   can be registered, selected, surfaced in catalog/schema/skills, probed, and used by the relevant runtime path.
7. **Security-bearing contracts.** Add concrete harnesses for auth assurance, public-edge transport descriptors,
   asset mounts, provider state recovery, WPM receipt satisfaction, and redaction.
8. **Provider-author tooling.** Scaffold provider packages, template packages, and WPM bundle skeletons from the
   family/kind contract. The scaffold should generate tests first so an operator's agent can fill the provider
   without guessing the seam.
9. **Popular-layer examples.** Add one non-reference provider example for the first high-value families: channel,
   auth, human entrypoint or completion detector. Use these examples to harden the author workflow before a public
   ABI or marketplace is considered.

## 12. Required Negative Tests And Acceptance Signals

Required negative tests:

- unknown provider id selected by a profile is rejected;
- unregistered provider selected by overlay is rejected;
- overlay inheritance cycles are rejected;
- unsupported family key or wrong-family provider id is rejected;
- host-touching dependency without accepted WPM receipt evidence is unavailable;
- degraded last WPM probe or degraded current GLA probe makes the provider unavailable;
- literal secret values and ad-hoc secret strings in profile config are rejected;
- ambiguous required compatibility is rejected;
- runtime provider registration after daemon boot is rejected;
- provider-specific imports from app/gateway/session/identity/worker/kernel fail the boundary gate;
- fake auth provider cannot bypass provider-neutral Access Gateway assurance policy;
- public-edge transport evidence cannot satisfy grant/recipient/revocation/assurance checks;
- provider asset path collisions, traversal, or grant/secret-bearing content are rejected;
- unknown provider state schema versions fail closed during daemon recovery.

The direction is implemented when:

- adding a new provider in a migrated family changes only the provider package, provider set/profile/overlay, WPM
  bundle/receipt if needed, and tests/docs;
- adding a new template changes only the template package/catalog entity, compatibility declarations, skills/docs,
  and tests;
- generic app composition and narrow-waist packages have no provider-specific imports, enums, config types, state
  types, or compatibility tables;
- a fake provider in each prioritized family can be selected by profile and exercised through catalog, schema,
  provider host creation, doctor/probe, admission, and the relevant runtime path;
- host-touching providers are unavailable without accepted WPM receipt evidence and current GLA probes;
- runtime agents can discover and use the provider through ordinary catalog/schema/skill/template surfaces but
  cannot register executable code after daemon boot;
- default providers and custom providers share the same package contract and validation pipeline.

## 13. Reconciliation With Existing Docs

| Concern | Normative source |
|---|---|
| Product invariants, narrow waist, WPM boundary, trust split | `docs/01-architecture-overview.md` |
| Uniform provider contract and install-time vs runtime clocks | `docs/02-provider-and-extension-model.md` plus this graph plan |
| Concrete candidates and reference alternatives | `docs/03-software-candidates.md`; profile-specific default wording must name the profile |
| Runtime Provider Host boundary and provider-set composition | `docs/architecture/provider-host-extension-architecture.md` |
| Provider contribution rules | `docs/architecture/provider-author-workflow.md` plus this graph plan's profile/workflow rules |
| WPM receipt availability | `docs/architecture/catalog-dependency-bindings.md`; this graph plan only projects those rules |
| Session/template assembly merge and runtime agent parameterization | `docs/04-capsule-assembly.md` plus this graph plan's full precedence chain |
| Auth assurance and gateway neutrality | `docs/components/identity-and-auth.md` and `docs/components/access-gateway.md` |
| Daemon state recovery | `docs/architecture/daemon-state-recovery.md`; provider state namespaces inherit those rules |

## 14. Non-Goals

- No dynamic hot-loading from runtime inputs.
- No public plugin ABI until multiple real external providers force one.
- No marketplace or version-solver semantics in this phase.
- No provider-specific app composition.
- No default mega-installer that stands up all layer dependencies whether selected or not.
- No replacement of Access Gateway authorization with Caddy/nginx/Traefik configuration.
- No conflation of dependencies with providers.

## Related

`docs/02-provider-and-extension-model.md` (uniform provider contract and registry model) ·
`docs/architecture/provider-host-extension-architecture.md` (runtime registration and provider set boundary) ·
`docs/architecture/provider-author-workflow.md` (provider contribution rules) ·
`docs/architecture/provider-authoring-ux.md` (provider-authoring UX flow) ·
`docs/architecture/catalog-dependency-bindings.md` (WPM receipt availability) ·
`docs/03-software-candidates.md` (layer inventory and alternatives) ·
`docs/04-capsule-assembly.md` (templates and session assembly).
