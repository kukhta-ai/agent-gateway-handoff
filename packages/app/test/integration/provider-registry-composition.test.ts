import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROWSER_HANDOFF_TEMPLATE,
  createProviderPackageSkeleton,
  referenceWpmDependencyBindings,
} from "@gla/catalog";
import type { LauncherPort, RuntimeHandle } from "@gla/kernel";
import { type GlaProviderModule, ProviderRegistry } from "@gla/provider-host";
import {
  AUTH_AUTHENTIK_PROVIDER_ID,
  AUTH_WEBAUTHN_PROVIDER_ID,
  CHANNEL_CLI_PROVIDER_ID,
  CONNECTOR_CDP_PROVIDER_ID,
  DETECTOR_URL_PROVIDER_ID,
  DETECTOR_USER_DONE_PROVIDER_ID,
  ENTRYPOINT_NOVNC_PROVIDER_ID,
  LAUNCHER_PROCESS_PROVIDER_ID,
  REFERENCE_PROFILE_HARDENED_IDP_ID,
  REFERENCE_PROFILE_LOCAL_DEV_ID,
  REFERENCE_PROFILE_SCENARIO_01_ID,
  SECRET_STORE_REFERENCE_PROVIDER_ID,
  WORKSPACE_PROFILE_PROVIDER_ID,
  referenceAppDeploymentConfigForProfile,
  referenceCapsuleProviderSelectionForProfile,
  referenceProviderModules,
} from "@gla/provider-set-reference";
import { describe, expect, it } from "vitest";
import { createApp, createBridge, createProvisioningBridge } from "../../src/composition.js";
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

function referenceBindingsWithReachableEdgeProxy(): ReturnType<
  typeof referenceWpmDependencyBindings
