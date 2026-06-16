// @gla/app — reference distribution entrypoint.
// Generic app composition lives in `composition.ts`; this file supplies today's trusted in-tree
// reference provider set and selected profile as boot-time distribution data.

import {
  AUTH_WEBAUTHN_PROVIDER_ID,
  CHANNEL_CLI_PROVIDER_ID,
  DETECTOR_URL_PROVIDER_ID,
  LAUNCHER_PROCESS_PROVIDER_ID,
  PROVIDER_SET_REFERENCE_MODULE,
  REFERENCE_PROFILE_HARDENED_IDP_ID,
  REFERENCE_PROFILE_LOCAL_DEV_ID,
  REFERENCE_PROFILE_SCENARIO_01_ID,
  REFERENCE_PROFILE_SINGLE_OPERATOR_ID,
  type ReferenceProviderProfileId,
  WORKSPACE_PROFILE_PROVIDER_ID,
  createReferenceProviderRegistry,
  referenceAppDeploymentConfigForProfile,
  referenceCapsuleProviderSelectionForProfile,
  referenceEntrypointClientAssetMounts,
  referenceProviderModules,
  referenceProviderProfileManifests,
  referenceProviderRuntimeProfile,
  referenceTemplateProbes,
} from "@gla/provider-set-reference";
import {
  createApp as createGenericApp,
  createBridge as createGenericBridge,
  createEnrollmentStack as createGenericEnrollmentStack,
  createProvisioningBridge as createGenericProvisioningBridge,
} from "./composition.js";
import type {
  App,
  AppDeploymentConfigInput,
  AppProviderSet,
  CreateBridgeOptions,
  CreateEnrollmentStackOptions,
  CreateProvisioningBridgeOptions,
  EnrollmentStack,
  ProviderCompositionOptions,
  ProviderDefaultConfigArgs,
  ProviderDefaultServicesArgs,
  ProviderSelectionProfile,
  ProvisioningStack,
} from "./composition.js";
import {
  defaultBridgeEndpoint,
  endpointIsLocal,
  parseServeArgs,
  runServe as runGenericServe,
  serve as serveGeneric,
} from "./daemon.js";
import type { DaemonHandle, ServeOptions } from "./daemon.js";

export * from "./composition.js";
export { defaultBridgeEndpoint, endpointIsLocal, parseServeArgs };
export type { DaemonHandle, ServeOptions };

/**
 * Default selected provider ids for older callers of the in-tree reference distribution.
 *
 * @deprecated Use `referenceAppDeploymentConfigForProfile()` and
 * `referenceCapsuleProviderSelectionForProfile()` from `@gla/provider-set-reference`.
 */
export const referenceProviderProfile: ProviderSelectionProfile = referenceProviderRuntimeProfile(
  REFERENCE_PROFILE_SCENARIO_01_ID,
);

function referenceDefaultConfig({
  family,
  providerId,
  legacy,
}: ProviderDefaultConfigArgs): Record<string, unknown> | undefined {
  if (family === "auth" && providerId === AUTH_WEBAUTHN_PROVIDER_ID) {
    return legacy;
  }
  if (family === "launcher" && providerId === LAUNCHER_PROCESS_PROVIDER_ID) {
    return legacy;
  }
  if (family === "workspace" && providerId === WORKSPACE_PROFILE_PROVIDER_ID) {
    return legacy;
  }
  if (family === "detector" && providerId === DETECTOR_URL_PROVIDER_ID) {
    return legacy;
  }
  if (family === "channel" && providerId === CHANNEL_CLI_PROVIDER_ID) {
    return legacy;
  }
  return undefined;
}

function referenceDefaultServices({
  family,
  providerId,
  legacy,
}: ProviderDefaultServicesArgs): Record<string, unknown> | undefined {
  if (
    family === "detector" &&
    providerId === DETECTOR_URL_PROVIDER_ID &&
    typeof legacy.readUrl === "function"
  ) {
    return { "detectorUrl.readUrl": legacy.readUrl };
  }
  return undefined;
}

/**
 * Legacy trusted provider set used by older callers.
 *
 * @deprecated The default `@gla/app` entrypoint now bootstraps from `ProviderRegistry`,
 * app deployment defaults, capsule template defaults, entrypoint assets, and template probes.
 */
export const referenceProviderSet: AppProviderSet = {
  moduleId: PROVIDER_SET_REFERENCE_MODULE,
  modules: referenceProviderModules,
  profiles: referenceProviderProfileManifests,
  selectedProfileId: REFERENCE_PROFILE_SCENARIO_01_ID,
  profile: referenceProviderProfile,
  defaultConfig: referenceDefaultConfig,
  defaultServices: referenceDefaultServices,
  entrypointClientAssets: referenceEntrypointClientAssetMounts,
  templateProbes: referenceTemplateProbes,
};

