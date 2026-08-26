import {
  type ProviderFamily,
  type ProviderManifest,
  referenceWpmDependencyBindings,
} from "@gla/catalog";
import {
  type AgentConnector,
  type AgentConnectorPort,
  type AuthProviderPort,
  type ChannelPort,
  type CompletionDetectorPort,
  type ConfigSchema,
  EMPTY_CONFIG_SCHEMA,
  type HumanEntrypointBinding,
  type HumanEntrypointPort,
  KERNEL_MODULE,
  type LauncherPort,
  type MountSpec,
  type OpaqueToken,
  type PartRef,
  type RawCompletionSignal,
  type RecipientRef,
  type Ref,
  type ResolvedAssemblySpec,
  type ResolvedCapsulePlan,
  type RuntimeHandle,
  type SecretStorePort,
  type WorkspaceHandle,
  type WorkspacePort,
  encodeRuntimeHandle,
} from "@gla/kernel";
import { POLICY_CEDAR_MODULE } from "@gla/policy-cedar";
import {
  type GlaProviderModule,
  ProviderHost,
  type ProviderRegistrationContext,
  ProviderRegistry,
} from "@gla/provider-host";
import { describe, expect, it } from "vitest";
import {
  type AppDeploymentConfigInput,
  type CapsuleProviderSelectionInput,
  type ProviderCompositionOptions,
  createApp,
  createBridge,
  createEnrollmentStack,
  createProvisioningBridge,
} from "../../src/composition.js";

interface FakeRecords {
  configs: Record<string, Record<string, unknown>>;
  workspaceConfigs: Array<Record<string, unknown>>;
  serviceBindings: Record<string, boolean>;
  assetProviderIds: string[];
  delivered: Array<{ recipient: RecipientRef; link: string }>;
}

interface FakeProviderBundle {
  modules: GlaProviderModule[];
  appDeploymentConfig: AppDeploymentConfigInput;
  capsuleProviders: CapsuleProviderSelectionInput;
  capsuleProviderConfig?: Record<string, Record<string, unknown>>;
  entrypointClientAssets: ProviderCompositionOptions["entrypointClientAssets"];
  templateProbes?: ProviderCompositionOptions["templateProbes"];
}

function emptySchema(): ConfigSchema {
  return structuredClone(EMPTY_CONFIG_SCHEMA);
}

function objectSchema(
  properties: NonNullable<ConfigSchema["properties"]>,
  required: string[] = [],
): ConfigSchema {
  return {
    type: "object",
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
    properties,
  };
}

function fakeRecords(): FakeRecords {
  return {
    configs: {},
    workspaceConfigs: [],
    serviceBindings: {},
    assetProviderIds: [],
    delivered: [],
  };
}

function providerManifest(opts: {
  id: string;
  kind: string;
  family: ProviderFamily;
  summary: string;
  configSchema?: ConfigSchema;
  factoryConfigSchema?: ConfigSchema;
  capability?: Record<string, unknown>;
  relations?: ProviderManifest["spec"]["relations"];
}): ProviderManifest {
  return {
    apiVersion: "gla.dev/v1",
    kind: opts.kind,
    metadata: { name: opts.id, version: "0.1.0" },
    spec: {
      family: opts.family,
      capability: { summary: opts.summary, ...(opts.capability ?? {}) },
      ...(opts.configSchema !== undefined ? { config_schema: opts.configSchema } : {}),
      ...(opts.factoryConfigSchema !== undefined
        ? { factory_config_schema: opts.factoryConfigSchema }
        : {}),
      ...(opts.relations !== undefined ? { relations: opts.relations } : {}),
      probe: opts.id,
      skills: [{ id: `use-${opts.id}`, for: opts.id, body: `Use ${opts.id}.` }],
    },
  };
}

function moduleFor(
  manifest: ProviderManifest,
  moduleId: string,
  register: (ctx: ProviderRegistrationContext) => void,
): GlaProviderModule {
  return {
    moduleId,
    manifest,
    register(ctx) {
      register(ctx);
      ctx.registerProbe(manifest.metadata.name, () => "available");
    },
  };
}

