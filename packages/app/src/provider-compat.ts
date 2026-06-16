import type { Probe, ProviderProfileFamilyId, ProviderProfileManifest } from "@gla/catalog";
import type { EntrypointClientAssetMount } from "@gla/gateway";
import {
  type GlaProviderModule,
  type ProviderHost,
  type ProviderId,
  ProviderRegistry,
  type RuntimeProviderFamily,
} from "@gla/provider-host";

/**
 * Legacy flat boot-time selected providers for every runtime family.
 *
 * @deprecated This is a compatibility read model for old provider-set/profile callers. New app
 * composition uses `AppDeploymentConfig` for app infrastructure and capsule template/assembly
 * resolution for capsule providers.
 */
export interface LegacyProviderSelectionProfile {
  auth: ProviderId;
  launcher: ProviderId;
  connector: ProviderId;
  workspace: ProviderId;
  entrypoint: ProviderId;
  detector: ProviderId;
  channel: ProviderId;
  secretStore: ProviderId;
}

/** Arguments passed to legacy provider-set-owned default config callbacks. */
export interface LegacyProviderDefaultConfigArgs {
  family: RuntimeProviderFamily;
  providerId: ProviderId;
  legacy: Record<string, unknown>;
}

/** Arguments passed to legacy provider-set-owned service callback adapters. */
export interface LegacyProviderDefaultServicesArgs {
  family: RuntimeProviderFamily;
  providerId: ProviderId;
  legacy: Record<string, unknown>;
}

/**
 * Legacy trusted provider-set shape.
 *
 * @deprecated Kept only as an explicit migration adapter while older distribution entrypoints are
 * moved to `ProviderRegistry`, app deployment config, and template package defaults. The runtime
 * composition root must not use this as its primary provider-layer input.
 */
export interface LegacyAppProviderSet {
  /** Stable module identity for the provider-set distribution. */
  moduleId: string;
  /** Trusted provider modules to register into ProviderRegistry at boot. */
  modules: readonly GlaProviderModule[];
  /** Named legacy broad provider profiles exposed by this provider set. */
  profiles?: readonly ProviderProfileManifest[];
  /** Profile id selected by this distribution unless the operator overrides it at boot. */
  selectedProfileId?: string;
  /** Legacy default provider ids for this distribution/profile. */
  profile: LegacyProviderSelectionProfile;
  /** Legacy provider-set-owned provider default config callback. */
  defaultConfig?(args: LegacyProviderDefaultConfigArgs): Record<string, unknown> | undefined;
  /** Legacy provider-set-owned provider service callback. */
  defaultServices?(args: LegacyProviderDefaultServicesArgs): Record<string, unknown> | undefined;
  /** Legacy browser-client asset resolver for human-entrypoint providers. */
  entrypointClientAssets?(
    host: ProviderHost,
    providerIds: readonly ProviderId[],
  ): EntrypointClientAssetMount[];
  /** Legacy template reachability probes, keyed by template `spec.probe`. */
  templateProbes?: Readonly<Record<string, Probe>>;
}

const PROVIDER_PROFILE_BINDINGS: ReadonlyArray<{
  profileFamily: ProviderProfileFamilyId;
  key: keyof LegacyProviderSelectionProfile;
}> = [
  { profileFamily: "AuthProvider", key: "auth" },
  { profileFamily: "Launcher", key: "launcher" },
  { profileFamily: "Workspace", key: "workspace" },
  { profileFamily: "HumanEntrypoint", key: "entrypoint" },
  { profileFamily: "AgentConnector", key: "connector" },
  { profileFamily: "CompletionDetector", key: "detector" },
  { profileFamily: "ChannelAdapter", key: "channel" },
  { profileFamily: "SecretStore", key: "secretStore" },
];

function selectionProviderId(selection: unknown): string | undefined {
  if (typeof selection === "string" && selection.length > 0) {
    return selection;
  }
  if (
    selection !== null &&
    typeof selection === "object" &&
    "providerId" in selection &&
    typeof selection.providerId === "string" &&
    selection.providerId.length > 0
  ) {
    return selection.providerId;
  }
  return undefined;
}

