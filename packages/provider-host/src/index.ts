// @gla/provider-host — core-adjacent ring.
// Trusted install-time provider registration, runtime factory lookup, probe/dependency checks,
// provider-owned state namespaces, and redacted diagnostics. It depends only on kernel ports and
// catalog manifest/evidence types; concrete adapters are supplied by provider-set packages.

import type {
  DependencyRequirement,
  IndexedDependencyBinding,
  ProbeResult,
  ProviderManifest,
} from "@gla/catalog";
import {
  type AgentConnectorPort,
  type AuthProviderPort,
  type ChannelPort,
  type CompletionDetectorPort,
  type GlaError,
  type HumanEntrypointPort,
  type LauncherPort,
  type SecretStorePort,
  type WorkspacePort,
  configDefectsToError,
  glaError,
  redactOperatorEgress,
  validateConfig,
  validateSchemaShape,
} from "@gla/kernel";

/** Stable package-identity marker. */
export const PROVIDER_HOST_MODULE = "@gla/provider-host" as const;
/** Ring classification from the architecture baseline. */
export const PROVIDER_HOST_RING = "core-adjacent" as const;

/** Provider ids are operator-selected opaque strings, not app-local enums. */
export type ProviderId = string;

/** Runtime provider families backed by trusted code factories. */
export type RuntimeProviderFamily =
  | "auth"
  | "launcher"
  | "entrypoint"
  | "connector"
  | "workspace"
  | "detector"
  | "channel"
  | "secret-store";

/** Mapping from runtime provider family to the kernel port it creates. */
export interface ProviderPortByFamily {
  auth: AuthProviderPort;
  launcher: LauncherPort;
  entrypoint: HumanEntrypointPort;
  connector: AgentConnectorPort;
  workspace: WorkspacePort;
  detector: CompletionDetectorPort;
  channel: ChannelPort;
  "secret-store": SecretStorePort;
}

/** Machine-readable provider-host diagnostic codes. */
export type ProviderHostDiagnosticCode =
  | "provider.duplicate"
  | "provider.unknown"
  | "provider.unsupported_family"
  | "provider.family_mismatch"
  | "provider.config_invalid"
  | "provider.schema_invalid"
  | "provider.dependency_unavailable"
  | "provider.probe_missing"
  | "provider.probe_failed"
  | "provider.factory_missing"
  | "provider.service_missing"
  | "provider.async_unsupported";

/** A redacted, stable diagnostic suitable for operator and agent-facing surfaces. */
export interface ProviderHostDiagnostic {
  code: ProviderHostDiagnosticCode;
  message: string;
  providerId?: ProviderId;
  family?: string;
  detail?: Record<string, unknown>;
}

/** Provider-owned durable-state slot declarations. */
export interface ProviderStateSchema {
  slots: Record<string, { sensitive?: boolean; summary?: string }>;
}

/** Minimal key-value store shape exposed inside a provider-owned namespace. */
export interface ProviderKvStore<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
}

/** Opaque provider state namespace. App code names only provider id + slot, never provider-owned types. */
export interface ProviderStateNamespace {
  kv<T>(slot: string): ProviderKvStore<T>;
}

/** Root state backend used by the host to allocate one namespace per provider id. */
export interface ProviderStateRoot {
  namespace(providerId: ProviderId): ProviderStateNamespace;
}

/** Default in-memory provider state root used by tests and non-persistent host instances. */
export class InMemoryProviderStateRoot implements ProviderStateRoot {
  private readonly namespaces = new Map<ProviderId, InMemoryProviderStateNamespace>();

  /** Return the provider-owned namespace for the supplied provider id. */
  namespace(providerId: ProviderId): ProviderStateNamespace {
    let namespace = this.namespaces.get(providerId);
    if (namespace === undefined) {
      namespace = new InMemoryProviderStateNamespace(providerId);
      this.namespaces.set(providerId, namespace);
    }
    return namespace;
  }
}

class InMemoryProviderStateNamespace implements ProviderStateNamespace {
  private readonly slots = new Map<string, Map<string, unknown>>();
  readonly providerId: ProviderId;