class FakeAuthProvider implements AuthProviderPort {
  async beginEnrollment(): Promise<Record<string, never>> {
    return {};
  }

  async finishEnrollment(): Promise<{ credentialId: string; authStrength: "password" }> {
    return { credentialId: "fake-credential", authStrength: "password" };
  }

  async challenge(): Promise<Record<string, never>> {
    return {};
  }

  async verifyAssertion(): Promise<{ ok: true; authStrength: "password" }> {
    return { ok: true, authStrength: "password" };
  }
}

class FakeLauncher implements LauncherPort {
  readonly tier = "none" as const;
  readonly mountCapability = { file: false, directory: false, modes: [] };

  async spawn(_spec: ResolvedAssemblySpec, _asUid: number): Promise<RuntimeHandle> {
    return encodeRuntimeHandle({
      endpoints: [
        {
          family: "agent-connector",
          provider: "fake-connector",
          resourceId: "fake-agent-resource",
          transport: "stdio",
        },
        {
          family: "human-entrypoint",
          provider: "fake-entrypoint",
          resourceId: "fake-human-resource",
          transport: "http",
          address: "http://127.0.0.1/fake",
          client: { kind: "fake-client", ref: "fake-entrypoint.fake-client" },
        },
      ],
    });
  }

  async health(): Promise<"up"> {
    return "up";
  }

  async stop(): Promise<void> {}
}

class FakeWorkspace implements WorkspacePort {
  async realize(
    _strategy: PartRef,
    _mounts: MountSpec[],
    _asUid: number,
  ): Promise<WorkspaceHandle> {
    return "workspace:fake" as WorkspaceHandle;
  }

  async reap(_h: WorkspaceHandle): Promise<void> {}
}

class FakeConnector implements AgentConnectorPort {
  async attach(_h: RuntimeHandle): Promise<AgentConnector> {
    return { type: "fake", provider: "fake-connector", resourceId: "fake-agent-resource" };
  }
}

class FakeEntrypoint implements HumanEntrypointPort {
  async open(_h: RuntimeHandle): Promise<HumanEntrypointBinding> {
    return {
      resourceId: "fake-human-resource",
      provider: "fake-entrypoint",
      client: { kind: "fake-client", ref: "fake-entrypoint.fake-client" },
      transport: { kind: "reverse-proxy", protocol: "http", upstream: "http://127.0.0.1/fake" },
    };
  }
}

class FakeDetector implements CompletionDetectorPort {
  readonly contract: ConfigSchema = emptySchema();

  async *watch(
    _h: RuntimeHandle,
    _params: Record<string, unknown>,
  ): AsyncIterable<RawCompletionSignal> {}
}

class FakeSecretStore implements SecretStorePort {
  async put(_value: unknown, _audience: string): Promise<Ref<"secret-ref">> {
    return "secret:fake" as Ref<"secret-ref">;
  }

  async injectInto(_ref: Ref<"secret-ref">, _target: unknown): Promise<void> {}
}

