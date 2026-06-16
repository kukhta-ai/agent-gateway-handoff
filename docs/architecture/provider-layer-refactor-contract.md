# Provider Layer Refactor Contract

> **Status:** GLA-110.01 implementation contract. This document makes the approved
> `provider-layer-refactor-as-is-to-be.html` diagram executable for the remaining GLA-110 tasks. It reconciles the
> current ProviderSet/Profile/Host implementation with the target model: one provider-layer entity per responsibility.

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

The app composition root wires these entities together. It can keep thin compatibility adapters while GLA-110 is in
flight, but the target architecture must be understandable without `AppProviderSet`, broad profiles, or `ProviderHost`
as public nouns.

## 2. Eliminated Or Narrowed Entities

| Current entity / seam | Target disposition | Replacement |
|---|---|---|
| `AppProviderSet` as central runtime input | **Eliminate as an architecture entity.** A distribution package may still provide boot helpers during migration, but runtime composition must not discover providers, defaults, services, assets, and probes through one broad object. | Provider package registration functions, `AppDeploymentConfig`, template packages, and catalog projection inputs. |
| `ProviderSelectionProfile` | **Split.** The current flat all-family selection shape mixes app infrastructure and capsule composition. | `AppDeploymentConfig` for `AuthProvider` / `ChannelAdapter` / `SecretStore`; `CapsuleTemplate` defaults plus `AssemblySpec` overrides for capsule families. |
| `ProviderProfileManifest` / broad profile overlays | **Narrow and migrate.** Broad all-family manifests stop being the primary runtime selection format. | `AppDeploymentConfigManifest` for app boot selections, template package defaults for capsule selections, and compatibility-only migration readers while old manifests are accepted. |
| `templateWithProviderProfile()` | **Delete after migration.** It mutates `browser-handoff` from a broad profile. | Template package descriptors where `CapsuleTemplate` owns fixed/default/open capsule parts directly. |
| Provider-set callbacks: `defaultConfig`, `defaultServices`, `entrypointClientAssets`, `templateProbes` | **Move or isolate.** They are not target runtime composition seams. | Provider factory config from registry/deployment/template config, app/test service resolver seams, provider asset descriptors in registry/catalog, and provider/template probes. |
| `ProviderHost` as a public architecture noun | **Narrow to an internal factory runner or replace with `ProviderRegistry`.** Existing factory mechanics may be reused internally, but callers should depend on registry/deployment/plan concepts. | `ProviderRegistry` as the executable provider boundary; typed factory creation through resolved deployment config or resolved capsule plan. |
| `ProviderRuntime` / similar generic runtime nouns | **Avoid unless they name a real interface.** They obscure whether the responsibility is registration, selection, projection, admission, or factory execution. | The five target entities above. |

ProviderHost as a public architecture noun is therefore retired even if existing implementation mechanics survive behind
the registry during migration.

## 2.1. Compatibility Boundary

`packages/app/src/provider-compat.ts` is the only app-owned compatibility adapter for legacy provider-set/profile
runtime inputs during GLA-110 migration.

| Legacy surface | Compatibility owner | Allowed callers | Removal condition |
|---|---|---|---|
| `AppProviderSet.modules` | `packages/app/src/provider-compat.ts` | App composition may call `legacyProviderSetRegistry()` only to turn an explicitly supplied legacy set into a sealed `ProviderRegistry`. | Removed after distribution entrypoints, tests, and install/update UX no longer accept `providerSet`. |
| `ProviderSelectionProfile` and broad `ProviderProfileManifest` conversion | `packages/app/src/provider-compat.ts` plus catalog validation for manifest parsing | App composition may consume the converted shape only to preserve old `providerProfileId` / `providerProfile` inputs. | Removed after app deployment config manifests and template packages replace broad profile inputs in CLI/API docs. |
| `defaultConfig` / `defaultServices` callbacks | `packages/app/src/provider-compat.ts` | Runtime composition may invoke these only through `legacyProviderSetDefaultConfig()` and `legacyProviderSetDefaultServices()`. | Removed after provider factory config and test service seams are explicit non-provider inputs. |
| `entrypointClientAssets` / `templateProbes` callbacks | `packages/app/src/provider-compat.ts` | Runtime composition may merge these only through `legacyProviderSetEntrypointClientAssets()` and `legacyProviderSetTemplateProbes()`. | Removed after registry/catalog asset descriptors and explicit probe maps cover all reference and extension packages. |

