import { describe, expect, it } from "vitest";
import {
  BROWSER_HANDOFF_TEMPLATE,
  CHANNEL_CLI_MANIFEST,
  PROVIDER_MANIFESTS,
  type ProviderFamily,
  type ProviderManifest,
  type ProviderProfileValidationResult,
  validateProviderProfileInputs,
  validateTemplatePackageManifest,
} from "../../src/index.js";

function provider(
  id: string,
  family: Exclude<ProviderFamily, "template">,
  kind: string,
  config_schema: ProviderManifest["spec"]["config_schema"] = {},
): ProviderManifest {
  return {
    apiVersion: "gla.dev/v1",
    kind,
    metadata: { name: id, version: "0.1.0" },
    spec: {
      family,
      capability: { summary: `${id} test provider` },
      config_schema,
      probe: id,
      skills: [{ id: `use-${id}`, for: id, body: `# use-${id}` }],
    },
  };
}

const AUTH_WEBAUTHN = provider("auth-webauthn", "auth", "AuthProvider", {
  rpID: { type: "string", required: false, min: 1 },
});

const AUTH_OIDC = provider("auth-oidc-acme", "auth", "AuthProvider", {
  issuerUrl: { type: "string", required: true, min: 1 },
  clientSecret: {
    type: "object",
    required: true,
    fields: { secretRef: { type: "string", required: true, min: 1 } },
  },
});

const SECRET_STORE = provider("secret-store-reference", "secret-store", "SecretStore");

const INSTALLED_PROVIDERS: ProviderManifest[] = [
  ...Object.values(PROVIDER_MANIFESTS),
  CHANNEL_CLI_MANIFEST,
  AUTH_WEBAUTHN,
  AUTH_OIDC,
  SECRET_STORE,
];

