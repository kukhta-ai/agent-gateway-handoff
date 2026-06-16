// @gla/app composition — provider-set-agnostic composition root (baseline §1).
// The :3000 process is booted here: ports meet deployable implementations and are injected inward,
// never from core. Provider-family adapters move behind Provider Host provider sets; non-provider
// infrastructure adapters still meet their ports here until their families migrate.
//
// Slice 2: `createBridge()` wires the **real Cedar PolicyPort** into admission, so `gla session create
// --dry-run` exercises real forbid-wins policy. A real run dispatches a Session in `issued` (no spawn).
// Slice 3: `createProvisioningBridge()` additionally wires the **real worker plane** — the process
// launcher (T2, headless ‖ full noVNC, auto-detected) + the temp-profile workspace + the CDP connector
// + the noVNC entrypoint — and a SessionService whose `provision()` runs the create-saga, so `gla
// session create` (no --dry-run) provisions a live capsule and returns `{capsule, connector}`, and `gla
// session connector` re-emits it.

import { lstatSync, statSync } from "node:fs";

// Concrete adapters (the outward side) — importable ONLY from this composition root until their provider
// families migrate behind Provider Host:
import { AdmissionService } from "@gla/admission";
import { AgentBridge } from "@gla/bridge";
import { CapabilityService } from "@gla/capability";
import {
  BROWSER_HANDOFF_TEMPLATE,
  CatalogService,
  type CatalogServiceOptions,
  type DependencyBinding,
  type IndexedDependencyBinding,
  type Probe,
  type ProviderClientAssetSourceInput,
  type ProviderGraphDiagnostic,
  type ProviderGraphDoctorReport,
  type ProviderGraphProjectionResult,
  type ProviderGraphProviderFact,
  type ProviderGraphResolvedProvider,
  type ProviderProfileManifest,
  type StoreContent,
  type TemplatePackageManifest,
  providerGraphDoctorReport,
  resolveProviderGraphProjection,
  toAdmissionCatalogFromProviderGraphProjection,
} from "@gla/catalog";
import { CompletionService, type DetectorContract } from "@gla/completion";
import { AccessGateway, type EntrypointClientAssetMount } from "@gla/gateway";
import { type EnrollmentRecord, IdentityService } from "@gla/identity";
// Core / core-adjacent ports (the inward side of the seam):
import {
  type AgentConnector,
  type AgentConnectorPort,
  type AuthAssuranceProfile,
  type AuthProviderPort,
  type CapabilityId,
  type ChannelPort,
  type CompletionDetectorPort,
  type ConfigSchema,
  EMPTY_CONFIG_SCHEMA,
  HmacCapabilitySigner,
  type HumanEntrypointPort,
  KERNEL_MODULE,
  type LauncherPort,
  type MountCapability,
  type OpaqueToken,
  type RecipientRef,
  type Ref,
  type ResolvedAssemblySpec,
  type ResolvedCapsulePlan,
  type RuntimeHandle,
  type SessionId,
  authAssurancePolicyFromProfile,
  authAssurancePolicyFromRequiredAuthStrength,
  glaError,
  redactOperatorText,
  validateSchemaShape,
} from "@gla/kernel";
import { CedarPolicyAdapter, MVP_POLICY_SET, POLICY_CEDAR_MODULE } from "@gla/policy-cedar";
import {
  type ProviderHost,
  type ProviderId,
  type ProviderKvStore,
  type ProviderRegistry,
  type ProviderStateNamespaceMetadata,
  type ProviderStateRoot,
  type RuntimeProviderFamily,
  providerServices,
} from "@gla/provider-host";
import { RouteController } from "@gla/route";
import {
  type CapsuleWorkerPort,
  type CompletionDeps,
  type HandoffDeps,
  SessionService,
  type SessionServiceOptions,
  type SessionServiceSnapshot,
} from "@gla/session";
import { TaskService, type TaskServiceSnapshot } from "@gla/task";
import {
  CapsuleLifecycleManager,
  type CapsuleRecord,
  CleanupReconciler,
  SpawnerRegistry,
  WorkspaceManager,
  attachConnector,
} from "@gla/worker";
import { DaemonStateError, DaemonStateRoot } from "./daemon-state.js";
import {
  type LegacyAppProviderSet,
  type LegacyProviderDefaultConfigArgs,
  type LegacyProviderDefaultServicesArgs,
  type LegacyProviderSelectionProfile,
  legacyProviderSelectionFromManifest,
  legacyProviderSetDefaultConfig,
  legacyProviderSetDefaultServices,
  legacyProviderSetEntrypointClientAssets,
  legacyProviderSetProfileSelection,
  legacyProviderSetRegistry,
  legacyProviderSetSelectedProfileId,
  legacyProviderSetSelectedProfileManifest,
  legacyProviderSetTemplateProbes,
} from "./provider-compat.js";

/** The MVP default wiring (baseline §5): which adapter is bound to each kernel port. */
export interface Wiring {
  kernel: string;
  policy: string;
  auth: string;
  launcher: string;
  connector: string;
  workspace: string;
  detector: string;
  channel: string;
  secretStore: string;
}

/** Provider-neutral sink used by channel providers that expose line-oriented delivery in dev/test. */
export interface DeliverySink {
  write(line: string): void;
}

const deliveryToStdout: DeliverySink = {
  write: (line) => void process.stdout.write(`${line}\n`),
};

/**
 * Legacy flat boot-time selected providers for every runtime family the app composes.
 *
 * @deprecated Prefer {@link AppDeploymentConfig} plus template/assembly capsule resolution.
 */
export type ProviderSelectionProfile = LegacyProviderSelectionProfile;

/** App infrastructure providers selected at deployment/app boot, not by capsule assembly. */
export interface AppDeploymentConfig {
  /** AuthProvider selected for gateway/enrollment/step-up. */
  auth: ProviderId;
  /** ChannelAdapter selected for deployment messaging. */
  channel: ProviderId;
  /** SecretStore selected for deployment secret storage. */
  secretStore: ProviderId;
  /** App-level provider config/defaults keyed by provider id. */
  providerConfig?: Record<string, Record<string, unknown>>;
}

/** App deployment config input accepted by composition APIs. */
export interface AppDeploymentConfigInput {
  /** AuthProvider override for app boot. */
  auth?: ProviderId;
  /** ChannelAdapter override for app boot. */
  channel?: ProviderId;
  /** SecretStore override for app boot. */
  secretStore?: ProviderId;
  /** App-level provider config/defaults keyed by provider id. */
  providerConfig?: Record<string, Record<string, unknown>>;
}

/** Capsule runtime providers selected by template/assembly, not by app deployment config. */
export interface CapsuleProviderSelection {
  launcher: ProviderId;
  connector: ProviderId;
  workspace: ProviderId;
  entrypoint: ProviderId;
  detector: ProviderId;
}

/** Capsule provider selection input accepted by composition APIs during migration. */
export type CapsuleProviderSelectionInput = Partial<CapsuleProviderSelection>;

/** @deprecated Compatibility adapter callback args for legacy provider sets. */
export type ProviderDefaultConfigArgs = LegacyProviderDefaultConfigArgs;

/** @deprecated Compatibility adapter callback args for legacy provider-set service seams. */
export type ProviderDefaultServicesArgs = LegacyProviderDefaultServicesArgs;

/**
 * Legacy trusted provider set selected at install/boot time.
 *
 * @deprecated New runtime composition uses {@link ProviderRegistry}, {@link AppDeploymentConfig}, and
 * capsule template/assembly defaults. This alias is preserved only for explicit migration callers.
 */
export type AppProviderSet = LegacyAppProviderSet;

/** Provider composition inputs for registry boot, app deployment selection, and capsule defaults. */
export interface ProviderCompositionOptions {
  /** Boot-time executable provider registry. Preferred over legacy provider-set module discovery. */
  providerRegistry?: ProviderRegistry;
  /** App infrastructure provider selection for AuthProvider, ChannelAdapter, and SecretStore. */
  appDeploymentConfig?: AppDeploymentConfigInput;
  /** Capsule provider choices for Launcher, Workspace, HumanEntrypoint, AgentConnector, and CompletionDetector. */
  capsuleProviders?: CapsuleProviderSelectionInput;
  /** Capsule-level provider defaults/config keyed by provider id. */
  capsuleProviderConfig?: Record<string, Record<string, unknown>>;
  /**
   * Legacy trusted install/boot-time provider set.
   *
   * @deprecated Use `providerRegistry` plus `appDeploymentConfig`, `capsuleProviders`,
   * `entrypointClientAssets`, and `templateProbes`. This field is a compatibility adapter only.
   */
  providerSet?: AppProviderSet;
  /** Prebuilt trusted Provider Host, mainly for tests or external composition. */
  providerHost?: ProviderHost;
  /** @deprecated Legacy broad profile id; prefer app deployment config and template defaults. */
  providerProfileId?: string;
  /** @deprecated Legacy broad profile override; prefer app deployment config and capsule selection. */
  providerProfile?: Partial<ProviderSelectionProfile>;
  /** Provider-declared browser client assets supplied by registry/bootstrap data. */
  entrypointClientAssets?: readonly EntrypointClientAssetMount[];
  /** Template reachability probes supplied by external composition when no provider set owns them. */
  templateProbes?: Readonly<Record<string, Probe>>;
}

/** The composed application handle. `listen()` boots the real long-running daemon (the `:3000` deployable). */
export interface App {
  readonly wiring: Wiring;
  /**
   * Boot the real long-running daemon: bind the Access Gateway on the PUBLIC `:port` (default 3000), bind the
   * Agent Bridge on a LOCAL endpoint, and stay alive until `close()`. Returns the running {@link DaemonHandle}
   * (gateway addr, bridge endpoint, public base, and the graceful-shutdown `close()`). For full control over the
   * bind host, the bridge endpoint, and the public base URL, call {@link serve} directly (this is the terse
   * default: `0.0.0.0:<port>`, the default uds bridge endpoint, links against `http://127.0.0.1:<port>`).
   */
  listen(port?: number): Promise<import("./daemon.js").DaemonHandle>;
}

function requireProviderRegistry(opts: ProviderCompositionOptions): ProviderHost {
  if (opts.providerRegistry !== undefined) {
    return opts.providerRegistry.isSealed() ? opts.providerRegistry : opts.providerRegistry.seal();
  }
  if (opts.providerHost !== undefined) {
    return opts.providerHost;
  }
  if (opts.providerSet !== undefined) {
    return legacyProviderSetRegistry(opts.providerSet);
  }
  throw new Error(
    "provider composition requires a providerRegistry, providerSet, or prebuilt providerHost",
  );
}

function requireProviderHost(opts: ProviderCompositionOptions): ProviderHost {
  return requireProviderRegistry(opts);
}

function appDeploymentSelectionInput(
  input: AppDeploymentConfigInput | undefined,
): AppDeploymentConfigInput {
  return {
    ...(input?.auth !== undefined ? { auth: input.auth } : {}),
    ...(input?.channel !== undefined ? { channel: input.channel } : {}),
    ...(input?.secretStore !== undefined ? { secretStore: input.secretStore } : {}),
    ...(input?.providerConfig !== undefined ? { providerConfig: input.providerConfig } : {}),
  };
}

function capsuleSelectionInput(
  input: CapsuleProviderSelectionInput | undefined,
): CapsuleProviderSelectionInput {
  return {
    ...(input?.launcher !== undefined ? { launcher: input.launcher } : {}),
    ...(input?.connector !== undefined ? { connector: input.connector } : {}),
    ...(input?.workspace !== undefined ? { workspace: input.workspace } : {}),
    ...(input?.entrypoint !== undefined ? { entrypoint: input.entrypoint } : {}),
    ...(input?.detector !== undefined ? { detector: input.detector } : {}),
  };
}

function appDeploymentSelectionFromLegacy(
  profile: Partial<ProviderSelectionProfile>,
): AppDeploymentConfigInput {
  return {
    ...(profile.auth !== undefined ? { auth: profile.auth } : {}),
    ...(profile.channel !== undefined ? { channel: profile.channel } : {}),
    ...(profile.secretStore !== undefined ? { secretStore: profile.secretStore } : {}),
  };
}

function capsuleSelectionFromLegacy(
  profile: Partial<ProviderSelectionProfile>,
): CapsuleProviderSelectionInput {
  return {
    ...(profile.launcher !== undefined ? { launcher: profile.launcher } : {}),
    ...(profile.connector !== undefined ? { connector: profile.connector } : {}),
    ...(profile.workspace !== undefined ? { workspace: profile.workspace } : {}),
    ...(profile.entrypoint !== undefined ? { entrypoint: profile.entrypoint } : {}),
    ...(profile.detector !== undefined ? { detector: profile.detector } : {}),
  };
}

function mergedProviderConfigFor(
  providerIds: readonly ProviderId[],
  providerConfigSources: readonly (Record<string, Record<string, unknown>> | undefined)[],
): Record<string, Record<string, unknown>> | undefined {
  const providerConfig: Record<string, Record<string, unknown>> = {};
  for (const providerId of providerIds) {
    for (const source of providerConfigSources) {
      const values = source?.[providerId];
      if (hasEntries(values)) {
        providerConfig[providerId] = {
          ...(providerConfig[providerId] ?? {}),
          ...structuredClone(values),
        };
      }
    }
  }
  return Object.keys(providerConfig).length > 0 ? providerConfig : undefined;
}

function requireAppDeploymentConfig(
  input: AppDeploymentConfigInput,
  providerConfigSources: readonly (Record<string, Record<string, unknown>> | undefined)[],
): AppDeploymentConfig {
  const { auth, channel, secretStore } = input;
  if (typeof auth !== "string" || auth.length === 0) {
    throw new Error('provider composition deployment config is missing "auth"');
  }
  if (typeof channel !== "string" || channel.length === 0) {
    throw new Error('provider composition deployment config is missing "channel"');
  }
  if (typeof secretStore !== "string" || secretStore.length === 0) {
    throw new Error('provider composition deployment config is missing "secretStore"');
  }
  const providerConfig = mergedProviderConfigFor(
    [auth, channel, secretStore],
    providerConfigSources,
  );
  return {
    auth,
    channel,
    secretStore,
    ...(providerConfig !== undefined ? { providerConfig } : {}),
  };
}