/** Convert a legacy broad profile manifest into the legacy flat selected-provider shape. */
export function legacyProviderSelectionFromManifest(
  manifest: ProviderProfileManifest,
): Partial<LegacyProviderSelectionProfile> {
  const select = manifest.spec.select ?? {};
  const out: Partial<LegacyProviderSelectionProfile> = {};
  const auth = selectionProviderId(select.AuthProvider);
  if (auth !== undefined) {
    out.auth = auth;
  }
  const launcher = selectionProviderId(select.Launcher);
  if (launcher !== undefined) {
    out.launcher = launcher;
  }
  const connector = selectionProviderId(select.AgentConnector);
  if (connector !== undefined) {
    out.connector = connector;
  }
  const workspace = selectionProviderId(select.Workspace);
  if (workspace !== undefined) {
    out.workspace = workspace;
  }
  const entrypoint = selectionProviderId(select.HumanEntrypoint);
  if (entrypoint !== undefined) {
    out.entrypoint = entrypoint;
  }
  const detector = selectionProviderId(select.CompletionDetector);
  if (detector !== undefined) {
    out.detector = detector;
  }
  const channel = selectionProviderId(select.ChannelAdapter);
  if (channel !== undefined) {
    out.channel = channel;
  }
  const secretStore = selectionProviderId(select.SecretStore);
  if (secretStore !== undefined) {
    out.secretStore = secretStore;
  }
  return out;
}

/** Build a legacy broad ProviderProfile manifest from the selected-provider compatibility shape. */
export function legacyProviderProfileManifest(
  profile: LegacyProviderSelectionProfile,
  name = "selected-runtime-profile",
): ProviderProfileManifest {
  const select: NonNullable<ProviderProfileManifest["spec"]["select"]> = {};
  for (const binding of PROVIDER_PROFILE_BINDINGS) {
    select[binding.profileFamily] = profile[binding.key];
  }
  return {
    apiVersion: "gla.dev/v1",
    kind: "ProviderProfile",
    metadata: { name },
    spec: {
      select,
      lifecycle: { owner: "operator", apply: "boot", hotReload: false },
    },
  };
}

/** Return a named broad profile manifest from a legacy provider set, if one was selected. */
export function legacyProviderSetProfileManifest(
  providerSet: LegacyAppProviderSet | undefined,
  profileId: string | undefined,
): ProviderProfileManifest | undefined {
  if (providerSet === undefined || profileId === undefined) {
    return undefined;
  }
  const manifest = providerSet.profiles?.find((profile) => profile.metadata.name === profileId);
  if (manifest === undefined) {
    throw new Error(
      `legacy provider set "${providerSet.moduleId}" does not expose profile "${profileId}"`,
    );
  }
  return manifest;
}

/** Return the legacy provider set's selected broad profile id, if any. */
export function legacyProviderSetSelectedProfileId(
  providerSet: LegacyAppProviderSet | undefined,
): string | undefined {
  return providerSet?.selectedProfileId;
}

/** Return a named or provider-set-selected broad profile manifest from a legacy provider set. */
export function legacyProviderSetSelectedProfileManifest(
  providerSet: LegacyAppProviderSet | undefined,
  profileId: string | undefined,
): ProviderProfileManifest | undefined {
  return legacyProviderSetProfileManifest(
    providerSet,
    profileId ?? legacyProviderSetSelectedProfileId(providerSet),
  );
}

/** Return the legacy provider set's flat provider selection, if present. */
export function legacyProviderSetProfileSelection(
  providerSet: LegacyAppProviderSet | undefined,
): LegacyProviderSelectionProfile | undefined {
  return providerSet?.profile;
}

/** Build a sealed registry from a legacy provider set's trusted provider modules. */
export function legacyProviderSetRegistry(providerSet: LegacyAppProviderSet): ProviderRegistry {
  return ProviderRegistry.fromProviderModules(providerSet.modules);
}

/** Invoke a legacy provider-set default config callback, if present. */
export function legacyProviderSetDefaultConfig(
  providerSet: LegacyAppProviderSet | undefined,
  args: LegacyProviderDefaultConfigArgs,
): Record<string, unknown> | undefined {
  return providerSet?.defaultConfig?.(args);
}

/** Invoke a legacy provider-set service callback, if present. */
export function legacyProviderSetDefaultServices(
  providerSet: LegacyAppProviderSet | undefined,
  args: LegacyProviderDefaultServicesArgs,
): Record<string, unknown> | undefined {
  return providerSet?.defaultServices?.(args);
}

/** Resolve legacy provider-set-owned entrypoint client assets, if present. */
export function legacyProviderSetEntrypointClientAssets(
  providerSet: LegacyAppProviderSet | undefined,
  host: ProviderHost,
): EntrypointClientAssetMount[] {
  return providerSet?.entrypointClientAssets?.(host, host.providerIds("entrypoint")) ?? [];
}

/** Resolve legacy provider-set-owned template probes, if present. */
export function legacyProviderSetTemplateProbes(
  providerSet: LegacyAppProviderSet | undefined,
): Readonly<Record<string, Probe>> {
  return providerSet?.templateProbes ?? {};
}