function codes(result: ProviderProfileValidationResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function validTemplatePackage(): unknown {
  return {
    apiVersion: "gla.dev/v1",
    kind: "TemplatePackage",
    metadata: { name: "browser-handoff-package", version: "0.1.0" },
    spec: {
      templates: [structuredClone(BROWSER_HANDOFF_TEMPLATE)],
      schema: {
        recipient: { type: "string", required: true, min: 1 },
      },
      defaults: {
        "browser-handoff": {
          HumanEntrypoint: "entrypoint-novnc",
          AgentConnector: "connector-cdp",
          CompletionDetector: "url-watcher",
        },
      },
      compatibility: {
        requiredParts: ["launcher", "entrypoint", "connector", "workspace", "detector"],
      },
      docs: ["docs/04-capsule-assembly.md"],
      tests: ["packages/catalog/test/unit/provider-profile-contract.test.ts"],
    },
  };
}

describe("ProviderProfile and ProviderProfileOverlay contracts", () => {
  it("accepts versioned profile and overlay inputs with canonical families and boot lifecycle", () => {
    const result = validateProviderProfileInputs({
      providers: INSTALLED_PROVIDERS,
      profiles: [
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfile",
          metadata: { name: "local-dev", version: "0.1.0" },
          spec: {
            lifecycle: { owner: "operator", apply: "boot" },
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
              "auth-webauthn": { rpID: "gla.local" },
              "channel-cli": { delivery: "stdout" },
            },
            defaults: {
              "template.browser-handoff": {
                HumanEntrypoint: "entrypoint-novnc",
                AgentConnector: "connector-cdp",
              },
            },
          },
        },
      ],
      overlays: [
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfileOverlay",
          metadata: { name: "acme-oidc" },
          spec: {
            lifecycle: { owner: "operator", apply: "boot" },
            extends: "local-dev",
            select: {
              AuthProvider: "auth-oidc-acme",
            },
            config: {
              "auth-oidc-acme": {
                issuerUrl: "https://idp.acme.example",
                clientSecret: { secretRef: "oidc-client-secret" },
              },
            },
          },
        },
      ],
    });

    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it("rejects profile schema, cardinality, provider resolution, and secret defects with stable diagnostics", () => {
    const result = validateProviderProfileInputs({
      providers: INSTALLED_PROVIDERS,
      profiles: [
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfile",
          metadata: { name: "broken" },
          spec: {
            extra: true,
            select: {
              MadeUpFamily: "channel-cli",
              AuthProvider: "launcher-process",
              Launcher: "missing-launcher",
              ChannelAdapter: ["channel-cli", "channel-slack"],
              SecretStore: null,
            },
            config: {
              "missing-provider": { endpoint: "https://missing.example" },
              "auth-oidc-acme": {
                issuerUrl: "https://idp.acme.example",
                clientSecret: "literal-super-secret",
              },
              "channel-cli": { token: "secret:bot-token" },
              "secret-store-reference": {
                clientSecret: { value: "nested-raw-secret" },
                backupToken: [123],
                password: null,
              },
            },
          },
        },
      ],
    });

    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "profile.schema_invalid",
        "profile.unknown_family",
        "profile.family_mismatch",
        "profile.unknown_provider",
        "profile.duplicate_singleton",
        "profile.disabled_forbidden",
        "profile.unresolved_config_ref",
        "profile.literal_secret",
        "profile.config_invalid",
      ]),
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain("literal-super-secret");
    expect(JSON.stringify(result.diagnostics)).not.toContain("secret:bot-token");
    expect(JSON.stringify(result.diagnostics)).not.toContain("nested-raw-secret");
    expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(
      expect.arrayContaining([
        "spec.config.secret-store-reference.backupToken.0",
        "spec.config.secret-store-reference.password",
      ]),
    );
  });

  it("validates template/provider defaults with the same fail-closed selection rules", () => {
    const result = validateProviderProfileInputs({
      providers: INSTALLED_PROVIDERS,
      profiles: [
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfile",
          metadata: { name: "bad-defaults" },
          spec: {
            defaults: {
              "template.browser-handoff": {
                MadeUpFamily: "channel-cli",
                HumanEntrypoint: "launcher-process",
                CompletionDetector: ["url-watcher", "user-done"],
                SecretStore: null,
              },
            },
          },
        },
      ],
    });

    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "profile.unknown_family",
        "profile.family_mismatch",
        "profile.duplicate_singleton",
        "profile.disabled_forbidden",
      ]),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(
      expect.arrayContaining([
        "spec.defaults.template.browser-handoff.MadeUpFamily",
        "spec.defaults.template.browser-handoff.HumanEntrypoint",
        "spec.defaults.template.browser-handoff.CompletionDetector",
        "spec.defaults.template.browser-handoff.SecretStore",
      ]),
    );
  });

  it("validates template defaults against canonical families and registered provider ids", () => {
    const result = validateProviderProfileInputs({
      providers: INSTALLED_PROVIDERS,
      profiles: [
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfile",
          metadata: { name: "bad-defaults" },
          spec: {
            defaults: {
              "template.browser-handoff": {
                MadeUpFamily: "connector-cdp",
                AgentConnector: "missing-connector",
                HumanEntrypoint: "launcher-process",
                CompletionDetector: ["url-watcher", "user-done"],
                SecretStore: null,
              },
            },
          },
        },
      ],
    });

    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "profile.unknown_family",
        "profile.unknown_provider",
        "profile.family_mismatch",
        "profile.duplicate_singleton",
        "profile.disabled_forbidden",
      ]),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(
      expect.arrayContaining([
        "spec.defaults.template.browser-handoff.MadeUpFamily",
        "spec.defaults.template.browser-handoff.AgentConnector",
        "spec.defaults.template.browser-handoff.HumanEntrypoint",
        "spec.defaults.template.browser-handoff.CompletionDetector",
        "spec.defaults.template.browser-handoff.SecretStore",
      ]),
    );
  });

  it("rejects overlay inheritance cycles and unknown bases", () => {
    const result = validateProviderProfileInputs({
      providers: INSTALLED_PROVIDERS,
      profiles: [
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfile",
          metadata: { name: "base" },
          spec: { extends: "cycle-b" },
        },
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfile",
          metadata: { name: "orphan" },
          spec: { extends: "missing-base" },
        },
      ],
      overlays: [
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfileOverlay",
          metadata: { name: "cycle-a" },
          spec: { extends: "base" },
        },
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfileOverlay",
          metadata: { name: "cycle-b" },
          spec: { extends: "cycle-a" },
        },
      ],
    });

    expect(codes(result)).toEqual(
      expect.arrayContaining(["profile.inheritance_cycle", "profile.extends_unknown"]),
    );
  });

  it("reports profile lifecycle as an operator install/update boot-time contract", () => {
    const result = validateProviderProfileInputs({
      providers: INSTALLED_PROVIDERS,
      profiles: [
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfile",
          metadata: { name: "runtime-editable" },
          spec: {
            lifecycle: { owner: "runtime-agent", apply: "hot", hotReload: true },
          },
        },
      ],
    });

    expect(codes(result)).toContain("profile.lifecycle_invalid");
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toContain(
      "operator",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toContain("boot");
  });
});