function requireCapsuleProviderSelection(
  input: CapsuleProviderSelectionInput,
): CapsuleProviderSelection {
  const { launcher, connector, workspace, entrypoint, detector } = input;
  if (typeof launcher !== "string" || launcher.length === 0) {
    throw new Error('provider composition capsule selection is missing "launcher"');
  }
  if (typeof connector !== "string" || connector.length === 0) {
    throw new Error('provider composition capsule selection is missing "connector"');
  }
  if (typeof workspace !== "string" || workspace.length === 0) {
    throw new Error('provider composition capsule selection is missing "workspace"');
  }
  if (typeof entrypoint !== "string" || entrypoint.length === 0) {
    throw new Error('provider composition capsule selection is missing "entrypoint"');
  }
  if (typeof detector !== "string" || detector.length === 0) {
    throw new Error('provider composition capsule selection is missing "detector"');
  }
  return {
    launcher,
    connector,
    workspace,
    entrypoint,
    detector,
  };
}

function deploymentProviderConfig(
  deployment: AppDeploymentConfig,
  providerId: ProviderId,
): Record<string, unknown> | undefined {
  return deployment.providerConfig?.[providerId];
}

function capsuleProviderConfig(
  opts: ProviderCompositionOptions,
  providerId: ProviderId,
): Record<string, unknown> | undefined {
  return opts.capsuleProviderConfig?.[providerId];
}

function providerBootFallbackConfig(
  host: ProviderHost,
  providerId: ProviderId,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const schema =
    host.providerManifest(providerId)?.spec.factory_config_schema ??
    host.providerManifest(providerId)?.spec.config_schema;
  if (schema === undefined) {
    return {};
  }
  const allowed = new Set(Object.keys(schema.properties ?? {}));
  return Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)));
}

function providerModuleId(
  host: ProviderHost,
  family: RuntimeProviderFamily,
  providerId: ProviderId,
): string {
  return host.requireProviderDescriptor(providerId, family).moduleId;
}

function providerConfig(
  explicit: Record<string, unknown> | undefined,
  providerSet: AppProviderSet | undefined,
  family: RuntimeProviderFamily,
  providerId: ProviderId,
  legacy: Record<string, unknown> = {},
  defaults?: Record<string, unknown>,
): Record<string, unknown> {
  if (explicit !== undefined) {
    return explicit;
  }
  const mergedLegacy = { ...(defaults ?? {}), ...legacy };
  const configured = legacyProviderSetDefaultConfig(providerSet, {
    family,
    providerId,
    legacy: mergedLegacy,
  });
  if (configured !== undefined) {
    return configured;
  }
  return mergedLegacy;
}

function providerServiceBindings(
  providerSet: AppProviderSet | undefined,
  family: RuntimeProviderFamily,
  providerId: ProviderId,
  legacy: Record<string, unknown> = {},
): Record<string, unknown> {
  return legacyProviderSetDefaultServices(providerSet, { family, providerId, legacy }) ?? {};
}

/** Catalog store content derived from Provider Host registration data. */
export function providerStoreContent(host: ProviderHost): StoreContent {
  return {
    providers: host.providerManifests(),
    templates: [structuredClone(BROWSER_HANDOFF_TEMPLATE)],
  };
}

function providerCatalogOptions(
  dependencyBindings: DependencyBinding[] | undefined,
  host: ProviderHost,
): CatalogServiceOptions {
  const content = providerStoreContent(host);
  const options: CatalogServiceOptions = {
    content,
  };
  if (dependencyBindings !== undefined) {
    options.dependencyBindings = dependencyBindings;
  }
  return options;
}

function hasEntries(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  return value !== undefined && Object.keys(value).length > 0;
}

interface ProviderSelectionResolutionOverrides {
  deployment?: AppDeploymentConfigInput;
  capsule?: CapsuleProviderSelectionInput;
  legacy?: Partial<ProviderSelectionProfile>;
}

interface ProviderSelectionResolution {
  deployment: AppDeploymentConfig;
  capsule: CapsuleProviderSelection;
  profileManifest: ProviderProfileManifest;
}

function profileSelectFromSelections(
  deployment: AppDeploymentConfig,
  capsule: CapsuleProviderSelection,
): NonNullable<ProviderProfileManifest["spec"]["select"]> {
  return {
    AuthProvider: deployment.auth,
    Launcher: capsule.launcher,
    Workspace: capsule.workspace,
    HumanEntrypoint: capsule.entrypoint,
    AgentConnector: capsule.connector,
    CompletionDetector: capsule.detector,
    ChannelAdapter: deployment.channel,
    SecretStore: deployment.secretStore,
  };
}

function providerProfileManifestFromSelections(opts: {
  deployment: AppDeploymentConfig;
  capsule: CapsuleProviderSelection;
  profileId?: string | undefined;
  baseManifest?: ProviderProfileManifest | undefined;
  hasRuntimeOverride?: boolean | undefined;
  providerConfigSources?: readonly (Record<string, Record<string, unknown>> | undefined)[];
}): ProviderProfileManifest {
  const select = profileSelectFromSelections(opts.deployment, opts.capsule);
  const selectedProviderIds = [
    opts.deployment.auth,
    opts.capsule.launcher,
    opts.capsule.workspace,
    opts.capsule.entrypoint,
    opts.capsule.connector,
    opts.capsule.detector,
    opts.deployment.channel,
    opts.deployment.secretStore,
  ];
  const config = mergedProviderConfigFor(selectedProviderIds, opts.providerConfigSources ?? []);
  if (opts.baseManifest !== undefined) {
    const manifest = structuredClone(opts.baseManifest);
    manifest.metadata = {
      ...manifest.metadata,
      ...(opts.hasRuntimeOverride === true && opts.profileId !== undefined
        ? { name: `${opts.profileId}+runtime-override` }
        : {}),
    };
    manifest.spec = {
      ...manifest.spec,
      select: {
        ...(manifest.spec.select ?? {}),
        ...select,
      },
      ...(config !== undefined ? { config } : {}),
    };
    return manifest;
  }
  return {
    apiVersion: "gla.dev/v1",
    kind: "ProviderProfile",
    metadata: { name: opts.profileId ?? "selected-runtime-profile" },
    spec: {
      select,
      ...(config !== undefined ? { config } : {}),
      lifecycle: { owner: "operator", apply: "boot", hotReload: false },
    },
  };
}

function resolveProviderSelections(
  opts: ProviderCompositionOptions,
  overrides: ProviderSelectionResolutionOverrides = {},
): ProviderSelectionResolution {
  const namedManifest = legacyProviderSetSelectedProfileManifest(
    opts.providerSet,
    opts.providerProfileId,
  );
  const legacySelection: Partial<ProviderSelectionProfile> = {
    ...(legacyProviderSetProfileSelection(opts.providerSet) ?? {}),
    ...(namedManifest !== undefined ? legacyProviderSelectionFromManifest(namedManifest) : {}),
    ...(opts.providerProfile ?? {}),
    ...(overrides.legacy ?? {}),
  };
  const deploymentInput: AppDeploymentConfigInput = {
    ...appDeploymentSelectionFromLegacy(legacySelection),
    ...appDeploymentSelectionInput(opts.appDeploymentConfig),
    ...appDeploymentSelectionInput(overrides.deployment),
  };
  const capsuleInput: CapsuleProviderSelectionInput = {
    ...capsuleSelectionFromLegacy(legacySelection),
    ...capsuleSelectionInput(opts.capsuleProviders),
    ...capsuleSelectionInput(overrides.capsule),
  };
  const deployment = requireAppDeploymentConfig(deploymentInput, [
    namedManifest?.spec.config,
    opts.appDeploymentConfig?.providerConfig,
    overrides.deployment?.providerConfig,
  ]);
  const capsule = requireCapsuleProviderSelection(capsuleInput);
  const profileId = opts.providerProfileId ?? legacyProviderSetSelectedProfileId(opts.providerSet);
  const hasRuntimeOverride =
    Object.keys(opts.providerProfile ?? {}).length > 0 ||
    Object.keys(overrides.legacy ?? {}).length > 0 ||
    Object.keys(appDeploymentSelectionInput(opts.appDeploymentConfig)).length > 0 ||
    Object.keys(capsuleSelectionInput(opts.capsuleProviders)).length > 0 ||
    Object.keys(appDeploymentSelectionInput(overrides.deployment)).length > 0 ||
    Object.keys(capsuleSelectionInput(overrides.capsule)).length > 0;
  const profileManifest = providerProfileManifestFromSelections({
    deployment,
    capsule,
    profileId,
    baseManifest: namedManifest,
    hasRuntimeOverride,
    providerConfigSources: [
      namedManifest?.spec.config,
      opts.appDeploymentConfig?.providerConfig,
      opts.capsuleProviderConfig,
      overrides.deployment?.providerConfig,
    ],
  });
  return {
    deployment,
    capsule,
    profileManifest,
  };
}

/** Resolve app infrastructure provider selection without capsule provider fields. */
export function resolveAppDeploymentConfig(
  opts: ProviderCompositionOptions,
  overrides: AppDeploymentConfigInput = {},
): AppDeploymentConfig {
  return resolveProviderSelections(opts, { deployment: overrides }).deployment;
}

/** Resolve capsule provider selection without app infrastructure provider fields. */
export function resolveCapsuleProviderSelection(
  opts: ProviderCompositionOptions,
  overrides: CapsuleProviderSelectionInput = {},
): CapsuleProviderSelection {
  return resolveProviderSelections(opts, { capsule: overrides }).capsule;
}

function runtimeCapsuleTemplatePackage(capsule: CapsuleProviderSelection): TemplatePackageManifest {
  return {
    apiVersion: "gla.dev/v1",
    kind: "TemplatePackage",
    metadata: {
      name: "runtime-browser-handoff-template-defaults",
      version: BROWSER_HANDOFF_TEMPLATE.metadata.version,
    },
    spec: {
      templates: [structuredClone(BROWSER_HANDOFF_TEMPLATE)],
      ...(BROWSER_HANDOFF_TEMPLATE.spec.openParams !== undefined
        ? { schema: structuredClone(BROWSER_HANDOFF_TEMPLATE.spec.openParams) }
        : {}),
      defaults: {
        [`template.${BROWSER_HANDOFF_TEMPLATE.metadata.name}`]: {
          Launcher: capsule.launcher,
          Workspace: capsule.workspace,
          HumanEntrypoint: capsule.entrypoint,
          AgentConnector: capsule.connector,
          CompletionDetector: capsule.detector,
        },
      },
      compatibility: {
        requiredParts: [...(BROWSER_HANDOFF_TEMPLATE.spec.openParts ?? [])],
      },
      docs: ["docs/04-capsule-assembly.md"],
      tests: ["packages/app/test/integration/provider-set-composition.test.ts"],
    },
  };
}

interface ProviderGraphRuntimeContext {
  readonly catalogOptions: CatalogServiceOptions;
  readonly graph: ProviderGraphProjectionResult;
  readonly doctor: ProviderGraphDoctorReport;
}

function providerGraphRuntimeContext(opts: {
  providerHost: ProviderHost;
  providerSet?: AppProviderSet | undefined;
  capsule: CapsuleProviderSelection;
  profileManifest: ProviderProfileManifest;
  dependencyBindings?: DependencyBinding[] | undefined;
  runtimeAssemblyParams?: Record<string, Record<string, unknown>> | undefined;
  configValidationProviderIds?: readonly ProviderId[] | undefined;
  templateProbes?: Readonly<Record<string, Probe>> | undefined;
  entrypointClientAssets?: readonly EntrypointClientAssetMount[] | undefined;
}): ProviderGraphRuntimeContext {
  const content = providerStoreContent(opts.providerHost);
  const templatePackages = [runtimeCapsuleTemplatePackage(opts.capsule)];
  const catalogOptions: CatalogServiceOptions = { content };
  if (opts.dependencyBindings !== undefined) {
    catalogOptions.dependencyBindings = opts.dependencyBindings;
  }
  const graphInputBase: Parameters<typeof resolveProviderGraphProjection>[0] = {
    ...(opts.providerSet !== undefined
      ? {
          providerSet: {
            id: opts.providerSet.moduleId,
            providers: content.providers,
          },
        }
      : { providerManifests: content.providers }),
    templatePackages,
    baseProfile: opts.profileManifest,
    ...(opts.dependencyBindings !== undefined
      ? { dependencyBindings: opts.dependencyBindings }
      : {}),
    ...(opts.runtimeAssemblyParams !== undefined
      ? { runtimeAssemblyParams: opts.runtimeAssemblyParams }
      : {}),
    ...(opts.entrypointClientAssets !== undefined
      ? { clientAssetSources: providerClientAssetSources(opts.entrypointClientAssets) }
      : {}),
    configValidationMode: "factory",
    ...(opts.configValidationProviderIds !== undefined
      ? { configValidationProviderIds: opts.configValidationProviderIds }
      : {}),
  };
  const dependencyGraph = resolveProviderGraphProjection(graphInputBase);
  const dependencyBindingsByProvider = Object.fromEntries(
    dependencyGraph.projection.providerFacts.map((provider) => [
      provider.providerId,
      provider.dependencies,
    ]),
  );
  const probes = {
    ...opts.providerHost.providerProbeRegistry(dependencyBindingsByProvider),
    ...legacyProviderSetTemplateProbes(opts.providerSet),
    ...(opts.templateProbes ?? {}),
  };
  for (const provider of content.providers) {
    if (provider.spec.probe !== undefined && probes[provider.spec.probe] === undefined) {
      probes[provider.spec.probe] = () => "unavailable";
    }
  }
  for (const template of content.templates) {
    if (template.spec.probe !== undefined && probes[template.spec.probe] === undefined) {
      probes[template.spec.probe] = () => "unavailable";
    }
  }
  catalogOptions.probes = probes;
  const graphInput: Parameters<typeof resolveProviderGraphProjection>[0] = {
    ...graphInputBase,
    probes,
  };
  const graph = resolveProviderGraphProjection(graphInput);
  catalogOptions.providerGraph = graph;
  return {
    catalogOptions,
    graph,
    doctor: providerGraphDoctorReport(graph),
  };
}