function referenceProfileId(opts: ProviderCompositionOptions): ReferenceProviderProfileId {
  const profileId = opts.providerProfileId;
  if (profileId === undefined) {
    return REFERENCE_PROFILE_SCENARIO_01_ID;
  }
  if (
    profileId === REFERENCE_PROFILE_LOCAL_DEV_ID ||
    profileId === REFERENCE_PROFILE_SINGLE_OPERATOR_ID ||
    profileId === REFERENCE_PROFILE_SCENARIO_01_ID ||
    profileId === REFERENCE_PROFILE_HARDENED_IDP_ID
  ) {
    return profileId;
  }
  if (/[<>{}⟨⟩]/u.test(profileId)) {
    return REFERENCE_PROFILE_SCENARIO_01_ID;
  }
  throw new Error(`unknown reference provider profile "${profileId}"`);
}

function mergeProviderConfig(
  base: Record<string, Record<string, unknown>> | undefined,
  override: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> | undefined {
  const merged: Record<string, Record<string, unknown>> = {};
  for (const [providerId, values] of Object.entries(base ?? {})) {
    merged[providerId] = { ...values };
  }
  for (const [providerId, values] of Object.entries(override ?? {})) {
    merged[providerId] = { ...(merged[providerId] ?? {}), ...values };
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeAppDeploymentConfig(
  base: AppDeploymentConfigInput,
  override: AppDeploymentConfigInput | undefined,
): AppDeploymentConfigInput {
  const providerConfig = mergeProviderConfig(base.providerConfig, override?.providerConfig);
  return {
    ...base,
    ...(override ?? {}),
    ...(providerConfig !== undefined ? { providerConfig } : {}),
  };
}

function withReferenceDefaults<T extends ProviderCompositionOptions>(
  opts: T,
): T & ProviderCompositionOptions {
  if (opts.providerSet !== undefined) {
    return opts;
  }
  const profileId = referenceProfileId(opts);
  const registry =
    opts.providerRegistry ??
    (opts.providerHost === undefined ? createReferenceProviderRegistry() : undefined);
  const { providerConfig: capsuleDefaultProviderConfig, ...capsuleDefaults } =
    referenceCapsuleProviderSelectionForProfile(profileId);
  const capsuleProviderConfig = mergeProviderConfig(
    capsuleDefaultProviderConfig,
    opts.capsuleProviderConfig,
  );
  return {
    ...opts,
    ...(registry !== undefined ? { providerRegistry: registry } : {}),
    appDeploymentConfig: mergeAppDeploymentConfig(
      referenceAppDeploymentConfigForProfile(profileId),
      opts.appDeploymentConfig,
    ),
    capsuleProviders: {
      ...capsuleDefaults,
      ...(opts.capsuleProviders ?? {}),
    },
    ...(capsuleProviderConfig !== undefined ? { capsuleProviderConfig } : {}),
    entrypointClientAssets: opts.entrypointClientAssets ?? referenceEntrypointClientAssetMounts(),
    templateProbes: {
      ...referenceTemplateProbes,
      ...(opts.templateProbes ?? {}),
    },
  };
}

/** Compose the reference GLA app distribution. */
export function createApp(opts: ProviderCompositionOptions = {}): App {
  return createGenericApp(withReferenceDefaults(opts));
}

/** Compose the reference Agent Bridge distribution. */
export function createBridge(
  opts: CreateBridgeOptions = {},
): ReturnType<typeof createGenericBridge> {
  return createGenericBridge(withReferenceDefaults(opts));
}

/** Compose the reference provisioning bridge distribution. */
export function createProvisioningBridge(
  opts: CreateProvisioningBridgeOptions = {},
): ProvisioningStack {
  return createGenericProvisioningBridge(withReferenceDefaults(opts));
}

/** Compose the reference enrollment stack distribution. */
export function createEnrollmentStack(opts: CreateEnrollmentStackOptions): EnrollmentStack {
  return createGenericEnrollmentStack(withReferenceDefaults(opts));
}

/** Boot the reference GLA daemon distribution with the in-tree provider set selected by default. */
export function serve(opts: ServeOptions = {}): Promise<DaemonHandle> {
  return serveGeneric(withReferenceDefaults(opts));
}

/** Run the reference `gla serve` command with the in-tree provider set selected by default. */
export function runServe(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return runGenericServe(argv, env, withReferenceDefaults({}));
}

/** Process entry point for the reference `:3000` deployable. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  await runServe(argv);
}
