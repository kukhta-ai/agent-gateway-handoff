import { type ConfigSchema, EMPTY_CONFIG_SCHEMA } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  BROWSER_HANDOFF_TEMPLATE,
  CHANNEL_CLI_MANIFEST,
  CatalogService,
  PROVIDER_MANIFESTS,
  type ProviderFamily,
  type ProviderManifest,
  type ProviderProfileManifest,
  type ProviderProfileOverlayManifest,
  type TemplateManifest,
  type TemplatePackageManifest,
  providerGraphDoctorReport,
  referenceWpmDependencyBindings,
  resolveProviderGraphProjection,
  toAdmissionCatalog,
  toAdmissionCatalogFromProviderGraphProjection,
  validateProviderPackageAuthoring,
  validateTemplatePackageAuthoring,
} from "../../src/index.js";

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
      config_schema: emptySchema(),
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
    config_schema: objectSchema({
      rpID: { type: "string", default: "localhost", minLength: 1 },
    }),
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
      schema: objectSchema({ recipient: { type: "string", minLength: 1 } }, ["recipient"]),
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
      configValidationMode: "runtime",
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
    expect(launcher?.provenance).toMatchObject({ source: "provider-set", id: "reference" });
    expect(launcher?.defaultSource).toMatchObject({
      source: "base-profile-select",
      providerId: "launcher-process",
      profile: "local-dev",
    });

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
      packageProvenance: {
        packageId: "browser-handoff-package",
        version: "0.1.0",
        docs: ["docs/04-capsule-assembly.md"],
        tests: ["packages/catalog/test/unit/provider-graph-projection.test.ts"],
      },
      compatibilityConstraints: expect.objectContaining({
        openParts: ["entrypoint", "connector", "detector"],
        requiredParts: ["launcher", "entrypoint", "connector", "workspace", "detector"],
      }),
    });
  });

  it("defaults provider graph config validation to factory schemas for profile config", () => {
    const factoryOnlyDetector: ProviderManifest = {
      apiVersion: "gla.dev/v1",
      kind: "CompletionDetector",
      metadata: { name: "detector-factory-only", version: "0.1.0" },
      spec: {
        family: "detector",
        capability: { summary: "factory-only detector" },
        factory_config_schema: objectSchema({ pollMs: { type: "number", minimum: 1 } }, ["pollMs"]),
        probe: "detector-factory-only",
      },
    };
    const input = {
      providerSet: { providers: [factoryOnlyDetector] },
      baseProfile: {
        apiVersion: "gla.dev/v1",
        kind: "ProviderProfile",
        metadata: { name: "factory-profile" },
        spec: {
          select: { CompletionDetector: "detector-factory-only" },
          config: { "detector-factory-only": { pollMs: 1 } },
        },
      },
    } satisfies Parameters<typeof resolveProviderGraphProjection>[0];

    expect(resolveProviderGraphProjection(input).ok).toBe(true);
    expect(
      diagnosticCodes(
        resolveProviderGraphProjection({ ...input, configValidationMode: "runtime" }),
      ),
    ).toContain("graph.config_invalid");
  });

  it("materializes hand-authored TemplatePackage provider defaults into resolved capsule template parts", () => {
    const pkg = templatePackage();
    pkg.spec.defaults = {
      ...pkg.spec.defaults,
      "template.browser-handoff": {
        Launcher: "launcher-process",
        Workspace: "workspace-profile",
        HumanEntrypoint: "entrypoint-novnc",
        AgentConnector: "connector-cdp",
        CompletionDetector: "user-done",
      },
    };

    const graph = resolveProviderGraphProjection({
      providerSet: { providers: PROVIDERS },
      baseProfile: BASE_PROFILE,
      templatePackages: [pkg],
      dependencyBindings: referenceWpmDependencyBindings(),
    });

    expect(graph.projection.templates[0]).toMatchObject({
      templateId: "browser-handoff",
      requiredParts: expect.objectContaining({
        launcher: "launcher-process",
        workspace: "workspace-profile",
        entrypoint: "entrypoint-novnc",
        connector: "connector-cdp",
        detector: "user-done",
      }),
      defaultSources: {
        launcher: expect.objectContaining({
          source: "template-package-default",
          templatePackage: "browser-handoff-package",
          family: "Launcher",
          providerId: "launcher-process",
        }),
        workspace: expect.objectContaining({
          source: "template-package-default",
          family: "Workspace",
          providerId: "workspace-profile",
        }),
        entrypoint: expect.objectContaining({
          source: "template-package-default",
          family: "HumanEntrypoint",
          providerId: "entrypoint-novnc",
        }),
        connector: expect.objectContaining({
          source: "template-package-default",
          family: "AgentConnector",
          providerId: "connector-cdp",
        }),
        detector: expect.objectContaining({
          source: "template-package-default",
          family: "CompletionDetector",
          providerId: "user-done",
        }),
      },
    });
    expect(
      toAdmissionCatalogFromProviderGraphProjection(graph).templateDefaults("browser-handoff"),
    ).toMatchObject({
      detectors: [{ use: "user-done" }],
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
        openParams: objectSchema({ recipient: { type: "string", minLength: 1 } }, ["recipient"]),
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
    const duplicateLauncherSameVersion: ProviderManifest = {
      ...(structuredClone(PROVIDER_MANIFESTS["launcher-process"]) as ProviderManifest),
      metadata: { name: "launcher-process", version: "0.1.0" },
    };
    const duplicateTemplate = structuredClone(BROWSER_HANDOFF_TEMPLATE);
    const duplicateTemplateVersion = structuredClone(BROWSER_HANDOFF_TEMPLATE);
    duplicateTemplateVersion.metadata.version = "9.9.9";
    const badRelationProvider = provider("bad-relation", "launcher", "Launcher");
    const badRelationProviderManifest: ProviderManifest = {
      ...badRelationProvider,
      spec: {
        ...badRelationProvider.spec,
        relations: {
          compatibleWith: {
            connectors: ["missing-connector"],
            entyrpoints: ["entrypoint-novnc"],
          },
        },
      },
    };

    const result = resolveProviderGraphProjection({
      providerSet: {
        providers: [...PROVIDERS, duplicateLauncherSameVersion, duplicateLauncher],
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
      templates: [brokenTemplate, duplicateTemplate, duplicateTemplateVersion, ambiguousTemplate],
      compatibilityRequiredParts: ["entrypoint"],
    });

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toEqual(
      expect.arrayContaining([
        "graph.unknown_family",
        "graph.unknown_provider",
        "graph.family_mismatch",
        "graph.duplicate_provider",
        "graph.duplicate_provider_version",
        "graph.duplicate_template",
        "graph.duplicate_template_version",
        "graph.overlay_cycle",
        "graph.unresolved_relation",
        "graph.dependency_unavailable",
        "graph.compatibility_ambiguous",
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "graph.unresolved_relation",
          detail: expect.objectContaining({ relationKey: "entyrpoints" }),
        }),
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
      configValidationMode: "runtime",
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

  it("distinguishes provider and template dependency health in graph diagnostics", () => {
    const graph = resolveProviderGraphProjection({
      providerSet: {
        providers: PROVIDERS,
        templates: [structuredClone(BROWSER_HANDOFF_TEMPLATE)],
      },
      baseProfile: BASE_PROFILE,
      dependencyBindings: referenceWpmDependencyBindings(),
      probes: {
        "launcher-process": () => "unavailable",
        "browser-handoff": () => "degraded",
      },
    });

    expect(graph.ok).toBe(false);
    expect(graph.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "graph.dependency_unavailable",
          providerId: "launcher-process",
          dependency: "browser-runtime",
          dependencyScope: "provider",
          dependencyStatus: "bound",
          install: "available",
          runtime: "unavailable",
        }),
        expect.objectContaining({
          code: "graph.dependency_unavailable",
          template: "browser-handoff",
          dependency: "edge-proxy",
          dependencyScope: "template",
          dependencyStatus: "bound",
          install: "available",
          runtime: "degraded",
        }),
      ]),
    );
    expect(
      toAdmissionCatalogFromProviderGraphProjection(graph).provider("launcher-process"),
    ).toMatchObject({
      available: false,
      availability: "unavailable",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          dependencyScope: "provider",
          install: "available",
          runtime: "unavailable",
        }),
      ]),
    });
    expect(providerGraphDoctorReport(graph)).toMatchObject({
      status: "FAIL",
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: "launcher-process",
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              dependencyScope: "provider",
              install: "available",
              runtime: "unavailable",
            }),
          ]),
        }),
      ]),
      templates: expect.arrayContaining([
        expect.objectContaining({
          templateId: "browser-handoff",
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              dependencyScope: "template",
              install: "available",
              runtime: "degraded",
            }),
          ]),
        }),
      ]),
    });
  });

  it("fails closed when host-touching graph inputs omit current probe declarations", () => {
    const providers = structuredClone(PROVIDERS);
    const launcher = providers.find((provider) => provider.metadata.name === "launcher-process");
    if (launcher === undefined) {
      throw new Error("missing launcher fixture");
    }
    const { probe: _launcherProbe, ...launcherSpec } = launcher.spec;
    launcher.spec = launcherSpec;
    const template = structuredClone(BROWSER_HANDOFF_TEMPLATE);
    const { probe: _templateProbe, ...templateSpec } = template.spec;
    template.spec = templateSpec;

    const graph = resolveProviderGraphProjection({
      providerSet: {
        providers,
        templates: [template],
      },
      baseProfile: BASE_PROFILE,
      dependencyBindings: referenceWpmDependencyBindings(),
    });

    expect(graph.ok).toBe(false);
    expect(graph.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "graph.dependency_unavailable",
          providerId: "launcher-process",
          dependency: "browser-runtime",
          dependencyScope: "provider",
          dependencyStatus: "bound",
          install: "available",
          runtime: "unavailable",
        }),
        expect.objectContaining({
          code: "graph.dependency_unavailable",
          template: "browser-handoff",
          dependency: "edge-proxy",
          dependencyScope: "template",
          dependencyStatus: "bound",
          install: "available",
          runtime: "unavailable",
        }),
      ]),
    );
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
      configValidationMode: "runtime",
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
        openParams: emptySchema(),
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
    entrypoint.spec.config_schema = objectSchema({ origin: { type: "string", minLength: 1 } }, [
      "origin",
    ]);
    const fixedTemplate: TemplateManifest = {
      apiVersion: "gla.dev/v1",
      kind: "CapsuleTemplate",
      metadata: { name: "fixed-entrypoint-template", version: "0.1.0" },
      spec: {
        family: "template",
        capability: { summary: "fixed template" },
        requiredParts: { entrypoint: "entrypoint-needs-config" },
        openParams: emptySchema(),
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
        openParams: objectSchema({ recipient: { type: "string", minLength: 1 } }, ["recipient"]),
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
        openParams: objectSchema({ recipient: { type: "string", minLength: 1 } }, ["recipient"]),
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

  it("proves a non-reference human-entrypoint package projects through profile, catalog, doctor, and admission", () => {
    const entrypointSharelink: ProviderManifest = {
      apiVersion: "gla.dev/v1",
      kind: "HumanEntrypoint",
      metadata: { name: "entrypoint-sharelink", version: "0.1.0" },
      spec: {
        family: "entrypoint",
        capability: {
          summary: "share-link human entrypoint for a hosted browser view",
          client: { kind: "share-link", ref: "entrypoint-sharelink.client" },
        },
        config_schema: objectSchema({
          theme: { type: "string", enum: ["light", "dark"], default: "light" },
        }),
        probe: "entrypoint-sharelink",
        skills: [
          {
            id: "use-entrypoint-sharelink",
            for: "entrypoint-sharelink",
            body: "# use-entrypoint-sharelink\nOpen the provider-owned share-link human view.",
          },
        ],
      },
    };
    const sharelinkTemplate: TemplateManifest = {
      apiVersion: "gla.dev/v1",
      kind: "CapsuleTemplate",
      metadata: { name: "sharelink-handoff", version: "0.1.0" },
      spec: {
        family: "template",
        capability: { summary: "browser handoff with the share-link human entrypoint" },
        requiredParts: {
          launcher: "launcher-process",
          entrypoint: "entrypoint-sharelink",
          connector: "connector-cdp",
          workspace: "workspace-profile",
          detector: "url-watcher",
        },
        openParts: ["entrypoint", "connector", "detector"],
        compatibleProviders: {
          entrypoint: ["entrypoint-sharelink"],
          connector: ["connector-cdp"],
          detector: ["url-watcher", "user-done"],
        },
        openParams: objectSchema({ recipient: { type: "string", minLength: 1 } }, ["recipient"]),
        probe: "sharelink-handoff",
        skills: [
          {
            id: "sharelink-handoff",
            for: "sharelink-handoff",
            body: "# sharelink-handoff\nUse the share-link entrypoint variant.",
          },
        ],
      },
    };
    const sharelinkTemplatePackage: TemplatePackageManifest = {
      apiVersion: "gla.dev/v1",
      kind: "TemplatePackage",
      metadata: { name: "sharelink-handoff-package", version: "0.1.0" },
      spec: {
        templates: [sharelinkTemplate],
        schema: objectSchema({ recipient: { type: "string", minLength: 1 } }, ["recipient"]),
        defaults: { "entrypoint-sharelink": { theme: "light" } },
        compatibility: {
          requiredParts: ["entrypoint", "connector", "detector"],
        },
        docs: ["templates/sharelink-handoff/README.md"],
        tests: ["packages/catalog/test/unit/provider-graph-projection.test.ts"],
      },
    };
    const overlay: ProviderProfileOverlayManifest = {
      apiVersion: "gla.dev/v1",
      kind: "ProviderProfileOverlay",
      metadata: { name: "operator-sharelink-entrypoint", version: "0.1.0" },
      spec: {
        extends: "local-dev",
        select: { HumanEntrypoint: "entrypoint-sharelink" },
        config: { "entrypoint-sharelink": { theme: "dark" } },
      },
    };
    const providers = [...PROVIDERS, entrypointSharelink];

    expect(
      validateProviderPackageAuthoring({
        manifest: entrypointSharelink,
        module: {
          providerId: "entrypoint-sharelink",
          family: "entrypoint",
          registersFactory: true,
          registersProbe: true,
        },
        docs: ["adapters/entrypoint-sharelink/README.md"],
        contractTests: ["packages/catalog/test/unit/provider-graph-projection.test.ts"],
        changedFiles: [
          "adapters/entrypoint-sharelink/src/index.ts",
          "packages/provider-set-sharelink/src/index.ts",
        ],
      }).ok,
    ).toBe(true);
    expect(
      validateTemplatePackageAuthoring({
        manifest: sharelinkTemplatePackage,
        providers,
      }).ok,
    ).toBe(true);
    const redactionCheck = validateProviderPackageAuthoring({
      manifest: entrypointSharelink,
      module: {
        providerId: "entrypoint-sharelink",
        family: "entrypoint",
        registersFactory: true,
        registersProbe: true,
      },
      docs: ["https://operator.example/setup?token=entrypoint-token-canary"],
      contractTests: ["packages/catalog/test/unit/provider-graph-projection.test.ts"],
    });
    expect(redactionCheck.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "provider_author.redaction_violation" }),
      ]),
    );
    expect(JSON.stringify(redactionCheck.diagnostics)).not.toContain("entrypoint-token-canary");

    const graph = resolveProviderGraphProjection({
      providerSet: {
        id: "sharelink-provider-set",
        providers,
      },
      baseProfile: BASE_PROFILE,
      overlays: [overlay],
      templatePackages: [templatePackage(), sharelinkTemplatePackage],
      dependencyBindings: referenceWpmDependencyBindings(),
      runtimeAssemblyParams: {
        "entrypoint-sharelink": { theme: "dark" },
        "url-watcher": { complete_on: "/dashboard" },
      },
      configValidationMode: "runtime",
      probes: {
        "entrypoint-sharelink": () => "available",
        "sharelink-handoff": () => "available",
      },
    });

    if (!graph.ok) {
      throw new Error(`expected sharelink graph to pass: ${JSON.stringify(graph.diagnostics)}`);
    }
    expect(graph.projection.selectedProviders.HumanEntrypoint).toBe("entrypoint-sharelink");
    expect(
      graph.projection.providers.find((provider) => provider.providerId === "entrypoint-sharelink"),
    ).toMatchObject({
      providerId: "entrypoint-sharelink",
      family: "HumanEntrypoint",
      runtimeFamily: "entrypoint",
      available: true,
      config: { theme: "dark" },
    });

    const catalog = new CatalogService({
      content: { providers, templates: [sharelinkTemplate] },
      dependencyBindings: referenceWpmDependencyBindings(),
      probes: { "entrypoint-sharelink": () => "available", "sharelink-handoff": () => "available" },
      providerGraph: graph,
    });
    expect(catalog.show("entrypoint-sharelink")).toMatchObject({
      name: "entrypoint-sharelink",
      family: "entrypoint",
      availability: "available",
    });
    expect(catalog.skillShow("use-entrypoint-sharelink")).toMatchObject({
      id: "use-entrypoint-sharelink",
      for: "entrypoint-sharelink",
    });
    expect(catalog.templateShow("sharelink-handoff")).toMatchObject({
      id: "sharelink-handoff",
      available: true,
      packageProvenance: {
        packageId: "sharelink-handoff-package",
        version: "0.1.0",
        docs: ["templates/sharelink-handoff/README.md"],
        tests: ["packages/catalog/test/unit/provider-graph-projection.test.ts"],
      },
      compatibilityConstraints: expect.objectContaining({
        openParts: ["entrypoint", "connector", "detector"],
        requiredParts: ["entrypoint", "connector", "detector"],
      }),
      defaultSources: expect.objectContaining({
        entrypoint: expect.objectContaining({
          source: "capsule-template-required-part",
          providerId: "entrypoint-sharelink",
        }),
      }),
      parts: expect.arrayContaining([
        expect.objectContaining({
          part: "entrypoint",
          provider: "entrypoint-sharelink",
          defaultSource: expect.objectContaining({
            source: "capsule-template-required-part",
            providerId: "entrypoint-sharelink",
          }),
        }),
      ]),
    });

    const admission = toAdmissionCatalogFromProviderGraphProjection(graph);
    expect(admission.provider("entrypoint-sharelink")).toMatchObject({
      name: "entrypoint-sharelink",
      available: true,
      family: "entrypoint",
      config_schema: expect.objectContaining({
        properties: expect.objectContaining({
          theme: expect.objectContaining({ type: "string", enum: ["light", "dark"] }),
        }),
      }),
    });
    expect(admission.templateDefaults("sharelink-handoff")).toMatchObject({
      available: true,
      entrypoints: [{ use: "entrypoint-sharelink" }],
      compatibleProviders: expect.objectContaining({
        entrypoint: expect.arrayContaining(["entrypoint-sharelink"]),
      }),
    });
    expect(providerGraphDoctorReport(graph)).toMatchObject({
      status: "PASS",
      selectedProviders: expect.objectContaining({ HumanEntrypoint: "entrypoint-sharelink" }),
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: "entrypoint-sharelink",
          selected: true,
          available: true,
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: "provider.available" }),
          ]),
        }),
      ]),
      templates: expect.arrayContaining([
        expect.objectContaining({
          templateId: "sharelink-handoff",
          packageProvenance: expect.objectContaining({
            packageId: "sharelink-handoff-package",
          }),
          defaultSources: expect.objectContaining({
            entrypoint: expect.objectContaining({ providerId: "entrypoint-sharelink" }),
          }),
        }),
      ]),
    });

    const unavailableGraph = resolveProviderGraphProjection({
      providerSet: { id: "sharelink-provider-set", providers },
      baseProfile: BASE_PROFILE,
      overlays: [overlay],
      templatePackages: [templatePackage(), sharelinkTemplatePackage],
      dependencyBindings: referenceWpmDependencyBindings(),
      probes: {
        "entrypoint-sharelink": () => "unavailable",
        "sharelink-handoff": () => "available",
      },
    });
    expect(providerGraphDoctorReport(unavailableGraph)).toMatchObject({
      status: "FAIL",
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: "entrypoint-sharelink",
          availability: "unavailable",
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: "provider.unavailable" }),
          ]),
        }),
      ]),
    });
  });
});