function selectedGraphProvider(
  graph: ProviderGraphProjectionResult,
  providerId: ProviderId,
  family: RuntimeProviderFamily,
): ProviderGraphResolvedProvider | undefined {
  return graph.projection.providers.find(
    (provider) => provider.providerId === providerId && provider.runtimeFamily === family,
  );
}

function graphProviderFact(
  graph: ProviderGraphProjectionResult,
  providerId: ProviderId,
  family: RuntimeProviderFamily,
): ProviderGraphProviderFact | undefined {
  return graph.projection.providerFacts.find(
    (provider) => provider.providerId === providerId && provider.runtimeFamily === family,
  );
}

function graphProviderDiagnostics(
  graph: ProviderGraphProjectionResult,
  providerId: ProviderId,
): ProviderGraphDiagnostic[] {
  return graph.diagnostics.filter(
    (diagnostic) =>
      diagnostic.providerId === providerId ||
      (diagnostic.providerId === undefined && diagnostic.template === undefined),
  );
}

function graphProviderCreateInputs(
  context: ProviderGraphRuntimeContext,
  family: RuntimeProviderFamily,
  providerId: ProviderId,
  fallbackConfig: Record<string, unknown> = {},
  opts: { preferProvidedConfig?: boolean } = {},
): { config: Record<string, unknown>; dependencyBindings?: IndexedDependencyBinding[] } {
  const selected = selectedGraphProvider(context.graph, providerId, family);
  const fact = selected ?? graphProviderFact(context.graph, providerId, family);
  if (fact === undefined) {
    throw glaError("catalog.unknown", `provider "${providerId}" is not registered in the graph`, {
      detail: {
        diagnostics: [
          {
            code: "graph.unknown_provider",
            providerId,
            family,
            message: `provider "${providerId}" is not registered in the selected provider graph`,
          },
        ],
      },
    });
  }
  const diagnostics = graphProviderDiagnostics(context.graph, providerId);
  const bootBlockingDiagnostics = diagnostics.filter(
    (diagnostic) => diagnostic.code !== "graph.dependency_unavailable",
  );
  if (bootBlockingDiagnostics.length > 0) {
    throw glaError(
      "catalog.unavailable",
      `provider "${providerId}" has graph diagnostics and cannot boot`,
      {
        detail: { diagnostics: bootBlockingDiagnostics },
      },
    );
  }
  if (!fact.available) {
    const dependencyNames = fact.dependencies.map((dependency) => dependency.dependency).join(", ");
    throw glaError(
      "dependency.unavailable",
      `provider "${providerId}" has unavailable dependencies${
        dependencyNames.length > 0 ? `: ${dependencyNames}` : ""
      }`,
      {
        detail: {
          diagnostics:
            diagnostics.length > 0
              ? diagnostics
              : [
                  {
                    code: "graph.dependency_unavailable",
                    providerId,
                    family,
                    message: `provider "${providerId}" is ${fact.availability}`,
                    detail: { dependencies: fact.dependencies },
                  },
                ],
        },
      },
    );
  }
  const config = opts.preferProvidedConfig ? fallbackConfig : (selected?.config ?? fallbackConfig);
  const dependencyBindings = fact.dependencies.length > 0 ? fact.dependencies : undefined;
  return {
    config,
    ...(dependencyBindings !== undefined ? { dependencyBindings } : {}),
  };
}

function addRuntimeParams(
  params: Record<string, Record<string, unknown>>,
  providerId: ProviderId,
  values: Record<string, unknown> | undefined,
): void {
  if (hasEntries(values)) {
    params[providerId] = values;
  }
}

