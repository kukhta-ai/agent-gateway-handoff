import type { IndexedDependencyBinding, ProviderManifest } from "@gla/catalog";
import type { ConfigSchema, LauncherPort, RuntimeHandle } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  type GlaProviderModule,
  InMemoryProviderStateRoot,
  ProviderHost,
  type ProviderHostDiagnostic,
  type ProviderStateRoot,
} from "../../src/index.js";

const fakeLauncher: LauncherPort = {
  tier: "none",
  mountCapability: { file: false, directory: false, modes: [] },
  async spawn(): Promise<RuntimeHandle> {
    return "runtime:fake" as RuntimeHandle;
  },
  async health(): Promise<"up"> {
    return "up";
  },
  async stop(): Promise<void> {},
};

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

function manifest(overrides: Partial<ProviderManifest["spec"]> = {}): ProviderManifest {
  return {
    apiVersion: "gla.dev/v1",
    kind: "Launcher",
    metadata: { name: "fake-launcher", version: "0.1.0" },
    spec: {
      family: "launcher",
      capability: { summary: "fake launcher" },
      config_schema: objectSchema({ mode: { type: "string", enum: ["safe"] } }, ["mode"]),
      probe: "fake-launcher",
      skills: [{ id: "use-fake-launcher", for: "fake-launcher", body: "Use fake launcher." }],
      relations: { compatibleWith: { connectors: ["fake-connector"] } },
      ...overrides,
    },
  };
}

function module(overrides: Partial<ProviderManifest["spec"]> = {}): GlaProviderModule {
  return {
    moduleId: "@gla/fake-launcher-provider",
    manifest: manifest(overrides),
    register(ctx) {
      ctx.registerLauncher("fake-launcher", {
        create(createCtx) {
          createCtx.state.kv<{ seen: boolean }>("runtime").set("created", { seen: true });
          return fakeLauncher;
        },
      });
      ctx.registerProbe("fake-launcher", () => "available");
      ctx.registerStateSchema("fake-launcher", {
        slots: { runtime: { summary: "fake runtime state" } },
      });
    },
  };
}

