# Provider Host and Layer Migration Architecture

> **Status:** historical migration addendum. `ProviderHost` remains an internal factory runner used by current
> implementation mechanics, but GLA-110 replaces it as a public target architecture noun with `ProviderRegistry`,
> `AppDeploymentConfig`, `CapsuleTemplate`/`AssemblySpec`, `CapabilityCatalog`, and `Admission Resolver`.
> Provider set/profile wording below describes the pre-refactor migration path or compatibility boundary, not the
> target model for new docs or APIs.
> **Scope:** record how the provider-extension model in `docs/02-provider-and-extension-model.md` first became
> concrete in code: generic app composition consumed a trusted provider set/profile at boot, Provider Host owned
> registered provider metadata and runtime creation, and the reference build was one explicit distribution
> entrypoint. This document does not create a public plugin ABI, dynamic hot-loading, marketplace resolution, or a new
> auth gateway.
> The graph/default-package direction for making this horizontally extensible is recorded in
> `docs/architecture/provider-graph-defaults-and-extension-plan.md`.

## How this was produced

The `bmad-create-architecture` workflow was loaded for this architecture request. Its first workflow step is
an interactive facilitator flow: it requires a PRD-style input confirmation and says not to proceed without
explicit user continuation. For this scoped addendum, the work therefore follows the established project
fallback: use the committed design set as the source of truth, name the blocker, and keep the output narrowly
grounded in the existing docs and code.

Inputs read for this note: `docs/01-architecture-overview.md`, `docs/02-provider-and-extension-model.md`,
`docs/03-software-candidates.md`, `docs/architecture/catalog-dependency-bindings.md`,
`docs/architecture/authentik-integration.md`, `docs/architecture/kernel-contracts.md`,
`docs/components/catalog.md`, `packages/kernel/src/ports.ts`, `packages/catalog/src/manifests.ts`,
`packages/worker/src/index.ts`, `packages/provider-host/src/index.ts`,
`packages/provider-set-reference/src/index.ts`, `packages/app/src/composition.ts`, and
`packages/app/src/index.ts`.

## 1. Problem statement

The design set already says providers extend GLA by inversion of control: a provider describes itself, registers
into a family registry, and the rest of the system discovers it by capability. That model is present in three
places today:

- `packages/kernel` defines provider-neutral ports for auth, launchers, workspaces, entrypoints, connectors,
  completion detectors, channels, secret stores, and catalog reads.
- `packages/catalog` carries manifest shapes, static provider manifests, dependency requirements, skills, and
  availability derived from WPM dependency bindings.
- `packages/worker` already has a `SpawnerRegistry` for launchers.

The missing piece was the runtime bridge between manifest and wiring: a generic **Provider Host** that turns
trusted installed provider modules into registered factories, catalog entries, probes, state namespaces, client
assets, diagnostics, and runtime ports.

Without that host, `packages/app` becomes the real extension API: it must import adapter packages, keep
provider-id-to-module lookup tables, and understand provider-specific config/state vocabulary. That was acceptable
for the first slice, but it violates the long-term rule: adding a provider should be adding a provider package and
selecting a provider set/profile, not editing the application composition engine or teaching core packages the
provider's vocabulary.

## 2. Layer inventory and migration target