function fakeProviderBundle(records: FakeRecords): FakeProviderBundle {
  const modules: GlaProviderModule[] = [
    moduleFor(
      providerManifest({
        id: "fake-auth",
        kind: "AuthProvider",
        family: "auth",
        summary: "fake auth",
        configSchema: objectSchema(
          {
            rpID: { type: "string", minLength: 1 },
            rpName: { type: "string", minLength: 1 },
            expectedOrigin: {
              type: "array",
              minItems: 1,
              items: { type: "string", minLength: 1 },
            },
          },
          ["rpID", "expectedOrigin"],
        ),
      }),
      "@fake/auth",
      (ctx) =>
        ctx.registerAuthProvider("fake-auth", {
          create(createCtx) {
            records.configs.auth = createCtx.config;
            return new FakeAuthProvider();
          },
        }),
    ),
    moduleFor(
      providerManifest({
        id: "fake-launcher",
        kind: "Launcher",
        family: "launcher",
        summary: "fake launcher",
        configSchema: objectSchema({
          mode: { type: "string", enum: ["auto", "headless"], default: "headless" },
        }),
        relations: {
          compatibleWith: {
            entrypoints: ["fake-entrypoint"],
            connectors: ["fake-connector"],
          },
        },
      }),
      "@fake/launcher",
      (ctx) =>
        ctx.registerLauncher("fake-launcher", {
          create(createCtx) {
            records.configs.launcher = createCtx.config;
            return new FakeLauncher();
          },
        }),
    ),
    moduleFor(
      providerManifest({
        id: "fake-workspace",
        kind: "Workspace",
        family: "workspace",
        summary: "fake workspace",
        configSchema: objectSchema({ root: { type: "string", minLength: 1 } }),
      }),
      "@fake/workspace",
      (ctx) =>
        ctx.registerWorkspace("fake-workspace", {
          create(createCtx) {
            records.configs.workspace = createCtx.config;
            records.workspaceConfigs.push(createCtx.config);
            return new FakeWorkspace();
          },
        }),
    ),
    moduleFor(
      providerManifest({
        id: "fake-connector",
        kind: "AgentConnector",
        family: "connector",
        summary: "fake connector",
      }),
      "@fake/connector",
      (ctx) => ctx.registerAgentConnector("fake-connector", { create: () => new FakeConnector() }),
    ),
    moduleFor(
      providerManifest({
        id: "fake-entrypoint",
        kind: "HumanEntrypoint",
        family: "entrypoint",
        summary: "fake entrypoint",
        configSchema: objectSchema({
          clientTheme: { type: "string", enum: ["light", "dark"], default: "light" },
        }),
        capability: {
          clientAssets: [{ ref: "fake-entrypoint.fake-client", kind: "fake-client" }],
        },
      }),
      "@fake/entrypoint",
      (ctx) =>
        ctx.registerHumanEntrypoint("fake-entrypoint", { create: () => new FakeEntrypoint() }),
    ),
    moduleFor(
      providerManifest({
        id: "fake-detector",
        kind: "CompletionDetector",
        family: "detector",
        summary: "fake detector",
        factoryConfigSchema: objectSchema({ pollMs: { type: "number", minimum: 1 } }, ["pollMs"]),
        capability: { completion: { statuses: { fake: { status: "done" } } } },
        relations: { compatibleWith: { templates: ["browser-handoff"] } },
      }),
      "@fake/detector",
      (ctx) =>
        ctx.registerCompletionDetector("fake-detector", {
          create(createCtx) {
            records.configs.detector = createCtx.config;
            records.serviceBindings.detectorReadUrl =
              createCtx.services.get<() => Promise<string | undefined>>("detectorUrl.readUrl") !==
              undefined;
            return new FakeDetector();
          },
        }),
    ),
    moduleFor(
      providerManifest({
        id: "fake-channel",
        kind: "ChannelAdapter",
        family: "channel",
        summary: "fake channel",
      }),
      "@fake/channel",
      (ctx) =>
        ctx.registerChannel("fake-channel", {
          create(createCtx) {
            records.serviceBindings.channelIdentity =
              createCtx.services.get("identity") !== undefined;
            return {
              async deliver(recipient: RecipientRef, link: string, _delegation: OpaqueToken) {
                records.delivered.push({ recipient, link });
              },
              async *receive() {},
            } satisfies ChannelPort;
          },
        }),
    ),
    moduleFor(
      providerManifest({
        id: "fake-secret-store",
        kind: "SecretStore",
        family: "secret-store",
        summary: "fake secret store",
      }),
      "@fake/secret-store",
      (ctx) =>
        ctx.registerSecretStore("fake-secret-store", {
          create: () => new FakeSecretStore(),
        }),
    ),
  ];
  records.assetProviderIds = ["fake-entrypoint"];
  return {
    modules,
    appDeploymentConfig: {
      auth: "fake-auth",
      channel: "fake-channel",
      secretStore: "fake-secret-store",
    },
    capsuleProviders: {
      launcher: "fake-launcher",
      connector: "fake-connector",
      workspace: "fake-workspace",
      entrypoint: "fake-entrypoint",
      detector: "fake-detector",
    },
    entrypointClientAssets: [
      {
        providerId: "fake-entrypoint",
        ref: "fake-entrypoint.fake-client",
        root: process.cwd(),
        readOnly: true,
      },
    ],
    templateProbes: { "browser-handoff": () => "available" },
  };
}

