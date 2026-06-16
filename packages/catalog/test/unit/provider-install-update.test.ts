import { EMPTY_CONFIG_SCHEMA } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  CHANNEL_CLI_MANIFEST,
  type DependencyRequirement,
  PROVIDER_MANIFESTS,
  type ProviderFamily,
  type ProviderInstallInventoryInput,
  type ProviderInstallPackageInput,
  type ProviderManifest,
  applyProviderInstallUpdate,
  createTemplatePackageSkeleton,
  doctorProviderInstallInventory,
  planProviderInstallUpdate,
  referenceWpmDependencyBindings,
} from "../../src/index.js";

function provider(
  id: string,
  family: Exclude<ProviderFamily, "template">,
  kind: string,
  requires: readonly DependencyRequirement[] = [],
): ProviderManifest {
  return {
    apiVersion: "gla.dev/v1",
    kind,
    metadata: { name: id, version: "0.1.0" },
    spec: {
      family,
      capability: { summary: `${id} provider` },
      config_schema: structuredClone(EMPTY_CONFIG_SCHEMA),
      ...(requires.length > 0 ? { requires: [...requires] } : {}),
      probe: id,
      skills: [{ id: `use-${id}`, for: id, body: `# ${id}` }],
    },
  };
}

const AUTH_WEBAUTHN = provider("auth-webauthn", "auth", "AuthProvider");
const SECRET_STORE = provider("secret-store-reference", "secret-store", "SecretStore");

const REQUIRED_PARTS = {
  launcher: "launcher-process",
  entrypoint: "entrypoint-novnc",
  connector: "connector-cdp",
  workspace: "workspace-profile",
  detector: "url-watcher",
};

const OPEN_PARTS = ["entrypoint", "connector", "workspace", "detector"];

function trustedProviderPackage(
  manifest: ProviderManifest,
  opts: { signed?: boolean; verified?: boolean } = {},
): ProviderInstallPackageInput {
  return {
    kind: "provider",
    signed: opts.signed ?? true,
    verified: opts.verified ?? true,
    content: {
      manifest,
      module: {
        providerId: manifest.metadata.name,
        family: manifest.spec.family,
        registersFactory: true,
        registersProbe: true,
      },
      docs: [`adapters/${manifest.metadata.name}/README.md`],
      contractTests: [
        `adapters/${manifest.metadata.name}/test/contract/${manifest.metadata.name}.test.ts`,
      ],
    },
  };
}

function trustedTemplatePackage(opts: { compatible?: boolean } = {}): ProviderInstallPackageInput {
  const compatible = opts.compatible ?? true;
  return {
    kind: "template-package",
    signed: true,
    verified: true,
    content: createTemplatePackageSkeleton({
      packageId: compatible ? "browser-handoff-package" : "ambiguous-handoff-package",
      templateId: compatible ? "browser-handoff" : "ambiguous-handoff",
      requiredParts: REQUIRED_PARTS,
      openParts: OPEN_PARTS,
      compatibleProviders: compatible
        ? {
            entrypoint: ["entrypoint-novnc"],
            connector: ["connector-cdp"],
            workspace: ["workspace-profile"],
            detector: ["url-watcher"],
          }
        : {},
      providerDefaults: {
        "url-watcher": { complete_on: "/dashboard" },
      },
    }),
  };
}

function referenceInventory(
  overrides: Partial<ProviderInstallInventoryInput> = {},
): ProviderInstallInventoryInput {
  return {
    inventoryId: "reference-installed",
    profileId: "single-operator",
    packages: [
      ...Object.values(PROVIDER_MANIFESTS).map((manifest) => trustedProviderPackage(manifest)),
      trustedProviderPackage(CHANNEL_CLI_MANIFEST),
      trustedProviderPackage(AUTH_WEBAUTHN),
      trustedProviderPackage(SECRET_STORE),
      trustedTemplatePackage(),
    ],
    appDeployment: {
      AuthProvider: "auth-webauthn",
      ChannelAdapter: "channel-cli",
      SecretStore: "secret-store-reference",
    },
    capsuleDefaults: {
      Launcher: "launcher-process",
      HumanEntrypoint: "entrypoint-novnc",
      AgentConnector: "connector-cdp",
      Workspace: "workspace-profile",
      CompletionDetector: "url-watcher",
    },
    dependencyBindings: referenceWpmDependencyBindings(),
    ...overrides,
  };
}

