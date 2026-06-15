import { describe, expect, it } from "vitest";
import {
  BROWSER_HANDOFF_TEMPLATE,
  CHANNEL_CLI_MANIFEST,
  CatalogService,
  PROVIDER_MANIFESTS,
  type ProviderFamily,
  type ProviderManifest,
  type ProviderProfileManifest,
  type TemplateManifest,
  type TemplatePackageManifest,
  providerGraphDoctorReport,
  referenceWpmDependencyBindings,
  resolveProviderGraphProjection,
  toAdmissionCatalog,
  toAdmissionCatalogFromProviderGraphProjection,
} from "../../src/index.js";

function provider(
  id: string,
  family: Exclude<ProviderFamily, "template">,
  kind: string,
  version = "0.1.0",
): ProviderManifest {
  return {
    apiVersion: "gla.dev/v1",
    kind,
    metadata: { name: id, version },
    spec: {
      family,
      capability: { summary: `${id} test provider` },
      config_schema: {},
      probe: id,
    },
  };
}

const AUTH_WEBAUTHN: ProviderManifest = {
  apiVersion: "gla.dev/v1",
  kind: "AuthProvider",
  metadata: { name: "auth-webauthn", version: "0.1.0" },
  spec: {
    family: "auth",
    capability: {
      summary: "WebAuthn auth provider",
      authAssurance: {
        supportedPolicies: ["phishing-resistant", "password-permitted"],
        maxLevel: "phishing-resistant",
        requiredEvidence: ["userVerified", "recipientBound", "replayResistant"],
        degradesTo: "none",
        diagnostics: ["missing-user-verification"],
      },
    },
    config_schema: {
      rpID: { type: "string", required: false, default: "localhost", min: 1 },
    },
    probe: "auth-webauthn",
  },
};

const SECRET_STORE = provider("secret-store-reference", "secret-store", "SecretStore");

const PROVIDERS: ProviderManifest[] = [
  ...Object.values(PROVIDER_MANIFESTS),
  CHANNEL_CLI_MANIFEST,
  AUTH_WEBAUTHN,
  SECRET_STORE,
];

const BASE_PROFILE: ProviderProfileManifest = {
  apiVersion: "gla.dev/v1",
  kind: "ProviderProfile",
  metadata: { name: "local-dev", version: "0.1.0" },
  spec: {
    select: {
      AuthProvider: "auth-webauthn",
      Launcher: "launcher-process",
      Workspace: "workspace-profile",
      HumanEntrypoint: "entrypoint-novnc",
      AgentConnector: "connector-cdp",
      CompletionDetector: "url-watcher",
      ChannelAdapter: "channel-cli",
      SecretStore: "secret-store-reference",
    },
    config: {
      "launcher-process": { startTimeoutMs: 1_000 },
      "auth-webauthn": { rpID: "base.example" },
    },
  },
};

function templatePackage(): TemplatePackageManifest {
  return {
    apiVersion: "gla.dev/v1",
    kind: "TemplatePackage",
    metadata: { name: "browser-handoff-package", version: "0.1.0" },
    spec: {
      templates: [structuredClone(BROWSER_HANDOFF_TEMPLATE)],
      schema: { recipient: { type: "string", required: true, min: 1 } },
      defaults: {
        "launcher-process": { startTimeoutMs: 2_500 },
      },
      compatibility: {
        requiredParts: ["launcher", "entrypoint", "connector", "workspace", "detector"],
      },
      docs: ["docs/04-capsule-assembly.md"],
      tests: ["packages/catalog/test/unit/provider-graph-projection.test.ts"],
    },
  };
}

