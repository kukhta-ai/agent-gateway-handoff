# Provider Layer Refactor Contract

> **Status:** Final GLA-110 provider-layer contract after GLA-110.14 legacy compatibility removal. This document makes
> the approved `provider-layer-refactor-as-is-to-be.html` diagram executable and records the archived migration from
> the former ProviderSet/Profile/Host implementation to the target model: one provider-layer entity per responsibility.

## 1. Target Contract

The provider layer keeps five target responsibilities. Each responsibility has one owning entity and one boundary where
other code may rely on it.

| Target entity | Single responsibility | Boundary contract | Must not own |
|---|---|---|---|
| `ProviderRegistry` | Boot-time executable provider registration. | Registers trusted provider packages, provider ids, versions, families, factory handles, probes, config schemas, browser-client asset descriptors, package provenance, and provider state namespaces. Once sealed, it is read-only for runtime admission. | It does not choose deployment defaults, mutate capsule templates, decide availability, or admit sessions. It is not dynamic hot-loading. |
| `AppDeploymentConfig` | Operator/app boot selection for app infrastructure providers. | Selects and configures `AuthProvider`, `ChannelAdapter`, and `SecretStore`, plus provider-neutral auth-assurance policy and app-level secret/config resolver inputs. | It does not select capsule runtime parts and is not an AssemblySpec/profile for a session. |
| `CapsuleTemplate` / `TemplatePackage` plus `AssemblySpec` | Capsule composition. | Templates own fixed/default/open capsule parts and provider-specific default config for `Launcher`, `Workspace`, `HumanEntrypoint`, `AgentConnector`, and `CompletionDetector`. Assembly specs may override only template-open capsule parts. | They do not select `AuthProvider`, `ChannelAdapter`, or `SecretStore`, and they do not register executable provider code. |
| `CapabilityCatalog` | Read-only capability projection. | Projects registry data, templates, app deployment config, WPM/install evidence, probes, compatibility facts, default sources, package provenance, and diagnostics into the catalog views used by Bridge, doctor, and Admission. | It does not run factories, write installed inventory, or make admission decisions. Status is derived, never authored. |
| `Admission Resolver` | Proposal-to-plan resolution. | Resolves an assembly proposal against catalog capabilities and returns a validated `ResolvedCapsulePlan` with selected capsule provider ids, provider config, compatibility decisions, evidence requirements, and stable diagnostics. | It does not create providers, repeat app boot selection, or mutate the registry/catalog. |

The app composition root wires these entities together. Runtime composition has no supported provider-set/profile
compatibility adapter: old ProviderSet/Profile nouns appear only below as archived migration history or as names of
historical packages/files, not as supported app inputs.

## 2. Eliminated Or Narrowed Entities

| Current entity / seam | Target disposition | Replacement |
|---|---|---|
| `AppProviderSet` as central runtime input | **Eliminate as an architecture entity.** A distribution package may still provide boot helpers during migration, but runtime composition must not discover providers, defaults, services, assets, and probes through one broad object. | Provider package registration functions, `AppDeploymentConfig`, template packages, and catalog projection inputs. |
| `ProviderSelectionProfile` | **Split.** The current flat all-family selection shape mixes app infrastructure and capsule composition. | `AppDeploymentConfig` for `AuthProvider` / `ChannelAdapter` / `SecretStore`; `CapsuleTemplate` defaults plus `AssemblySpec` overrides for capsule families. |
| `ProviderProfileManifest` / broad profile overlays | **Eliminate from supported app/runtime selection.** Broad all-family manifests are not accepted as the runtime selection model. | `AppDeploymentConfig` for app boot selections, template package defaults for capsule selections, and catalog-internal projection inputs where still needed. |
| `templateWithProviderProfile()` | **Delete.** It mutates `browser-handoff` from a broad profile. | Template package descriptors where `CapsuleTemplate` owns fixed/default/open capsule parts directly. |
| Provider-set callbacks: `defaultConfig`, `defaultServices`, `entrypointClientAssets`, `templateProbes` | **Delete from runtime composition seams.** They are not target runtime composition seams. | Provider factory config from registry/deployment/template config, app/test service resolver seams, provider asset descriptors in registry/catalog, and provider/template probes. |
| `ProviderHost` as a public architecture noun | **Narrow to an internal factory runner or replace with `ProviderRegistry`.** Existing factory mechanics may be reused internally, but callers should depend on registry/deployment/plan concepts. | `ProviderRegistry` as the executable provider boundary; typed factory creation through resolved deployment config or resolved capsule plan. |
| `ProviderRuntime` / similar generic runtime nouns | **Avoid unless they name a real interface.** They obscure whether the responsibility is registration, selection, projection, admission, or factory execution. | The five target entities above. |