describe("provider install/update planning", () => {
  it("previews registry, deployment, capsule, compatibility, and evidence changes before activation", () => {
    const plan = planProviderInstallUpdate({
      active: { inventoryId: "empty-active", profileId: "empty" },
      candidate: referenceInventory(),
    });

    expect(plan.ok).toBe(true);
    expect(plan.status).toBe("ready-to-apply");
    expect(plan.changes.registryEntries.added).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "auth-webauthn", family: "auth", layer: "registry" }),
        expect.objectContaining({ id: "browser-handoff-package", layer: "template-package" }),
      ]),
    );
    expect(plan.changes.deploymentDefaults).toMatchObject({
      AuthProvider: { to: "auth-webauthn" },
      ChannelAdapter: { to: "channel-cli" },
      SecretStore: { to: "secret-store-reference" },
    });
    expect(plan.changes.capsuleDefaults).toMatchObject({
      Launcher: { to: "launcher-process" },
      HumanEntrypoint: { to: "entrypoint-novnc" },
    });
    expect(plan.changes.capsuleTemplateDefaults).toHaveProperty("template.browser-handoff");
    expect(plan.changes.compatibilityRelations.added).toEqual([
      expect.objectContaining({
        templateId: "browser-handoff",
        requiredParts: OPEN_PARTS,
      }),
    ]);
    expect(plan.candidate.evidenceRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerId: "launcher-process",
          dependency: "browser-runtime",
          status: "bound",
        }),
        expect.objectContaining({
          ownerId: "entrypoint-novnc",
          dependency: "human-view",
          status: "bound",
        }),
      ]),
    );
    expect(plan.doctor).toMatchObject({
      status: "PASS",
      selectedProviders: {
        AuthProvider: "auth-webauthn",
        Launcher: "launcher-process",
        HumanEntrypoint: "entrypoint-novnc",
      },
    });
    expect(plan.activation).toMatchObject({
      mutatesDeploymentState: false,
      rejectedAttemptsLeaveActiveUnchanged: true,
      nextUx: "runtime-consumption",
    });
  });

  it("rejects duplicate, unsigned, unverifiable, incompatible, and evidence-missing packages without activating", () => {
    const active = referenceInventory({ inventoryId: "current-active", profileId: "current" });
    const authWithMissingEvidence = trustedProviderPackage(
      provider("auth-external", "auth", "AuthProvider", [
        { dependency: "external-idp", hostTouching: true },
      ]),
      { signed: false, verified: false },
    );
    const candidate = referenceInventory({
      inventoryId: "bad-candidate",
      profileId: "bad-candidate",
      packages: [
        ...Object.values(PROVIDER_MANIFESTS).map((manifest) => trustedProviderPackage(manifest)),
        trustedProviderPackage(CHANNEL_CLI_MANIFEST),
        trustedProviderPackage(SECRET_STORE),
        authWithMissingEvidence,
        authWithMissingEvidence,
        trustedTemplatePackage({ compatible: false }),
      ],
      appDeployment: {
        AuthProvider: "auth-external",
        ChannelAdapter: "channel-cli",
        SecretStore: "secret-store-reference",
      },
    });

    const result = applyProviderInstallUpdate({ active, candidate });
    const codes = result.plan.diagnostics.map((diagnostic) =>
      typeof diagnostic === "object" && diagnostic !== null && "code" in diagnostic
        ? diagnostic.code
        : undefined,
    );
    const diagnostic = (code: string, extra: Record<string, unknown> = {}) =>
      result.plan.diagnostics.find(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          "code" in entry &&
          entry.code === code &&
          Object.entries(extra).every(
            ([key, value]) => (entry as Record<string, unknown>)[key] === value,
          ),
      );

    expect(result.ok).toBe(false);
    expect(result.activated).toBe(false);
    expect(result.activeSummary).toMatchObject({
      inventoryId: "current-active",
      profileId: "current",
      deploymentDefaults: {
        AuthProvider: "auth-webauthn",
        ChannelAdapter: "channel-cli",
      },
      capsuleDefaults: {
        Launcher: "launcher-process",
      },
    });
    expect(codes).toEqual(
      expect.arrayContaining([
        "install.package_unsigned",
        "install.package_unverifiable",
        "provider_author.duplicate_provider_id",
        "graph.dependency_unavailable",
        "graph.compatibility_ambiguous",
      ]),
    );
    expect(diagnostic("provider_author.duplicate_provider_id")).toMatchObject({
      family: "auth",
      layer: "registry",
    });
    expect(
      diagnostic("graph.dependency_unavailable", { dependency: "external-idp" }),
    ).toMatchObject({
      family: "auth",
      layer: "registry",
    });
    expect(diagnostic("graph.compatibility_ambiguous", { family: "workspace" })).toMatchObject({
      family: "workspace",
      layer: "template-package",
    });
    expect(diagnostic("graph.compatibility_ambiguous", { family: "detector" })).toMatchObject({
      family: "detector",
      layer: "template-package",
    });
    expect(result.plan.doctor.status).toBe("FAIL");
    expect(
      result.plan.diagnostics.find(
        (diagnostic) =>
          typeof diagnostic === "object" &&
          diagnostic !== null &&
          "providerId" in diagnostic &&
          diagnostic.providerId === "auth-external",
      ),
    ).toMatchObject({
      family: "auth",
    });
  });

  it("reports provider graph doctor inventory and unresolved graph problems", () => {
    const badInventory = referenceInventory({
      packages: [
        ...Object.values(PROVIDER_MANIFESTS).map((manifest) => trustedProviderPackage(manifest)),
        trustedProviderPackage(CHANNEL_CLI_MANIFEST),
        trustedProviderPackage(SECRET_STORE),
        trustedProviderPackage(
          provider("auth-external", "auth", "AuthProvider", [
            { dependency: "external-idp", hostTouching: true },
          ]),
        ),
        trustedTemplatePackage({ compatible: false }),
      ],
      appDeployment: {
        AuthProvider: "auth-external",
        ChannelAdapter: "channel-cli",
        SecretStore: "secret-store-reference",
      },
    });

    const report = doctorProviderInstallInventory(badInventory);

    expect(report.inventory.deploymentDefaults).toMatchObject({ AuthProvider: "auth-external" });
    expect(report.inventory.capsuleDefaults).toMatchObject({ Launcher: "launcher-process" });
    expect(report.inventory.evidenceRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerId: "auth-external",
          dependency: "external-idp",
          status: "missing",
        }),
      ]),
    );
    expect(report.doctor.status).toBe("FAIL");
    expect(report.doctor.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "auth-external",
          selected: true,
          available: false,
        }),
      ]),
    );
  });
});