function diagnosticCodes(result: ReturnType<typeof resolveProviderGraphProjection>): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("provider graph projection", () => {
  it("builds one deterministic projection from provider set, profile, overlays, templates, and WPM evidence", () => {
    const result = resolveProviderGraphProjection({
      providerSet: {
        id: "reference",
        providers: PROVIDERS,
        defaultConfig: {
          "launcher-process": { mode: "headless" },
          "auth-webauthn": { rpID: "provider-set.example" },
        },
      },
      baseProfile: BASE_PROFILE,
      overlays: [
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfileOverlay",
          metadata: { name: "operator-overlay" },
          spec: {
            extends: "local-dev",
            config: {
              "launcher-process": { startTimeoutMs: 2_000 },
              "auth-webauthn": { rpID: "operator.example" },
            },
          },
        },
      ],
      templatePackages: [templatePackage()],
      dependencyBindings: referenceWpmDependencyBindings(),
      runtimeAssemblyParams: {
        "launcher-process": { startTimeoutMs: 3_000 },
        "url-watcher": { complete_on: "/dashboard" },
      },
    });

    if (!result.ok) {
      throw new Error(`expected graph projection to pass: ${JSON.stringify(result.diagnostics)}`);
    }
    expect(result.ok).toBe(true);
    expect(result.projection.selectedProviders).toMatchObject({
      AuthProvider: "auth-webauthn",
      Launcher: "launcher-process",
      HumanEntrypoint: "entrypoint-novnc",
    });

    const launcher = result.projection.providers.find(
      (selected) => selected.providerId === "launcher-process",
    );
    expect(launcher?.available).toBe(true);
    expect(launcher?.config).toEqual({ mode: "headless", startTimeoutMs: 3_000 });
    expect(launcher?.configLayers.map((layer) => layer.source)).toEqual([
      "provider-schema-defaults",
      "provider-set-default-config",
      "base-profile-config",
      "overlay-config",
      "template-defaults",
      "runtime-assembly-params",
    ]);
    expect(launcher?.dependencies[0]?.dependency).toBe("browser-runtime");

    const auth = result.projection.providers.find(
      (selected) => selected.providerId === "auth-webauthn",
    );
    expect(auth?.config).toEqual({ rpID: "operator.example" });
    expect(auth?.authAssurance).toMatchObject({
      supportedPolicies: ["phishing-resistant", "password-permitted"],
      maxLevel: "phishing-resistant",
      requiredEvidence: ["userVerified", "recipientBound", "replayResistant"],
      degradesTo: "none",
    });
    expect(
      result.projection.providerFacts.find((provider) => provider.providerId === "auth-webauthn")
        ?.authAssurance,
    ).toMatchObject({
      supportedPolicies: ["phishing-resistant", "password-permitted"],
    });
    expect(result.projection.templates[0]).toMatchObject({
      templateId: "browser-handoff",
      available: true,
    });
  });

  it("rejects graph resolution defects with stable diagnostics", () => {
    const brokenTemplate = structuredClone(BROWSER_HANDOFF_TEMPLATE);
    brokenTemplate.spec.compatibleProviders = {
      entrypoint: ["missing-entrypoint"],
    };
    const ambiguousTemplate: TemplateManifest = {
      apiVersion: "gla.dev/v1",
      kind: "CapsuleTemplate",
      metadata: { name: "ambiguous-entrypoint-template", version: "0.1.0" },
      spec: {
        family: "template",
        capability: { summary: "ambiguous test template" },
        requiredParts: { entrypoint: "entrypoint-novnc" },
        openParts: ["entrypoint"],
        openParams: { recipient: { type: "string", required: true, min: 1 } },
        skills: [
          {
            id: "ambiguous-entrypoint-template",
            for: "ambiguous-entrypoint-template",
            body: "# test",
          },
        ],
      },
    };
    const duplicateLauncher: ProviderManifest = {
      ...(structuredClone(PROVIDER_MANIFESTS["launcher-process"]) as ProviderManifest),
      metadata: { name: "launcher-process", version: "9.9.9" },
    };
    const badRelationProvider = provider("bad-relation", "launcher", "Launcher");
    const badRelationProviderManifest: ProviderManifest = {
      ...badRelationProvider,
      spec: {
        ...badRelationProvider.spec,
        relations: { compatibleWith: { connectors: ["missing-connector"] } },
      },
    };

    const result = resolveProviderGraphProjection({
      providerSet: {
        providers: [...PROVIDERS, duplicateLauncher],
      },
      providerManifests: [badRelationProviderManifest],
      baseProfile: {
        apiVersion: "gla.dev/v1",
        kind: "ProviderProfile",
        metadata: { name: "broken", version: "0.1.0" },
        spec: {
          select: {
            ...BASE_PROFILE.spec.select,
            MadeUpFamily: "auth-webauthn",
            Launcher: "channel-cli",
            AgentConnector: "missing-connector",
          } as unknown as NonNullable<ProviderProfileManifest["spec"]["select"]>,
        },
      },
      overlays: [
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfileOverlay",
          metadata: { name: "cycle-a" },
          spec: { extends: "cycle-b" },
        },
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfileOverlay",
          metadata: { name: "cycle-b" },
          spec: { extends: "cycle-a" },
        },
      ],
      templates: [brokenTemplate, ambiguousTemplate],
      compatibilityRequiredParts: ["entrypoint"],
    });

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toEqual(
      expect.arrayContaining([
        "graph.unknown_family",
        "graph.unknown_provider",
        "graph.family_mismatch",
        "graph.duplicate_provider_version",
        "graph.overlay_cycle",
        "graph.unresolved_relation",
        "graph.dependency_unavailable",
        "graph.compatibility_ambiguous",
      ]),
    );
  });

  it("keeps WPM DependencyBinding evidence out of provider config precedence", () => {
    const result = resolveProviderGraphProjection({
      providerSet: { providers: PROVIDERS },
      baseProfile: BASE_PROFILE,
      templatePackages: [templatePackage()],
      dependencyBindings: referenceWpmDependencyBindings(),
      runtimeAssemblyParams: {
        "url-watcher": { complete_on: "/dashboard" },
      },
    });

    if (!result.ok) {
      throw new Error(`expected graph projection to pass: ${JSON.stringify(result.diagnostics)}`);
    }
    expect(result.ok).toBe(true);
    const launcher = result.projection.providers.find(
      (selected) => selected.providerId === "launcher-process",
    );
    expect(launcher?.dependencies[0]).toMatchObject({
      dependency: "browser-runtime",
      status: "bound",
      receipt: { status: "Done" },
    });
    expect(launcher?.config).not.toHaveProperty("dependencyBindings");
    expect(launcher?.config).not.toHaveProperty("connection");
    expect(launcher?.config).not.toHaveProperty("receipt");
  });

  it("feeds admission and doctor from the same graph projection as catalog reads", () => {
    const dependencyBindings = referenceWpmDependencyBindings().filter(
      (binding) => binding.dependency !== "edge-proxy",
    );
    const content = {
      providers: PROVIDERS,
      templates: [structuredClone(BROWSER_HANDOFF_TEMPLATE)],
    };
    const catalog = new CatalogService({ content, dependencyBindings });
    const graph = resolveProviderGraphProjection({
      providerSet: {
        id: "reference",
        providers: content.providers,
        templates: content.templates,
      },
      baseProfile: BASE_PROFILE,
      dependencyBindings,
      runtimeAssemblyParams: {
        "url-watcher": { complete_on: "/dashboard" },
      },
    });

    const classicAdmission = toAdmissionCatalog(catalog, content);
    const graphAdmission = toAdmissionCatalogFromProviderGraphProjection(graph);
    const graphTemplate = graphAdmission.templateDefaults("browser-handoff");

    expect(graphTemplate).toMatchObject({
      available: false,
      availability: "unavailable",
      diagnostics: [
        expect.objectContaining({
          code: "template.dependency_unavailable",
          dependency: "edge-proxy",
        }),
      ],
    });
    expect(graphAdmission.provider("launcher-process")).toMatchObject(
      classicAdmission.provider("launcher-process") ?? {},
    );
    expect(classicAdmission.provider("auth-webauthn")?.authAssurance).toMatchObject({
      maxLevel: "phishing-resistant",
      requiredEvidence: ["userVerified", "recipientBound", "replayResistant"],
    });
    expect(graphAdmission.provider("auth-webauthn")?.authAssurance).toMatchObject({
      maxLevel: "phishing-resistant",
      requiredEvidence: ["userVerified", "recipientBound", "replayResistant"],
    });
    expect(catalog.show("auth-webauthn")?.authAssurance).toMatchObject({
      supportedPolicies: ["phishing-resistant", "password-permitted"],
    });
    expect(graphAdmission.provider("user-done")).toMatchObject({
      name: "user-done",
      available: true,
      family: "detector",
    });
    expect(providerGraphDoctorReport(graph)).toMatchObject({
      status: "FAIL",
      selectedProviders: expect.objectContaining({ Launcher: "launcher-process" }),
      templates: [
        expect.objectContaining({
          templateId: "browser-handoff",
          availability: "unavailable",
        }),
      ],
    });
    expect(
      providerGraphDoctorReport(graph).providers.find(
        (provider) => provider.providerId === "auth-webauthn",
      )?.authAssurance,
    ).toMatchObject({
      supportedPolicies: ["phishing-resistant", "password-permitted"],
      maxLevel: "phishing-resistant",
    });
  });

  it("marks graph-defective templates unavailable for admission before state creation", () => {
    const entrypoint = provider("entrypoint-basic", "entrypoint", "HumanEntrypoint");
    const ambiguousTemplate: TemplateManifest = {
      apiVersion: "gla.dev/v1",
      kind: "CapsuleTemplate",
      metadata: { name: "ambiguous-entrypoint-template", version: "0.1.0" },
      spec: {
        family: "template",
        capability: { summary: "ambiguous template" },
        requiredParts: { entrypoint: "entrypoint-basic" },
        openParts: ["entrypoint"],
        openParams: {},
      },
    };
    const graph = resolveProviderGraphProjection({
      providerSet: {
        providers: [entrypoint],
        templates: [ambiguousTemplate],
      },
      baseProfile: {
        apiVersion: "gla.dev/v1",
        kind: "ProviderProfile",
        metadata: { name: "entrypoint-profile" },
        spec: { select: { HumanEntrypoint: "entrypoint-basic" } },
      },
      compatibilityRequiredParts: ["entrypoint"],
    });

    expect(graph.ok).toBe(false);
    expect(
      toAdmissionCatalogFromProviderGraphProjection(graph).templateDefaults(
        "ambiguous-entrypoint-template",
      ),
    ).toMatchObject({
      available: false,
      availability: "unavailable",
      diagnostics: [
        expect.objectContaining({
          code: "graph.compatibility_ambiguous",
        }),
      ],
    });
    expect(providerGraphDoctorReport(graph)).toMatchObject({
      status: "FAIL",
      templates: [
        expect.objectContaining({
          templateId: "ambiguous-entrypoint-template",
          available: false,
          availability: "unavailable",
          diagnostics: [
            expect.objectContaining({
              code: "graph.compatibility_ambiguous",
            }),
          ],
        }),
      ],
    });
  });

  it("propagates selected provider graph defects to fixed template availability", () => {
    const entrypoint = provider("entrypoint-needs-config", "entrypoint", "HumanEntrypoint");
    entrypoint.spec.config_schema = {
      origin: { type: "string", required: true, min: 1 },
    };
    const fixedTemplate: TemplateManifest = {
      apiVersion: "gla.dev/v1",
      kind: "CapsuleTemplate",
      metadata: { name: "fixed-entrypoint-template", version: "0.1.0" },
      spec: {
        family: "template",
        capability: { summary: "fixed template" },
        requiredParts: { entrypoint: "entrypoint-needs-config" },
        openParams: {},
      },
    };
    const content = {
      providers: [entrypoint],
      templates: [fixedTemplate],
    };
    const graph = resolveProviderGraphProjection({
      providerSet: content,
      baseProfile: {
        apiVersion: "gla.dev/v1",
        kind: "ProviderProfile",
        metadata: { name: "entrypoint-profile" },
        spec: { select: { HumanEntrypoint: "entrypoint-needs-config" } },
      },
    });
    const catalog = new CatalogService({ content, providerGraph: graph });

    expect(graph.ok).toBe(false);
    expect(catalog.show("fixed-entrypoint-template")).toMatchObject({
      available: false,
      availability: "unavailable",
    });
    expect(
      catalog.list({ kind: "template", available: true }).map((entry) => entry.name),
    ).not.toContain("fixed-entrypoint-template");
    expect(catalog.templateShow("fixed-entrypoint-template")).toMatchObject({
      available: false,
      availability: "unavailable",
      diagnostics: [
        expect.objectContaining({
          code: "graph.config_invalid",
          provider: "entrypoint-needs-config",
          part: "entrypoint",
        }),
      ],
    });
    expect(
      toAdmissionCatalogFromProviderGraphProjection(graph).templateDefaults(
        "fixed-entrypoint-template",
      ),
    ).toMatchObject({
      available: false,
      availability: "unavailable",
      diagnostics: [
        expect.objectContaining({
          code: "graph.config_invalid",
          provider: "entrypoint-needs-config",
          part: "entrypoint",
        }),
      ],
    });
    expect(providerGraphDoctorReport(graph)).toMatchObject({
      status: "FAIL",
      providers: [
        expect.objectContaining({
          providerId: "entrypoint-needs-config",
          available: false,
          availability: "unavailable",
        }),
      ],
      templates: [
        expect.objectContaining({
          templateId: "fixed-entrypoint-template",
          available: false,
          availability: "unavailable",
          diagnostics: [
            expect.objectContaining({
              code: "graph.config_invalid",
              provider: "entrypoint-needs-config",
              part: "entrypoint",
            }),
          ],
        }),
      ],
    });
  });

  it("does not reject open parts without a required-compatibility contract", () => {
    const entrypoint = provider("entrypoint-basic", "entrypoint", "HumanEntrypoint");
    const openButNotRequired: TemplateManifest = {
      apiVersion: "gla.dev/v1",
      kind: "CapsuleTemplate",
      metadata: { name: "open-entrypoint-template", version: "0.1.0" },
      spec: {
        family: "template",
        capability: { summary: "open entrypoint without required compatibility" },
        requiredParts: { entrypoint: "entrypoint-basic" },
        openParts: ["entrypoint"],
        openParams: { recipient: { type: "string", required: true, min: 1 } },
        skills: [
          { id: "open-entrypoint-template", for: "open-entrypoint-template", body: "# test" },
        ],
      },
    };

    const result = resolveProviderGraphProjection({
      providerSet: { providers: [entrypoint] },
      baseProfile: {
        apiVersion: "gla.dev/v1",
        kind: "ProviderProfile",
        metadata: { name: "entrypoint-only" },
        spec: { select: { HumanEntrypoint: "entrypoint-basic" } },
      },
      templates: [openButNotRequired],
    });

    expect(result.ok).toBe(true);
  });

  it("emits dependency diagnostics for unavailable template-required providers outside profile selection", () => {
    const dependencyBackedEntrypoint: ProviderManifest = {
      ...provider("entrypoint-external", "entrypoint", "HumanEntrypoint"),
      spec: {
        ...provider("entrypoint-external", "entrypoint", "HumanEntrypoint").spec,
        requires: [
          {
            dependency: "external-entrypoint",
            hostTouching: true,
            connectionRefs: ["endpoint"],
            bundle: {
              id: "external-entrypoint",
              version: "0.1.0",
              declaredRequires: { "gla-core": "^0.1.0" },
            },
          },
        ],
      },
    };
    const template: TemplateManifest = {
      apiVersion: "gla.dev/v1",
      kind: "CapsuleTemplate",
      metadata: { name: "external-entrypoint-template", version: "0.1.0" },
      spec: {
        family: "template",
        capability: { summary: "template with dependency-backed entrypoint" },
        requiredParts: { entrypoint: "entrypoint-external" },
        openParams: { recipient: { type: "string", required: true, min: 1 } },
        skills: [
          {
            id: "external-entrypoint-template",
            for: "external-entrypoint-template",
            body: "# test",
          },
        ],
      },
    };

    const result = resolveProviderGraphProjection({
      providerSet: { providers: [dependencyBackedEntrypoint] },
      baseProfile: {
        apiVersion: "gla.dev/v1",
        kind: "ProviderProfile",
        metadata: { name: "empty-profile" },
        spec: {},
      },
      templates: [template],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "graph.dependency_unavailable",
          providerId: "entrypoint-external",
          template: "external-entrypoint-template",
          dependency: "external-entrypoint",
        }),
      ]),
    );
  });
});
