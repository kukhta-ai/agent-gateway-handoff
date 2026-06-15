import {
  type ProviderFamily,
  type ProviderManifest,
  type ProviderProfileManifest,
  referenceWpmDependencyBindings,
} from "@gla/catalog";
import {
  type AgentConnector,
  type AgentConnectorPort,
  type AuthProviderPort,
  type ChannelPort,
  type CompletionDetectorPort,
  type ConfigSchema,
  type HumanEntrypointBinding,
  type HumanEntrypointPort,
  KERNEL_MODULE,
  type LauncherPort,
  type MountSpec,
  type OpaqueToken,
  type PartRef,
  type RawCompletionSignal,
  type RecipientRef,
  type ResolvedAssemblySpec,
  type RuntimeHandle,
  type WorkspaceHandle,
  type WorkspacePort,
  encodeRuntimeHandle,
} from "@gla/kernel";
import { POLICY_CEDAR_MODULE } from "@gla/policy-cedar";
import type { GlaProviderModule, ProviderRegistrationContext } from "@gla/provider-host";
import { describe, expect, it } from "vitest";
import {
  type AppProviderSet,
  createApp,
  createBridge,
  createProvisioningBridge,
} from "../../src/composition.js";

interface FakeRecords {
  configs: Record<string, Record<string, unknown>>;
  serviceBindings: Record<string, boolean>;
  assetProviderIds: string[];
  delivered: Array<{ recipient: RecipientRef; link: string }>;
}

function fakeRecords(): FakeRecords {
  return {
    configs: {},
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
  readonly contract: ConfigSchema = {};

  async *watch(
    _h: RuntimeHandle,
    _params: Record<string, unknown>,
  ): AsyncIterable<RawCompletionSignal> {}
}

function fakeProviderSet(records: FakeRecords): AppProviderSet {
  const modules: GlaProviderModule[] = [
    moduleFor(
      providerManifest({
        id: "fake-auth",
        kind: "AuthProvider",
        family: "auth",
        summary: "fake auth",
        configSchema: {
          rpID: { type: "string", required: true, min: 1 },
          rpName: { type: "string", required: false, min: 1 },
          expectedOrigin: { type: "list", required: true, min: 1, items: { type: "string" } },
        },
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
        configSchema: {
          mode: { type: "enum", enum: ["auto", "headless"], required: false, default: "headless" },
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
        configSchema: { root: { type: "string", required: false, min: 1 } },
      }),
      "@fake/workspace",
      (ctx) =>
        ctx.registerWorkspace("fake-workspace", {
          create(createCtx) {
            records.configs.workspace = createCtx.config;
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
        configSchema: {
          clientTheme: {
            type: "enum",
            required: false,
            enum: ["light", "dark"],
            default: "light",
          },
        },
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
        factoryConfigSchema: { pollMs: { type: "number", required: true, min: 1 } },
        capability: { completion: { statuses: { fake: { status: "done" } } } },
      }),
      "@fake/detector",
      (ctx) =>
        ctx.registerCompletionDetector("fake-detector", {
          create(createCtx) {
            records.configs.detector = createCtx.config;
            records.serviceBindings.detectorReadUrl =
              createCtx.services.get<() => Promise<string | undefined>>("fake.detector.readUrl") !==
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
  ];
  return {
    moduleId: "@fake/provider-set",
    modules,
    profile: {
      auth: "fake-auth",
      launcher: "fake-launcher",
      connector: "fake-connector",
      workspace: "fake-workspace",
      entrypoint: "fake-entrypoint",
      detector: "fake-detector",
      channel: "fake-channel",
    },
    defaultConfig({ family, providerId, legacy }) {
      if (family === "auth" && providerId === "fake-auth") {
        return legacy;
      }
      if (family === "launcher" && providerId === "fake-launcher") {
        return legacy;
      }
      if (family === "workspace" && providerId === "fake-workspace") {
        return legacy;
      }
      if (family === "detector" && providerId === "fake-detector") {
        return legacy;
      }
      return undefined;
    },
    defaultServices({ family, providerId, legacy }) {
      if (
        family === "detector" &&
        providerId === "fake-detector" &&
        typeof legacy.readUrl === "function"
      ) {
        return { "fake.detector.readUrl": legacy.readUrl };
      }
      return undefined;
    },
    entrypointClientAssets(_host, providerIds) {
      records.assetProviderIds = [...providerIds];
      return [
        {
          providerId: "fake-entrypoint",
          ref: "fake-entrypoint.fake-client",
          root: process.cwd(),
          readOnly: true,
        },
      ];
    },
    templateProbes: { "browser-handoff": () => "available" },
  };
}

function fakeProviderProfile(id: string): ProviderProfileManifest {
  return {
    apiVersion: "gla.dev/v1",
    kind: "ProviderProfile",
    metadata: { name: id, version: "0.1.0" },
    spec: {
      lifecycle: { owner: "operator", apply: "boot", hotReload: false },
      select: {
        AuthProvider: "fake-auth",
        Launcher: "fake-launcher",
        Workspace: "fake-workspace",
        HumanEntrypoint: "fake-entrypoint",
        AgentConnector: "fake-connector",
        CompletionDetector: "fake-detector",
        ChannelAdapter: "fake-channel",
      },
    },
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

describe("provider-set agnostic app composition", () => {
  it("projects wiring and catalog read models from Provider Host metadata for a non-reference provider set", () => {
    const records = fakeRecords();
    const providerSet = fakeProviderSet(records);

    expect(createApp({ providerSet }).wiring).toEqual({
      kernel: KERNEL_MODULE,
      policy: POLICY_CEDAR_MODULE,
      auth: "@fake/auth",
      launcher: "@fake/launcher",
      connector: "@fake/connector",
      workspace: "@fake/workspace",
      detector: "@fake/detector",
      channel: "@fake/channel",
    });

    const bridge = createBridge({ providerSet });
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

  it("does not treat public-edge WPM evidence as reachable without a template probe", () => {
    const { templateProbes: _templateProbes, ...providerSet } = fakeProviderSet(fakeRecords());

    const bridge = createBridge({
      providerSet,
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

  it("fails closed through Provider Host diagnostics when a selected provider is unknown", () => {
    const providerSet = fakeProviderSet(fakeRecords());
    const error = captureThrown(() =>
      createApp({
        providerSet,
        providerProfile: { auth: "missing-auth" },
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
    const providerSet = fakeProviderSet(fakeRecords());
    const error = captureThrown(() =>
      createApp({
        providerSet,
        providerProfile: { auth: "fake-launcher" },
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

  it("creates runtime ports, provider defaults, services, and assets through the same generic boot path", async () => {
    const records = fakeRecords();
    const providerSet: AppProviderSet = {
      ...fakeProviderSet(records),
      profiles: [fakeProviderProfile("fake-scenario")],
      selectedProfileId: "fake-scenario",
    };
    const stack = createProvisioningBridge({
      providerSet,
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
        profileId: "fake-scenario",
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
      expect(stack.detector).toBeDefined();
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
      expect(records.configs.detector).toMatchObject({ pollMs: 7 });
      expect(records.serviceBindings.detectorReadUrl).toBe(true);
      expect(records.serviceBindings.channelIdentity).toBe(true);
      expect(records.assetProviderIds).toEqual(["fake-entrypoint"]);
    } finally {
      await stack.close();
    }
  });
});