describe("ProviderHost", () => {
  it("registers a trusted provider module with manifest, factory, probe, skills, relations, and state schema", async () => {
    const stateRoot = new InMemoryProviderStateRoot();
    const host = new ProviderHost({ stateRoot }).registerModule(module());

    expect(host.providerIds("launcher")).toEqual(["fake-launcher"]);
    expect(host.providerManifest("fake-launcher")).toMatchObject({
      metadata: { name: "fake-launcher" },
      spec: {
        family: "launcher",
        probe: "fake-launcher",
        skills: [{ id: "use-fake-launcher" }],
        relations: { compatibleWith: { connectors: ["fake-connector"] } },
      },
    });
    expect(host.providerStateSchema("fake-launcher")).toEqual({
      schemaVersion: 1,
      sensitivity: "sensitive",
      migration: "fail-closed",
      slots: { runtime: { summary: "fake runtime state", sensitivity: "sensitive" } },
    });
    expect(host.providerDescriptor("fake-launcher")).toMatchObject({
      providerId: "fake-launcher",
      moduleId: "@gla/fake-launcher-provider",
      manifest: { metadata: { name: "fake-launcher" } },
      stateSchema: {
        schemaVersion: 1,
        sensitivity: "sensitive",
        migration: "fail-closed",
        slots: { runtime: { summary: "fake runtime state", sensitivity: "sensitive" } },
      },
    });
    expect(host.providerDescriptors().map((descriptor) => descriptor.moduleId)).toEqual([
      "@gla/fake-launcher-provider",
    ]);

    const created = await host.createProvider("launcher", "fake-launcher", {
      config: { mode: "safe" },
    });
    expect(created).toBe(fakeLauncher);
    expect(
      stateRoot.namespace("fake-launcher").kv<{ seen: boolean }>("runtime").get("created"),
    ).toEqual({
      seen: true,
    });
    expect(stateRoot.namespace("fake-launcher")).toMatchObject({
      providerId: "fake-launcher",
      schemaVersion: 1,
      sensitivity: "sensitive",
      migration: "fail-closed",
      diagnostics: [
        expect.objectContaining({
          code: "provider.state_namespace",
          providerId: "fake-launcher",
          detail: expect.objectContaining({
            schemaVersion: 1,
            slots: ["runtime"],
          }),
        }),
      ],
    });
  });

  it("rejects duplicate provider ids with a stable redacted diagnostic", () => {
    const host = new ProviderHost().registerModule(module());

    expect(() => host.registerModule(module())).toThrow(/already registered/);
    expect(host.diagnostics()).toContainEqual(
      expect.objectContaining({
        code: "provider.duplicate",
        providerId: "fake-launcher",
      }),
    );
  });

  it("rejects unknown provider ids with a stable diagnostic", async () => {
    const host = new ProviderHost();

    await expect(host.createProvider("launcher", "missing-provider")).rejects.toMatchObject({
      code: "catalog.unknown",
      detail: {
        diagnostics: [
          expect.objectContaining({
            code: "provider.unknown",
            providerId: "missing-provider",
          }),
        ],
      },
    });
  });

  it("fails closed when a registered provider is requested through the wrong family", async () => {
    const host = new ProviderHost().registerModule(module());

    await expect(
      host.createProvider("connector", "fake-launcher", {
        config: { mode: "safe" },
      }),
    ).rejects.toMatchObject({
      code: "state.conflict",
      detail: {
        diagnostics: [
          expect.objectContaining({
            code: "provider.family_mismatch",
            providerId: "fake-launcher",
            family: "connector",
          }),
        ],
      },
    });
  });

  it("does not expose partial runtime registry entries after failed registration", () => {
    const badModule: GlaProviderModule = {
      manifest: manifest(),
      register(ctx) {
        ctx.registerLauncher("fake-launcher", { create: () => fakeLauncher });
        ctx.registerStateSchema("fake-launcher", { slots: { first: {} } });
        ctx.registerStateSchema("fake-launcher", { slots: { duplicate: {} } });
      },
    };
    const host = new ProviderHost();

    expect(() => host.registerModule(badModule)).toThrow(/state schema is already registered/);
    expect(host.providerIds("launcher")).toEqual([]);
    expect(host.providerManifest("fake-launcher")).toBeUndefined();
    expect(host.providerStateSchema("fake-launcher")).toBeUndefined();
  });

  it("fails closed when a provider declares an unknown state schema version", () => {
    const unsupportedState: GlaProviderModule = {
      manifest: manifest(),
      register(ctx) {
        ctx.registerLauncher("fake-launcher", { create: () => fakeLauncher });
        ctx.registerProbe("fake-launcher", () => "available");
        ctx.registerStateSchema("fake-launcher", {
          schemaVersion: 99,
          sensitivity: "sensitive",
          migration: "fail-closed",
          slots: { runtime: { summary: "future state" } },
        });
      },
    };

    expect(() => new ProviderHost().registerModule(unsupportedState)).toThrow(
      /unsupported state schema version/,
    );
  });

  it("fails closed with redacted diagnostics when provider-owned state namespace is unavailable", async () => {
    const stateRoot: ProviderStateRoot = {
      namespace() {
        throw new Error("state backend leaked super-secret-token");
      },
    };
    const host = new ProviderHost({ stateRoot }).registerModule(module());

    await expect(
      host.createProvider("launcher", "fake-launcher", {
        config: { mode: "safe" },
      }),
    ).rejects.toMatchObject({
      code: "dependency.unavailable",
      detail: {
        diagnostics: [
          expect.objectContaining({
            code: "provider.state_unavailable",
            providerId: "fake-launcher",
            family: "launcher",
            detail: { errorName: "Error" },
          }),
        ],
      },
    });
    expect(JSON.stringify(host.diagnostics())).not.toContain("super-secret-token");
  });

  it("rejects invalid provider config before creating a runtime port", async () => {
    const host = new ProviderHost().registerModule(module());

    await expect(
      host.createProvider("launcher", "fake-launcher", {
        config: { mode: "unsafe", token: "super-secret-token" },
      }),
    ).rejects.toMatchObject({
      code: "policy.denied",
      detail: {
        diagnostics: [
          expect.objectContaining({
            code: "provider.config_invalid",
            detail: expect.objectContaining({
              defects: expect.arrayContaining([
                expect.objectContaining({ field: "mode" }),
                expect.objectContaining({ field: "token" }),
              ]),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(host.diagnostics())).not.toContain("super-secret-token");
  });

  it("uses factory_config_schema for runtime creation while preserving agent-facing config_schema metadata", async () => {
    const host = new ProviderHost().registerModule(
      module({
        config_schema: objectSchema({ complete_on: { type: "string", pattern: "^/" } }, [
          "complete_on",
        ]),
        factory_config_schema: objectSchema({ mode: { type: "string", enum: ["safe"] } }, ["mode"]),
      }),
    );

    expect(host.providerManifest("fake-launcher")?.spec.config_schema).toEqual(
      objectSchema({ complete_on: { type: "string", pattern: "^/" } }, ["complete_on"]),
    );
    await expect(
      host.createProvider("launcher", "fake-launcher", {
        config: { mode: "safe" },
      }),
    ).resolves.toBe(fakeLauncher);
    await expect(
      host.createProvider("launcher", "fake-launcher", {
        config: { complete_on: "/dashboard" },
      }),
    ).rejects.toMatchObject({
      code: "policy.denied",
      detail: {
        diagnostics: [
          expect.objectContaining({
            code: "provider.config_invalid",
          }),
        ],
      },
    });
  });

  it("fails closed when host-touching dependency evidence is missing", async () => {
    const host = new ProviderHost().registerModule(
      module({
        requires: [{ dependency: "browser-runtime", hostTouching: true }],
      }),
    );

    await expect(
      host.createProvider("launcher", "fake-launcher", {
        config: { mode: "safe" },
      }),
    ).rejects.toMatchObject({
      code: "dependency.unavailable",
      detail: {
        diagnostics: [
          expect.objectContaining({
            code: "provider.dependency_unavailable",
          }),
        ],
      },
    });
  });

  it("fails closed when a registered provider probe reports unavailable", async () => {
    const unavailable: GlaProviderModule = {
      manifest: manifest(),
      register(ctx) {
        ctx.registerLauncher("fake-launcher", { create: () => fakeLauncher });
        ctx.registerProbe("fake-launcher", () => "unavailable");
      },
    };
    const host = new ProviderHost().registerModule(unavailable);

    await expect(
      host.createProvider("launcher", "fake-launcher", {
        config: { mode: "safe" },
      }),
    ).rejects.toMatchObject({
      code: "dependency.unavailable",
      detail: {
        diagnostics: [
          expect.objectContaining({
            code: "provider.probe_failed",
          }),
        ],
      },
    });
  });

  it("projects registered synchronous probes with indexed dependency evidence", () => {
    const dependency: IndexedDependencyBinding = {
      dependency: "browser-runtime",
      hostTouching: true,
      status: "bound",
      missingEvidence: [],
      diagnostics: { install: "available", runtime: "available" },
    };
    const dependencyAware: GlaProviderModule = {
      manifest: manifest({
        requires: [{ dependency: "browser-runtime", hostTouching: true }],
      }),
      register(ctx) {
        ctx.registerLauncher("fake-launcher", { create: () => fakeLauncher });
        ctx.registerProbe("fake-launcher", ({ dependencies }) =>
          dependencies.bindingFor("browser-runtime")?.status === "bound"
            ? "available"
            : "unavailable",
        );
      },
    };
    const host = new ProviderHost().registerModule(dependencyAware);

    expect(host.providerProbeRegistry()["fake-launcher"]?.()).toBe("unavailable");
    expect(host.providerProbeRegistry({ "fake-launcher": [dependency] })["fake-launcher"]?.()).toBe(
      "available",
    );
  });

  it("redacts provider-emitted diagnostics before forwarding to caller-supplied sinks", async () => {
    const emitted: ProviderHostDiagnostic[] = [];
    const host = new ProviderHost().registerModule({
      manifest: manifest(),
      register(ctx) {
        ctx.registerLauncher("fake-launcher", { create: () => fakeLauncher });
        ctx.registerProbe("fake-launcher", ({ diagnostics }) => {
          diagnostics.emit({
            code: "provider.probe_failed",
            providerId: "fake-launcher",
            message: "probe emitted provider-owned secret context",
            detail: { clientSecret: "provider-secret-canary" },
          });
          return "available";
        });
      },
    });

    await host.createProvider("launcher", "fake-launcher", {
      config: { mode: "safe" },
      diagnostics: { emit: (diagnostic) => emitted.push(diagnostic) },
    });

    expect(JSON.stringify(emitted)).not.toContain("provider-secret-canary");
    expect(emitted).toContainEqual(
      expect.objectContaining({
        code: "provider.probe_failed",
        detail: { clientSecret: "<redacted>" },
      }),
    );
  });

  it("rejects unsupported runtime families during registration", () => {
    const unsupported: GlaProviderModule = {
      manifest: {
        ...manifest(),
        spec: { ...manifest().spec, family: "template" },
      },
      register(ctx) {
        ctx.registerLauncher("fake-launcher", { create: () => fakeLauncher });
      },
    };

    expect(() => new ProviderHost().registerModule(unsupported)).toThrow(
      /unsupported runtime family/,
    );
  });
});
