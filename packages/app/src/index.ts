// @gla/app — reference distribution entrypoint.
// Generic app composition lives in `composition.ts`; this file supplies today's trusted in-tree
// reference provider set and selected profile as boot-time distribution data.

import {
  REFERENCE_PROFILE_HARDENED_IDP_ID,
  REFERENCE_PROFILE_LOCAL_DEV_ID,
  REFERENCE_PROFILE_SCENARIO_01_ID,
  REFERENCE_PROFILE_SINGLE_OPERATOR_ID,
  createReferenceProviderRegistry,
  referenceAppDeploymentConfigForProfile,
  referenceCapsuleProviderSelectionForProfile,
  referenceEntrypointClientAssetMounts,
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
  CreateBridgeOptions,
  CreateEnrollmentStackOptions,
  CreateProvisioningBridgeOptions,
  EnrollmentStack,
  ProviderCompositionOptions,
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

/** Reference-distribution preset selector expanded into the target provider-layer inputs. */
export interface ReferencePresetOptions {
  /** Named reference preset used to populate deployment config and capsule defaults. */
  referencePresetId?: ReferencePresetId;
}

type ReferencePresetId =
  | typeof REFERENCE_PROFILE_HARDENED_IDP_ID
  | typeof REFERENCE_PROFILE_LOCAL_DEV_ID
  | typeof REFERENCE_PROFILE_SCENARIO_01_ID
  | typeof REFERENCE_PROFILE_SINGLE_OPERATOR_ID;

type ReferenceProviderCompositionOptions = ProviderCompositionOptions & ReferencePresetOptions;
type ReferenceCreateBridgeOptions = CreateBridgeOptions & ReferencePresetOptions;
type ReferenceCreateProvisioningBridgeOptions = CreateProvisioningBridgeOptions &
  ReferencePresetOptions;
type ReferenceCreateEnrollmentStackOptions = CreateEnrollmentStackOptions & ReferencePresetOptions;
type ReferenceServeOptions = ServeOptions & ReferencePresetOptions;

function referencePresetId(opts: ReferencePresetOptions): ReferencePresetId {
  const presetId = opts.referencePresetId;
  if (presetId === undefined) {
    return REFERENCE_PROFILE_SCENARIO_01_ID;
  }
  if (
    presetId === REFERENCE_PROFILE_LOCAL_DEV_ID ||
    presetId === REFERENCE_PROFILE_SINGLE_OPERATOR_ID ||
    presetId === REFERENCE_PROFILE_SCENARIO_01_ID ||
    presetId === REFERENCE_PROFILE_HARDENED_IDP_ID
  ) {
    return presetId;
  }
  if (/[<>{}⟨⟩]/u.test(presetId)) {
    return REFERENCE_PROFILE_SCENARIO_01_ID;
  }
  throw new Error(`unknown reference preset "${presetId}"`);
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
  opts: T & ReferencePresetOptions,
): T & ProviderCompositionOptions {
  const presetId = referencePresetId(opts);
  const registry =
    opts.providerRegistry ??
    (opts.providerHost === undefined ? createReferenceProviderRegistry() : undefined);
  const { providerConfig: capsuleDefaultProviderConfig, ...capsuleDefaults } =
    referenceCapsuleProviderSelectionForProfile(presetId);
  const capsuleProviderConfig = mergeProviderConfig(
    capsuleDefaultProviderConfig,
    opts.capsuleProviderConfig,
  );
  return {
    ...opts,
    ...(registry !== undefined ? { providerRegistry: registry } : {}),
    appDeploymentConfig: mergeAppDeploymentConfig(
      referenceAppDeploymentConfigForProfile(presetId),
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
export function createApp(opts: ReferenceProviderCompositionOptions = {}): App {
  return createGenericApp(withReferenceDefaults(opts));
}

/** Compose the reference Agent Bridge distribution. */
export function createBridge(
  opts: ReferenceCreateBridgeOptions = {},
): ReturnType<typeof createGenericBridge> {
  return createGenericBridge(withReferenceDefaults(opts));
}

/** Compose the reference provisioning bridge distribution. */
export function createProvisioningBridge(
  opts: ReferenceCreateProvisioningBridgeOptions = {},
): ProvisioningStack {
  return createGenericProvisioningBridge(withReferenceDefaults(opts));
}

/** Compose the reference enrollment stack distribution. */
export function createEnrollmentStack(
  opts: ReferenceCreateEnrollmentStackOptions,
): EnrollmentStack {
  return createGenericEnrollmentStack(withReferenceDefaults(opts));
}

/** Boot the reference GLA daemon distribution with the in-tree provider set selected by default. */
export function serve(opts: ReferenceServeOptions = {}): Promise<DaemonHandle> {
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