> {
  return referenceWpmDependencyBindings().map((binding) =>
    binding.dependency === "edge-proxy"
      ? {
          ...binding,
          currentProbe: { result: "available" as const },
          lastProbe: {
            ...(binding.lastProbe ?? { at: "2026-06-13T00:00:00.000Z" }),
            result: "available" as const,
          },
        }
      : binding,
  );
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
    const bridge = createReferenceBridge({ referencePresetId: REFERENCE_PROFILE_LOCAL_DEV_ID });

    expect(bridge.catalogShow(LAUNCHER_PROCESS_PROVIDER_ID)).toMatchObject({
      resolvedConfig: { mode: "headless" },
    });
  });

  it("keeps legacy provider-set shape reads absent from runtime composition", () => {
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

    expect(legacyShapeReadLines).toEqual([]);
  });

  it("keeps provider-set callbacks out of runtime composition", () => {
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

    expect(callbackLines).toEqual([]);
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

  it("projects delegated auth from AppDeploymentConfig while capsule defaults stay separate", async () => {
    const providerRegistry = ProviderRegistry.fromProviderModules(referenceProviderModules);
    const deployment = referenceAppDeploymentConfigForProfile(REFERENCE_PROFILE_HARDENED_IDP_ID);
    const { providerConfig: capsuleProviderConfig, ...capsuleProviders } =
      referenceCapsuleProviderSelectionForProfile(REFERENCE_PROFILE_HARDENED_IDP_ID);
    const stack = createProvisioningBridge({
      providerRegistry,
      appDeploymentConfig: deployment,
      capsuleProviders,
      ...(capsuleProviderConfig !== undefined ? { capsuleProviderConfig } : {}),
      dependencyBindings: referenceBindingsWithReachableEdgeProxy(),
      templateProbes: { [BROWSER_HANDOFF_TEMPLATE.metadata.name]: () => "available" },
    });

    try {
      await stack.ready;

      expect(deployment.auth).toBe(AUTH_AUTHENTIK_PROVIDER_ID);
      expect(capsuleProviders).toMatchObject({
        launcher: LAUNCHER_PROCESS_PROVIDER_ID,
        workspace: WORKSPACE_PROFILE_PROVIDER_ID,
        entrypoint: ENTRYPOINT_NOVNC_PROVIDER_ID,
        connector: CONNECTOR_CDP_PROVIDER_ID,
        detector: DETECTOR_URL_PROVIDER_ID,
      });
      expect(stack.providerGraphDoctor.status).toBe("PASS");
      expect(stack.providerGraphDoctor.selectedProviders).toMatchObject({
        AuthProvider: AUTH_AUTHENTIK_PROVIDER_ID,
        Launcher: LAUNCHER_PROCESS_PROVIDER_ID,
        CompletionDetector: DETECTOR_URL_PROVIDER_ID,
      });
      expect(
        stack.providerGraphDoctor.providers.find(
          (provider) => provider.providerId === AUTH_AUTHENTIK_PROVIDER_ID,
        ),
      ).toMatchObject({
        providerId: AUTH_AUTHENTIK_PROVIDER_ID,
        family: "auth",
        selected: true,
        available: true,
        dependencies: [
          expect.objectContaining({
            dependency: "identity-provider",
            status: "bound",
          }),
        ],
      });
      expect(stack.authModule).toBe("@gla/auth-authentik");
      await expect(
        stack.bridge.sessionCreate({
          proposal: {
            intent: "delegated auth deployment verification",
            template: BROWSER_HANDOFF_TEMPLATE.metadata.name,
            recipient: "tg:user:delegated-auth",
            detectors: [{ use: DETECTOR_URL_PROVIDER_ID, params: { complete_on: "/dashboard" } }],
          },
          dryRun: true,
        }),
      ).resolves.toMatchObject({
        decision: "accept",
        dry_run: true,
        capsule_plan: {
          providers: expect.arrayContaining([
            expect.objectContaining({
              role: "launcher",
              providerId: LAUNCHER_PROCESS_PROVIDER_ID,
            }),
            expect.objectContaining({
              role: "detector",
              providerId: DETECTOR_URL_PROVIDER_ID,
            }),
          ]),
        },
      });
    } finally {
      await stack.close();
    }
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

  it("verifies registry, deployment, capsule, catalog, admission, provisioning, and gateway asset evidence agree", async () => {
    const assetRoot = mkdtempSync(join(tmpdir(), "gla-cross-layer-assets-"));
    const providerRegistry = ProviderRegistry.fromProviderModules(referenceProviderModules);
    const { providerConfig: capsuleProviderConfig, ...capsuleProviders } =
      referenceCapsuleProviderSelectionForProfile(REFERENCE_PROFILE_LOCAL_DEV_ID);
    const entrypointAsset = {
      providerId: ENTRYPOINT_NOVNC_PROVIDER_ID,
      ref: `${ENTRYPOINT_NOVNC_PROVIDER_ID}.novnc`,
      source: "package" as const,
      package: "@novnc/novnc",
      root: assetRoot,
      readOnly: true as const,
      cacheControl: "no-cache" as const,
    };
    const stack = createProvisioningBridge({
      providerRegistry,
      appDeploymentConfig: referenceAppDeploymentConfigForProfile(REFERENCE_PROFILE_LOCAL_DEV_ID),
      capsuleProviders,
      ...(capsuleProviderConfig !== undefined ? { capsuleProviderConfig } : {}),
      dependencyBindings: referenceBindingsWithReachableEdgeProxy(),
      templateProbes: { [BROWSER_HANDOFF_TEMPLATE.metadata.name]: () => "available" },
      entrypointClientAssets: [entrypointAsset],
      handoff: {
        expectedOrigin: "http://127.0.0.1:3000",
        publicBaseUrl: "http://127.0.0.1:3000",
        host: "127.0.0.1",
        port: 0,
        deliverySink: { write() {} },
      },
    });
    try {
      await stack.ready;

      expect(providerRegistry.isSealed()).toBe(true);
      expect(
        stack.providerGraphDoctor.status,
        JSON.stringify(stack.providerGraphDoctor, null, 2),
      ).toBe("PASS");
      expect(stack.providerGraphDoctor.selectedProviders).toMatchObject({
        AuthProvider: AUTH_WEBAUTHN_PROVIDER_ID,
        ChannelAdapter: CHANNEL_CLI_PROVIDER_ID,
        SecretStore: SECRET_STORE_REFERENCE_PROVIDER_ID,
        Launcher: LAUNCHER_PROCESS_PROVIDER_ID,
        Workspace: WORKSPACE_PROFILE_PROVIDER_ID,
        HumanEntrypoint: ENTRYPOINT_NOVNC_PROVIDER_ID,
        AgentConnector: CONNECTOR_CDP_PROVIDER_ID,
        CompletionDetector: DETECTOR_USER_DONE_PROVIDER_ID,
      });

      const template = stack.bridge.templateShow(BROWSER_HANDOFF_TEMPLATE.metadata.name);
      expect(template.defaultSources).toMatchObject({
        launcher: { providerId: LAUNCHER_PROCESS_PROVIDER_ID },
        workspace: { providerId: WORKSPACE_PROFILE_PROVIDER_ID },
        entrypoint: { providerId: ENTRYPOINT_NOVNC_PROVIDER_ID },
        connector: { providerId: CONNECTOR_CDP_PROVIDER_ID },
        detector: { providerId: DETECTOR_USER_DONE_PROVIDER_ID },
      });

      const entrypointCatalog = stack.bridge.catalogShow(ENTRYPOINT_NOVNC_PROVIDER_ID);
      expect(entrypointCatalog).toMatchObject({
        name: ENTRYPOINT_NOVNC_PROVIDER_ID,
        available: true,
        provenance: { source: "provider-manifest", id: ENTRYPOINT_NOVNC_PROVIDER_ID },
      });
      expect(entrypointCatalog.clientAssets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ref: entrypointAsset.ref,
            source: "package",
            status: "ready",
            states: expect.arrayContaining(["packaged", "read-only"]),
            provenance: expect.objectContaining({ source: "runtime-mount" }),
          }),
        ]),
      );
      expect(
        stack.providerGraphDoctor.providers.find(
          (provider) => provider.providerId === ENTRYPOINT_NOVNC_PROVIDER_ID,
        )?.clientAssets,
      ).toEqual(entrypointCatalog.clientAssets);
      expect(stack.gateway).toBeDefined();

      const dryRun = await stack.bridge.sessionCreate({
        proposal: {
          intent: "cross-layer provider verification",
          template: BROWSER_HANDOFF_TEMPLATE.metadata.name,
          recipient: "tg:user:matrix",
        },
        dryRun: true,
      });
      expect(dryRun).toMatchObject({
        decision: "accept",
        dry_run: true,
        capsule_plan: {
          template: BROWSER_HANDOFF_TEMPLATE.metadata.name,
          providers: expect.arrayContaining([
            expect.objectContaining({
              role: "launcher",
              providerId: LAUNCHER_PROCESS_PROVIDER_ID,
              available: true,
            }),
            expect.objectContaining({
              role: "entrypoint",
              providerId: ENTRYPOINT_NOVNC_PROVIDER_ID,
              available: true,
            }),
            expect.objectContaining({
              role: "connector",
              providerId: CONNECTOR_CDP_PROVIDER_ID,
              available: true,
            }),
            expect.objectContaining({
              role: "detector",
              providerId: DETECTOR_USER_DONE_PROVIDER_ID,
              available: true,
            }),
          ]),
        },
      });
      expect(stack.registry.has(LAUNCHER_PROCESS_PROVIDER_ID)).toBe(true);
      expect(stack.authModule).toBe("@gla/auth-webauthn");
    } finally {
      await stack.close();
      rmSync(assetRoot, { recursive: true, force: true });
    }
  });
});