ProviderHost as a public architecture noun is therefore retired even if existing implementation mechanics survive behind
the registry internally.

## 2.1. Archived Migration Boundary

GLA-110.14 closes the temporary compatibility boundary. `packages/app/src/provider-compat.ts` is deleted, app runtime
APIs no longer accept legacy provider-set/profile runtime inputs, and provider-set callback seams are not supported
composition inputs. The table below is retained as archived migration evidence only.

| Legacy surface | Final state | Evidence |
|---|---|---|
| `AppProviderSet.modules` | No allowed runtime owner or caller. Distribution entrypoints register provider modules into a sealed `ProviderRegistry`. | `packages/app/src/provider-compat.ts` is absent; boundary checks reject `AppProviderSet` and direct `providerSet.modules` reads in protected runtime packages. |
| `ProviderSelectionProfile` and broad `ProviderProfileManifest` conversion | No supported app/runtime input. Reference defaults are expanded through `referencePresetId` wrappers or explicit `AppDeploymentConfig` plus capsule selections. | CLI help and public app exports omit `--provider-profile`, `providerProfileId`, `providerProfile`, and broad profile aliases. |
| `defaultConfig` / `defaultServices` callbacks | No runtime callback seam. Config is explicit by provider id in deployment config, capsule config, template defaults, and provider schemas; non-provider services are explicit test/app seams. | Runtime source and boundary tests reject provider-set callback reads. |
| `entrypointClientAssets` / `templateProbes` callbacks | No provider-set callback seam. Assets and probes are explicit registry/catalog inputs with provenance and mutability diagnostics. | Gateway/catalog tests cover packaged, evidence-backed, local override, missing, mutable, and unverifiable asset sources. |

Boundary tests must fail if app runtime source reads those legacy members or reintroduces the removed compatibility
adapter. The default reference app path uses `ProviderRegistry`, app deployment defaults, capsule defaults, explicit
entrypoint assets, and explicit template probes.

## 3. Provider Family Assignment

Every provider family belongs to exactly one selection surface.

| Provider family | Target selection surface | Rationale |
|---|---|---|
| `AuthProvider` | `AppDeploymentConfig` | The gateway and enrollment paths need one deployment auth policy/provider. A session AssemblySpec must not change recipient proof. |
| `ChannelAdapter` | `AppDeploymentConfig` | The deployment chooses how GLA receives/sends messages for the operator's install. Runtime capsule choice should not change channel secrets or transport. |
| `SecretStore` | `AppDeploymentConfig` | Secret storage is app infrastructure and audit/security posture, not a capsule runtime part. |
| `Launcher` | `CapsuleTemplate` default/fixed/open part plus `AssemblySpec` override when open | Launching is part of the capsule's runtime substrate. |
| `Workspace` | `CapsuleTemplate` default/fixed/open part plus `AssemblySpec` override when open | Workspace realization is capsule state and mount behavior. |
| `HumanEntrypoint` | `CapsuleTemplate` default/fixed/open part plus `AssemblySpec` override when open | The user-facing surface belongs to the capsule. Gateway authorization remains separate. |
| `AgentConnector` | `CapsuleTemplate` default/fixed/open part plus `AssemblySpec` override when open | The agent handle belongs to the capsule and must follow agent-blind lifecycle rules. |
| `CompletionDetector` | `CapsuleTemplate` default/fixed/open part plus `AssemblySpec` override when open | Detection is mechanical capsule behavior validated by the Completion service. |

## 4. Migration Map