| Layer from doc 03 | Provider family or seam | Current implementation signal | Migration target |
|---|---|---|---|
| Delivery / channel | `ChannelAdapter` | `ChannelPort` exists; `channel-cli` is wired directly by app | Channel providers register factories, probes, skills, and delivery diagnostics through the host. |
| Public edge | reverse-proxy dependency | `DependencyBinding` model exists; Access Gateway remains the auth PEP | Edge stays a dependency/route-transport binding, not an auth-provider plugin. Provider host exposes dependency and route-transport capabilities without replacing Access Gateway. |
| Identity / auth | `AuthProvider` | `AuthProviderPort` exists; app owns `AuthProviderKind`, `AuthentikConfig`, `BoundSubject`, `PendingAttempt` | Auth providers own config/state schemas and factories. App selects opaque provider ids and never imports provider-specific auth types. |
| Capsule runtime / isolation | `Launcher` | `LauncherPort` plus `SpawnerRegistry`; process launcher registered manually | Launcher providers register with the provider host, which then populates the spawner registry from catalog-selected providers. |
| Human entrypoint / surface | `HumanEntrypoint` | `HumanEntrypointPort` exists; noVNC and asset mounts wired manually | Entrypoint providers own client assets, binding shape, transport requirements, and probes behind generic host registration. |
| Agent connector | `AgentConnector` | `AgentConnectorPort` exists; CDP adapter wired manually | Connector providers own agent-facing DTO fields and resource mapping. Core only sees provider-neutral connector resources. |
| Workspace | `Workspace` | `WorkspacePort` exists; profile workspace wired manually | Workspace providers register lifecycle factories and state/cleanup contracts through the same host. |
| Completion detection | `CompletionDetector` | `CompletionDetectorPort` exists; URL detector wired manually | Detector providers own contract schemas, raw-signal mapping, and watch factories. Completion service stays provider-neutral. |
| Browser in capsule | `CapsuleTemplate` plus dependency metadata | Static template manifests list parts and compatibility | Templates stay declarative catalog entities. They consume provider-host availability and compatibility, but they are not long-lived runtime factories by themselves. |
| Secret handling | `SecretStore` | Kernel port exists; provider family is in docs 02 but not yet first-class in catalog manifests | Secret-store providers must use the same host before real stores are introduced, with stricter redaction and secret-ref-only config rules. |
| Policy engine | internal `PolicyPort` adapter | Cedar is in-tree and explicitly not an operator-swappable layer | Do not migrate to the provider-host pattern now. Swapping policy engines is an internal code substitution, not an operator provider. |

The first migrations should be auth, then the capsule runtime families, then channel and secret-store. Public edge
uses the same manifest/dependency evidence vocabulary, but it must not become a second access gateway or a second
auth decision point.

## 3. Internal ProviderHost contract

The ProviderHost is an internal, trusted install-time mechanism behind the target `ProviderRegistry`. Providers are
code the operator chose to install. The runtime agent can read and consume registry/catalog projections; it cannot
register providers.

```ts
export type ProviderId = string;

export interface GlaProviderModule {
  readonly moduleId?: string;
  readonly manifest: ProviderManifest;
  register(ctx: ProviderRegistrationContext): void;
}

export interface ProviderDescriptor {
  readonly providerId: ProviderId;
  readonly moduleId: string;
  readonly manifest: ProviderManifest;
  readonly stateSchema?: ProviderStateSchema;
}

export interface ProviderRegistrationContext {
  registerAuthProvider(id: ProviderId, factory: ProviderFactory<AuthProviderPort>): void;
  registerLauncher(id: ProviderId, factory: ProviderFactory<LauncherPort>): void;
  registerHumanEntrypoint(id: ProviderId, factory: ProviderFactory<HumanEntrypointPort>): void;
  registerAgentConnector(id: ProviderId, factory: ProviderFactory<AgentConnectorPort>): void;
  registerWorkspace(id: ProviderId, factory: ProviderFactory<WorkspacePort>): void;
  registerCompletionDetector(id: ProviderId, factory: ProviderFactory<CompletionDetectorPort>): void;
  registerChannel(id: ProviderId, factory: ProviderFactory<ChannelPort>): void;
  registerSecretStore(id: ProviderId, factory: ProviderFactory<SecretStorePort>): void;
  registerProbe(id: ProviderId, probe: ProviderProbe): void;
  registerStateSchema(id: ProviderId, schema: ProviderStateSchema): void;
}

export interface ProviderFactory<TPort> {
  create(ctx: ProviderCreateContext): Promise<TPort> | TPort;
}

export interface ProviderCreateContext {
  readonly providerId: ProviderId;
  readonly config: unknown;
  readonly dependencies: ProviderDependencyView;
  readonly state: ProviderStateNamespace;
  readonly secrets: ProviderSecretResolver;
  readonly diagnostics: ProviderDiagnostics;
}
```

The TypeScript names may continue to refine, but the contract boundaries are not open:

- Provider modules own provider-specific config schemas, state schemas, probes, client assets, dependency
  requirements, compatibility relations, and factory construction.
- The Provider Host owns validation, duplicate registration checks, dependency availability checks, redaction,
  diagnostics, state namespace allocation, provider descriptors, and creating runtime ports.