Boundary tests must fail if `packages/app/src/composition.ts` or default distribution code reads those legacy members
directly again. `packages/app/src/index.ts` may continue to export `referenceProviderSet` only as a deprecated migration
object; the default reference app path must use `ProviderRegistry`, app deployment defaults, capsule defaults, explicit
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
| `packages/app/src/composition.ts` | `ProviderSelectionProfile`, `AppProviderSet`, `requireSelectedProfile()`, `templateWithProviderProfile()`, graph context construction, and `createProvisioningBridge()` mix registration, app selection, capsule selection, catalog projection, and factory execution. | Introduce separate deployment and capsule-plan inputs; preserve named reference defaults; make boot create app infrastructure from deployment config; make provisioning consume a resolved capsule plan; remove or isolate broad profile/provider-set paths. |
| `packages/app/src/index.ts` | Public app exports still expose `ProviderSelectionProfile`, `AppProviderSet`, `referenceProviderProfile`, and `referenceProviderSet` as caller-facing provider-layer concepts. | Replace public exports with registry/bootstrap helpers, `AppDeploymentConfig` defaults, template package defaults, and compatibility exports whose names and docs mark them as legacy. |
| `packages/app/src/daemon.ts` | Daemon options still parse provider-profile and legacy auth-provider paths separately. | Resolve enrollment policy and delegated auth diagnostics from `AppDeploymentConfig`, including deployment-config-selected delegated providers without the old `--auth-provider` fallback. |
| `packages/catalog/src/index.ts` | Provider graph projection consumes `providerSet`, broad profiles, template packages, dependency bindings, probes, and admission projection in one path. | Rebuild projection from `ProviderRegistry`, template packages, `AppDeploymentConfig`, WPM evidence, and probes; fail closed on duplicates, unknown compatibility relation keys, ambiguous defaults, and missing/evidence-gated providers. |
| `packages/catalog/src/provider-profile.ts` | `ProviderProfileManifest` models all provider families as one selection surface. | Split or narrow the manifest contract so app-infrastructure families and capsule families cannot be selected through one primary runtime shape. Keep migration readers explicit. |
| `packages/catalog/src/provider-authoring.ts` | Scaffold/validation can emit fields that do not affect graph resolution. | Generated provider/template packages must use consumed default-provider and compatibility fields; validation reports inert or unsupported fields. |
| `packages/provider-host/src/index.ts` | `ProviderHost` is the executable factory registry and is named by app/runtime code. | Either become the implementation behind `ProviderRegistry` or be narrowed to an internal compatibility runner. Public callers use registry/deployment/plan concepts. |
| `packages/provider-set-reference/src/index.ts` | Reference distribution mixes modules, broad profiles, template defaults, direct helper factories, service defaults, and asset resolution. | Export registry/bootstrap data, app deployment defaults, template package defaults, and migration helpers separately. Reference scenarios must keep externally observable defaults. |
| `packages/kernel/src/assembly.ts` and `packages/assembly/src/index.ts` | Assembly currently needs stable capsule-part selection without app infrastructure leakage, while proposal/template resolution can still inherit provider-profile-era defaults. | Ensure serialized session proposal shapes can carry only capsule provider choices and provider config for template-open parts. Template resolution uses template-owned defaults instead of app profile mutation. |
| `surfaces/cli/src/cli.ts` and CLI/MCP surfaces | Runtime flags and docs can drift from implemented provider/profile commands. | Runtime consumption can list/inspect defaults and propose capsule overrides only through implemented CLI/API surfaces; authoring/install docs cannot name unavailable commands as executable. |
| `packages/gateway/src/index.ts` and entrypoint assets | Gateway serves provider client assets while local overrides can look like packaged provider evidence. | Asset provenance and mutability are visible in catalog/doctor output; gateway distinguishes packaged, evidence-backed, local override, writable, missing, and unverifiable roots. |
| `docs/` | Older docs still use ProviderSet/Profile/Host as target nouns in places. | Update target architecture language to the five-entity model; mark old nouns as compatibility/internal where retained; keep UX docs aligned with implemented commands/APIs. |
| Tests and quality gates | Existing tests can pass while broad profiles remain central. | Add boundary checks for retired central dependencies; add package-local and cross-layer tests for registry, deployment config, template/assembly defaults, catalog, admission, provisioning, CLI, gateway assets, and docs. |