| Surface | Current responsibility drift | Required GLA-110 migration / verification |
|---|---|---|
| `packages/app/src/composition.ts` | Historical drift mixed registration, app selection, capsule selection, catalog projection, and factory execution through broad profile/provider-set paths. | Runtime composition accepts separate deployment and capsule-plan inputs; boot creates app infrastructure from deployment config; provisioning consumes a resolved capsule plan; broad profile/provider-set paths are removed. |
| `packages/app/src/index.ts` | Historical public exports exposed broad provider-layer concepts as caller-facing inputs. | Public reference wrappers expand `referencePresetId` into registry/bootstrap helpers, `AppDeploymentConfig` defaults, template defaults, explicit assets, and explicit probes; legacy provider-set/profile exports are absent. |
| `packages/app/src/daemon.ts` | Historical daemon options parsed provider-profile and auth-provider paths separately. | Enrollment policy and delegated auth diagnostics use the selected deployment `AuthProvider`; `--provider-profile` and profile env parsing are absent. |
| `packages/catalog/src/index.ts` | Provider graph projection consumes `providerSet`, broad profiles, template packages, dependency bindings, probes, and admission projection in one path. | Rebuild projection from `ProviderRegistry`, template packages, `AppDeploymentConfig`, WPM evidence, and probes; fail closed on duplicates, unknown compatibility relation keys, ambiguous defaults, and missing/evidence-gated providers. |
| `packages/catalog/src/provider-profile.ts` | Historical broad manifests model all provider families as one selection surface. | Broad manifests are not supported app/runtime inputs. Any remaining catalog-level reader is internal or archived history and must not be advertised as the runtime model. |
| `packages/catalog/src/provider-authoring.ts` | Scaffold/validation can emit fields that do not affect graph resolution. | Generated provider/template packages must use consumed default-provider and compatibility fields; validation reports inert or unsupported fields. |
| `packages/provider-host/src/index.ts` | `ProviderHost` is the executable factory registry and is named by app/runtime code. | Either become the implementation behind `ProviderRegistry` or be narrowed to an internal compatibility runner. Public callers use registry/deployment/plan concepts. |
| `packages/provider-set-reference/src/index.ts` | Reference distribution historically mixed modules, broad profiles, template defaults, direct helper factories, service defaults, and asset resolution. | Export registry/bootstrap data, app deployment defaults, template package defaults, explicit probes, and client asset mounts separately. Reference scenarios keep externally observable defaults without broad runtime profile inputs. |
| `packages/kernel/src/assembly.ts` and `packages/assembly/src/index.ts` | Assembly currently needs stable capsule-part selection without app infrastructure leakage, while proposal/template resolution can still inherit provider-profile-era defaults. | Ensure serialized session proposal shapes can carry only capsule provider choices and provider config for template-open parts. Template resolution uses template-owned defaults instead of app profile mutation. |
| `surfaces/cli/src/cli.ts` and CLI/MCP surfaces | Runtime flags and docs can drift from implemented provider/profile commands. | Runtime consumption can list/inspect defaults and propose capsule overrides only through implemented CLI/API surfaces; authoring/install docs cannot name unavailable commands as executable. |
| `packages/gateway/src/index.ts` and entrypoint assets | Gateway serves provider client assets while local overrides can look like packaged provider evidence. | Asset provenance and mutability are visible in catalog/doctor output; gateway distinguishes packaged, evidence-backed, local override, writable, missing, and unverifiable roots. |
| `docs/` | Older docs used ProviderSet/Profile/Host as target nouns in places. | Target architecture language uses the five-entity model; old nouns are archived migration history or historical package/file names only; UX docs align with implemented commands/APIs. |
| Tests and quality gates | Existing tests can pass while broad profiles remain central. | Add boundary checks for retired central dependencies; add package-local and cross-layer tests for registry, deployment config, template/assembly defaults, catalog, admission, provisioning, CLI, gateway assets, and docs. |

## 5. Migration Guidance By Artifact

Existing provider-layer inputs migrate by responsibility, not by renaming old files.

| Existing artifact or field | Target owner | Migration rule |
|---|---|---|
| Current reference profile ids such as `local-dev`, `single-operator`, `scenario-01`, and `hardened-idp` | `AppDeploymentConfig` plus `TemplatePackage` defaults | Split each named scenario into app deployment defaults for `AuthProvider`, `ChannelAdapter`, and `SecretStore`, and capsule template defaults for `Launcher`, `Workspace`, `HumanEntrypoint`, `AgentConnector`, and `CompletionDetector`. Reference app wrappers may keep the scenario name as a preset label that expands to target inputs. |
| `--provider-profile` / `providerProfileId` / `providerProfile` | Removed runtime input | Use explicit `AppDeploymentConfig` plus capsule selections in generic APIs, or `referencePresetId` in the reference wrapper. The serve CLI no longer parses a provider-profile flag or env var. |
| Explicit `--auth-provider` and enrollment policy parsing | `AppDeploymentConfig` | Enrollment policy parsing and diagnostics use the deployment-selected `AuthProvider`; an explicit auth provider flag is an app deployment override, not a broad profile fallback. |
| `AppProviderSet.modules` | `ProviderRegistry` bootstrap | Distribution entrypoints register trusted provider modules into a sealed registry. Generic app composition receives a registry/host from outside and does not discover concrete modules through a broad set. |
| `defaultConfig(providerId)` | `AppDeploymentConfig`, `CapsuleTemplate` defaults, and provider schemas | Provider-owned config is keyed by provider id in the owning selection surface and validated against that provider's schema before factory creation. |
| `defaultServices()` | Explicit app/test service resolver seams | Non-provider services stay provider-neutral and explicit. They do not ride on a provider-set object. |
| `entrypointClientAssets()` | Provider capability descriptors plus runtime `clientAssetSources` evidence | Browser-client assets are projected through catalog/doctor with package, WPM-evidence, or local-override provenance and gateway mutability checks. |
| `templateProbes` | Explicit probe maps and provider/template probe descriptors | Probe names are declared by providers/templates and supplied by the composition boundary; missing probes project unavailable. |
| Template defaults keyed by plain template id | `TemplatePackage.spec.defaults["template.<id>"]` | Template-package defaults use the consumed `template.<template-id>` key and provider-family names. Unprefixed or inert defaults fail authoring validation. |
| Template compatibility using `openParts` or unsupported relation keys | `TemplatePackage.spec.compatibility.requiredParts` and provider `relations.compatibleWith` | Required compatibility is declared through consumed fields only. Unknown compatibility relation keys are diagnostics, not comments. |
| Provider authoring scaffold fields | Provider authoring APIs and validation | Scaffolded provider/template JSON must emit fields consumed by graph resolution: provider manifests, `clientAssets`, dependency requirements, `template.<id>` defaults, `compatibility.requiredParts`, docs, skills, and tests. |
| Install/update inventory preset labels | Operator audit label only | The active inventory owns `appDeployment`, `capsuleDefaults`, package wrappers, dependency bindings, and client asset evidence. A preset label is not the runtime selection model. |