function fakeProviderOptions(bundle: FakeProviderBundle): ProviderCompositionOptions {
  return {
    providerRegistry: ProviderRegistry.fromProviderModules(bundle.modules),
    appDeploymentConfig: bundle.appDeploymentConfig,
    capsuleProviders: bundle.capsuleProviders,
    ...(bundle.capsuleProviderConfig !== undefined
      ? { capsuleProviderConfig: bundle.capsuleProviderConfig }
      : {}),
    ...(bundle.entrypointClientAssets !== undefined
      ? { entrypointClientAssets: bundle.entrypointClientAssets }
      : {}),
    ...(bundle.templateProbes !== undefined ? { templateProbes: bundle.templateProbes } : {}),
  };
}

function fakeCapsulePlan(opts: {
  launcherConfig?: Record<string, unknown>;
  workspaceConfig?: Record<string, unknown>;
}): ResolvedCapsulePlan {
  return {
    template: "browser-handoff",
    providers: [
      {
        role: "launcher",
        providerId: "fake-launcher",
        config: opts.launcherConfig ?? { mode: "headless" },
        available: true,
        evidenceRequirements: [],
        diagnostics: [],
      },
      {
        role: "workspace",
        providerId: "fake-workspace",
        config: opts.workspaceConfig ?? {},
        available: true,
        evidenceRequirements: [],
        diagnostics: [],
      },
      {
        role: "connector",
        providerId: "fake-connector",
        config: {},
        available: true,
        evidenceRequirements: [],
        diagnostics: [],
      },
    ],
  };
}

function captureThrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected function to throw");
}