  constructor(providerId: ProviderId) {
    this.providerId = providerId;
  }

  kv<T>(slot: string): ProviderKvStore<T> {
    let store = this.slots.get(slot);
    if (store === undefined) {
      store = new Map<string, unknown>();
      this.slots.set(slot, store);
    }
    return {
      get: (key) => store.get(key) as T | undefined,
      set: (key, value) => void store.set(key, value),
      delete: (key) => void store.delete(key),
    };
  }
}

/** Secret resolver surface for provider factories. Implementations decide where secret refs resolve. */
export interface ProviderSecretResolver {
  resolve(ref: string): Promise<unknown> | unknown;
}

const EMPTY_SECRET_RESOLVER: ProviderSecretResolver = {
  resolve(ref: string): never {
    throw glaError("auth.insufficient", `no secret resolver is available for "${ref}"`, {
      detail: { ref },
    });
  },
};

/** Service registry for non-provider dependencies a factory needs, such as IdentityPort for channels. */
export interface ProviderServiceRegistry {
  get<T>(name: string): T | undefined;
  require<T>(name: string): T;
}

class EmptyProviderServices implements ProviderServiceRegistry {
  get<T>(_name: string): T | undefined {
    return undefined;
  }

  require<T>(name: string): T {
    throw glaError(
      "dependency.unavailable",
      `required provider service "${name}" is not available`,
      {
        detail: {
          diagnostics: [
            {
              code: "provider.service_missing",
              message: `required provider service "${name}" is not available`,
              detail: { service: name },
            } satisfies ProviderHostDiagnostic,
          ],
        },
      },
    );
  }
}

/** Build a simple provider service registry from a record. */
export function providerServices(services: Record<string, unknown> = {}): ProviderServiceRegistry {
  return {
    get: <T>(name: string): T | undefined => services[name] as T | undefined,
    require: <T>(name: string): T => {
      const value = services[name] as T | undefined;
      if (value === undefined) {
        throw glaError(
          "dependency.unavailable",
          `required provider service "${name}" is not available`,
          {
            detail: {
              diagnostics: [
                {
                  code: "provider.service_missing",
                  message: `required provider service "${name}" is not available`,
                  detail: { service: name },
                } satisfies ProviderHostDiagnostic,
              ],
            },
          },
        );
      }
      return value;
    },
  };
}

/** Dependency view passed to provider factories after host-level availability checks. */
export interface ProviderDependencyView {
  readonly requirements: readonly DependencyRequirement[];
  bindingFor(dependency: string): IndexedDependencyBinding | undefined;
  diagnostics(): ProviderHostDiagnostic[];
}

/** Factory diagnostics sink. */
export interface ProviderDiagnostics {
  emit(diagnostic: ProviderHostDiagnostic): void;
}

/** Probe function registered by a provider module. */
export type ProviderProbe = (
  ctx: Pick<ProviderCreateContext, "providerId" | "dependencies" | "diagnostics">,
) => ProbeResult | Promise<ProbeResult>;

/** Factory function registered by a provider module. */
export interface ProviderFactory<TPort> {
  create(ctx: ProviderCreateContext): TPort | Promise<TPort>;
}

/** Context passed to a provider factory after config/dependency/probe checks pass. */
export interface ProviderCreateContext {
  readonly providerId: ProviderId;
  readonly config: Record<string, unknown>;
  readonly dependencies: ProviderDependencyView;
  readonly state: ProviderStateNamespace;
  readonly secrets: ProviderSecretResolver;
  readonly diagnostics: ProviderDiagnostics;
  readonly services: ProviderServiceRegistry;
}

/** A trusted installed provider module. */
export interface GlaProviderModule {
  readonly manifest: ProviderManifest;
  register(ctx: ProviderRegistrationContext): void;
}

