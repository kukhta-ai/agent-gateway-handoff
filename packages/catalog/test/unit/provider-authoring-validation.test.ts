import { describe, expect, it } from "vitest";
import {
  PROVIDER_MANIFESTS,
  type ProviderFamily,
  type ProviderManifest,
  type ProviderPackageAuthoringReport,
  type TemplatePackageAuthoringReport,
  createProviderPackageSkeleton,
  createTemplatePackageSkeleton,
  validateProviderPackageAuthoring,
  validateTemplatePackageAuthoring,
} from "../../src/index.js";

function provider(
  id: string,
  family: Exclude<ProviderFamily, "template">,
  kind: string,
): ProviderManifest {
  return {
    apiVersion: "gla.dev/v1",
    kind,
    metadata: { name: id, version: "0.1.0" },
    spec: {
      family,
      capability: { summary: `${id} provider` },
      config_schema: {},
      probe: id,
      skills: [{ id: `use-${id}`, for: id, body: `# ${id}` }],
    },
  };
}

const PROVIDERS: ProviderManifest[] = [
  ...Object.values(PROVIDER_MANIFESTS),
  provider("auth-webauthn", "auth", "AuthProvider"),
  provider("secret-store-reference", "secret-store", "SecretStore"),
];

function providerCodes(result: ProviderPackageAuthoringReport): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function templateCodes(result: TemplatePackageAuthoringReport): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("provider package authoring validation", () => {
  it("creates a provider skeleton that validates without generic app or narrow-waist edits", () => {
    const skeleton = createProviderPackageSkeleton({
      providerId: "auth-example",
      family: "auth",
      requires: [
        {
          dependency: "example-idp",
          hostTouching: true,
          connectionRefs: ["issuerUrl", "clientSecret"],
        },
      ],
    });

    const result = validateProviderPackageAuthoring(skeleton);

    expect(result).toEqual({
      ok: true,
      diagnostics: [],
      readiness: {
        providerId: "auth-example",
        family: "auth",
        requiredWpmSkeletons: [
          {
            dependency: "example-idp",
            bundleId: "example-idp",
            connectionRefs: ["issuerUrl", "clientSecret"],
            files: [
              "wpm/bundles/example-idp/bundle.yml",
              "wpm/bundles/example-idp/install-backlog.md",
              "wpm/bundles/example-idp/verify.ts",
            ],
          },
        ],
        availability: "not-evaluated",
        nextUx: "operator-install-update",
      },
    });
    expect(skeleton.changedFiles).not.toContain("packages/app/src/composition.ts");
    expect(skeleton.changedFiles.some((file) => file.startsWith("packages/kernel/"))).toBe(false);
  });

  it("aggregates stable provider diagnostics and redacts secret-shaped authoring input", () => {
    const result = validateProviderPackageAuthoring({
      manifest: {
        apiVersion: "gla.dev/v1",
        kind: "Launcher",
        metadata: { name: "auth-broken", version: "0.1.0" },
        spec: {
          family: "auth",
          capability: { summary: "broken auth provider", note: "author-token-canary" },
          config_schema: {
            issuer: { type: "text" },
          },
          requires: [
            {
              dependency: "idp",
              hostTouching: true,
              connectionRefs: ["issuerUrl"],
            },
          ],
          skills: [],
        },
      },
      module: {
        providerId: "auth-other",
        family: "launcher",
        registersFactory: false,
        registersProbe: false,
      },
      docs: [],
      contractTests: [],
      changedFiles: [
        "packages/app/src/composition.ts",
        "packages/app/src/index.ts",
        "adapters/auth-broken/../other-provider/src/index.ts",
        "adapters/auth-broken/../../packages/kernel/src/ports.ts",
      ],
      wpmBundles: [],
    });

    expect(providerCodes(result)).toEqual(
      expect.arrayContaining([
        "provider_author.family_contract_invalid",
        "provider_author.schema_invalid",
        "provider_author.probe_missing",
        "provider_author.skills_or_docs_missing",
        "provider_author.wpm_bundle_missing",
        "provider_author.redaction_violation",
        "provider_author.contract_tests_missing",
        "provider_author.narrow_waist_edit",
      ]),
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain("author-token-canary");
    expect(result.readiness.availability).toBe("not-evaluated");
    expect(result.readiness.nextUx).toBe("operator-install-update");
    expect(result.readiness.requiredWpmSkeletons[0]?.dependency).toBe("idp");
    expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(
      expect.arrayContaining([
        "packages/app/src/composition.ts",
        "packages/app/src/index.ts",
        "adapters/auth-broken/../other-provider/src/index.ts",
        "adapters/auth-broken/../../packages/kernel/src/ports.ts",
      ]),
    );
  });

  it("rejects traversal-shaped provider and dependency ids before skeleton paths are generated", () => {
    expect(() =>
      createProviderPackageSkeleton({
        providerId: "../packages/app/src/composition",
        family: "auth",
      }),
    ).toThrow(/provider id/);
    expect(() =>
      createProviderPackageSkeleton({
        providerId: "auth-safe",
        family: "auth",
        requires: [{ dependency: "../edge-proxy", hostTouching: true }],
      }),
    ).toThrow(/dependency/);
  });
});

describe("template package authoring validation", () => {
  it("creates a TemplatePackage skeleton that validates as a catalog-only package", () => {
    const skeleton = createTemplatePackageSkeleton({
      packageId: "browser-handoff-lite-package",
      templateId: "browser-handoff-lite",
      requiredParts: {
        launcher: "launcher-process",
        entrypoint: "entrypoint-novnc",
        connector: "connector-cdp",
        detector: "url-watcher",
      },
      openParts: ["entrypoint", "connector", "detector"],
      compatibleProviders: {
        entrypoint: ["entrypoint-novnc"],
        connector: ["connector-cdp"],
        detector: ["url-watcher"],
      },
      requires: [
        {
          dependency: "edge-proxy",
          hostTouching: true,
          connectionRefs: ["publicBaseUrl", "gatewayUpstream"],
        },
      ],
    });

    const result = validateTemplatePackageAuthoring({
      ...skeleton,
      providers: PROVIDERS,
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.readiness).toMatchObject({
      packageId: "browser-handoff-lite-package",
      templateIds: ["browser-handoff-lite"],
      availability: "not-evaluated",
      nextUx: "operator-install-update",
    });
    expect(result.readiness.requiredWpmSkeletons).toEqual([
      {
        dependency: "edge-proxy",
        bundleId: "edge-proxy",
        connectionRefs: ["publicBaseUrl", "gatewayUpstream"],
        files: [
          "wpm/bundles/edge-proxy/bundle.yml",
          "wpm/bundles/edge-proxy/install-backlog.md",
          "wpm/bundles/edge-proxy/verify.ts",
        ],
      },
    ]);
    expect(skeleton.changedFiles.some((file) => file.startsWith("packages/gateway/"))).toBe(false);
  });

  it("reports template authoring defects with stable diagnostics before runtime consumption", () => {
    const result = validateTemplatePackageAuthoring({
      providers: PROVIDERS,
      manifest: {
        apiVersion: "gla.dev/v1",
        kind: "TemplatePackage",
        metadata: { name: "broken-template-package", version: "0.1.0" },
        spec: {
          templates: [
            {
              apiVersion: "gla.dev/v1",
              kind: "NotCapsuleTemplate",
              metadata: { name: "broken-template", version: "0.1.0" },
              spec: {
                family: "template",
                capability: { summary: "broken template", note: "template-token-canary" },
                requiredParts: { launcher: "launcher-process" },
                requires: [
                  {
                    dependency: "edge-proxy",
                    hostTouching: true,
                    connectionRefs: [],
                  },
                ],
                openParts: ["entrypoint"],
                compatibleProviders: {
                  connector: ["connector-cdp"],
                  entrypoint: ["missing-provider"],
                },
                openParams: {
                  recipient: { type: "text" },
                },
              },
              runtimeFactory: "@gla/bad-template-runtime",
            },
          ],
          schema: {
            recipient: { type: "text" },
          },
          defaults: {
            "missing-template": {
              MadeUpFamily: "launcher-process",
              Launcher: "entrypoint-novnc",
            },
          },
          compatibility: {},
          docs: [],
          tests: ["templates/broken-template/test/contract/broken-template.test.ts"],
        },
      },
      changedFiles: [
        "packages/gateway/src/index.ts",
        "templates/broken-template/../other-template/template-package.json",
        "templates/broken-template/../../packages/app/src/index.ts",
      ],
    });

    expect(templateCodes(result)).toEqual(
      expect.arrayContaining([
        "template_author.catalog_entity_invalid",
        "template_author.schema_invalid",
        "template_author.defaults_invalid",
        "template_author.compatibility_invalid",
        "template_author.skills_or_docs_missing",
        "template_author.dependency_invalid",
        "template_author.wpm_bundle_missing",
        "template_author.redaction_violation",
        "template_author.narrow_waist_edit",
        "template_author.factory_forbidden",
      ]),
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain("template-token-canary");
    expect(result.readiness.availability).toBe("not-evaluated");
    expect(result.readiness.nextUx).toBe("operator-install-update");
    expect(result.readiness.requiredWpmSkeletons[0]?.dependency).toBe("edge-proxy");
    expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(
      expect.arrayContaining([
        "packages/gateway/src/index.ts",
        "templates/broken-template/../other-template/template-package.json",
        "templates/broken-template/../../packages/app/src/index.ts",
      ]),
    );
  });

  it("rejects traversal-shaped template ids before skeleton paths are generated", () => {
    expect(() =>
      createTemplatePackageSkeleton({
        packageId: "safe-package",
        templateId: "../packages/app/src/index",
        requiredParts: { launcher: "launcher-process" },
      }),
    ).toThrow(/template id/);
  });
});
