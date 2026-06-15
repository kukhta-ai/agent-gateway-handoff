// @gla/app — reference distribution entrypoint.
// Generic app composition lives in `composition.ts`; this file supplies today's trusted in-tree
// reference provider set and selected profile as boot-time distribution data.

import {
  AUTH_WEBAUTHN_PROVIDER_ID,
  CHANNEL_CLI_PROVIDER_ID,
  DETECTOR_URL_PROVIDER_ID,
  LAUNCHER_PROCESS_PROVIDER_ID,
  PROVIDER_SET_REFERENCE_MODULE,
  REFERENCE_PROFILE_SCENARIO_01_ID,
  WORKSPACE_PROFILE_PROVIDER_ID,
  referenceEntrypointClientAssetMounts,
  referenceProviderModules,
  referenceProviderProfileManifests,
  referenceProviderRuntimeProfile,
} from "@gla/provider-set-reference";
import {
  createApp as createGenericApp,
  createBridge as createGenericBridge,
  createEnrollmentStack as createGenericEnrollmentStack,
  createProvisioningBridge as createGenericProvisioningBridge,
} from "./composition.js";
import type {
  App,
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

/** Default selected provider ids for the in-tree reference distribution. */
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

/** Trusted provider set used by the default `@gla/app` package entrypoint. */
export const referenceProviderSet: AppProviderSet = {
  moduleId: PROVIDER_SET_REFERENCE_MODULE,
  modules: referenceProviderModules,
  profiles: referenceProviderProfileManifests,
  selectedProfileId: REFERENCE_PROFILE_SCENARIO_01_ID,
  profile: referenceProviderProfile,
  defaultConfig: referenceDefaultConfig,
  defaultServices: referenceDefaultServices,
  entrypointClientAssets: referenceEntrypointClientAssetMounts,
};

function withDefaultProviderSet<T extends ProviderCompositionOptions>(
  opts: T,
): T & ProviderCompositionOptions {
  return {
    ...opts,
    providerSet: opts.providerSet ?? referenceProviderSet,
  };
}

/** Compose the reference GLA app distribution. */
export function createApp(opts: ProviderCompositionOptions = {}): App {
  return createGenericApp(withDefaultProviderSet(opts));
}

/** Compose the reference Agent Bridge distribution. */
export function createBridge(
  opts: CreateBridgeOptions = {},
): ReturnType<typeof createGenericBridge> {
  return createGenericBridge(withDefaultProviderSet(opts));
}

/** Compose the reference provisioning bridge distribution. */
export function createProvisioningBridge(
  opts: CreateProvisioningBridgeOptions = {},
): ProvisioningStack {
  return createGenericProvisioningBridge(withDefaultProviderSet(opts));
}

/** Compose the reference enrollment stack distribution. */
export function createEnrollmentStack(opts: CreateEnrollmentStackOptions): EnrollmentStack {
  return createGenericEnrollmentStack(withDefaultProviderSet(opts));
}

/** Boot the reference GLA daemon distribution with the in-tree provider set selected by default. */
export function serve(opts: ServeOptions = {}): Promise<DaemonHandle> {
  return serveGeneric(withDefaultProviderSet(opts));
}

/** Run the reference `gla serve` command with the in-tree provider set selected by default. */
export function runServe(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return runGenericServe(argv, env, { providerSet: referenceProviderSet });
}

/** Process entry point for the reference `:3000` deployable. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  await runServe(argv);
}