/** Registration surface exposed only to trusted provider modules. */
export interface ProviderRegistrationContext {
  registerAuthProvider(id: ProviderId, factory: ProviderFactory<AuthProviderPort>): void;
  registerLauncher(id: ProviderId, factory: ProviderFactory<LauncherPort>): void;
  registerHumanEntrypoint(id: ProviderId, factory: ProviderFactory<HumanEntrypointPort>): void;
  registerAgentConnector(id: ProviderId, factory: ProviderFactory<AgentConnectorPort>): void;
  registerWorkspace(id: ProviderId, factory: ProviderFactory<WorkspacePort>): void;
  registerCompletionDetector(
    id: ProviderId,
    factory: ProviderFactory<CompletionDetectorPort>,
  ): void;
  registerChannel(id: ProviderId, factory: ProviderFactory<ChannelPort>): void;
  registerSecretStore(id: ProviderId, factory: ProviderFactory<SecretStorePort>): void;
  registerProbe(id: ProviderId, probe: ProviderProbe): void;
  registerStateSchema(id: ProviderId, schema: ProviderStateSchema): void;
}

/** Construction options for a Provider Host instance. */
export interface ProviderHostOptions {
  /** State backend used to allocate opaque provider-owned namespaces. */
  stateRoot?: ProviderStateRoot;
}

/** Per-provider creation inputs supplied by the app composition root after provider selection. */
export interface CreateProviderOptions {
  /** Provider-specific config value validated against the provider's registered schema. */
  config?: Record<string, unknown>;
  /** WPM/catalog dependency evidence keyed by dependency id or provided as an indexed list. */
  dependencyBindings?: IndexedDependencyBinding[] | Record<string, IndexedDependencyBinding>;
  /** Optional state backend override for this creation call. */
  stateRoot?: ProviderStateRoot;
  /** Secret resolver used by factories that consume secret refs. */
  secrets?: ProviderSecretResolver;
  /** Diagnostics sink; defaults to the host's redacted diagnostic log. */
  diagnostics?: ProviderDiagnostics;
  /** Non-provider services needed by factories, such as IdentityPort for channel providers. */
  services?: ProviderServiceRegistry;
}

const SUPPORTED_FAMILIES: ReadonlySet<string> = new Set<RuntimeProviderFamily>([
  "auth",
  "launcher",
  "entrypoint",
  "connector",
  "workspace",
  "detector",
  "channel",
  "secret-store",
]);