/** Compose against a sealed provider registry plus split app deployment and capsule selections. */
export function createApp(opts: ProviderCompositionOptions = {}): App {
  const providerHost = requireProviderHost(opts);
  const { deployment, capsule } = resolveProviderSelections(opts);
  const wiring: Wiring = {
    kernel: KERNEL_MODULE,
    policy: POLICY_CEDAR_MODULE,
    auth: providerModuleId(providerHost, "auth", deployment.auth),
    launcher: providerModuleId(providerHost, "launcher", capsule.launcher),
    connector: providerModuleId(providerHost, "connector", capsule.connector),
    workspace: providerModuleId(providerHost, "workspace", capsule.workspace),
    detector: providerModuleId(providerHost, "detector", capsule.detector),
    channel: providerModuleId(providerHost, "channel", deployment.channel),
    secretStore: providerModuleId(providerHost, "secret-store", deployment.secretStore),
  };
  return {
    wiring,
    // Boot the real daemon (no longer a stub): bind the gateway + the local bridge, stay alive, graceful shutdown.
    listen: async (port = 3000) => {
      const { serve } = await import("./daemon.js");
      return serve({ ...opts, port });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth-provider SELECTION (authentik-integration.md §1/§7, GLA-096)
//
// The selected IdP is deployment config behind the same kernel `AuthProviderPort`. Generic app
// composition imports no auth adapter implementation and owns no auth state schema: it passes an opaque
// provider id, provider-owned config, dependency evidence, and a generic state root into Provider Host.
// ─────────────────────────────────────────────────────────────────────────────

/** Opaque auth-provider id selected by operator or deployment config. */
export type AuthProviderKind = ProviderId;
/** Provider-owned auth config, validated by the selected provider's registered schema. */
export type AuthProviderConfig = Record<string, unknown>;

/**
 * The provider-selection inputs shared by the provisioning + enrollment composition (doc §7). When
 * `authProvider` is unset, the deployment auth provider is used; provider-owned config records
 * are validated by the selected provider's Provider Host schema.
 */
export interface AuthProviderSelection {
  /** The selected provider. Default comes from deployment config. */
  authProvider?: AuthProviderKind;
  /** Provider-owned config — required when the selected provider's schema requires fields. */
  authProviderConfig?: AuthProviderConfig;
}

/**
 * Build the chosen {@link AuthProviderPort} adapter (the single provider-selection seam, doc §1/§7).
 * Provider selection goes through the trusted Provider Host. The app passes only an opaque provider id,
 * provider-owned config, dependency evidence, and a generic provider-state root.
 *
 * @throws GlaErrorException if provider id/config/dependency evidence fails Provider Host validation.
 */
function buildAuthProvider(
  selection: AuthProviderSelection,
  webauthn: { rpID: string; rpName: string; expectedOrigin: string | string[] },
  stateRoot: ProviderStateRoot | undefined,
  dependencyBindings: IndexedDependencyBinding[] | undefined,
  providerHost: ProviderHost,
  providerSet: AppProviderSet | undefined,
  defaultAuthProvider: ProviderId,
  graphContext?: ProviderGraphRuntimeContext | undefined,
  configDefaults?: Record<string, unknown> | undefined,
): { provider: AuthProviderPort; module: string } {
  const providerId = selection.authProvider ?? defaultAuthProvider;
  const config = providerConfig(
    selection.authProviderConfig,
    providerSet,
    "auth",
    providerId,
    providerBootFallbackConfig(providerHost, providerId, {
      rpID: webauthn.rpID,
      rpName: webauthn.rpName,
      expectedOrigin: Array.isArray(webauthn.expectedOrigin)
        ? webauthn.expectedOrigin
        : [webauthn.expectedOrigin],
    }),
    configDefaults,
  );
  const graphInputs =
    graphContext !== undefined
      ? graphProviderCreateInputs(graphContext, "auth", providerId, config)
      : undefined;
  const provider = providerHost.createProviderSync("auth", providerId, {
    config: graphInputs?.config ?? config,
    ...(stateRoot !== undefined ? { stateRoot } : {}),
    ...(graphInputs?.dependencyBindings !== undefined
      ? { dependencyBindings: graphInputs.dependencyBindings }
      : dependencyBindings !== undefined
        ? { dependencyBindings }
        : {}),
  });
  return { provider, module: providerModuleId(providerHost, "auth", providerId) };
}

class DaemonProviderStateRoot implements ProviderStateRoot {
  constructor(private readonly state: DaemonStateRoot) {}

  namespace(
    providerId: ProviderId,
    metadata: ProviderStateNamespaceMetadata = {
      providerId,
      schemaVersion: 1,
      sensitivity: "sensitive",
      migration: "fail-closed",
      diagnostics: [],
    },
  ): ProviderStateNamespaceMetadata & { kv<T>(slot: string): ProviderKvStore<T> } {
    return {
      ...metadata,
      kv: <T>(slot: string) =>
        this.state.kv<T>(providerStateKind(providerId, metadata.schemaVersion, slot)),
    };
  }
}

function providerStateRoot(state: DaemonStateRoot | undefined): ProviderStateRoot | undefined {
  if (state === undefined) {
    return undefined;
  }
  return new DaemonProviderStateRoot(state);
}

function providerStateKind(providerId: ProviderId, schemaVersion: number, slot: string): string {
  return `provider.${providerId}.v${schemaVersion}.${slot}`;
}

function verifyProviderStateRecovery(state: DaemonStateRoot | undefined, host: ProviderHost): void {
  if (state === undefined) {
    return;
  }
  const known = new Set<string>();
  for (const descriptor of host.providerDescriptors()) {
    const schema = descriptor.stateSchema;
    if (schema === undefined) {
      continue;
    }
    for (const slot of Object.keys(schema.slots)) {
      const kind = providerStateKind(descriptor.providerId, schema.schemaVersion, slot);
      known.add(kind);
      state.kv<unknown>(kind).entries();
    }
  }
  for (const kind of state.recordKinds("provider.")) {
    if (!known.has(kind)) {
      throw new DaemonStateError(
        "state.schema",
        `unsupported provider state schema record: ${kind}`,
      );
    }
  }
}

function stateSlot<T>(
  state: DaemonStateRoot | undefined,
  kind: string,
  fallback: T,
): { load(): T; save(snapshot: T): void } | undefined {
  if (state === undefined) {
    return undefined;
  }
  const file = state.file<T>(kind, fallback);
  return {
    load: () => file.read(),
    save: (snapshot) => file.write(snapshot),
  };
}

function providerDependencyEvidence(
  providerId: ProviderId,
  dependencyBindings: DependencyBinding[] | undefined,
  providerHost: ProviderHost,
): IndexedDependencyBinding[] | undefined {
  const requires = new CatalogService(
    providerCatalogOptions(dependencyBindings, providerHost),
  ).show(providerId)?.requires;
  return requires !== undefined && requires.length > 0 ? requires : undefined;
}

function buildChannelProvider(opts: {
  providerHost: ProviderHost;
  providerSet?: AppProviderSet | undefined;
  providerId: ProviderId;
  config?: Record<string, unknown>;
  dependencyBindings?: DependencyBinding[];
  graphContext?: ProviderGraphRuntimeContext;
  identity: IdentityService;
  deliverySink?: DeliverySink;
}): ChannelPort {
  const graphInputs =
    opts.graphContext !== undefined
      ? graphProviderCreateInputs(opts.graphContext, "channel", opts.providerId, opts.config ?? {})
      : undefined;
  const dependencyEvidence =
    graphInputs?.dependencyBindings ??
    providerDependencyEvidence(opts.providerId, opts.dependencyBindings, opts.providerHost);
  const serviceBindings = providerServiceBindings(opts.providerSet, "channel", opts.providerId, {});
  return opts.providerHost.createProviderSync("channel", opts.providerId, {
    config: graphInputs?.config ?? opts.config ?? {},
    ...(dependencyEvidence !== undefined ? { dependencyBindings: dependencyEvidence } : {}),
    services: providerServices({
      ...serviceBindings,
      identity: opts.identity,
      "channel.sink": opts.deliverySink ?? deliveryToStdout,
    }),
  });
}

function providerEntrypointClientAssets(
  assets: readonly EntrypointClientAssetMount[] | undefined,
  providerSet: AppProviderSet | undefined,
  host: ProviderHost,
): EntrypointClientAssetMount[] {
  return [...(assets ?? []), ...legacyProviderSetEntrypointClientAssets(providerSet, host)];
}

function providerClientAssetSources(
  assets: readonly EntrypointClientAssetMount[],
): ProviderClientAssetSourceInput[] {
  return assets.map((asset) => {
    const source = asset.source ?? "package";
    const facts = clientAssetFilesystemFacts(asset, source);
    return {
      providerId: asset.providerId,
      ref: asset.ref,
      source,
      root: asset.root,
      ...facts,
      ...(asset.package !== undefined ? { package: asset.package } : {}),
      ...(asset.env !== undefined ? { env: asset.env } : {}),
      ...(asset.cacheControl !== undefined ? { cacheControl: asset.cacheControl } : {}),
      ...(asset.evidence !== undefined ? { evidence: structuredClone(asset.evidence) } : {}),
    };
  });
}

function clientAssetFilesystemFacts(
  asset: EntrypointClientAssetMount,
  source: ProviderClientAssetSourceInput["source"],
): Pick<ProviderClientAssetSourceInput, "exists" | "verified" | "readOnly"> {
  try {
    if (lstatSync(asset.root).isSymbolicLink()) {
      return { exists: true, verified: false, readOnly: false };
    }
    const rootStats = statSync(asset.root);
    if (!rootStats.isDirectory()) {
      return { exists: true, verified: false, readOnly: false };
    }
    const forbiddenWritableBits =
      source === "local-override" || source === "wpm-evidence" ? 0o222 : 0o022;
    const readOnly = asset.readOnly === true && (rootStats.mode & forbiddenWritableBits) === 0;
    return { exists: true, verified: readOnly, readOnly };
  } catch {
    return { exists: false, verified: false };
  }
}

interface ConnectorLifecycleMethods {
  bindSecretRef?(resourceId: string, secretRef: Ref<"secret-ref">): void;
  unbindSecretRef?(resourceId: string): void;
  suspendByResourceId?(resourceId: string): void;
  resumeByResourceId?(resourceId: string): void;
  isSuspended?(resourceIdOrProviderHandle: string): boolean;
  liveSocketCount?(resourceIdOrProviderHandle: string): number;
  hasBinding?(resourceId: string): boolean;
  close?(): Promise<void> | void;
}

function connectorLifecycle(port: AgentConnectorPort): ConnectorLifecycleMethods {
  return port as AgentConnectorPort & ConnectorLifecycleMethods;
}

function managedAgentConnectorPort(port: AgentConnectorPort): ManagedAgentConnectorPort {
  const lifecycle = connectorLifecycle(port);
  const controlsAgentChannel =
    typeof lifecycle.suspendByResourceId === "function" &&
    typeof lifecycle.resumeByResourceId === "function";
  const bound = new Map<string, Ref<"secret-ref">>();
  const suspended = new Set<string>();
  return {
    controlsAgentChannel,
    async attach(runtime) {
      const connector = { ...(await port.attach(runtime)) };
      const secretRef = bound.get(connector.resourceId);
      if (secretRef !== undefined && connector.secret_ref === undefined) {
        connector.secret_ref = secretRef;
      }
      return connector;
    },
    bindSecretRef(resourceId, secretRef) {
      bound.set(resourceId, secretRef);
      lifecycle.bindSecretRef?.(resourceId, secretRef);
    },
    unbindSecretRef(resourceId) {
      bound.delete(resourceId);
      suspended.delete(resourceId);
      lifecycle.unbindSecretRef?.(resourceId);
    },
    suspendByResourceId(resourceId) {
      suspended.add(resourceId);
      lifecycle.suspendByResourceId?.(resourceId);
    },
    resumeByResourceId(resourceId) {
      suspended.delete(resourceId);
      lifecycle.resumeByResourceId?.(resourceId);
    },
    isSuspended(resourceIdOrProviderHandle) {
      return (
        lifecycle.isSuspended?.(resourceIdOrProviderHandle) ??
        suspended.has(resourceIdOrProviderHandle)
      );
    },
    liveSocketCount(resourceIdOrProviderHandle) {
      return lifecycle.liveSocketCount?.(resourceIdOrProviderHandle) ?? 0;
    },
    hasBinding(resourceId) {
      return lifecycle.hasBinding?.(resourceId) ?? bound.has(resourceId);
    },
    async close() {
      await lifecycle.close?.();
    },
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function providerPortCacheKey(providerId: ProviderId, config: Record<string, unknown>): string {
  return `${providerId}\0${stableJson(config)}`;
}

function lazyManagedAgentConnectorPort(
  load: () => Promise<AgentConnectorPort>,
): ManagedAgentConnectorPort {
  let managed: ManagedAgentConnectorPort | undefined;
  let loading: Promise<ManagedAgentConnectorPort> | undefined;
  const get = async (): Promise<ManagedAgentConnectorPort> => {
    if (managed !== undefined) {
      return managed;
    }
    loading ??= load().then((port) => {
      managed = managedAgentConnectorPort(port);
      return managed;
    });
    return loading;
  };
  return {
    get controlsAgentChannel() {
      return managed?.controlsAgentChannel ?? false;
    },
    async attach(runtime) {
      return (await get()).attach(runtime);
    },
    bindSecretRef(resourceId, secretRef) {
      managed?.bindSecretRef(resourceId, secretRef);
    },
    unbindSecretRef(resourceId) {
      managed?.unbindSecretRef(resourceId);
    },
    suspendByResourceId(resourceId) {
      managed?.suspendByResourceId(resourceId);
    },
    resumeByResourceId(resourceId) {
      managed?.resumeByResourceId(resourceId);
    },
    isSuspended(resourceIdOrProviderHandle) {
      return managed?.isSuspended(resourceIdOrProviderHandle) ?? false;
    },
    liveSocketCount(resourceIdOrProviderHandle) {
      return managed?.liveSocketCount(resourceIdOrProviderHandle) ?? 0;
    },
    hasBinding(resourceId) {
      return managed?.hasBinding(resourceId) ?? false;
    },
    async close() {
      await managed?.close?.();
    },
  };
}

function launcherTierFromManifest(
  providerHost: ProviderHost,
  providerId: ProviderId,
): LauncherPort["tier"] {
  const tier = providerHost.providerManifest(providerId)?.spec.capability.isolation_tier;
  switch (tier) {
    case "none":
    case "local-process":
    case "systemd-user":
    case "rootless":
    case "docker":
    case "remote-worker":
      return tier;
    default:
      return "none";
  }
}

function launcherMountCapabilityFromManifest(
  providerHost: ProviderHost,
  providerId: ProviderId,
): MountCapability {
  const mounts = providerHost.providerManifest(providerId)?.spec.capability.mounts as
    | { host_paths?: string[]; modes?: Array<"ro" | "rw"> }
    | undefined;
  if (mounts === undefined) {
    return { file: false, directory: false, modes: [] };
  }
  const hostPaths = mounts.host_paths ?? [];
  return {
    file: hostPaths.includes("file"),
    directory: hostPaths.includes("directory"),
    modes: mounts.modes ?? [],
  };
}

function lazyLauncherPort(
  load: () => Promise<LauncherPort>,
  metadata: { tier: LauncherPort["tier"]; mountCapability: MountCapability },
): LauncherPort {
  let loaded: Promise<LauncherPort> | undefined;
  const get = () => {
    loaded ??= load();
    return loaded;
  };
  return {
    tier: metadata.tier,
    mountCapability: metadata.mountCapability,
    async spawn(spec, asUid) {
      return (await get()).spawn(spec, asUid);
    },
    async health(handle) {
      return (await get()).health(handle);
    },
    async stop(handle) {
      return (await get()).stop(handle);
    },
  };
}

function providerPlanEntry(
  plan: ResolvedCapsulePlan,
  role: string,
  preferredProviderId?: ProviderId,
): ResolvedCapsulePlan["providers"][number] | undefined {
  if (preferredProviderId !== undefined) {
    const preferred = plan.providers.find(
      (provider) => provider.role === role && provider.providerId === preferredProviderId,
    );
    if (preferred !== undefined) {
      return preferred;
    }
  }
  return plan.providers.find((provider) => provider.role === role);
}

function capsulePlanFromSpec(spec: ResolvedAssemblySpec): ResolvedCapsulePlan {
  const providers: ResolvedCapsulePlan["providers"] = [];
  const add = (
    role: string,
    ref: { use: string; params?: Record<string, unknown> } | undefined,
  ) => {
    if (ref === undefined) {
      return;
    }
    providers.push({
      role,
      providerId: ref.use,
      config: structuredClone(ref.params ?? {}),
      available: true,
      evidenceRequirements: [],
      diagnostics: [],
    });
  };
  add("launcher", spec.spec.launcher);
  add("workspace", spec.spec.workspace);
  add("connector", spec.spec.connector);
  for (const entrypoint of spec.spec.entrypoints ?? []) {
    add("entrypoint", entrypoint);
  }
  for (const detector of spec.spec.detectors ?? []) {
    add("detector", detector);
  }
  return { template: spec.spec.template, providers };
}

function providerConfigForPlan(
  plan: ResolvedCapsulePlan,
  role: string,
  preferredProviderId: ProviderId,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const config = providerPlanEntry(plan, role, preferredProviderId)?.config;
  return config !== undefined ? { ...fallback, ...config } : fallback;
}

function workspaceProviderIdForPlan(
  plan: ResolvedCapsulePlan,
  spec: ResolvedAssemblySpec,
  fallback: ProviderId,
): ProviderId {
  return (providerPlanEntry(plan, "workspace", spec.spec.workspace?.use)?.providerId ??
    spec.spec.workspace?.use ??
    fallback) as ProviderId;
}

function connectorProviderIdForPlan(
  plan: ResolvedCapsulePlan,
  spec: ResolvedAssemblySpec,
  fallback: ProviderId,
): ProviderId {
  return (providerPlanEntry(plan, "connector", spec.spec.connector?.use)?.providerId ??
    spec.spec.connector?.use ??
    fallback) as ProviderId;
}

function entrypointProviderIdForPlan(
  plan: ResolvedCapsulePlan,
  spec: ResolvedAssemblySpec,
  fallback: ProviderId,
): ProviderId {
  const explicitProvider = spec.spec.entrypoints?.[0]?.use;
  return (providerPlanEntry(plan, "entrypoint", explicitProvider)?.providerId ??
    explicitProvider ??
    fallback) as ProviderId;
}

function detectorProviderIdForSpec(spec: ResolvedAssemblySpec, fallback: ProviderId): ProviderId {
  const detectors = spec.spec.detectors ?? [];
  const withParams = detectors.find((detector) => hasEntries(detector.params));
  if (withParams !== undefined) {
    return withParams.use;
  }
  const explicitDefault = detectors.find((detector) => detector.use === fallback);
  if (explicitDefault !== undefined) {
    return explicitDefault.use;
  }
  return detectors[0]?.use ?? fallback;
}

function detectorProviderIdForPlan(
  plan: ResolvedCapsulePlan,
  spec: ResolvedAssemblySpec,
  fallback: ProviderId,
): ProviderId {
  const specProvider = detectorProviderIdForSpec(spec, fallback);
  return (providerPlanEntry(plan, "detector", specProvider)?.providerId ??
    specProvider) as ProviderId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusRulesFrom(value: unknown): DetectorContract["statuses"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const out: DetectorContract["statuses"] = {};
  for (const [status, rule] of Object.entries(value)) {
    if (!isRecord(rule) || typeof rule.status !== "string" || rule.status.length === 0) {
      return undefined;
    }
    out[status] =
      typeof rule.next === "string" && rule.next.length > 0
        ? { status: rule.status, next: rule.next }
        : { status: rule.status };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function completionCapability(
  providerHost: ProviderHost,
  providerId: ProviderId,
): Record<string, unknown> {
  const completion = providerHost.providerManifest(providerId)?.spec.capability.completion;
  if (!isRecord(completion)) {
    throw glaError(
      "catalog.unknown",
      `detector provider "${providerId}" has no completion contract metadata`,
      {
        detail: { providerId },
      },
    );
  }
  return completion;
}

function detectorParams(
  session: SessionService | undefined,
  sessionId: import("@gla/kernel").SessionId,
  detectorProviderId: ProviderId,
): Record<string, unknown> {
  return declaredDetectorPart(session, sessionId, detectorProviderId)?.params ?? {};
}

function declaredDetectorPart(
  session: SessionService | undefined,
  sessionId: import("@gla/kernel").SessionId,
  detectorProviderId: ProviderId,
): { params?: Record<string, unknown> } | undefined {
  if (session === undefined) {
    return undefined;
  }
  try {
    const spec = session.get(sessionId).spec;
    return spec.spec.detectors?.find((d) => d.use === detectorProviderId) as
      | { params?: Record<string, unknown> }
      | undefined;
  } catch {
    // Unknown session (shouldn't happen on a live window) -> no declared detector.
    return undefined;
  }
}

function buildDetectorContract(
  session: SessionService | undefined,
  sessionId: import("@gla/kernel").SessionId,
  providerHost: ProviderHost,
  detectorProviderId: ProviderId,
  statusMap:
    | {
        intermediate?: { status: string; next?: string };
        complete: { status: string; next?: string };
      }
    | undefined,
): DetectorContract {
  if (declaredDetectorPart(session, sessionId, detectorProviderId) === undefined) {
    return { detector: detectorProviderId, statuses: {} };
  }
  const completion = completionCapability(providerHost, detectorProviderId);
  let statuses = statusRulesFrom(completion.statuses);
  if (statusMap !== undefined) {
    statuses = {
      "url-complete": statusMap.complete,
      ...(statusMap.intermediate !== undefined
        ? { "url-intermediate": statusMap.intermediate }
        : {}),
    };
  }
  if (statuses === undefined) {
    throw glaError(
      "catalog.unknown",
      `detector provider "${detectorProviderId}" has no completion status rules`,
      {
        detail: { providerId: detectorProviderId },
      },
    );
  }
  const contract: DetectorContract = { detector: detectorProviderId, statuses };
  if (isRecord(completion.resultSchema)) {
    const shape = validateSchemaShape(completion.resultSchema);
    if (!shape.ok) {
      throw glaError(
        "policy.denied",
        `detector provider "${detectorProviderId}" declares an invalid completion result schema`,
        { detail: { providerId: detectorProviderId, defects: shape.defects } },
      );
    }
    contract.resultSchema = completion.resultSchema as unknown as ConfigSchema;
  }
  return contract;
}

/** Options for {@link createBridge}: an override Cedar policy set plus provider-set composition inputs. */
export interface CreateBridgeOptions extends ProviderCompositionOptions {
  /** The Cedar policy set source (defaults to {@link MVP_POLICY_SET}). */
  policySet?: string;
  /** Structured WPM dependency binding receipts. Absent means host-touching catalog providers are unavailable. */
  dependencyBindings?: DependencyBinding[];
}

/**
 * Compose the runnable {@link AgentBridge} with the **real Cedar PolicyPort** injected into admission
 * (Slice 2). This is the single place the Cedar adapter meets the kernel `PolicyPort`. A real-run
 * `session create` dispatches a Session in `issued` — NO spawn (provisioning is `createProvisioningBridge`).
 */
export function createBridge(opts: CreateBridgeOptions = {}): AgentBridge {
  const providerHost = requireProviderHost(opts);
  const selections = resolveProviderSelections(opts);
  const entrypointClientAssets = providerEntrypointClientAssets(
    opts.entrypointClientAssets,
    opts.providerSet,
    providerHost,
  );
  const graphContext = providerGraphRuntimeContext({
    providerHost,
    providerSet: opts.providerSet,
    capsule: selections.capsule,
    profileManifest: selections.profileManifest,
    dependencyBindings: opts.dependencyBindings,
    configValidationProviderIds: [],
    templateProbes: opts.templateProbes,
    entrypointClientAssets,
  });
  const catalogOptions = graphContext.catalogOptions;
  const catalog = new CatalogService(catalogOptions);
  const policy = new CedarPolicyAdapter(
    opts.policySet !== undefined ? { policySet: opts.policySet } : { policySet: MVP_POLICY_SET },
  );
  const admission = new AdmissionService({
    policy,
    catalog: toAdmissionCatalogFromProviderGraphProjection(graphContext.graph),
  });
  void graphContext.doctor;
  return new AgentBridge({ catalog, admission });
}

/** Options for {@link createProvisioningBridge}. */
export interface CreateProvisioningBridgeOptions extends CreateBridgeOptions {
  /** Opaque launcher provider id. Default `"launcher-process"`. */
  launcherProvider?: ProviderId;
  /** Provider-owned launcher config. Defaults preserve the legacy launcher options for launcher-process. */
  launcherProviderConfig?: Record<string, unknown>;
  /** Force the launcher mode (tests / hermes-1): default `"auto"` (full if Xvfb/x11vnc/websockify, else headless). */
  launcherMode?: "auto" | "full" | "headless";
  /** Opaque workspace provider id. Default `"workspace-profile"`. */
  workspaceProvider?: ProviderId;
  /** Provider-owned workspace config. Defaults preserve the legacy workspaceRoot option for workspace-profile. */
  workspaceProviderConfig?: Record<string, unknown>;
  /** Opaque agent-connector provider id. Default `"connector-cdp"`. */
  connectorProvider?: ProviderId;
  /** Provider-owned agent-connector config. */
  connectorProviderConfig?: Record<string, unknown>;
  /** Opaque human-entrypoint provider id. Default `"entrypoint-novnc"` when handoff is wired. */
  entrypointProvider?: ProviderId;
  /** Provider-owned human-entrypoint config. */
  entrypointProviderConfig?: Record<string, unknown>;
  /** Opaque completion-detector provider id. Default `"url-watcher"` when completion is wired. */
  detectorProvider?: ProviderId;
  /** Provider-owned completion-detector config. */
  detectorProviderConfig?: Record<string, unknown>;
  /** Opaque channel-provider id. Default `"channel-cli"` when handoff delivery is wired. */
  channelProvider?: ProviderId;
  /** Provider-owned channel config. Defaults preserve the CLI channel's injected-sink behaviour. */
  channelProviderConfig?: Record<string, unknown>;
  /** Override the workspace root (tests pass a scratch dir under which profile dirs are created). */
  workspaceRoot?: string;
  /**
   * Restart-safe daemon state root. When set, security-critical daemon facts are encrypted, authenticated, and
   * stored here with 0700/0600 permissions before the public gateway is bound.
   */
  stateRoot?: string;
  /** Override the Chromium executable path (default: the cached browser via playwright-core). */
  chromiumPath?: string;
  /** Override the CDP start timeout, ms. */
  startTimeoutMs?: number;
  /**
   * Wire the Slice-4b HANDOFF pipeline into the SessionService (so `handoff open/wait/get/list/cancel` work). When
   * present, the Access Gateway + Route controller + identity step-up are wired and the session's open-window saga
   * mints a recipient-bound grant, programs a route, and delivers the link. Requires the WebAuthn rp config (the
   * gateway runs the step-up against the enrolled credential).
   */
  handoff?: {
    /**
     * The auth provider to wire behind the kernel `AuthProviderPort` (doc §1/§7). Default `"webauthn"` (the
     * in-tree default. Non-default providers receive {@link AuthProviderSelection.authProviderConfig}.
     */
    authProvider?: AuthProviderKind;
    /** Provider-owned auth config, validated by the selected provider's registered schema. */
    authProviderConfig?: AuthProviderConfig;
    /** The Relying-Party ID the passkey is bound to (no scheme/port). Default `"localhost"`. WebAuthn-path config. */
    rpID?: string;
    /** The human-visible RP name. Default `"GLA"`. WebAuthn-path config. */
    rpName?: string;
    /** The expected page ORIGIN(s) the step-up ceremony runs on (scheme+host+port). WebAuthn-path config. */
    expectedOrigin: string | string[];
    /** The public base URL handoff links are built against, e.g. `http://localhost:3000`. */
    publicBaseUrl: string;
    /**
     * Trust `X-Forwarded-Prefix` for strip-prefix reverse proxies. Enable only behind an edge that sanitizes that
     * header; prefix-preserving proxying does not need it.
     */
    trustForwardedPrefix?: boolean;
    /** Gateway bind host. Default `0.0.0.0` (hermes-1); tests pass `127.0.0.1`. */
    host?: string;
    /** Gateway bind port. Default `3000`; tests pass `0` for an ephemeral port. */
    port?: number;
    /**
     * The AUTH-REUSE TTL (ms) — how long a recipient's successful step-up stays valid for REUSE on a LATER handoff
     * window for the SAME recipient (scenario-01 Phase 12, GLA-050/051: "auth still valid, no re-prompt"). Within
     * the TTL, a second window for that recipient opens with NO fresh WebAuthn ceremony; an expired/absent validity
     * (or a different recipient) re-prompts (Phase 6). The grant is STILL verified cryptographically every request.
     * Defaults to the gateway default (≈15m, the window TTL). Set 0 to disable reuse (always re-prompt).
     */
    authReuseTtlMs?: number;
    /**
     * Provider-neutral assurance policy profile for handoff step-up. Default `"phishing-resistant"` requires
     * passkey-grade evidence; `"password-permitted"` explicitly admits password-grade evidence.
     */
    authAssuranceProfile?: AuthAssuranceProfile;
    /**
     * Deprecated compatibility input. Prefer {@link authAssuranceProfile}. `"password"` maps to
     * `"password-permitted"`; `"webauthn"` maps to `"phishing-resistant"`.
     */
    requiredAuthStrength?: "password" | "webauthn";
    /** Where the channel writes the recipient-bound handoff link (defaults to stdout). */
    deliverySink?: DeliverySink;
    /** A shared identity service (so enrollment + handoff use the SAME enrolled credential store). */
    identity?: IdentityService;
    /**
     * Override the human-entrypoint resolver the open-window saga exposes. Tests inject stubs with different
     * provider/client/transport bindings; the real adapter supplies the current live-view transport in full mode.
     */
    entrypoint?: {
      open(
        handle: import("@gla/kernel").RuntimeHandle,
      ): Promise<import("@gla/kernel").HumanEntrypointBinding>;
    };
    /**
     * Wire the Slice-5 COMPLETION-CLOSE pipeline (so a validated done-signal RETURNS to `handoff wait` and CLOSES
     * the window — scenario-01 Phase 8/13). When present, the url-watcher detector watches each open window's live
     * URL over CDP; a match is validated by the Completion service against the declared detector contract and
     * normalized to an envelope; the session runs the close-window step (reverse-of-open) and returns to `active`
     * with the capsule running. The agent connector is SUSPENDED while a window is open (S-2 agent-blind) and
     * RESUMED on close. When absent, the Slice-4b behaviour holds (the window TTL-expires; `handoff wait` exit 6).
     */
    completion?: {
      /**
       * The url-watcher → envelope status map (the detector/template author's declaration, like a `config_schema`).
       * When absent, the selected provider's manifest supplies raw-status normalization rules.
       */
      statusMap?: {
        intermediate?: { status: string; next?: string };
        complete: { status: string; next?: string };
      };
      /**
       * A custom URL reader for the detector (tests inject a scripted `/register`→`/verify`→`/dashboard` sequence);
       * the default reads the capsule's CDP `/json` active-target URL. A non-firing reader → the window TTL-expires.
       */
      readUrl?: (handle: import("@gla/kernel").RuntimeHandle) => Promise<string | undefined>;
      /** The detector poll interval (ms). Default 200. */
      pollMs?: number;
    };
  };
}

/** Agent-connector shape the app/session need after provider selection, with optional test observability. */
export interface ManagedAgentConnectorPort {
  readonly controlsAgentChannel: boolean;
  attach(runtime: RuntimeHandle): Promise<AgentConnector>;
  bindSecretRef(resourceId: string, secretRef: Ref<"secret-ref">): void;
  unbindSecretRef(resourceId: string): void;
  suspendByResourceId(resourceId: string): void;
  resumeByResourceId(resourceId: string): void;
  isSuspended(resourceIdOrProviderHandle: string): boolean;
  liveSocketCount(resourceIdOrProviderHandle: string): number;
  hasBinding(resourceId: string): boolean;
  close(): Promise<void>;
}

/** A provisioning bridge plus the worker handles a caller can use to reconcile/teardown (tests, shutdown). */
export interface ProvisioningStack {
  /** Resolves after restart recovery has converged; public listeners must not bind before this is settled. */
  ready: Promise<void>;
  /** Idempotently closes runtime handles owned by this stack, including the daemon state-root lock. */
  close(): Promise<void>;
  bridge: AgentBridge;
  /** Doctor/readiness report derived from the same resolved provider graph used for boot and admission. */
  providerGraphDoctor: ProviderGraphDoctorReport;
  /** The capsule lifecycle manager (spawn/health/stop tracking). */
  lifecycle: CapsuleLifecycleManager;
  /** The cleanup reconciler (idempotent terminal-session teardown + orphan scan). */
  reconciler: CleanupReconciler;
  /** The spawner registry (so a test can register a second launcher — the pluggability proof). */
  registry: SpawnerRegistry;
  /** The selected human-entrypoint provider, present when handoff composition requires one. */
  entrypoint?: HumanEntrypointPort;
  /** The SHARED capability service (one signer for the anchor + task + connector caps). */
  capability: CapabilityService;
  /** The SHARED task service (so a caller can resolve a task's cap id / drive teardown). */
  task: TaskService;
  /** The provision-capable session service (so a caller can observe connector lineage / teardown). */
  session: SessionService;
  /** The selected agent-connector provider, normalized to the app/session connector lifecycle contract. */
  connector: ManagedAgentConnectorPort;
  /** The selected completion-detector provider, present when completion watching is wired. */
  detector?: CompletionDetectorPort;
  /** The Access Gateway (Slice 4b: the sole public entry; serves the handoff step-up + proxies the WS). Present only when handoff is wired. */
  gateway?: AccessGateway;
  /** The Route controller (Slice 4b: programs grant-bound routes on the gateway). Present only when handoff is wired. */
  route?: RouteController;
  /** The identity service (Slice 4b: enrolled-credential store the gateway steps up against). Present only when handoff is wired. */
  identity?: IdentityService;
  /**
   * The auth module actually wired behind the kernel `AuthProviderPort` (the wiring record, doc §7):
   * Adapter module marker mapped from the selected auth provider id by the trusted provider set.
   * Lets a caller/test observe WHICH provider was selected without reaching into the identity service.
   */
  authModule: string;
  /**
   * The OPERATOR enrollment action (Phase E; present only when handoff is wired, since the gateway then fronts
   * enrollment too). Mint a single-use operator-discharge grant bound to the recipient + deliver the enrollment
   * invite link. Returns an operator-safe read model; the usable grant-bearing link is delivered only through the
   * recipient channel.
   */
  enrollInvite?: (
    recipient: RecipientRef,
  ) => Promise<{ link: string; grant: OpaqueToken; nonce: string }>;
  /**
   * The public base URL handoff/enroll links are built against (present only when handoff is wired) — so a caller can
   * compose links the same way the gateway does.
   */
  publicBaseUrl?: string;
}

/**
 * Compose a PROVISIONING {@link AgentBridge} (Slice 3) — the Slice-2 Cedar admission PLUS the real
 * worker plane wired into a `provision()`-capable SessionService. This is where the worker/launcher/
 * connector/entrypoint adapters meet their kernel ports:
 *   - SpawnerRegistry ← the process launcher (T2, default; headless ‖ full, auto-detected)
 *   - WorkspaceManager ← the temp-profile workspace adapter
 *   - CapsuleLifecycleManager(registry, workspace) — spawn→health→stop, no-orphan teardown
 *   - the CDP connector adapter (agent-blind secret_ref) + the noVNC entrypoint adapter
 *   - CapabilityService.mintConnector — the agent-connector capability (agent-blind ref)
 * A real-run `session create` then provisions a live capsule and returns `{capsule, connector}`; `session
 * connector` re-emits it; teardown leaves no orphan. Returns the bridge + the worker handles.
 */
export function createProvisioningBridge(
  opts: CreateProvisioningBridgeOptions = {},
): ProvisioningStack {
  const providerHost = requireProviderHost(opts);
  const capsuleProviderOverrides: CapsuleProviderSelectionInput = {
    ...(opts.launcherProvider !== undefined ? { launcher: opts.launcherProvider } : {}),
    ...(opts.workspaceProvider !== undefined ? { workspace: opts.workspaceProvider } : {}),
    ...(opts.connectorProvider !== undefined ? { connector: opts.connectorProvider } : {}),
    ...(opts.entrypointProvider !== undefined ? { entrypoint: opts.entrypointProvider } : {}),
    ...(opts.detectorProvider !== undefined ? { detector: opts.detectorProvider } : {}),
  };
  const deploymentOverrides: AppDeploymentConfigInput = {
    ...(opts.channelProvider !== undefined ? { channel: opts.channelProvider } : {}),
    ...(opts.handoff?.authProvider !== undefined ? { auth: opts.handoff.authProvider } : {}),
  };
  const selections = resolveProviderSelections(opts, {
    deployment: deploymentOverrides,
    capsule: capsuleProviderOverrides,
  });
  const deployment = selections.deployment;
  const capsule = selections.capsule;
  const state =
    opts.stateRoot !== undefined
      ? DaemonStateRoot.open({
          root: opts.stateRoot,
          unsafeRoots: opts.workspaceRoot !== undefined ? [opts.workspaceRoot] : [],
        })
      : undefined;
  let stateOwnedByStack = false;
  try {
    verifyProviderStateRecovery(state, providerHost);
    const launcherProviderId = capsule.launcher;
    const workspaceProviderId = capsule.workspace;
    const connectorProviderId = capsule.connector;
    const entrypointProviderId = capsule.entrypoint;
    const detectorProviderId = capsule.detector;
    const channelProviderId = deployment.channel;
    const launcherDefaultConfig = capsuleProviderConfig(opts, launcherProviderId);
    const launcherBootConfig = providerConfig(
      opts.launcherProviderConfig,
      opts.providerSet,
      "launcher",
      launcherProviderId,
      providerBootFallbackConfig(providerHost, launcherProviderId, {
        ...(opts.launcherMode !== undefined
          ? { mode: opts.launcherMode }
          : launcherDefaultConfig?.mode === undefined
            ? { mode: "auto" }
            : {}),
        ...(opts.chromiumPath !== undefined ? { chromiumPath: opts.chromiumPath } : {}),
        ...(opts.startTimeoutMs !== undefined ? { startTimeoutMs: opts.startTimeoutMs } : {}),
      }),
      launcherDefaultConfig,
    );
    const workspaceBootConfig = providerConfig(
      opts.workspaceProviderConfig,
      opts.providerSet,
      "workspace",
      workspaceProviderId,
      providerBootFallbackConfig(providerHost, workspaceProviderId, {
        ...(opts.workspaceRoot !== undefined ? { root: opts.workspaceRoot } : {}),
      }),
      capsuleProviderConfig(opts, workspaceProviderId),
    );
    const connectorBootConfig = providerConfig(
      opts.connectorProviderConfig,
      opts.providerSet,
      "connector",
      connectorProviderId,
      {},
      capsuleProviderConfig(opts, connectorProviderId),
    );
    const entrypointBootConfig = providerConfig(
      opts.entrypointProviderConfig,
      opts.providerSet,
      "entrypoint",
      entrypointProviderId,
      {},
      capsuleProviderConfig(opts, entrypointProviderId),
    );
    const detectorFactoryConfig = (providerId: ProviderId): Record<string, unknown> =>
      opts.handoff?.completion !== undefined
        ? providerConfig(
            opts.detectorProviderConfig,
            opts.providerSet,
            "detector",
            providerId,
            {
              ...providerBootFallbackConfig(providerHost, providerId, {
                ...(opts.handoff.completion.pollMs !== undefined
                  ? { pollMs: opts.handoff.completion.pollMs }
                  : {}),
              }),
            },
            capsuleProviderConfig(opts, providerId),
          )
        : providerConfig(
            opts.detectorProviderConfig,
            opts.providerSet,
            "detector",
            providerId,
            {},
            capsuleProviderConfig(opts, providerId),
          );
    const detectorBootConfig = detectorFactoryConfig(detectorProviderId);
    const channelBootConfig = providerConfig(
      opts.channelProviderConfig,
      opts.providerSet,
      "channel",
      channelProviderId,
      providerBootFallbackConfig(providerHost, channelProviderId, {
        ...(opts.handoff?.deliverySink !== undefined ? { delivery: "injected" } : {}),
      }),
      deploymentProviderConfig(deployment, channelProviderId),
    );
    const authBootConfig =
      opts.handoff !== undefined
        ? providerConfig(
            opts.handoff.authProviderConfig,
            opts.providerSet,
            "auth",
            deployment.auth,
            {
              rpID: opts.handoff.rpID ?? "localhost",
              rpName: opts.handoff.rpName ?? "GLA",
              expectedOrigin: Array.isArray(opts.handoff.expectedOrigin)
                ? opts.handoff.expectedOrigin
                : [opts.handoff.expectedOrigin],
            },
            deploymentProviderConfig(deployment, deployment.auth),
          )
        : undefined;
    const runtimeAssemblyParams: Record<string, Record<string, unknown>> = {};
    addRuntimeParams(runtimeAssemblyParams, launcherProviderId, launcherBootConfig);
    addRuntimeParams(runtimeAssemblyParams, workspaceProviderId, workspaceBootConfig);
    addRuntimeParams(runtimeAssemblyParams, connectorProviderId, connectorBootConfig);
    addRuntimeParams(runtimeAssemblyParams, entrypointProviderId, entrypointBootConfig);
    addRuntimeParams(runtimeAssemblyParams, detectorProviderId, detectorBootConfig);
    addRuntimeParams(runtimeAssemblyParams, channelProviderId, channelBootConfig);
    addRuntimeParams(runtimeAssemblyParams, deployment.auth, authBootConfig);
    const configValidationProviderIds = [
      launcherProviderId,
      workspaceProviderId,
      connectorProviderId,
      ...(opts.handoff !== undefined
        ? [deployment.auth, channelProviderId, entrypointProviderId]
        : []),
      ...(opts.handoff?.completion !== undefined ? [detectorProviderId] : []),
    ];

    const entrypointClientAssets = providerEntrypointClientAssets(
      opts.entrypointClientAssets,
      opts.providerSet,
      providerHost,
    );
    const graphContext = providerGraphRuntimeContext({
      providerHost,
      providerSet: opts.providerSet,
      capsule,
      profileManifest: selections.profileManifest,
      dependencyBindings: opts.dependencyBindings,
      runtimeAssemblyParams,
      configValidationProviderIds,
      templateProbes: opts.templateProbes,
      entrypointClientAssets,
    });
    const catalogOptions = graphContext.catalogOptions;
    const catalog = new CatalogService(catalogOptions);
    const policy = new CedarPolicyAdapter(
      opts.policySet !== undefined ? { policySet: opts.policySet } : { policySet: MVP_POLICY_SET },
    );
    const admission = new AdmissionService({
      policy,
      catalog: toAdmissionCatalogFromProviderGraphProjection(graphContext.graph),
    });

    // ── Worker plane: Provider Host creates launcher/workspace ports, then worker core receives only ports.
    const registry = new SpawnerRegistry();
    const loadLauncherProvider = async (
      providerId: ProviderId,
      config: Record<string, unknown>,
    ) => {
      const launcherCreateInputs = graphProviderCreateInputs(
        graphContext,
        "launcher",
        providerId,
        config,
        { preferProvidedConfig: true },
      );
      return providerHost.createProvider("launcher", providerId, {
        config: launcherCreateInputs.config,
        ...(launcherCreateInputs.dependencyBindings !== undefined
          ? { dependencyBindings: launcherCreateInputs.dependencyBindings }
          : {}),
      });
    };
    if (!registry.has(launcherProviderId)) {
      registry.register(
        launcherProviderId,
        lazyLauncherPort(() => loadLauncherProvider(launcherProviderId, launcherBootConfig), {
          tier: launcherTierFromManifest(providerHost, launcherProviderId),
          mountCapability: launcherMountCapabilityFromManifest(providerHost, launcherProviderId),
        }),
        { default: true },
      );
    }

    const workspaceManagers = new Map<string, WorkspaceManager>();
    const workspaceManagerForProvider = async (
      providerId: ProviderId,
      config: Record<string, unknown>,
    ): Promise<WorkspaceManager> => {
      const key = providerPortCacheKey(providerId, config);
      const existing = workspaceManagers.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const workspaceCreateInputs = graphProviderCreateInputs(
        graphContext,
        "workspace",
        providerId,
        config,
        { preferProvidedConfig: true },
      );
      const port = await providerHost.createProvider("workspace", providerId, {
        config: workspaceCreateInputs.config,
        ...(workspaceCreateInputs.dependencyBindings !== undefined
          ? { dependencyBindings: workspaceCreateInputs.dependencyBindings }
          : {}),
      });
      const manager = new WorkspaceManager(port);
      workspaceManagers.set(key, manager);
      return manager;
    };
    const lifecycleStore = stateSlot<CapsuleRecord[]>(state, "worker.lifecycle", []);
    const lifecycle = new CapsuleLifecycleManager({
      registry,
      launcherFor: (providerId, config) => loadLauncherProvider(providerId as ProviderId, config),
      workspaceFor: (plan, spec) => {
        const providerId = workspaceProviderIdForPlan(plan, spec, workspaceProviderId);
        return workspaceManagerForProvider(
          providerId,
          providerConfigForPlan(plan, "workspace", providerId, workspaceBootConfig),
        );
      },
      workspaceByProviderId: (providerId, config = {}) =>
        workspaceManagerForProvider(providerId as ProviderId, config),
      ...(lifecycleStore !== undefined ? { store: lifecycleStore } : {}),
    });

    // ── ONE shared capability signer underpins the agent-authority anchor, the TASK capability, AND the
    //    agent-connector capability — so the connector genuinely DESCENDS from the task cap (same key) and
    //    a revocation of the task cap CASCADES to the connector by lineage (capability-service.md). Using
    //    separate signers would break both the lineage tag and the shared revocation snapshot.
    const signer = new HmacCapabilitySigner(
      state?.secretBytes("capability.signing-key", 32),
      state?.revocations("capability.revocations"),
    );
    const capability = new CapabilityService(
      signer,
      state !== undefined
        ? { spentNonces: state.stringSet("capability.spent-enrollment-nonces") }
        : {},
    );
    const connectorPorts = new Map<string, ManagedAgentConnectorPort>();
    const connectorForProvider = (
      providerId: ProviderId,
      config: Record<string, unknown> = {},
    ): ManagedAgentConnectorPort => {
      const key = providerPortCacheKey(providerId, config);
      let port = connectorPorts.get(key);
      if (port !== undefined) {
        return port;
      }
      port = lazyManagedAgentConnectorPort(async () => {
        const connectorCreateInputs = graphProviderCreateInputs(
          graphContext,
          "connector",
          providerId,
          config,
          { preferProvidedConfig: true },
        );
        return providerHost.createProvider("connector", providerId, {
          config: connectorCreateInputs.config,
          ...(connectorCreateInputs.dependencyBindings !== undefined
            ? { dependencyBindings: connectorCreateInputs.dependencyBindings }
            : {}),
        });
      });
      connectorPorts.set(key, port);
      return port;
    };
    const connector = connectorForProvider(connectorProviderId, connectorBootConfig);
    // A holder so the Task service's TEARDOWN dep (Slice 7) can call the SessionService's terminal
    // `teardownSession` — the SessionService is constructed later (it needs the handoff/completion deps),
    // so the closure reads it from `.svc` (assigned once built). Avoids a forward `let` / construction cycle.
    const sessionRef: { svc?: SessionService } = {};
    const connectorProviderIdForSession = (sessionId: SessionId): ProviderId => {
      const session = sessionRef.svc?.get(sessionId);
      return session !== undefined
        ? connectorProviderIdForPlan(
            session.capsulePlan ?? capsulePlanFromSpec(session.spec),
            session.spec,
            connectorProviderId,
          )
        : connectorProviderId;
    };
    const connectorProviderConfigForSession = (
      sessionId: SessionId,
      providerId: ProviderId,
    ): Record<string, unknown> => {
      const session = sessionRef.svc?.get(sessionId);
      return session !== undefined
        ? providerConfigForPlan(
            session.capsulePlan ?? capsulePlanFromSpec(session.spec),
            "connector",
            providerId,
            connectorBootConfig,
          )
        : connectorBootConfig;
    };
    const connectorForSession = (sessionId: SessionId): ManagedAgentConnectorPort =>
      connectorForProvider(
        connectorProviderIdForSession(sessionId),
        connectorProviderConfigForSession(sessionId, connectorProviderIdForSession(sessionId)),
      );
    // ── Slice 7 — the Task service is built with its TERMINAL-teardown wiring: `task complete`/`task revoke`
    //    tear down every session under the task (via the SessionService's `teardownSession`) and revoke the
    //    task capability (which, by lineage, stops every descendant cap — the session grants + the connector —
    //    verifying; kernel-contracts.md §2). The session teardown is delegated; the cap revoke is the Task
    //    service's own job via the shared signer it already holds.
    const taskStore = stateSlot<TaskServiceSnapshot>(state, "task.state", {
      tasks: [],
      tokens: [],
    });
    const taskOptions: ConstructorParameters<typeof TaskService>[0] = {
      capability: signer,
      teardown: {
        teardownSession: (sessionId, disposition) =>
          sessionRef.svc?.teardownSession(sessionId, disposition) ?? Promise.resolve(),
      },
    };
    if (taskStore !== undefined) {
      taskOptions.store = taskStore;
    }
    const task = new TaskService(taskOptions);

    // ── Slice 4b — the HANDOFF pipeline (the Access Gateway + Route controller + identity step-up + channel),
    //    wired into the SessionService's open-window saga when `opts.handoff` is present. The gateway is the sole
    //    public entry (it serves the step-up + proxies the WS); the route controller programs grant-bound routes ON
    //    the gateway; the saga mints a recipient-bound grant (attenuated from the task cap), programs the route, and
    //    delivers the recipient-bound link.
    let gateway: AccessGateway | undefined;
    let route: RouteController | undefined;
    let identity: IdentityService | undefined;
    let entrypoint: HumanEntrypointPort | undefined;
    let detector: CompletionDetectorPort | undefined;
    let handoffDeps: HandoffDeps | undefined;
    let completionDeps: CompletionDeps | undefined;
    /** The auth module actually wired behind the AuthProviderPort (doc §7 wiring record). */
    let authModule: string = providerModuleId(providerHost, "auth", deployment.auth);
    /** The operator enrollment action (wired when handoff is, since the same gateway then fronts enrollment). */
    let enrollInvite:
      | ((recipient: RecipientRef) => Promise<{ link: string; grant: OpaqueToken; nonce: string }>)
      | undefined;
    let publicBaseUrl: string | undefined;
    // (`sessionRef` is declared above with the Task-service teardown wiring — the completion deps' closures
    //  resolved only when a window opens/closes read the SessionService back from `.svc` once it is built.)
    if (opts.handoff !== undefined) {
      const h = opts.handoff;
      // Provider selection (doc §1/§7): default → the in-tree WebAuthn provider (unchanged); `authentik` → the
      // delegated OIDC adapter. Both implement `AuthProviderPort`, so the IdentityService injection is identical.
      const selected = buildAuthProvider(
        {
          ...(h.authProvider !== undefined ? { authProvider: h.authProvider } : {}),
          ...(h.authProviderConfig !== undefined
            ? { authProviderConfig: h.authProviderConfig }
            : {}),
        },
        {
          rpID: h.rpID ?? "localhost",
          rpName: h.rpName ?? "GLA",
          expectedOrigin: h.expectedOrigin,
        },
        providerStateRoot(state),
        providerDependencyEvidence(
          h.authProvider ?? deployment.auth,
          opts.dependencyBindings,
          providerHost,
        ),
        providerHost,
        opts.providerSet,
        deployment.auth,
        graphContext,
        deploymentProviderConfig(deployment, deployment.auth),
      );
      authModule = selected.module;
      identity =
        h.identity ??
        new IdentityService({
          authProvider: selected.provider,
          ...(state !== undefined
            ? { enrollments: state.kv<EnrollmentRecord>("identity.enrollments") }
            : {}),
        });
      const channel = buildChannelProvider({
        providerHost,
        providerSet: opts.providerSet,
        providerId: channelProviderId,
        config: channelBootConfig,
        graphContext,
        identity,
        ...(opts.dependencyBindings !== undefined
          ? { dependencyBindings: opts.dependencyBindings }
          : {}),
        ...(h.deliverySink !== undefined ? { deliverySink: h.deliverySink } : {}),
      });
      const authAssurancePolicy =
        h.authAssuranceProfile !== undefined
          ? authAssurancePolicyFromProfile(h.authAssuranceProfile)
          : h.requiredAuthStrength !== undefined
            ? authAssurancePolicyFromRequiredAuthStrength(h.requiredAuthStrength)
            : undefined;
      const entrypointPorts = new Map<string, HumanEntrypointPort>();
      const entrypointForProvider = (
        providerId: ProviderId,
        config: Record<string, unknown> = {},
      ): HumanEntrypointPort => {
        if (h.entrypoint !== undefined && providerId === entrypointProviderId) {
          return h.entrypoint;
        }
        const key = providerPortCacheKey(providerId, config);
        let port = entrypointPorts.get(key);
        if (port !== undefined) {
          return port;
        }
        let loaded: Promise<HumanEntrypointPort> | undefined;
        const get = async (): Promise<HumanEntrypointPort> => {
          loaded ??= (async () => {
            const entrypointCreateInputs = graphProviderCreateInputs(
              graphContext,
              "entrypoint",
              providerId,
              config,
              { preferProvidedConfig: true },
            );
            return providerHost.createProvider("entrypoint", providerId, {
              config: entrypointCreateInputs.config,
              ...(entrypointCreateInputs.dependencyBindings !== undefined
                ? { dependencyBindings: entrypointCreateInputs.dependencyBindings }
                : {}),
            });
          })();
          return loaded;
        };
        port = {
          open: async (runtime) => (await get()).open(runtime),
        };
        entrypointPorts.set(key, port);
        return port;
      };
      entrypoint = entrypointForProvider(entrypointProviderId, entrypointBootConfig);
      // The gateway is the Route controller's abstract edge AND the public step-up/WS-proxy entry. It verifies the
      // recipient-bound grant statelessly + requires the bound identity (step-up) before forwarding to the capsule.
      gateway = new AccessGateway({
        // ONE gateway fronts BOTH enrollment (Phase E) AND the handoff (Phases 6/12) — the sole public entry on
        // hermes-1. The enrollment seams (the capability grant verifier + the identity enroll surface) let the SAME
        // gateway serve the grant-verified enrollment flow against the SAME enrolled-credential store the step-up
        // verifies against, so a real two-handoff scenario (enroll → handoff → re-open) runs through one edge.
        grants: capability,
        identity,
        sessionGrants: capability,
        stepUp: identity,
        host: h.host ?? "0.0.0.0",
        port: h.port ?? 3000,
        publicBaseUrl: h.publicBaseUrl,
        ...(h.trustForwardedPrefix !== undefined
          ? { trustForwardedPrefix: h.trustForwardedPrefix }
          : {}),
        // The auth-reuse TTL (GLA-050/051): a recipient's step-up stays valid for a later window for THIS recipient,
        // so scenario-01 Phase 12's second window opens with no re-prompt. Defaults to the gateway default (~15m).
        ...(h.authReuseTtlMs !== undefined ? { authReuseTtlMs: h.authReuseTtlMs } : {}),
        // Provider-neutral assurance profile (default phishing-resistant): app translates deployment policy to the
        // gateway's common contract; gateway code never names provider method claims.
        ...(authAssurancePolicy !== undefined ? { authAssurancePolicy } : {}),
        // Entrypoint providers own browser-client assets; the gateway only sees generic static mounts.
        entrypointClientAssets,
      });
      route = new RouteController({ gateway });
      handoffDeps = {
        capability: {
          // Thread the session-computed `scopePath` (nested under the task scope `/task/<taskId>/…` when the grant
          // attenuates from the task cap) straight through, so the grant's scope is ⊆ the parent task scope.
          mintSessionGrant: (req) =>
            capability
              .mintSessionGrant(req)
              .then((m) => ({ grantId: m.capability.id, token: m.token, scopePath: m.scopePath })),
          revoke: (id) => capability.revoke(id),
          // Force-close the live WS at the edge so a revoked/expired grant's surface is unreachable (GLA-039 AC#3).
          forceCloseGrant: (grantId) => gateway?.forceCloseGrant(grantId),
        },
        route: {
          program: (window, grantId, entrypointBinding, path) => {
            if (route === undefined) {
              throw new Error("route controller not wired");
            }
            return route.program(window, grantId, entrypointBinding, path);
          },
          unmount: (windowId) => (route ? route.unmount(windowId) : Promise.resolve()),
        },
        entrypoint,
        entrypointFor: (plan, spec) =>
          entrypointForProvider(
            entrypointProviderIdForPlan(plan, spec, entrypointProviderId),
            providerConfigForPlan(
              plan,
              "entrypoint",
              entrypointProviderIdForPlan(plan, spec, entrypointProviderId),
              entrypointBootConfig,
            ),
          ),
        channel,
        // Build the recipient-bound handoff link from the route path + the grant token (the gateway's helper).
        buildLink: (path, token) => AccessGateway.handoffLink(h.publicBaseUrl, path, token),
        // The grant attenuates FROM the session's TASK capability TOKEN (so it cannot widen recipient/scope/ttl and
        // cascades on the task cap's revoke). Resolve the task → its minted task-capability bearer token.
        parentTokenFor: (_sessionId, taskId) => task.capabilityToken(taskId),
      };

      // The operator enrollment action (Phase E) on the SAME gateway + credential store the step-up verifies against —
      // mint a single-use operator-discharge grant bound to the recipient + deliver the invite link. The precondition
      // for any handoff (the recipient must be enrolled before window 1).
      publicBaseUrl = h.publicBaseUrl;
      enrollInvite = async (recipient: RecipientRef) => {
        const minted = await capability.mintEnrollmentGrant(recipient);
        const link = AccessGateway.enrollLink(h.publicBaseUrl, minted.token);
        await channel.deliver(recipient, link, minted.token);
        return redactedEnrollmentInvite(link, minted.token, minted.nonce);
      };

      // ── Slice 5 — the COMPLETION-CLOSE pipeline (the Completion service + the url-watcher detector + the
      //    connector severance), wired into the SessionService when `opts.handoff.completion` is present. The
      //    url-watcher watches each open window's live URL over CDP; a match is validated by the Completion service
      //    against the declared detector contract + normalized to an envelope; the session closes the window
      //    (reverse-of-open) and returns to `active` with the capsule running. The agent's brokered CDP socket is
      //    SEVERED while a window is open (S-2 agent-blind — its live connection is destroyed) and re-allowed on close.
      if (h.completion !== undefined) {
        const c = h.completion;
        const completionSvc = new CompletionService();
        const detectorPorts = new Map<string, CompletionDetectorPort>();
        const detectorForProvider = (
          providerId: ProviderId,
          config: Record<string, unknown> = {},
        ): CompletionDetectorPort => {
          const key = providerPortCacheKey(providerId, config);
          let port = detectorPorts.get(key);
          if (port !== undefined) {
            return port;
          }
          let loaded: Promise<CompletionDetectorPort> | undefined;
          const get = async (): Promise<CompletionDetectorPort> => {
            loaded ??= (async () => {
              const detectorCreateInputs = graphProviderCreateInputs(
                graphContext,
                "detector",
                providerId,
                config,
                { preferProvidedConfig: true },
              );
              const detectorServiceBindings = providerServiceBindings(
                opts.providerSet,
                "detector",
                providerId,
                {
                  ...(c.readUrl !== undefined ? { readUrl: c.readUrl } : {}),
                },
              );
              const detectorServices =
                Object.keys(detectorServiceBindings).length > 0
                  ? providerServices(detectorServiceBindings)
                  : undefined;
              return providerHost.createProvider("detector", providerId, {
                config: detectorCreateInputs.config,
                ...(detectorCreateInputs.dependencyBindings !== undefined
                  ? { dependencyBindings: detectorCreateInputs.dependencyBindings }
                  : {}),
                ...(detectorServices !== undefined ? { services: detectorServices } : {}),
              });
            })();
            return loaded;
          };
          port = {
            contract:
              providerHost.providerManifest(providerId)?.spec.config_schema ?? EMPTY_CONFIG_SCHEMA,
            async *watch(runtime, params) {
              yield* (await get()).watch(runtime, params);
            },
          };
          detectorPorts.set(key, port);
          return port;
        };
        const detectorProviderIdForSession = (sessionId: SessionId): ProviderId => {
          const session = sessionRef.svc?.get(sessionId);
          return session !== undefined
            ? detectorProviderIdForPlan(
                session.capsulePlan ?? capsulePlanFromSpec(session.spec),
                session.spec,
                detectorProviderId,
              )
            : detectorProviderId;
        };
        detector = detectorForProvider(detectorProviderId, detectorBootConfig);
        // The detector manifest is the default raw-status contract. An explicit statusMap is a deployment/template
        // override for the selected detector, not a generic URL-watcher assumption.
        const statusMap = c.statusMap;
        completionDeps = {
          completion: completionSvc,
          // Build the DECLARED detector contract from provider metadata: admitted raw statuses -> normalization.
          // These closures run only when a window opens/closes — AFTER `sessionRef.svc` is assigned below.
          contractFor: (sessionId) =>
            buildDetectorContract(
              sessionRef.svc,
              sessionId,
              providerHost,
              detectorProviderIdForSession(sessionId),
              statusMap,
            ),
          detector,
          detectorFor: (plan, spec) => {
            const selectedDetectorProviderId = detectorProviderIdForPlan(
              plan,
              spec,
              detectorProviderId,
            );
            return detectorForProvider(
              selectedDetectorProviderId,
              detectorFactoryConfig(selectedDetectorProviderId),
            );
          },
          // The params the selected detector watches with — the session's declared detector part.
          detectorParamsFor: (sessionId) =>
            detectorParams(sessionRef.svc, sessionId, detectorProviderIdForSession(sessionId)),
          // S-2 agent-blind: SEVER/resume the agent connector by the session's connector resource id. The provider
          // adapter owns how that id maps to live sockets, so session/app do not key lifecycle to a transport URL.
          connectorControl: {
            assertControllable: (sessionId) => {
              const providerId = connectorProviderIdForSession(sessionId);
              if (!connectorForSession(sessionId).controlsAgentChannel) {
                throw glaError(
                  "dependency.unavailable",
                  `connector provider "${providerId}" cannot enforce agent-blind channel control`,
                  {
                    detail: {
                      diagnostics: [
                        {
                          code: "provider.service_missing",
                          providerId,
                          family: "connector",
                          message:
                            "connector provider must expose suspend/resume by resource id for handoff completion",
                        },
                      ],
                    },
                  },
                );
              }
            },
            suspend: (sessionId) => {
              const resourceId =
                sessionRef.svc?.connectorTeardownInfo(sessionId)?.connectorResourceId;
              if (resourceId !== undefined && resourceId.length > 0) {
                connectorForSession(sessionId).suspendByResourceId(resourceId);
              }
            },
            resume: (sessionId) => {
              const resourceId =
                sessionRef.svc?.connectorTeardownInfo(sessionId)?.connectorResourceId;
              if (resourceId !== undefined && resourceId.length > 0) {
                connectorForSession(sessionId).resumeByResourceId(resourceId);
              }
            },
          },
        };
      }
    }

    // ── The provision-capable SessionService: inject the worker/capability/connector seams (+ handoff when wired).
    //    `parentCapabilityRefFor` threads the session's TASK capability id down as the connector's parent
    //    (Finding #1) — so `mintConnector` produces a CHILD of the task cap, not a fresh root.
    const sessionStore = stateSlot<SessionServiceSnapshot>(state, "session.state", {
      sessions: [],
      provisioned: [],
      handoffs: [],
      completions: [],
    });
    const capsuleWorker: CapsuleWorkerPort = {
      spawn: (sessionId, spec, plan) => lifecycle.spawn(sessionId, spec, plan),
      teardown: (sessionId) => lifecycle.teardown(sessionId),
      hasLive: (sessionId) => lifecycle.hasLive(sessionId),
      runtimeOf: (sessionId) => lifecycle.runtimeOf(sessionId),
    };
    const sessionOpts: SessionServiceOptions = {
      provision: {
        worker: capsuleWorker,
        capability: {
          async mintConnector(sessionId, parentRef) {
            const minted = await capability.mintConnector(sessionId, parentRef);
            // Surface the lineage parent (the task cap id) so the session records the connector
            // genuinely descends from the task cap (Finding #1; the revoke-the-parent cascade applies).
            return parentRef !== undefined
              ? { capabilityId: minted.capability.id, secretRef: minted.secretRef, parentRef }
              : { capabilityId: minted.capability.id, secretRef: minted.secretRef };
          },
          revoke: (capId) => capability.revoke(capId),
        },
        connector,
        connectorFor: (plan, spec) =>
          connectorForProvider(
            connectorProviderIdForPlan(plan, spec, connectorProviderId),
            providerConfigForPlan(
              plan,
              "connector",
              connectorProviderIdForPlan(plan, spec, connectorProviderId),
              connectorBootConfig,
            ),
          ),
        parentCapabilityRefFor: (_sessionId, taskId) => {
          // Resolve the session's task → its minted task-capability id (the connector's lineage parent).
          const t = task.tryGet(taskId);
          return t !== undefined ? (t.taskCapabilityRef as unknown as CapabilityId) : undefined;
        },
      },
    };
    if (sessionStore !== undefined) {
      sessionOpts.store = sessionStore;
    }
    if (handoffDeps !== undefined) {
      sessionOpts.handoff = handoffDeps;
    }
    if (completionDeps !== undefined) {
      sessionOpts.completion = completionDeps;
    }
    // ── Slice 7 — the SessionService's TERMINAL-teardown seam (`teardownSession`'s STOP-the-capsule step):
    //    `reconcile(sessionId)` is the worker's Cleanup Reconciler (built just below), which stops the capsule
    //    (kills the process group), reaps the workspace (wipes the ephemeral temp profile — host mounts
    //    survive), revokes the connector cap, and forgets the bookkeeping — idempotent + restart-safe, and
    //    reconciling by STATE regardless of launcher. The reconciler is constructed after the session (it
    //    reads the session for the connector-teardown info), so the seam reads it from the holder.
    const reconcilerRef: { rec?: CleanupReconciler } = {};
    sessionOpts.teardown = {
      reconcile: (sessionId) => reconcilerRef.rec?.reconcile(sessionId) ?? Promise.resolve(),
    };
    const session = new SessionService(sessionOpts);
    // Publish the session into the holder the completion deps' closures read (they run only on a later open/close).
    sessionRef.svc = session;

    // ── The Cleanup Reconciler's TERMINAL teardown now revokes the connector cap AND unbinds its
    //    secret_ref (Finding #2) — symmetric with the saga's failure compensation, so a session that
    //    provisions successfully and is later reaped leaves NO live connector cap and NO residual binding.
    const reconciler = new CleanupReconciler({
      lifecycle,
      revokeConnector: async (sessionId) => {
        const info = session.connectorTeardownInfo(sessionId as never);
        if (info === undefined) {
          return; // never provisioned / already cleaned — idempotent no-op.
        }
        // Drop the agent-blind resource binding (no residual) and revoke the connector cap.
        connectorForSession(sessionId as never).unbindSecretRef(info.connectorResourceId);
        await capability.revoke(info.connectorCapId);
        // Forget the provision bookkeeping so a second teardown is a clean no-op (idempotent).
        session.clearProvisioned(sessionId as never);
      },
    });
    // Publish the reconciler into the holder the SessionService's teardown seam reads (Slice 7) — so
    // `teardownSession`/`task complete` stop+reap the capsule via the SAME idempotent reconciler.
    reconcilerRef.rec = reconciler;

    // Inject the SHARED signer + capability service + task service into the bridge so the agent anchor,
    // the task cap, and the connector cap are all minted/verified/revoked by the ONE signer (the lineage
    // cascade across anchor→task→connector holds, and the bridge verifies with the minting key).
    const bridge = new AgentBridge({
      catalog,
      admission,
      session,
      task,
      capability,
      signer,
      provisioning: true,
    });
    // `attachConnector` is the worker's connector helper; the session uses the connector port directly,
    // but keeping this import referenced preserves the wired surface explicitly (and tree-shake-safe).
    void attachConnector;
    let stackClosed = false;
    const close = async (): Promise<void> => {
      if (stackClosed) {
        return;
      }
      stackClosed = true;
      try {
        for (const sessionId of lifecycle.liveSessions()) {
          await reconciler.reconcile(sessionId).catch(() => {});
        }
        for (const port of connectorPorts.values()) {
          await port.close().catch(() => {});
        }
        await gateway?.close().catch(() => {});
      } finally {
        state?.close();
      }
    };
    const stack: ProvisioningStack = {
      ready: session.recoveryComplete(),
      close,
      bridge,
      providerGraphDoctor: graphContext.doctor,
      lifecycle,
      reconciler,
      registry,
      capability,
      task,
      session,
      connector,
      authModule,
    };
    if (entrypoint !== undefined) {
      stack.entrypoint = entrypoint;
    }
    if (detector !== undefined) {
      stack.detector = detector;
    }
    // Slice 4b: expose the handoff pipeline handles when wired (so a test/caller can drive the gateway/route/identity).
    if (gateway !== undefined) {
      stack.gateway = gateway;
    }
    if (route !== undefined) {
      stack.route = route;
    }
    if (identity !== undefined) {
      stack.identity = identity;
    }
    if (enrollInvite !== undefined) {
      stack.enrollInvite = enrollInvite;
    }
    if (publicBaseUrl !== undefined) {
      stack.publicBaseUrl = publicBaseUrl;
    }
    stateOwnedByStack = true;
    return stack;
  } catch (error) {
    if (!stateOwnedByStack) {
      state?.close();
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slice 4a — recipient enrollment (scenario-01 Phase E)
// ─────────────────────────────────────────────────────────────────────────────

/** Options for {@link createEnrollmentStack}. */
export interface CreateEnrollmentStackOptions extends ProviderCompositionOptions {
  /**
   * The auth provider to wire behind the kernel `AuthProviderPort` (doc §1/§7). Default comes from
   * deployment config. Provider-owned config is validated by the selected provider's schema.
   */
  authProvider?: AuthProviderKind;
  /** Provider-owned auth config, validated by the selected provider's registered schema. */
  authProviderConfig?: AuthProviderConfig;
  /**
   * The Relying-Party ID — the registrable host the passkey is bound to (no scheme/port). hermes-1: the gateway's
   * host; the loopback test: `"localhost"`. MUST match the page origin host. Default `"localhost"`. WebAuthn-path config.
   */
  rpID?: string;
  /** The human-visible RP name in the OS passkey UI. Default `"GLA"`. */
  rpName?: string;
  /**
   * The expected page ORIGIN(s) the WebAuthn ceremony runs on (scheme+host+port), e.g. `http://localhost:3000`.
   * Required so the attestation/assertion is verified against the right origin. A single string or a list.
   */
  expectedOrigin: string | string[];
  /** The public base URL enrollment invite links are built against, e.g. `http://localhost:3000`. */
  publicBaseUrl: string;
  /**
   * Trust `X-Forwarded-Prefix` for strip-prefix reverse proxies. Enable only behind an edge that sanitizes that
   * header; prefix-preserving proxying does not need it.
   */
  trustForwardedPrefix?: boolean;
  /** Gateway bind host. Default `0.0.0.0` (hermes-1); tests pass `127.0.0.1`. */
  host?: string;
  /** Gateway bind port. Default `3000`; tests pass `0` for an ephemeral port. */
  port?: number;
  /** Structured WPM dependency evidence used by host-touching auth providers. */
  dependencyBindings?: DependencyBinding[];
  /** Opaque channel-provider id. Default comes from deployment config. */
  channelProvider?: ProviderId;
  /** Provider-owned channel config. Defaults preserve the CLI channel's injected-sink behaviour. */
  channelProviderConfig?: Record<string, unknown>;
  /** Where the channel writes the enrollment invite link (defaults to stdout). */
  deliverySink?: DeliverySink;
  /**
   * A PRE-BUILT auth provider to inject behind the kernel `AuthProviderPort`, bypassing {@link buildAuthProvider}
   * for deterministic tests or external composition. When set, it wins over Provider Host creation; `authModule`
   * is taken from {@link authModuleOverride}
   * (or, when that is absent, the resolved provider kind). Mirrors `createProvisioningBridge`'s `handoff.identity`
   * injection. (The PRODUCTION browser-redirect/callback path that feeds `{code,state}` to `enrollComplete` is
   * GLA-072's shared deliverable, see authentik-integration.md §2 / authentik-enrollment.md §8.1.)
   */
  authProviderOverride?: AuthProviderPort;
  /** The module marker recorded in {@link EnrollmentStack.authModule} when {@link authProviderOverride} is set. */
  authModuleOverride?: string;
}

/**
 * The composed enrollment stack (Slice 4a): the wired Access Gateway + the operator's `enrollInvite` action + the
 * handles a caller/test needs to observe enrolled-vs-not from outside.
 */
export interface EnrollmentStack {
  /** The Access Gateway HTTP server (sole public entry; serves the grant-verified enrollment flow). */
  gateway: AccessGateway;
  /** The capability service (mints the operator-discharge grant; owns the single-use spent-set). */
  capability: CapabilityService;
  /** The identity service (owns the enrollment fact + auth_strength; wired with the selected provider). */
  identity: IdentityService;
  /**
   * The auth provider injected behind the kernel `AuthProviderPort` (only `app` imports the concrete adapter).
   * Typed as the PORT because it is the in-tree WebAuthn provider by default, or the delegated authentik adapter
   * when selected (doc §7) — both satisfy `AuthProviderPort`.
   */
  authProvider: AuthProviderPort;
  /**
   * The auth module actually wired, mapped from the selected provider id by the trusted provider set.
   */
  authModule: string;
  /** The channel provider the invite is delivered through (recipient-bound). */
  channel: ChannelPort;
  /**
   * The OPERATOR enrollment action (docs/05 §3: NOT on the agent surface). Mint a single-use operator-discharge
   * grant bound to the recipient, then deliver the enrollment invite link (carrying the grant) to exactly that
   * recipient via the channel. Returns only an operator-safe redacted read model; tests or channels that need the
   * usable link must observe recipient delivery.
   */
  enrollInvite(
    recipient: RecipientRef,
  ): Promise<{ link: string; grant: OpaqueToken; nonce: string }>;
}

/**
 * Compose the Slice-4a enrollment stack. This is the single place the real WebAuthn provider meets the kernel
 * `AuthProviderPort` and is injected into the Identity service; the Access Gateway is wired with the capability +
 * identity seams (it imports neither adapter). After this, `enrollInvite(recipient)` mints+delivers an invite, and
 * the gateway serves the grant-verified enrollment flow on `host:port`.
 *
 * Wiring (the ports→adapter seams):
 *   - AuthProviderPort from Provider Host ← selected provider id + provider-owned config
 *   - IdentityService ← the WebAuthn provider (the swap-IdP boundary: identity depends on the PORT)
 *   - CapabilityService.mintEnrollmentGrant / verifyEnrollmentGrant(Token) / markSpent — the single-use grant
 *   - AccessGateway ← the capability grant seam + the identity enroll seam (no adapter import)
 *   - ChannelPort from Provider Host ← selected provider id + provider-owned config
 */
export function createEnrollmentStack(opts: CreateEnrollmentStackOptions): EnrollmentStack {
  const providerHost = requireProviderHost(opts);
  const selections = resolveProviderSelections(opts, {
    deployment: {
      ...(opts.authProvider !== undefined ? { auth: opts.authProvider } : {}),
      ...(opts.channelProvider !== undefined ? { channel: opts.channelProvider } : {}),
    },
  });
  const deployment = selections.deployment;
  // Provider selection (doc §1/§7): deployment config supplies the default. A pre-built
  // `authProviderOverride` wins, so delegated enrollment paths can still be tested end-to-end with no real network.
  let authProvider: AuthProviderPort;
  let authModule: string;
  if (opts.authProviderOverride !== undefined) {
    authProvider = opts.authProviderOverride;
    authModule = opts.authModuleOverride ?? providerModuleId(providerHost, "auth", deployment.auth);
  } else {
    const built = buildAuthProvider(
      {
        ...(opts.authProvider !== undefined ? { authProvider: opts.authProvider } : {}),
        ...(opts.authProviderConfig !== undefined
          ? { authProviderConfig: opts.authProviderConfig }
          : {}),
      },
      {
        rpID: opts.rpID ?? "localhost",
        rpName: opts.rpName ?? "GLA",
        expectedOrigin: opts.expectedOrigin,
      },
      undefined,
      providerDependencyEvidence(deployment.auth, opts.dependencyBindings, providerHost),
      providerHost,
      opts.providerSet,
      deployment.auth,
      undefined,
      deploymentProviderConfig(deployment, deployment.auth),
    );
    authProvider = built.provider;
    authModule = built.module;
  }
  const identity = new IdentityService({ authProvider });
  const capability = new CapabilityService();
  const channel = buildChannelProvider({
    providerHost,
    providerSet: opts.providerSet,
    providerId: deployment.channel,
    config: providerConfig(
      opts.channelProviderConfig,
      opts.providerSet,
      "channel",
      deployment.channel,
      providerBootFallbackConfig(providerHost, deployment.channel, {
        ...(opts.deliverySink !== undefined ? { delivery: "injected" } : {}),
      }),
      deploymentProviderConfig(deployment, deployment.channel),
    ),
    identity,
    ...(opts.dependencyBindings !== undefined
      ? { dependencyBindings: opts.dependencyBindings }
      : {}),
    ...(opts.deliverySink !== undefined ? { deliverySink: opts.deliverySink } : {}),
  });
  const gateway = new AccessGateway({
    grants: capability,
    identity,
    host: opts.host ?? "0.0.0.0",
    port: opts.port ?? 3000,
    publicBaseUrl: opts.publicBaseUrl,
    ...(opts.trustForwardedPrefix !== undefined
      ? { trustForwardedPrefix: opts.trustForwardedPrefix }
      : {}),
  });

  return {
    gateway,
    capability,
    identity,
    authProvider,
    authModule,
    channel,
    async enrollInvite(recipient) {
      // 1) Mint the single-use operator-discharge grant bound to this recipient (distinct from a handoff grant).
      const minted = await capability.mintEnrollmentGrant(recipient);
      // 2) Build the enrollment invite link carrying the grant, and deliver it to EXACTLY the bound recipient.
      const link = AccessGateway.enrollLink(opts.publicBaseUrl, minted.token);
      // The channel-delegation token would gate a richer channel; the CLI fallback records it but does not enforce.
      await channel.deliver(recipient, link, minted.token);
      return redactedEnrollmentInvite(link, minted.token, minted.nonce);
    },
  };
}

function redactedEnrollmentInvite(
  link: string,
  grant: OpaqueToken,
  nonce: string,
): { link: string; grant: OpaqueToken; nonce: string } {
  void grant;
  void nonce;
  return {
    link: redactOperatorText(link),
    grant: "<redacted>" as OpaqueToken,
    nonce: "<redacted>",
  };
}