describe("TemplatePackage contracts", () => {
  it("accepts CapsuleTemplate catalog packages without a Provider Host runtime factory", () => {
    const result = validateTemplatePackageManifest(validTemplatePackage());

    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it("rejects runtime factories, invalid CapsuleTemplate shape, and incomplete package surfaces", () => {
    const invalidTemplate = structuredClone(BROWSER_HANDOFF_TEMPLATE) as unknown as Record<
      string,
      unknown
    >;
    const invalidSpec = invalidTemplate.spec as Record<string, unknown>;
    invalidSpec.family = "launcher";
    invalidSpec.openParams = undefined;
    const badPackage = validTemplatePackage() as Record<string, unknown>;
    const spec = badPackage.spec as Record<string, unknown>;
    spec.templates = [invalidTemplate];
    spec.runtimeFactory = "@gla/template-runtime";
    spec.schema = undefined;
    spec.defaults = undefined;
    spec.compatibility = undefined;
    spec.docs = [];
    spec.tests = [];

    const result = validateTemplatePackageManifest(badPackage);

    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "template_package.factory_forbidden",
        "template_package.template_invalid",
        "template_package.schema_invalid",
      ]),
    );
  });

  it("rejects Provider Host factory declarations nested inside CapsuleTemplate entries", () => {
    const packageWithNestedFactory = validTemplatePackage() as Record<string, unknown>;
    const spec = packageWithNestedFactory.spec as Record<string, unknown>;
    const templates = spec.templates as Record<string, unknown>[];
    const template = templates[0] as Record<string, unknown>;
    const templateSpec = template.spec as Record<string, unknown>;
    template.runtimeFactory = "@gla/template-runtime";
    templateSpec.providerHostFactory = "@gla/template-provider-host";

    const result = validateTemplatePackageManifest(packageWithNestedFactory);

    expect(codes(result)).toContain("template_package.factory_forbidden");
    expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(
      expect.arrayContaining([
        "spec.templates.0.runtimeFactory",
        "spec.templates.0.spec.providerHostFactory",
      ]),
    );
  });

  it("validates profile and template-package inputs together", () => {
    const result = validateProviderProfileInputs({
      providers: INSTALLED_PROVIDERS,
      profiles: [
        {
          apiVersion: "gla.dev/v1",
          kind: "ProviderProfile",
          metadata: { name: "template-package-check" },
          spec: { select: { Launcher: "launcher-process" } },
        },
      ],
      templatePackages: [validTemplatePackage()],
    });

    expect(result).toEqual({ ok: true, diagnostics: [] });
  });
});