function factoryMap(): Map<RuntimeProviderFamily, Map<ProviderId, ProviderFactory<unknown>>> {
  return new Map(
    [...SUPPORTED_FAMILIES].map((family) => [
      family as RuntimeProviderFamily,
      new Map<ProviderId, ProviderFactory<unknown>>(),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown }).then === "function";
}

interface ProviderRegistrationStaging {
  factories: Map<RuntimeProviderFamily, Map<ProviderId, ProviderFactory<unknown>>>;
  probes: Map<ProviderId, ProviderProbe>;
  stateSchemas: Map<ProviderId, ProviderStateSchema>;
}

function registrationStaging(): ProviderRegistrationStaging {
  return {
    factories: factoryMap(),
    probes: new Map(),
    stateSchemas: new Map(),
  };
}

function redactDiagnostic(diagnostic: ProviderHostDiagnostic): ProviderHostDiagnostic {
  return redactOperatorEgress(diagnostic) as ProviderHostDiagnostic;
}

function redactingDiagnostics(sink: ProviderDiagnostics): ProviderDiagnostics {
  return {
    emit: (diagnostic) => sink.emit(redactDiagnostic(diagnostic)),
  };
}

function toGlaError(diagnostic: ProviderHostDiagnostic): GlaError {
  const code =
    diagnostic.code === "provider.duplicate" || diagnostic.code === "provider.family_mismatch"
      ? "state.conflict"
      : diagnostic.code === "provider.unknown" || diagnostic.code === "provider.unsupported_family"
        ? "catalog.unknown"
        : diagnostic.code === "provider.config_invalid" ||
            diagnostic.code === "provider.schema_invalid"
          ? "policy.denied"
          : "dependency.unavailable";
  return {
    code,
    message: diagnostic.message,
    detail: { diagnostics: [redactDiagnostic(diagnostic)] },
    skill: "interpret-gla-rejections",
    retryable: false,
  };
}

function throwDiagnostic(diagnostic: ProviderHostDiagnostic): never {
  const err = toGlaError(diagnostic);
  const opts: { detail?: Record<string, unknown>; skill?: string; retryable?: boolean } = {
    skill: err.skill,
    retryable: err.retryable,
  };
  if (err.detail !== undefined) {
    opts.detail = err.detail;
  }
  throw glaError(err.code, err.message, {
    ...opts,
  });
}

function dependencyBindingLookup(
  input: IndexedDependencyBinding[] | Record<string, IndexedDependencyBinding> | undefined,
): (dependency: string) => IndexedDependencyBinding | undefined {
  if (input === undefined) {
    return () => undefined;
  }
  if (Array.isArray(input)) {
    return (dependency) => input.find((binding) => binding.dependency === dependency);
  }
  return (dependency) => input[dependency];
}

function dependencyAvailable(binding: IndexedDependencyBinding | undefined): boolean {
  return (
    binding !== undefined &&
    binding.status === "bound" &&
    binding.diagnostics.install === "available" &&
    binding.diagnostics.runtime === "available"
  );
}

class StaticProviderDependencyView implements ProviderDependencyView {
  readonly requirements: readonly DependencyRequirement[];
  private readonly lookup: (dependency: string) => IndexedDependencyBinding | undefined;

  constructor(
    requirements: readonly DependencyRequirement[],
    bindings: IndexedDependencyBinding[] | Record<string, IndexedDependencyBinding> | undefined,
  ) {
    this.requirements = requirements;
    this.lookup = dependencyBindingLookup(bindings);
  }

  bindingFor(dependency: string): IndexedDependencyBinding | undefined {
    return this.lookup(dependency);
  }

  diagnostics(): ProviderHostDiagnostic[] {
    return this.requirements.flatMap((requirement) => {
      if (requirement.hostTouching !== true) {
        return [];
      }
      const binding = this.bindingFor(requirement.dependency);
      if (dependencyAvailable(binding)) {
        return [];
      }
      return [
        {
          code: "provider.dependency_unavailable",
          message: `dependency "${requirement.dependency}" is not available for provider`,
          detail: {
            dependency: requirement.dependency,
            status: binding?.status ?? "missing",
            diagnostics: binding?.diagnostics,
            missingEvidence: binding?.missingEvidence,
          },
        },
      ];
    });
  }
}

interface PreparedProviderCreate<TPort> {
  factory: ProviderFactory<TPort>;
  probe?: ProviderProbe;
  ctx: ProviderCreateContext;
}

/** Internal Provider Host for trusted installed provider modules. */
export class ProviderHost {
  private readonly manifests = new Map<ProviderId, ProviderManifest>();
  private readonly factories = factoryMap();
  private readonly probes = new Map<ProviderId, ProviderProbe>();
  private readonly stateSchemas = new Map<ProviderId, ProviderStateSchema>();
  private readonly diagnosticsLog: ProviderHostDiagnostic[] = [];
  private readonly stateRoot: ProviderStateRoot;

  constructor(opts: ProviderHostOptions = {}) {
    this.stateRoot = opts.stateRoot ?? new InMemoryProviderStateRoot();
  }

  /** Register one trusted provider module. */
  registerModule(module: GlaProviderModule): this {
    const providerId = module.manifest.metadata.name;
    const family = module.manifest.spec.family;
    if (this.manifests.has(providerId)) {
      this.fail({
        code: "provider.duplicate",
        providerId,
        family,
        message: `provider "${providerId}" is already registered`,
      });
    }
    if (!SUPPORTED_FAMILIES.has(family)) {
      this.fail({
        code: "provider.unsupported_family",
        providerId,
        family,
        message: `provider "${providerId}" declares unsupported runtime family "${family}"`,
      });
    }
    for (const schema of [
      module.manifest.spec.config_schema,
      module.manifest.spec.factory_config_schema,
    ]) {
      if (schema === undefined) {
        continue;
      }
      const shape = validateSchemaShape(schema);
      if (!shape.ok) {
        const diagnostic: ProviderHostDiagnostic = {
          code: "provider.schema_invalid",
          providerId,
          family,
          message: `provider "${providerId}" declares an invalid config schema`,
          detail: { defects: shape.defects },
        };
        this.fail(diagnostic);
      }
    }

    const staged = registrationStaging();
    module.register(this.registrationContext(providerId, family as RuntimeProviderFamily, staged));

    const familyFactories = staged.factories.get(family as RuntimeProviderFamily);
    if (familyFactories?.has(providerId) !== true) {
      this.fail({
        code: "provider.factory_missing",
        providerId,
        family,
        message: `provider "${providerId}" did not register a ${family} factory`,
      });
    }
    this.commitRegistration(staged);
    this.manifests.set(providerId, module.manifest);
    return this;
  }

  /** Register a batch of trusted provider modules. */
  registerModules(modules: readonly GlaProviderModule[]): this {
    for (const module of modules) {
      this.registerModule(module);
    }
    return this;
  }

  /** Registered provider manifests, in registration order. */
  providerManifests(): ProviderManifest[] {
    return [...this.manifests.values()].map((manifest) => structuredClone(manifest));
  }

  /** Return one registered provider manifest by id. */
  providerManifest(id: ProviderId): ProviderManifest | undefined {
    const manifest = this.manifests.get(id);
    return manifest === undefined ? undefined : structuredClone(manifest);
  }

  /** Registered provider ids for a family. */
  providerIds(family?: RuntimeProviderFamily): ProviderId[] {
    if (family === undefined) {
      return [...this.manifests.keys()];
    }
    return [...(this.factories.get(family)?.keys() ?? [])];
  }

  /** Provider-owned state schema, if the provider declared one. */
  providerStateSchema(id: ProviderId): ProviderStateSchema | undefined {
    const schema = this.stateSchemas.get(id);
    return schema === undefined ? undefined : structuredClone(schema);
  }

  /** Redacted provider-host diagnostics accumulated so far. */
  diagnostics(): ProviderHostDiagnostic[] {
    return this.diagnosticsLog.map((diagnostic) => structuredClone(diagnostic));
  }

  /** Create a runtime provider port after config, dependency, and probe checks pass. */
  async createProvider<TFamily extends RuntimeProviderFamily>(
    family: TFamily,
    id: ProviderId,
    opts: CreateProviderOptions = {},
  ): Promise<ProviderPortByFamily[TFamily]> {
    const prepared = this.prepareProviderCreate(family, id, opts);
    if (prepared.probe !== undefined) {
      const result = await prepared.probe({
        providerId: id,
        dependencies: prepared.ctx.dependencies,
        diagnostics: prepared.ctx.diagnostics,
      });
      this.assertProbeAvailable(id, family, result);
    }

    return prepared.factory.create(prepared.ctx);
  }

  /**
   * Create a runtime provider port for sync composition roots.
   *
   * Use {@link createProvider} for providers with async probes or factories. This method preserves the
   * synchronous app boot path while still routing provider selection through the host.
   */
  createProviderSync<TFamily extends RuntimeProviderFamily>(
    family: TFamily,
    id: ProviderId,
    opts: CreateProviderOptions = {},
  ): ProviderPortByFamily[TFamily] {
    const prepared = this.prepareProviderCreate(family, id, opts);
    if (prepared.probe !== undefined) {
      const result = prepared.probe({
        providerId: id,
        dependencies: prepared.ctx.dependencies,
        diagnostics: prepared.ctx.diagnostics,
      });
      if (isPromiseLike(result)) {
        this.fail({
          code: "provider.async_unsupported",
          providerId: id,
          family,
          message: `provider "${id}" probe is async but sync creation was requested`,
        });
      }
      this.assertProbeAvailable(id, family, result);
    }
    const created = prepared.factory.create(prepared.ctx);
    if (isPromiseLike(created)) {
      this.fail({
        code: "provider.async_unsupported",
        providerId: id,
        family,
        message: `provider "${id}" factory is async but sync creation was requested`,
      });
    }
    return created;
  }

  /** Emit one redacted provider-host diagnostic into the host log. */
  emit(diagnostic: ProviderHostDiagnostic): void {
    this.diagnosticsLog.push(redactDiagnostic(diagnostic));
  }

  private prepareProviderCreate<TFamily extends RuntimeProviderFamily>(
    family: TFamily,
    id: ProviderId,
    opts: CreateProviderOptions,
  ): PreparedProviderCreate<ProviderPortByFamily[TFamily]> {
    const manifest = this.manifests.get(id);
    if (manifest === undefined) {
      this.fail({
        code: "provider.unknown",
        providerId: id,
        family,
        message: `unknown provider "${id}"`,
      });
    }
    if (manifest.spec.family !== family) {
      this.fail({
        code: "provider.family_mismatch",
        providerId: id,
        family,
        message: `provider "${id}" is registered as ${manifest.spec.family}, not ${family}`,
        detail: { actualFamily: manifest.spec.family, expectedFamily: family },
      });
    }
    const factory = this.factories.get(family)?.get(id) as
      | ProviderFactory<ProviderPortByFamily[TFamily]>
      | undefined;
    if (factory === undefined) {
      this.fail({
        code: "provider.factory_missing",
        providerId: id,
        family,
        message: `provider "${id}" has no ${family} factory`,
      });
    }

    const config = opts.config ?? {};
    if (!isRecord(config)) {
      this.fail({
        code: "provider.config_invalid",
        providerId: id,
        family,
        message: `provider "${id}" config must be an object`,
        detail: { configType: typeof config },
      });
    }
    const schema = manifest.spec.factory_config_schema ?? manifest.spec.config_schema ?? {};
    const validation = validateConfig(schema, config);
    if (!validation.ok) {
      const err = configDefectsToError(validation.defects);
      const diagnostic: ProviderHostDiagnostic = {
        code: "provider.config_invalid",
        providerId: id,
        family,
        message: err.message,
      };
      if (err.detail !== undefined) {
        diagnostic.detail = err.detail;
      }
      this.fail(diagnostic);
    }

    const dependencies = new StaticProviderDependencyView(
      manifest.spec.requires ?? [],
      opts.dependencyBindings,
    );
    const dependencyDiagnostics = dependencies.diagnostics();
    if (dependencyDiagnostics.length > 0) {
      this.fail({
        code: "provider.dependency_unavailable",
        providerId: id,
        family,
        message: `provider "${id}" has unavailable dependencies`,
        detail: { diagnostics: dependencyDiagnostics },
      });
    }

    const diagnostics = redactingDiagnostics(opts.diagnostics ?? this);
    const ctx: ProviderCreateContext = {
      providerId: id,
      config,
      dependencies,
      state: (opts.stateRoot ?? this.stateRoot).namespace(id),
      secrets: opts.secrets ?? EMPTY_SECRET_RESOLVER,
      diagnostics,
      services: opts.services ?? new EmptyProviderServices(),
    };

    const probe = this.probes.get(id);
    if (manifest.spec.probe !== undefined && probe === undefined) {
      this.fail({
        code: "provider.probe_missing",
        providerId: id,
        family,
        message: `provider "${id}" declares probe "${manifest.spec.probe}" but registered none`,
      });
    }

    return { factory, ...(probe !== undefined ? { probe } : {}), ctx };
  }

  private assertProbeAvailable(
    id: ProviderId,
    family: RuntimeProviderFamily,
    result: ProbeResult,
  ): void {
    if (result !== "available") {
      this.fail({
        code: "provider.probe_failed",
        providerId: id,
        family,
        message: `provider "${id}" probe reported ${result}`,
        detail: { result },
      });
    }
  }

  private registrationContext(
    moduleProviderId: ProviderId,
    moduleFamily: RuntimeProviderFamily,
    staged: ProviderRegistrationStaging,
  ): ProviderRegistrationContext {
    return {
      registerAuthProvider: (id, factory) =>
        this.registerFactory(staged, moduleProviderId, moduleFamily, "auth", id, factory),
      registerLauncher: (id, factory) =>
        this.registerFactory(staged, moduleProviderId, moduleFamily, "launcher", id, factory),
      registerHumanEntrypoint: (id, factory) =>
        this.registerFactory(staged, moduleProviderId, moduleFamily, "entrypoint", id, factory),
      registerAgentConnector: (id, factory) =>
        this.registerFactory(staged, moduleProviderId, moduleFamily, "connector", id, factory),
      registerWorkspace: (id, factory) =>
        this.registerFactory(staged, moduleProviderId, moduleFamily, "workspace", id, factory),
      registerCompletionDetector: (id, factory) =>
        this.registerFactory(staged, moduleProviderId, moduleFamily, "detector", id, factory),
      registerChannel: (id, factory) =>
        this.registerFactory(staged, moduleProviderId, moduleFamily, "channel", id, factory),
      registerSecretStore: (id, factory) =>
        this.registerFactory(staged, moduleProviderId, moduleFamily, "secret-store", id, factory),
      registerProbe: (id, probe) =>
        this.registerOwned(moduleProviderId, id, () => {
          if (this.probes.has(id) || staged.probes.has(id)) {
            this.fail({
              code: "provider.duplicate",
              providerId: id,
              family: moduleFamily,
              message: `provider "${id}" probe is already registered`,
            });
          }
          staged.probes.set(id, probe);
        }),
      registerStateSchema: (id, schema) =>
        this.registerOwned(moduleProviderId, id, () => {
          if (this.stateSchemas.has(id) || staged.stateSchemas.has(id)) {
            this.fail({
              code: "provider.duplicate",
              providerId: id,
              family: moduleFamily,
              message: `provider "${id}" state schema is already registered`,
            });
          }
          staged.stateSchemas.set(id, structuredClone(schema));
        }),
    };
  }

  private commitRegistration(staged: ProviderRegistrationStaging): void {
    for (const [family, factories] of staged.factories) {
      const familyFactories = this.factories.get(family);
      if (familyFactories === undefined) {
        continue;
      }
      for (const [id, factory] of factories) {
        familyFactories.set(id, factory);
      }
    }
    for (const [id, probe] of staged.probes) {
      this.probes.set(id, probe);
    }
    for (const [id, schema] of staged.stateSchemas) {
      this.stateSchemas.set(id, structuredClone(schema));
    }
  }

  private registerOwned(
    providerId: ProviderId,
    registeredId: ProviderId,
    register: () => void,
  ): void {
    if (providerId !== registeredId) {
      this.fail({
        code: "provider.family_mismatch",
        providerId: registeredId,
        message: `provider module "${providerId}" cannot register "${registeredId}"`,
        detail: { moduleProviderId: providerId, registeredId },
      });
    }
    register();
  }

  private registerFactory<TPort>(
    staged: ProviderRegistrationStaging,
    moduleProviderId: ProviderId,
    moduleFamily: RuntimeProviderFamily,
    expectedFamily: RuntimeProviderFamily,
    id: ProviderId,
    factory: ProviderFactory<TPort>,
  ): void {
    this.registerOwned(moduleProviderId, id, () => {
      if (moduleFamily !== expectedFamily) {
        this.fail({
          code: "provider.family_mismatch",
          providerId: id,
          family: expectedFamily,
          message: `provider "${id}" manifest family is ${moduleFamily}, not ${expectedFamily}`,
          detail: { manifestFamily: moduleFamily, registeredFamily: expectedFamily },
        });
      }
      const familyFactories = staged.factories.get(expectedFamily);
      if (familyFactories === undefined) {
        this.fail({
          code: "provider.unsupported_family",
          providerId: id,
          family: expectedFamily,
          message: `provider family "${expectedFamily}" is not supported`,
        });
      }
      if (this.factories.get(expectedFamily)?.has(id) === true || familyFactories.has(id)) {
        this.fail({
          code: "provider.duplicate",
          providerId: id,
          family: expectedFamily,
          message: `provider "${id}" ${expectedFamily} factory is already registered`,
        });
      }
      familyFactories.set(id, factory as ProviderFactory<unknown>);
    });
  }

  private fail(diagnostic: ProviderHostDiagnostic): never {
    this.emit(diagnostic);
    throwDiagnostic(diagnostic);
  }
}
