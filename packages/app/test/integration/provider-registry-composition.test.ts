import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProviderRegistry } from "@gla/provider-host";
import {
  AUTH_WEBAUTHN_PROVIDER_ID,
  REFERENCE_PROFILE_SCENARIO_01_ID,
  referenceProviderModules,
  referenceProviderRuntimeProfile,
} from "@gla/provider-set-reference";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/composition.js";

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
  it("boots app wiring and exposes provider inventory through ProviderRegistry without AppProviderSet discovery", () => {
    const providerRegistry = ProviderRegistry.fromProviderModules(referenceProviderModules);
    const providerProfile = referenceProviderRuntimeProfile(REFERENCE_PROFILE_SCENARIO_01_ID);

    const app = createApp({ providerRegistry, providerProfile });
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
    const providerProfile = referenceProviderRuntimeProfile(REFERENCE_PROFILE_SCENARIO_01_ID);

    expect(providerRegistry.isSealed()).toBe(false);
    createApp({ providerRegistry, providerProfile });

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

  it("keeps legacy provider-set module reads isolated to the registry compatibility boundary", () => {
    const srcRoot = fileURLToPath(new URL("../../src", import.meta.url));
    const moduleReadLines = sourceFiles(srcRoot).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.includes("providerSet.modules"))
        .map((line) => `${basename(path)}:${line.trim()}`),
    );

    expect(moduleReadLines).toEqual([
      "composition.ts:return ProviderRegistry.fromProviderModules(opts.providerSet.modules);",
    ]);
  });
});