describe("registry-backed app composition", () => {
  it("projects wiring and catalog read models from Provider Host metadata for a non-reference provider bundle", () => {
    const records = fakeRecords();
    const bundle = fakeProviderBundle(records);

    expect(createApp(fakeProviderOptions(bundle)).wiring).toEqual({
      kernel: KERNEL_MODULE,
      policy: POLICY_CEDAR_MODULE,
      auth: "@fake/auth",
      launcher: "@fake/launcher",
      connector: "@fake/connector",
      workspace: "@fake/workspace",
      detector: "@fake/detector",
      channel: "@fake/channel",
      secretStore: "@fake/secret-store",
    });

    const bridge = createBridge(fakeProviderOptions(bundle));
    expect(bridge.catalogList().map((entity) => entity.name)).toEqual(
      expect.arrayContaining([
        "fake-auth",
        "fake-launcher",
        "fake-entrypoint",
        "fake-connector",
        "fake-workspace",
        "fake-detector",
        "fake-channel",
        "browser-handoff",
      ]),
    );
    expect(bridge.templateShow("browser-handoff").parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ part: "launcher", provider: "fake-launcher" }),
        expect.objectContaining({ part: "entrypoint", provider: "fake-entrypoint" }),
        expect.objectContaining({ part: "connector", provider: "fake-connector" }),
        expect.objectContaining({ part: "workspace", provider: "fake-workspace" }),
        expect.objectContaining({ part: "detector", provider: "fake-detector" }),
      ]),
    );
  });

  it("awaits async capsule provider factories during provisioning", async () => {
    const records = fakeRecords();
    const base = fakeProviderBundle(records);
    const bundle: FakeProviderBundle = {
      ...base,
      modules: [
        ...base.modules,
        moduleFor(
          providerManifest({
            id: "fake-async-launcher",
            kind: "Launcher",
            family: "launcher",
            summary: "fake async launcher",
            relations: {
              compatibleWith: {
                entrypoints: ["fake-entrypoint"],
                connectors: ["fake-connector"],
              },
            },
          }),
          "@fake/async-launcher",
          (ctx) =>
            ctx.registerLauncher("fake-async-launcher", {
              create: async () => new FakeLauncher(),
            }),
        ),
      ],
      capsuleProviders: { ...base.capsuleProviders, launcher: "fake-async-launcher" },
    };

    const stack = createProvisioningBridge({
      ...fakeProviderOptions(bundle),
      dependencyBindings: referenceWpmDependencyBindings(),
    });
    try {
      const created = await stack.bridge.sessionCreate({
        proposal: {
          intent: "reg",
          template: "browser-handoff",
          recipient: "tg:user:1",
        },
      });
      expect(created).toMatchObject({
        decision: "accept",
        state: "active",
        capsule_plan: {
          providers: expect.arrayContaining([
            expect.objectContaining({ role: "launcher", providerId: "fake-async-launcher" }),
          ]),
        },
      });
    } finally {
      await stack.close();
    }
  });

  it("creates separate workspace providers for same provider id with different plan config", async () => {
    const records = fakeRecords();
    const bundle = fakeProviderBundle(records);
    const stack = createProvisioningBridge({
      ...fakeProviderOptions(bundle),
      dependencyBindings: referenceWpmDependencyBindings(),
    });
    const spec: ResolvedAssemblySpec = {
      apiVersion: "gla.dev/v1",
      kind: "Assembly",
      metadata: { intent: "workspace config cache proof" },
      spec: {
        template: "browser-handoff",
        recipient: "tg:user:1" as never,
        launcher: { use: "fake-launcher" },
        workspace: { use: "fake-workspace" },
      },
      __resolved: true,
    };
    try {
      await stack.lifecycle.spawn(
        "sess_workspace_a",
        spec,
        fakeCapsulePlan({ workspaceConfig: { root: "/tmp/fake-a" } }),
      );
      await stack.lifecycle.spawn(
        "sess_workspace_b",
        spec,
        fakeCapsulePlan({ workspaceConfig: { root: "/tmp/fake-b" } }),
      );

      expect(records.workspaceConfigs).toEqual([{ root: "/tmp/fake-a" }, { root: "/tmp/fake-b" }]);
    } finally {
      await stack.lifecycle.teardown("sess_workspace_a");
      await stack.lifecycle.teardown("sess_workspace_b");
      await stack.close();
    }
  });

  it("reports provider.async_unsupported for remaining synchronous boot provider paths", () => {
    const records = fakeRecords();
    const base = fakeProviderBundle(records);
    const bundle: FakeProviderBundle = {
      ...base,
      modules: [
        ...base.modules,
        moduleFor(
          providerManifest({
            id: "fake-async-auth",
            kind: "AuthProvider",
            family: "auth",
            summary: "fake async auth",
            configSchema: objectSchema({
              rpID: { type: "string", minLength: 1 },
              expectedOrigin: {
                type: "array",
                minItems: 1,
                items: { type: "string", minLength: 1 },
              },
            }),
          }),
          "@fake/async-auth",
          (ctx) =>
            ctx.registerAuthProvider("fake-async-auth", {
              create: async () => new FakeAuthProvider(),
            }),
        ),
      ],
      appDeploymentConfig: { ...base.appDeploymentConfig, auth: "fake-async-auth" },
    };

    const error = captureThrown(() =>
      createEnrollmentStack({
        ...fakeProviderOptions(bundle),
        expectedOrigin: "http://127.0.0.1:3000",
        publicBaseUrl: "http://127.0.0.1:3000",
      }),
    );
    expect(error).toMatchObject({
      code: "dependency.unavailable",
      detail: {
        diagnostics: [
          expect.objectContaining({
            code: "provider.async_unsupported",
            providerId: "fake-async-auth",
            family: "auth",
          }),
        ],
      },
    });
  });

  it("does not treat public-edge WPM evidence as reachable without a template probe", () => {
    const records = fakeRecords();
    const bundle = fakeProviderBundle(records);

    const bridge = createBridge({
      ...fakeProviderOptions({ ...bundle, templateProbes: undefined }),
      dependencyBindings: referenceWpmDependencyBindings(),
    });
    const show = bridge.templateShow("browser-handoff");

    expect(show.available).toBe(false);
    expect(show.availability).toBe("unavailable");
    expect(show.dependencies[0]).toMatchObject({
      dependency: "edge-proxy",
      status: "bound",
      diagnostics: { install: "available", runtime: "unavailable" },
      publicEdgeTransport: expect.objectContaining({
        currentReachability: { result: "unavailable" },
      }),
    });
    expect(show.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "template.dependency_unavailable",
          dependency: "edge-proxy",
          dependencyScope: "template",
          install: "available",
          runtime: "unavailable",
        }),
      ]),
    );
  });

  it("keeps the runtime bridge closed to providers registered after boot composition", async () => {
    const records = fakeRecords();
    const bundle = fakeProviderBundle(records);
    const providerHost = new ProviderHost().registerModules(bundle.modules);
    const bridge = createBridge({
      providerHost,
      appDeploymentConfig: bundle.appDeploymentConfig,
      capsuleProviders: bundle.capsuleProviders,
      dependencyBindings: referenceWpmDependencyBindings(),
      templateProbes: bundle.templateProbes ?? {},
    });

    expect(bridge.catalogList().map((entity) => entity.name)).not.toContain("late-entrypoint");
    expect(() => bridge.skillShow("use-late-entrypoint")).toThrowError(/unknown skill/i);

    providerHost.registerModule(
      moduleFor(
        providerManifest({
          id: "late-entrypoint",
          kind: "HumanEntrypoint",
          family: "entrypoint",
          summary: "late entrypoint",
        }),
        "@fake/late-entrypoint",
        (ctx) =>
          ctx.registerHumanEntrypoint("late-entrypoint", {
            create: () => new FakeEntrypoint(),
          }),
      ),
    );

    expect(providerHost.providerManifest("late-entrypoint")).toBeDefined();
    expect(bridge.catalogList().map((entity) => entity.name)).not.toContain("late-entrypoint");
    const compatibleEntrypoints =
      bridge.templateShow("browser-handoff").compatibleProviders?.entrypoint ?? [];
    expect(compatibleEntrypoints).not.toContain("late-entrypoint");
    expect(() => bridge.skillShow("use-late-entrypoint")).toThrowError(/unknown skill/i);
    await expect(
      bridge.sessionCreate({
        proposal: {
          intent: "try a provider registered after daemon boot",
          template: "browser-handoff",
          recipient: "tg:user:123",
          entrypoints: [{ use: "late-entrypoint" }],
        },
        dryRun: true,
      }),
    ).rejects.toMatchObject({
      code: "policy.denied",
      detail: {
        part: "entrypoint",
        use: "late-entrypoint",
        compatibleWith: ["fake-entrypoint"],
      },
    });
  });

  it("fails closed through Provider Host diagnostics when a selected provider is unknown", () => {
    const bundle = fakeProviderBundle(fakeRecords());
    const error = captureThrown(() =>
      createApp({
        ...fakeProviderOptions(bundle),
        appDeploymentConfig: { ...bundle.appDeploymentConfig, auth: "missing-auth" },
      }),
    );

    expect(error).toMatchObject({
      code: "catalog.unknown",
      detail: {
        diagnostics: [
          expect.objectContaining({
            code: "provider.unknown",
            providerId: "missing-auth",
            family: "auth",
          }),
        ],
      },
    });
    expect(JSON.stringify(error)).not.toContain("super-secret-token");
  });

  it("fails closed through Provider Host diagnostics when a selected provider has the wrong family", () => {
    const bundle = fakeProviderBundle(fakeRecords());
    const error = captureThrown(() =>
      createApp({
        ...fakeProviderOptions(bundle),
        appDeploymentConfig: { ...bundle.appDeploymentConfig, auth: "fake-launcher" },
      }),
    );

    expect(error).toMatchObject({
      code: "state.conflict",
      detail: {
        diagnostics: [
          expect.objectContaining({
            code: "provider.family_mismatch",
            providerId: "fake-launcher",
            family: "auth",
            detail: expect.objectContaining({
              actualFamily: "launcher",
              expectedFamily: "auth",
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(error)).not.toContain("super-secret-token");
  });

  it("creates runtime ports, provider config, services, and assets through the same generic boot path", async () => {
    const records = fakeRecords();
    const bundle = fakeProviderBundle(records);
    const stack = createProvisioningBridge({
      ...fakeProviderOptions(bundle),
      dependencyBindings: referenceWpmDependencyBindings(),
      launcherMode: "headless",
      workspaceRoot: "/tmp/fake-gla-workspace",
      handoff: {
        host: "127.0.0.1",
        port: 0,
        publicBaseUrl: "http://127.0.0.1:3000",
        expectedOrigin: "http://127.0.0.1:3000",
        completion: {
          pollMs: 7,
          readUrl: async () => "/done",
        },
      },
    });
    try {
      expect(stack.providerGraphDoctor).toMatchObject({
        status: "PASS",
        profileId: "resolved-runtime-selection",
        selectedProviders: expect.objectContaining({
          Launcher: "fake-launcher",
          HumanEntrypoint: "fake-entrypoint",
          AgentConnector: "fake-connector",
        }),
        providers: expect.arrayContaining([
          expect.objectContaining({
            providerId: "fake-entrypoint",
            selected: true,
            diagnostics: expect.arrayContaining([
              expect.objectContaining({ code: "provider.available" }),
            ]),
          }),
        ]),
      });
      expect(stack.bridge.catalogList().map((entity) => entity.name)).toContain("fake-entrypoint");
      expect(stack.bridge.skillShow("use-fake-entrypoint")).toMatchObject({
        id: "use-fake-entrypoint",
        for: "fake-entrypoint",
      });
      const created = await stack.bridge.sessionCreate({
        proposal: {
          intent: "exercise fake provider set",
          template: "browser-handoff",
          recipient: "tg:user:123",
        },
      });
      expect(created).toMatchObject({
        decision: "accept",
        state: "active",
      });
      const detector = stack.detector;
      expect(detector).toBeDefined();
      if (detector === undefined) {
        throw new Error("expected detector to be wired");
      }
      for await (const _signal of detector.watch("runtime:fake" as RuntimeHandle, {})) {
        // The fake detector does not emit; iterating is enough to force lazy Provider Host creation.
      }
      await expect(
        stack.bridge.sessionCreate({
          proposal: {
            intent: "exercise fake provider set",
            template: "browser-handoff",
            recipient: "tg:user:123",
          },
          dryRun: true,
        }),
      ).resolves.toMatchObject({
        decision: "accept",
        dry_run: true,
      });
      expect(stack.authModule).toBe("@fake/auth");
      expect(stack.entrypoint).toBeDefined();
      await expect(stack.connector.attach("runtime:fake" as RuntimeHandle)).resolves.toMatchObject({
        type: "fake",
        provider: "fake-connector",
        resourceId: "fake-agent-resource",
      });
      expect(records.configs.auth).toMatchObject({
        rpID: "localhost",
        expectedOrigin: ["http://127.0.0.1:3000"],
      });
      expect(records.configs.launcher).toMatchObject({ mode: "headless" });
      expect(records.configs.workspace).toMatchObject({ root: "/tmp/fake-gla-workspace" });
      await expect.poll(() => records.configs.detector).toMatchObject({ pollMs: 7 });
      expect(records.serviceBindings.detectorReadUrl).toBe(true);
      expect(records.serviceBindings.channelIdentity).toBe(true);
      expect(records.assetProviderIds).toEqual(["fake-entrypoint"]);
    } finally {
      await stack.close();
    }
  });
});
