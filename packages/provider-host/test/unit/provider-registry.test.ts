import type { ProviderManifest, TemplateManifest } from "@gla/catalog";
import type { LauncherPort, RuntimeHandle } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  type GlaProviderModule,
  ProviderRegistry,
  type ProviderRegistryPackageEvidence,
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

function manifest(
  args: {
    name?: string;
    version?: string;
    relations?: ProviderManifest["spec"]["relations"];
  } = {},
): ProviderManifest {
  return {
    apiVersion: "gla.dev/v1",
    kind: "Launcher",
    metadata: { name: args.name ?? "fake-launcher", version: args.version ?? "0.1.0" },
    spec: {
      family: "launcher",
      capability: { summary: "fake launcher" },
      probe: args.name ?? "fake-launcher",
      ...(args.relations !== undefined ? { relations: args.relations } : {}),
    },
  };
}

function providerModule(
  args: {
    name?: string;
    version?: string;
    moduleId?: string;
    relations?: ProviderManifest["spec"]["relations"];
    asyncFactory?: boolean;
  } = {},
): GlaProviderModule {
  const providerManifest = manifest(args);
  return {
    moduleId: args.moduleId ?? `@gla/${providerManifest.metadata.name}`,
    manifest: providerManifest,
    register(ctx) {
      ctx.registerLauncher(providerManifest.metadata.name, {
        create: args.asyncFactory === true ? async () => fakeLauncher : () => fakeLauncher,
      });
      ctx.registerProbe(providerManifest.metadata.name, () => "available");
    },
  };
}

function template(name = "browser-handoff", version = "0.1.0"): TemplateManifest {
  return {
    apiVersion: "gla.dev/v1",
    kind: "CapsuleTemplate",
    metadata: { name, version },
    spec: {
      family: "template",
      capability: { summary: "fake template" },
      requiredParts: { launcher: "fake-launcher" },
      openParts: ["launcher"],
      compatibleProviders: { launcher: ["fake-launcher"] },
    },
  };
}

const packageEvidence: ProviderRegistryPackageEvidence = {
  kind: "template-package",
  moduleId: "@gla/fake-template-package",
};

describe("ProviderRegistry", () => {
  it("enumerates registered manifests, versions, factory availability, probe metadata, and package evidence", () => {
    const registry = new ProviderRegistry().registerModule(providerModule()).seal();

    expect(registry.isSealed()).toBe(true);
    expect(registry.providerEntries()).toEqual([
      expect.objectContaining({
        providerId: "fake-launcher",
        family: "launcher",
        version: "0.1.0",
        factoryAvailable: true,
        manifest: expect.objectContaining({
          metadata: { name: "fake-launcher", version: "0.1.0" },
        }),
        probe: {
          name: "fake-launcher",
          registered: true,
          syncProjection: "unavailable-if-async",
        },
        packageEvidence: {
          kind: "provider-module",
          moduleId: "@gla/fake-launcher",
        },
      }),
    ]);
  });

  it("fails closed on duplicate provider ids and duplicate provider id/version pairs before registration mutates state", () => {
    const duplicatePair = new ProviderRegistry();

    expect(() =>
      duplicatePair.registerModules([
        providerModule({ moduleId: "@gla/first" }),
        providerModule({ moduleId: "@gla/second" }),
      ]),
    ).toThrow(/version "0.1.0" is already registered/);
    expect(duplicatePair.providerIds()).toEqual([]);
    expect(duplicatePair.diagnostics()).toContainEqual(
      expect.objectContaining({
        code: "provider.duplicate_id_version_pair",
        providerId: "fake-launcher",
        detail: expect.objectContaining({ duplicateKind: "provider-id-version" }),
      }),
    );

    const duplicateId = new ProviderRegistry();
    expect(() =>
      duplicateId.registerModules([
        providerModule({ moduleId: "@gla/first", version: "0.1.0" }),
        providerModule({ moduleId: "@gla/second", version: "0.2.0" }),
      ]),
    ).toThrow(/already registered with version "0.1.0"/);
    expect(duplicateId.providerIds()).toEqual([]);
    expect(duplicateId.diagnostics()).toContainEqual(
      expect.objectContaining({
        code: "provider.duplicate",
        providerId: "fake-launcher",
        detail: expect.objectContaining({ duplicateKind: "provider-id" }),
      }),
    );
  });

  it("fails closed on duplicate template ids before catalog or admission can consume them", () => {
    const registry = new ProviderRegistry();

    expect(() =>
      registry.registerTemplates(
        [template("browser-handoff"), template("browser-handoff")],
        packageEvidence,
      ),
    ).toThrow(/template "browser-handoff" version "0.1.0" is already registered/);
    expect(registry.templateEntries()).toEqual([]);
    expect(registry.diagnostics()).toContainEqual(
      expect.objectContaining({
        code: "provider.duplicate_template",
        providerId: "browser-handoff",
        family: "template",
      }),
    );
  });

  it("fails closed on unknown compatibility relation keys before catalog resolution", () => {
    const registry = new ProviderRegistry();

    expect(() =>
      registry.registerModule(
        providerModule({
          relations: { compatibleWith: { launcherrs: ["fake-other"] } },
        }),
      ),
    ).toThrow(/not a known compatibility relation/);
    expect(registry.providerIds()).toEqual([]);
    expect(registry.diagnostics()).toContainEqual(
      expect.objectContaining({
        code: "provider.compatibility_invalid",
        providerId: "fake-launcher",
        detail: expect.objectContaining({ relationKey: "launcherrs" }),
      }),
    );
  });

  it("rejects registration after the registry is sealed with a deterministic diagnostic", () => {
    const registry = new ProviderRegistry().seal();

    expect(() => registry.registerModule(providerModule())).toThrow(/registry is sealed/);
    expect(registry.diagnostics()).toContainEqual(
      expect.objectContaining({
        code: "provider.registry_sealed",
        detail: { subject: "provider module" },
      }),
    );
  });

  it("preserves async provider factories while sync call sites get async-unsupported diagnostics", async () => {
    const registry = new ProviderRegistry().registerModule(providerModule({ asyncFactory: true }));

    await expect(registry.createProvider("launcher", "fake-launcher")).resolves.toBe(fakeLauncher);
    expect(() => registry.createProviderSync("launcher", "fake-launcher")).toThrow(
      /factory is async but sync creation was requested/,
    );
    expect(registry.diagnostics()).toContainEqual(
      expect.objectContaining({
        code: "provider.async_unsupported",
        providerId: "fake-launcher",
        family: "launcher",
      }),
    );
  });
});