- Generic app composition owns process bootstrapping, daemon state root, public bind configuration, and consuming
  selected provider ids, but not provider-specific adapter construction, provider-id-to-module lookup tables, or
  reference-provider defaults.
- Core, gateway, session, identity, route, completion, and worker packages continue to depend on kernel ports and
  provider-neutral descriptors only.

## 4. Historical Composition Model

This section records the compatibility model that GLA-110 is retiring. New target architecture should describe the
same responsibilities through `ProviderRegistry`, `AppDeploymentConfig`, `CapsuleTemplate`/`AssemblySpec`,
`CapabilityCatalog`, and `Admission Resolver`.

Provider modules are loaded from a trusted **provider set** selected at build/install time. A provider set is the
operator/distribution-owned bundle of provider modules plus a selected profile:

```ts
export interface AppProviderSet {
  moduleId: string;
  modules: readonly GlaProviderModule[];
  profiles?: readonly ProviderProfileManifest[];
  selectedProfileId?: string;
  profile: ProviderSelectionProfile;
  defaultConfig?(args: ProviderDefaultConfigArgs): Record<string, unknown> | undefined;
  defaultServices?(args: ProviderDefaultServicesArgs): Record<string, unknown> | undefined;
  entrypointClientAssets?(host: ProviderHost, providerIds: readonly ProviderId[]): EntrypointClientAssetMount[];
}
```

`packages/app/src/composition.ts` is the provider-set-agnostic composition engine. It accepts an
`AppProviderSet` or a prebuilt `ProviderHost` plus full selected profile, registers modules into Provider Host,
derives catalog content from `host.providerManifests()`, and derives wiring/read-model module identities from
`host.providerDescriptor(id).moduleId`.

`packages/app/src/index.ts` is the explicit reference/default distribution entrypoint. It imports
`@gla/provider-set-reference`, exposes its named provider-profile manifests (`local-dev`, `single-operator`,
`scenario-01`, and `hardened-idp`), selects `scenario-01` by default, and supplies reference-only default
config/service/asset mappings. This is the only generic-runtime source path allowed to select the reference set
directly; the boundary scanner rejects reference-set imports from `composition.ts` and the narrow-waist packages.

That is intentionally not dynamic hot-loading. The first goal is to remove provider-specific knowledge from app and
runtime core while preserving a simple, testable modular monolith. Public ABI, third-party package loading, and
marketplace/version solving remain deferred until there are multiple real providers per family.

Startup flow:

1. Select a trusted provider set/profile at distribution or install boot.
2. Register each provider module into the Provider Host.
3. Read provider descriptors and manifests from Provider Host; app-local lookup tables are not an authority.
4. Ingest provider manifests into the Catalog and derive availability from WPM dependency bindings plus current
   probes.
5. Normalize operator/env/WPM compatibility inputs into provider-owned config/service maps through the selected
   provider set.
6. Create selected runtime ports from provider factories only after config, dependency, probe, and state checks pass.
7. Populate family registries such as the worker `SpawnerRegistry`.
8. Expose catalog, schema, skill, doctor, and diagnostics views from the same provider-host state.

This differs from ordinary dependency injection. DI can pass an already-built object graph to app code, but it does
not by itself define provider manifests, selected profiles, catalog projections, dependency evidence, probes,
state namespaces, redaction, compatibility, or fail-closed runtime creation. Provider Host is the architectural
layer that joins those concerns. DI remains an implementation technique inside this layer; it is not the extension
contract.

## 5. State, secrets, and diagnostics

Provider-specific state must not leak into app-level types. A provider receives an opaque namespace scoped by
provider id and schema. For example, authentik may store subject bindings and pending OIDC attempts, but app should
see only "auth provider state for provider `authentik`", not `BoundSubject` or `PendingAttempt`.

Security constraints:

- Secret-bearing provider config is represented as `secret-ref` or secret resolver input, never literal catalog or
  diagnostic output.
- Provider diagnostics are typed and redacted at the host boundary.
- Missing config, invalid config, unknown provider id, duplicate registration, unavailable dependency evidence, and
  failed probes produce stable machine-readable diagnostics.
- Ambiguous provider evidence must fail closed or degrade to the lowest safe assurance at the adapter boundary; the
  gateway must not learn provider-specific evidence names.

Channel adapters and SecretStore providers share the same registration path, but they do not have the same trust
surface:

- A **channel adapter** is a delivery provider. It may need non-secret operator config, external dependency receipts,
  and runtime services such as `IdentityPort` or a local delivery sink. It must preserve recipient binding and never
  widen delivery beyond the bound recipient. Secrets used by real channels, such as bot tokens, are supplied as
  secret refs or resolver inputs, not catalog literals.
- A **SecretStore provider** is a secret-bearing provider. Its public outputs are opaque `secret:` refs and redacted
  diagnostics only. Its state schema is sensitive by default because provider-owned slots may map refs to raw
  agent-blind values. Catalog entries may describe config/state/probe capabilities, but they must not expose raw
  stored values, bootstrap secrets, or resolved dependency secrets.

To add a new channel or SecretStore provider, a developer adds a provider module to the selected provider set. The
module supplies a manifest, config schema, probe, optional state schema, skills/docs, and a factory registered with
`registerChannel` or `registerSecretStore`. `packages/app` selects only the provider id and provider-owned config;
kernel, gateway, session, identity, capability, bridge, and worker core packages must not be edited for a new
provider in either family.

## 6. Non-goals

- No public plugin ABI in this migration.
- No dynamic code loading from untrusted runtime inputs.
- No runtime-agent provider registration.
- No second auth gateway in front of GLA's Access Gateway.
- No migration of Cedar/policy into an operator-facing provider family.
- No requirement that every family be migrated in one task.

## 7. Migration order

1. **Provider Host foundation.** Establish generic provider module registration, config/state schemas, probes,
   diagnostics, fake-provider contract tests, and the reference provider set.
2. **AuthProvider migration.** Move WebAuthn and authentik behind provider-host registration. Remove authentik
   config/state/type imports from app. Keep gateway and identity provider-neutral.
3. **Capsule runtime migration.** Move launcher, workspace, human entrypoint, agent connector, and completion
   detector wiring behind the host. Preserve the provider-neutral resource descriptors from GLA-088.
4. **Channel and SecretStore migration.** Make channel adapters host-registered and introduce secret-store provider
   registration before real external secret stores are added. The reference provider set carries `channel-cli` as
   the default `channel` provider and a minimal in-tree `secret-store-reference` provider; both are selected by
   provider id through Provider Host rather than by app-owned adapter construction.
5. **Public-edge and template alignment.** Keep edge as dependency/transport binding and templates as declarative
   catalog composition. The catalog read model derives open-part compatibility from registered provider manifests'
   compatibility relations and selected template defaults, derives template availability from required providers plus
   template-level dependencies such as `edge-proxy`, and hands Admission stable diagnostics before any
   task/session/route/capsule is created.
   Caddy/nginx/Traefik remain exposure/transport dependencies; they never replace Access Gateway grant,
   recipient, revocation, or assurance checks.
6. **Boundary hardening.** Add import-boundary and fake-provider tests so new providers can be added without app,
   gateway, session, identity, worker-core, or kernel edits.

## 8. Acceptance signals for the migration

The architecture is in place when these are true:

- `packages/app` has no provider-specific type imports such as authentik subject/attempt types or noVNC/CDP adapter
  types. It deals in provider ids, provider-host diagnostics, and kernel ports.
- A fake provider in each migrated family can be registered, selected, probed, surfaced in catalog/schema/skills, and
  used by the relevant runtime path without changing narrow-waist packages.
- WPM dependency bindings and current probes remain the only way host-touching providers become available.
- The Access Gateway authorizes from grants, recipient facts, provider-neutral assurance, and route bindings only.
- Provider packages carry manifest, code, docs/skills, probes, and contract tests together.

## Related

`docs/01-architecture-overview.md` (narrow waist, WPM boundary) · `docs/02-provider-and-extension-model.md`
(inversion of control and provider contract) · `docs/03-software-candidates.md` (layer inventory) ·
`docs/architecture/catalog-dependency-bindings.md` (WPM receipt evidence) ·
`docs/architecture/authentik-integration.md` (current auth adapter realization) ·
`docs/architecture/kernel-contracts.md` (ports and narrow-waist contracts) ·
`docs/architecture/provider-graph-defaults-and-extension-plan.md` (default-provider graph and extension plan) ·
`docs/architecture/provider-author-workflow.md` (concrete provider contribution and boundary rules).