## 6. Architecture Decision Note

**Decision.** Replace broad provider-set/profile layering with `ProviderRegistry`, `AppDeploymentConfig`,
`CapsuleTemplate`/`AssemblySpec`, `CapabilityCatalog`, and `Admission Resolver` as the target provider-layer model.

**Why.** The old shape made one physical bundle look like the owner of unrelated decisions: executable code
registration, deployment infrastructure selection, capsule defaults, catalog projection, and session admission. That
made provider extension hard to reason about, let docs drift toward non-executable commands, and made compatibility
bugs look like profile/default bugs. The split gives each decision one owner: registry for executable packages,
deployment config for daemon infrastructure, templates/specs for capsule composition, catalog for read-only evidence,
and admission for proposal-to-plan resolution.

**Consequences.** `AppProviderSet`, broad `ProviderProfileManifest`, `ProviderSelectionProfile`, and `ProviderHost`
remain only as archived migration history, historical package/file names, or internal implementation mechanics where
explicitly named. New docs, diagrams, CLI UX, and authoring/install/runtime guidance explain the five target entities
and do not advertise old runtime inputs.

**References.** The approved visual design is
`docs/architecture/provider-layer-refactor-as-is-to-be.html`; implementation ownership is tracked by `GLA-110.02`
through `GLA-110.14` below. `GLA-110.13` owns the cross-layer verification contract in
`docs/architecture/provider-layer-refactor-regression-matrix.md`, and `GLA-110.14` owns final legacy removal.

## 7. Task Ownership Map

| Task | Contract area |
|---|---|
| `GLA-110.02` | `ProviderRegistry` boot-time executable provider boundary. |
| `GLA-110.03` | `AppDeploymentConfig` and app infrastructure selection. |
| `GLA-110.04` | `CapsuleTemplate` / `TemplatePackage` defaults and `AssemblySpec` capsule overrides. |
| `GLA-110.05` | `CapabilityCatalog` projection from registry, templates, config, probes, and evidence. |
| `GLA-110.06` | `Admission Resolver` output and provisioning consumption of `ResolvedCapsulePlan`. |
| `GLA-110.07` | Removal or isolation of legacy ProviderSet/Profile/Host public composition surfaces. |
| `GLA-110.08` | Provider authoring UX against the refactored package contracts. |
| `GLA-110.09` | Operator install/update UX against deployment inventory and provider evidence. |
| `GLA-110.10` | Runtime consumption UX for catalog/default discovery and capsule-only overrides. |
| `GLA-110.11` | Provider client asset provenance and gateway/catalog diagnostics. |
| `GLA-110.12` | Documentation, diagrams, migration guidance, and this decision-note alignment. |
| `GLA-110.13` | Cross-layer regression matrix and clean-checkout-equivalent gate evidence. |
| `GLA-110.14` | Final removal of provider-set/profile compatibility adapters, runtime inputs, CLI flags, docs, and allowlists. |

## 8. Difference From The Approved Diagram

No functional difference is intended from `provider-layer-refactor-as-is-to-be.html`. The only implementation latitude is
that existing `ProviderHost` mechanics may remain as an internal factory runner behind `ProviderRegistry`. If a later
task reintroduces any old ProviderSet/Profile entity as more than archived history or an explicitly internal catalog
implementation detail, that task must record the deviation in backlog notes and update this contract before closure.
