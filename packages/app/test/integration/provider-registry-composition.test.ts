import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_HANDOFF_TEMPLATE, createProviderPackageSkeleton } from "@gla/catalog";
import type { LauncherPort, RuntimeHandle } from "@gla/kernel";
import { type GlaProviderModule, ProviderRegistry } from "@gla/provider-host";
import {
  AUTH_WEBAUTHN_PROVIDER_ID,
  CHANNEL_CLI_PROVIDER_ID,
  CONNECTOR_CDP_PROVIDER_ID,
  DETECTOR_URL_PROVIDER_ID,
  DETECTOR_USER_DONE_PROVIDER_ID,
  ENTRYPOINT_NOVNC_PROVIDER_ID,
  LAUNCHER_PROCESS_PROVIDER_ID,
  REFERENCE_PROFILE_LOCAL_DEV_ID,
  REFERENCE_PROFILE_SCENARIO_01_ID,
  SECRET_STORE_REFERENCE_PROVIDER_ID,
  WORKSPACE_PROFILE_PROVIDER_ID,
  referenceAppDeploymentConfigForProfile,
  referenceCapsuleProviderSelectionForProfile,
  referenceProviderModules,
} from "@gla/provider-set-reference";
import { describe, expect, it } from "vitest";
import { createApp, createBridge } from "../../src/composition.js";
import {
  createApp as createReferenceApp,
  createBridge as createReferenceBridge,
} from "../../src/index.js";

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("ProviderRegistry app composition", () => {
  it("boots the reference distribution from registry, deployment defaults, and capsule defaults", () => {
    const app = createReferenceApp();
    const bridge = createReferenceBridge();

    expect(app.wiring).toMatchObject({
      auth: "@gla/auth-webauthn",
      launcher: "@gla/launcher-process",
      connector: "@gla/connector-cdp",
      workspace: "@gla/workspace-profile",
      detector: "@gla/detector-url",
      channel: "@gla/channel-cli",
      secretStore: "@gla/provider-set-reference",
    });
    expect(bridge.catalogShow(AUTH_WEBAUTHN_PROVIDER_ID)).toMatchObject({
      provenance: {
        source: "provider-manifest",
        id: AUTH_WEBAUTHN_PROVIDER_ID,
      },
    });
  });

  it("boots app wiring and exposes provider inventory through ProviderRegistry without AppProviderSet discovery", () => {
    const providerRegistry = ProviderRegistry.fromProviderModules(referenceProviderModules);
    const { providerConfig: capsuleProviderConfig, ...capsuleProviders } =
      referenceCapsuleProviderSelectionForProfile(REFERENCE_PROFILE_SCENARIO_01_ID);

    const app = createApp({
      providerRegistry,
      appDeploymentConfig: referenceAppDeploymentConfigForProfile(REFERENCE_PROFILE_SCENARIO_01_ID),
      capsuleProviders,
      ...(capsuleProviderConfig !== undefined ? { capsuleProviderConfig } : {}),
    });
    const authEntry = providerRegistry
      .providerEntries()
      .find((entry) => entry.providerId === AUTH_WEBAUTHN_PROVIDER_ID);

    expect(app.wiring.auth).toBe(authEntry?.packageEvidence.moduleId);
    expect(authEntry).toMatchObject({
      providerId: AUTH_WEBAUTHN_PROVIDER_ID,
      family: "auth",
      version: "0.1.0",
      factoryAvailable: true,
      probe: expect.objectContaining({ name: AUTH_WEBAUTHN_PROVIDER_ID, registered: true }),
      packageEvidence: expect.objectContaining({ kind: "provider-module" }),
    });
    expect(providerRegistry.isSealed()).toBe(true);
  });

  it("seals an externally supplied registry at app boot so provider code cannot be mutated later", () => {
    const providerRegistry = new ProviderRegistry().registerModules(referenceProviderModules);
    const { providerConfig: capsuleProviderConfig, ...capsuleProviders } =
      referenceCapsuleProviderSelectionForProfile(REFERENCE_PROFILE_SCENARIO_01_ID);

    expect(providerRegistry.isSealed()).toBe(false);
    createApp({
      providerRegistry,
      appDeploymentConfig: referenceAppDeploymentConfigForProfile(REFERENCE_PROFILE_SCENARIO_01_ID),
      capsuleProviders,
      ...(capsuleProviderConfig !== undefined ? { capsuleProviderConfig } : {}),
    });

    expect(providerRegistry.isSealed()).toBe(true);
    const firstReferenceModule = referenceProviderModules[0];
    if (firstReferenceModule === undefined) {
      throw new Error("reference provider module fixture is empty");
    }
    expect(() => providerRegistry.registerModule(firstReferenceModule)).toThrow(
      /registry is sealed/,
    );
    expect(providerRegistry.diagnostics()).toContainEqual(
      expect.objectContaining({ code: "provider.registry_sealed" }),
    );
  });

  it("labels catalog provenance as provider-manifest when composed from ProviderRegistry", () => {
    const providerRegistry = ProviderRegistry.fromProviderModules(referenceProviderModules);
    const { providerConfig: capsuleProviderConfig, ...capsuleProviders } =
      referenceCapsuleProviderSelectionForProfile(REFERENCE_PROFILE_SCENARIO_01_ID);
    const bridge = createBridge({
      providerRegistry,
      appDeploymentConfig: referenceAppDeploymentConfigForProfile(REFERENCE_PROFILE_SCENARIO_01_ID),
      capsuleProviders,
      ...(capsuleProviderConfig !== undefined ? { capsuleProviderConfig } : {}),
    });

    expect(bridge.catalogShow(AUTH_WEBAUTHN_PROVIDER_ID)).toMatchObject({
      name: AUTH_WEBAUTHN_PROVIDER_ID,
      provenance: {
        source: "provider-manifest",
        id: AUTH_WEBAUTHN_PROVIDER_ID,
        version: "0.1.0",
      },
    });
  });

  it("applies reference capsule provider config through the registry-backed runtime graph", () => {
    const bridge = createReferenceBridge({ providerProfileId: REFERENCE_PROFILE_LOCAL_DEV_ID });

    expect(bridge.catalogShow(LAUNCHER_PROCESS_PROVIDER_ID)).toMatchObject({
      resolvedConfig: { mode: "headless" },
    });
  });

  it("keeps legacy provider-set shape reads isolated to the compatibility boundary", () => {
    const srcRoot = fileURLToPath(new URL("../../src", import.meta.url));
    const legacyShapeReadLines = sourceFiles(srcRoot).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) =>
          [
            "providerSet.modules",
            "providerSet.profiles",
            "providerSet?.selectedProfileId",
            "providerSet?.profile",
          ].some((needle) => line.includes(needle)),
        )
        .map((line) => `${basename(path)}:${line.trim()}`),
    );

    expect(legacyShapeReadLines).toEqual([
      "provider-compat.ts:const manifest = providerSet.profiles?.find((profile) => profile.metadata.name === profileId);",
      "provider-compat.ts:return providerSet?.selectedProfileId;",
      "provider-compat.ts:return providerSet?.profile;",
      "provider-compat.ts:return ProviderRegistry.fromProviderModules(providerSet.modules);",
    ]);
  });

  it("keeps provider-set callbacks out of runtime composition except through the compatibility adapter", () => {
    const srcRoot = fileURLToPath(new URL("../../src", import.meta.url));
    const callbackLines = sourceFiles(srcRoot).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) =>
          [
            "providerSet?.defaultConfig",
            "providerSet?.defaultServices",
            "providerSet?.entrypointClientAssets",
            "providerSet?.templateProbes",
          ].some((needle) => line.includes(needle)),
        )
        .map((line) => `${basename(path)}:${line.trim()}`),
    );

    expect(callbackLines).toEqual([
      "provider-compat.ts:return providerSet?.defaultConfig?.(args);",
      "provider-compat.ts:return providerSet?.defaultServices?.(args);",
      'provider-compat.ts:return providerSet?.entrypointClientAssets?.(host, host.providerIds("entrypoint")) ?? [];',
      "provider-compat.ts:return providerSet?.templateProbes ?? {};",
    ]);
  });

  it("reference package exposes split deployment and capsule defaults for named profiles", () => {
    const scenarioDeployment = referenceAppDeploymentConfigForProfile(
      REFERENCE_PROFILE_SCENARIO_01_ID,
    );
    expect(scenarioDeployment).toMatchObject({
      auth: AUTH_WEBAUTHN_PROVIDER_ID,
      channel: CHANNEL_CLI_PROVIDER_ID,
      secretStore: SECRET_STORE_REFERENCE_PROVIDER_ID,
      providerConfig: {
        [AUTH_WEBAUTHN_PROVIDER_ID]: expect.objectContaining({ rpName: "GLA" }),
        [CHANNEL_CLI_PROVIDER_ID]: expect.objectContaining({ delivery: "stdout" }),
      },
    });
    expect(scenarioDeployment.providerConfig).not.toHaveProperty(LAUNCHER_PROCESS_PROVIDER_ID);
    expect(referenceCapsuleProviderSelectionForProfile(REFERENCE_PROFILE_SCENARIO_01_ID)).toEqual({
      launcher: LAUNCHER_PROCESS_PROVIDER_ID,
      connector: CONNECTOR_CDP_PROVIDER_ID,
      workspace: WORKSPACE_PROFILE_PROVIDER_ID,
      entrypoint: ENTRYPOINT_NOVNC_PROVIDER_ID,
      detector: DETECTOR_URL_PROVIDER_ID,
      providerConfig: {
        [LAUNCHER_PROCESS_PROVIDER_ID]: { mode: "auto" },
      },
    });
    expect(
      referenceCapsuleProviderSelectionForProfile(REFERENCE_PROFILE_LOCAL_DEV_ID),
    ).toMatchObject({
      launcher: LAUNCHER_PROCESS_PROVIDER_ID,
      detector: DETECTOR_USER_DONE_PROVIDER_ID,
      providerConfig: {
        [LAUNCHER_PROCESS_PROVIDER_ID]: { mode: "headless" },
      },
    });
  });

  it("registers a locally authored provider into a development boot context and projects it to catalog", () => {
    const authoredProviderId = "launcher-authoring-boot";
    const skeleton = createProviderPackageSkeleton({
      providerId: authoredProviderId,
      family: "launcher",
      configSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["dev"], default: "dev" },
        },
      },
    });
    const launcher: LauncherPort = {
      tier: "none",
      mountCapability: { file: false, directory: false, modes: [] },
      async spawn() {
        return "runtime:authoring-boot" as unknown as RuntimeHandle;
      },
      async health() {
        return "up";
      },
      async stop() {},
    };
    const localModule: GlaProviderModule = {
      moduleId: "@gla/provider-authoring-boot",
      manifest: skeleton.manifest,
      register(ctx) {
        ctx.registerLauncher(authoredProviderId, { create: () => launcher });
        ctx.registerProbe(authoredProviderId, () => "available");
      },
    };
    const providerRegistry = ProviderRegistry.fromProviderModules([
      ...referenceProviderModules,
      localModule,
    ]);
    const { providerConfig: capsuleProviderConfig, ...capsuleProviders } =
      referenceCapsuleProviderSelectionForProfile(REFERENCE_PROFILE_SCENARIO_01_ID);
    const bridge = createBridge({
      providerRegistry,
      appDeploymentConfig: referenceAppDeploymentConfigForProfile(REFERENCE_PROFILE_SCENARIO_01_ID),
      capsuleProviders: { ...capsuleProviders, launcher: authoredProviderId },
      capsuleProviderConfig: {
        ...(capsuleProviderConfig ?? {}),
        [authoredProviderId]: { mode: "dev" },
      },
    });

    expect(providerRegistry.isSealed()).toBe(true);
    expect(
      providerRegistry.providerEntries().find((entry) => entry.providerId === authoredProviderId),
    ).toMatchObject({
      providerId: authoredProviderId,
      family: "launcher",
      version: "0.1.0",
      factoryAvailable: true,
      probe: expect.objectContaining({ name: authoredProviderId, registered: true }),
      packageEvidence: {
        kind: "provider-module",
        moduleId: "@gla/provider-authoring-boot",
      },
    });
    expect(bridge.catalogShow(authoredProviderId)).toMatchObject({
      name: authoredProviderId,
      family: "launcher",
      availability: "available",
      resolvedConfig: { mode: "dev" },
      provenance: {
        source: "provider-manifest",
        id: authoredProviderId,
        version: "0.1.0",
      },
    });
    expect(bridge.templateShow(BROWSER_HANDOFF_TEMPLATE.metadata.name)).toMatchObject({
      defaultSources: {
        launcher: expect.objectContaining({
          providerId: authoredProviderId,
          source: "template-package-default",
        }),
      },
      compatibilityConstraints: {
        requiredParts: expect.arrayContaining(["entrypoint", "connector", "detector"]),
      },
    });
  });

  it("projects entrypoint client asset provenance from runtime filesystem evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "gla-client-asset-facts-"));
    const missingRoot = join(root, "missing");
    const mutableRoot = join(root, "mutable");
    mkdirSync(mutableRoot);
    try {
      const bridge = createReferenceBridge({
        entrypointClientAssets: [
          {
            providerId: ENTRYPOINT_NOVNC_PROVIDER_ID,
            ref: `${ENTRYPOINT_NOVNC_PROVIDER_ID}.novnc`,
            source: "local-override",
            env: "GLA_NOVNC_WEB_ROOT",
            root: missingRoot,
            readOnly: true,
          },
          {
            providerId: ENTRYPOINT_NOVNC_PROVIDER_ID,
            ref: `${ENTRYPOINT_NOVNC_PROVIDER_ID}.mutable`,
            source: "local-override",
            env: "GLA_NOVNC_WEB_ROOT",
            root: mutableRoot,
            readOnly: true,
          },
        ],
      });

      expect(bridge.catalogShow(ENTRYPOINT_NOVNC_PROVIDER_ID).clientAssets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ref: `${ENTRYPOINT_NOVNC_PROVIDER_ID}.novnc`,
            source: "local-override",
            status: "missing",
            readOnly: "unknown",
            states: expect.arrayContaining(["local-override", "missing", "unverifiable"]),
            provenance: expect.objectContaining({
              source: "local-override",
              env: "GLA_NOVNC_WEB_ROOT",
            }),
            diagnostics: expect.arrayContaining([
              expect.objectContaining({ code: "graph.client_asset_missing" }),
            ]),
          }),
          expect.objectContaining({
            ref: `${ENTRYPOINT_NOVNC_PROVIDER_ID}.mutable`,
            source: "local-override",
            status: "mutable",
            states: expect.arrayContaining(["local-override", "mutable", "unverifiable"]),
            provenance: expect.objectContaining({
              source: "local-override",
              env: "GLA_NOVNC_WEB_ROOT",
            }),
            diagnostics: expect.arrayContaining([
              expect.objectContaining({ code: "graph.client_asset_mutable" }),
            ]),
          }),
        ]),
      );
      const missingAsset = bridge
        .catalogShow(ENTRYPOINT_NOVNC_PROVIDER_ID)
        .clientAssets?.find((asset) => asset.ref === `${ENTRYPOINT_NOVNC_PROVIDER_ID}.novnc`);
      expect(missingAsset).not.toHaveProperty("package");
      expect(missingAsset?.states).not.toContain("packaged");
      expect(missingAsset?.states).not.toContain("evidence-backed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