## 5. Migration Guidance By Artifact

Existing provider-layer inputs migrate by responsibility, not by renaming old files.

| Existing artifact or field | Target owner | Migration rule |
|---|---|---|
| Current reference profile ids such as `local-dev`, `single-operator`, `scenario-01`, and `hardened-idp` | `AppDeploymentConfig` plus `TemplatePackage` defaults | Split each named scenario into app deployment defaults for `AuthProvider`, `ChannelAdapter`, and `SecretStore`, and capsule template defaults for `Launcher`, `Workspace`, `HumanEntrypoint`, `AgentConnector`, and `CompletionDetector`. Keep the scenario name only as a compatibility/default preset label. |
| `--provider-profile` / `providerProfileId` / `providerProfile` | Compatibility reader over app deployment and template defaults | Accept only as a migration input while emitting or resolving the split target shapes. Runtime session proposals must not use it to override deployment providers. |
| Legacy `--auth-provider` and enrollment policy fallback | `AppDeploymentConfig` | Enrollment policy parsing and diagnostics use the deployment-selected `AuthProvider`; the legacy flag is an override compatibility path, not a second source of truth. |
| `AppProviderSet.modules` | `ProviderRegistry` bootstrap | Distribution entrypoints register trusted provider modules into a sealed registry. Generic app composition receives a registry/host from outside and does not discover concrete modules through a broad set. |
| `defaultConfig(providerId)` | `AppDeploymentConfig`, `CapsuleTemplate` defaults, and provider schemas | Provider-owned config is keyed by provider id in the owning selection surface and validated against that provider's schema before factory creation. |
| `defaultServices()` | Explicit app/test service resolver seams | Non-provider services stay provider-neutral and explicit. They do not ride on a provider-set object. |
| `entrypointClientAssets()` | Provider capability descriptors plus runtime `clientAssetSources` evidence | Browser-client assets are projected through catalog/doctor with package, WPM-evidence, or local-override provenance and gateway mutability checks. |
| `templateProbes` | Explicit probe maps and provider/template probe descriptors | Probe names are declared by providers/templates and supplied by the composition boundary; missing probes project unavailable. |
| Template defaults keyed by plain template id | `TemplatePackage.spec.defaults["template.<id>"]` | Template-package defaults use the consumed `template.<template-id>` key and provider-family names. Unprefixed or inert defaults fail authoring validation. |
| Template compatibility using `openParts` or unsupported relation keys | `TemplatePackage.spec.compatibility.requiredParts` and provider `relations.compatibleWith` | Required compatibility is declared through consumed fields only. Unknown compatibility relation keys are diagnostics, not comments. |
| Provider authoring scaffold fields | Provider authoring APIs and validation | Scaffolded provider/template JSON must emit fields consumed by graph resolution: provider manifests, `clientAssets`, dependency requirements, `template.<id>` defaults, `compatibility.requiredParts`, docs, skills, and tests. |
| Install/update inventory `profileId` labels | Operator audit label only | The active inventory owns `appDeployment`, `capsuleDefaults`, package wrappers, dependency bindings, and client asset evidence. `profileId` is not the target runtime selection model. |

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
remain only as compatibility/internal implementation terms during migration. New docs, diagrams, CLI UX, and
authoring/install/runtime guidance must explain the five target entities first and link old terms to their removal or
compatibility owner.

**References.** The approved visual design is
`docs/architecture/provider-layer-refactor-as-is-to-be.html`; implementation ownership is tracked by `GLA-110.02`
through `GLA-110.13` below.

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

## 8. Difference From The Approved Diagram

No functional difference is intended from `provider-layer-refactor-as-is-to-be.html`. The only implementation latitude is
that existing `ProviderHost` mechanics may remain as an internal factory runner while callers migrate. If a later task
keeps any old entity as more than a compatibility/internal seam, that task must record the deviation in its backlog notes
and update this contract before closure.
