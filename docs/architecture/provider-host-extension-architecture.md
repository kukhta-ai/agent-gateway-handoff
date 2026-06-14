# Provider Host and Layer Migration Architecture

> **Status:** architecture addendum and migration backlog seed. **Scope:** close the gap between the
> provider-extension model in `docs/02-provider-and-extension-model.md` and the current implementation, where
> `packages/app` still wires concrete providers by importing individual adapter packages and provider-specific
> config/state types. This document does not create a public plugin ABI, dynamic hot-loading, marketplace
> resolution, or a new auth gateway. It defines the internal provider-host shape needed before those heavier
> mechanisms would be justified.

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
`packages/worker/src/index.ts`, and `packages/app/src/index.ts`.

## 1. Problem statement

The design set already says providers extend GLA by inversion of control: a provider describes itself, registers
into a family registry, and the rest of the system discovers it by capability. That model is present in three
places today:

- `packages/kernel` defines provider-neutral ports for auth, launchers, workspaces, entrypoints, connectors,
  completion detectors, channels, secret stores, and catalog reads.
- `packages/catalog` carries manifest shapes, static provider manifests, dependency requirements, skills, and
  availability derived from WPM dependency bindings.
- `packages/worker` already has a `SpawnerRegistry` for launchers.

The missing piece is the runtime bridge between manifest and wiring: a generic **Provider Host** that turns
trusted installed provider modules into registered factories, catalog entries, probes, state namespaces, client
assets, diagnostics, and runtime ports.

Without that host, `packages/app` becomes the real extension API. It imports `@gla/auth-authentik`,
`@gla/entrypoint-novnc`, `@gla/connector-cdp`, `@gla/launcher-process`, `@gla/channel-cli`, and their
provider-specific types directly. That is acceptable for the first slice, but it violates the long-term rule:
adding a provider should be adding a provider package, not editing the application composition root or teaching
it the provider's vocabulary.

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

## 3. Provider Host contract

The Provider Host is an internal, trusted install-time mechanism. Providers are code the operator chose to
install. The runtime agent can read and consume the resulting registry; it cannot register providers.

```ts
export type ProviderId = string;

export interface GlaProviderModule {
  readonly manifest: ProviderManifest;
  register(ctx: ProviderRegistrationContext): void;
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
  registerClientAssets?(id: ProviderId, assets: ProviderClientAssets): void;
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

The exact TypeScript names are open to implementation refinement. The contract boundaries are not:

- Provider modules own provider-specific config schemas, state schemas, probes, client assets, dependency
  requirements, compatibility relations, and factory construction.
- The Provider Host owns validation, duplicate registration checks, dependency availability checks, redaction,
  diagnostics, state namespace allocation, and creating the runtime registry views.
- `packages/app` owns process bootstrapping, daemon state root, public bind configuration, and selection of
  provider ids, but not provider-specific adapter construction.
- Core, gateway, session, identity, route, completion, and worker packages continue to depend on kernel ports and
  provider-neutral descriptors only.

## 4. Composition model

Provider modules are loaded from a trusted **provider set** selected at build/install time. Initially this can be a
static in-repo distribution package such as `@gla/provider-set-reference` that imports WebAuthn, authentik,
process launcher, noVNC, CDP, profile workspace, URL detector, and CLI channel modules. `packages/app` imports the
provider set as one opaque list, then gives that list to the Provider Host.

That is intentionally not dynamic hot-loading. The first goal is to remove provider-specific knowledge from app and
runtime core while preserving a simple, testable modular monolith. Public ABI, third-party package loading, and
marketplace/version solving remain deferred until there are multiple real providers per family.

Startup flow:

1. Load trusted provider modules from the selected provider set.
2. Register each module into the Provider Host.
3. Ingest provider manifests into the Catalog and derive availability from WPM dependency bindings plus current
   probes.
4. Normalize operator/env/WPM configuration into provider config keyed by provider id.
5. Create selected runtime ports from provider factories only after config and dependency checks pass.
6. Populate family registries such as the worker `SpawnerRegistry`.
7. Expose catalog, schema, skill, doctor, and diagnostics views from the same provider-host state.

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
   registration before real external secret stores are added.
5. **Public-edge and template alignment.** Keep edge as dependency/transport binding and templates as declarative
   catalog composition, but ensure both derive compatibility and availability from provider-host state rather than
   duplicate static tables.
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
`docs/architecture/kernel-contracts.md` (ports and narrow-waist contracts).
