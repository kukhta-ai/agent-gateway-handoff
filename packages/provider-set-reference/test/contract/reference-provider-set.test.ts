import {
  CatalogService,
  type ProviderManifest,
  providerGraphDoctorReport,
  referenceWpmDependencyBindings,
  resolveProviderGraphProjection,
  toAdmissionCatalog,
  toAdmissionCatalogFromProviderGraphProjection,
  validateProviderProfileInputs,
} from "@gla/catalog";
import type {
  AgentConnectorPort,
  AuthProviderPort,
  ChannelPort,
  CompletionDetectorPort,
  HumanEntrypointPort,
  IdentityPort,
  IdentityVerificationResult,
  LauncherPort,
  OpaqueToken,
  RawCompletionSignal,
  RecipientBinding,
  RecipientRef,
  Ref,
  RuntimeHandle,
  SecretStorePort,
  WorkspaceHandle,
  WorkspacePort,
} from "@gla/kernel";
import {
  type GlaProviderModule,
  ProviderHost,
  type RuntimeProviderFamily,
  providerServices,
} from "@gla/provider-host";
import { describe, expect, it } from "vitest";
import {
  AUTH_AUTHENTIK_PROVIDER_ID,
  AUTH_WEBAUTHN_PROVIDER_ID,
  REFERENCE_PROFILE_HARDENED_IDP_ID,
  REFERENCE_PROFILE_LOCAL_DEV_ID,
  REFERENCE_PROFILE_SCENARIO_01_ID,
  REFERENCE_PROFILE_SINGLE_OPERATOR_ID,
  SECRET_STORE_REFERENCE_PROVIDER_ID,
  createReferenceProviderHost,
  createReferenceSecretStoreProvider,
  referenceProviderModules,
  referenceProviderProfile,
  referenceProviderProfileManifests,
  referenceProviderProfiles,
  referenceProviderRuntimeProfile,
  referenceProviderStoreContent,
  referenceTemplateProviderDefaultsForProfile,
} from "../../src/index.js";

const fakeIdentity: IdentityPort = {
  async bind(recipient: RecipientRef, _ctx: { channel: string }): Promise<RecipientBinding> {
    return {
      recipient,
      userId: `user:${recipient}`,
      provenance: "test",
      authStrength: "webauthn",
    };
  },
  async enroll(_recipient: RecipientRef, _discharge: OpaqueToken) {
    return {
      binding: {
        recipient: _recipient,
        userId: "user:test",
        provenance: "test",
        authStrength: "webauthn",
      },
      authStrength: "webauthn" as const,
    };
  },
  async verify(): Promise<IdentityVerificationResult> {
    return { ok: true, userId: "user:test", authStrength: "webauthn" };
  },
};

interface ContractModuleSpec {
  family: RuntimeProviderFamily;
  id: string;
  kind: string;
  summary: string;
}

const contractModuleSpecs: ContractModuleSpec[] = [
  { family: "auth", id: "auth-contract", kind: "AuthProvider", summary: "contract auth" },
  { family: "launcher", id: "launcher-contract", kind: "Launcher", summary: "contract launcher" },
  {
    family: "entrypoint",
    id: "entrypoint-contract",
    kind: "HumanEntrypoint",
    summary: "contract entrypoint",
  },
  {
    family: "connector",
    id: "connector-contract",
    kind: "AgentConnector",
    summary: "contract connector",
  },
  {
    family: "workspace",
    id: "workspace-contract",
    kind: "Workspace",
    summary: "contract workspace",
  },
  {
    family: "detector",
    id: "detector-contract",
    kind: "CompletionDetector",
    summary: "contract detector",
  },
  {
    family: "channel",
    id: "channel-contract",
    kind: "ChannelAdapter",
    summary: "contract channel",
  },
  {
    family: "secret-store",
    id: "secret-store-contract",
    kind: "SecretStore",
    summary: "contract secret store",
  },
];

function contractManifest(spec: ContractModuleSpec): ProviderManifest {
  const manifest: ProviderManifest = {
    apiVersion: "gla.dev/v1",
    kind: spec.kind,
    metadata: { name: spec.id, version: "0.1.0" },
    spec: {
      family: spec.family,
      capability: { summary: spec.summary },
      config_schema: { mode: { type: "enum", enum: ["ok"], required: true } },
      probe: spec.id,
      skills: [
        {
          id: `use-${spec.id}`,
          for: spec.id,
          body: `# use-${spec.id}\n\nUse the ${spec.id} provider through Provider Host.`,
        },
      ],
    },
  };
  if (spec.family === "launcher") {
    manifest.spec.capability = {
      ...manifest.spec.capability,
      mounts: { host_paths: ["file"], modes: ["ro"] },
    };
    manifest.spec.relations = {
      compatibleWith: { entrypoints: ["entrypoint-contract"], connectors: ["connector-contract"] },
    };
  }
  if (spec.family === "entrypoint" || spec.family === "connector" || spec.family === "detector") {
    manifest.spec.relations = { compatibleWith: { templates: ["browser-handoff"] } };
  }
  return manifest;
}

function contractModule(spec: ContractModuleSpec): GlaProviderModule {
  return {
    manifest: contractManifest(spec),
    register(ctx) {
      switch (spec.family) {
        case "auth": {
          const auth: AuthProviderPort = {
            async beginEnrollment() {
              return { provider: spec.id };
            },
            async finishEnrollment() {
              return { credentialId: "credential:contract", authStrength: "webauthn" };
            },
            async challenge() {
              return { provider: spec.id };
            },
            async verifyAssertion() {
              return { ok: true, authStrength: "webauthn" };
            },
          };
          ctx.registerAuthProvider(spec.id, { create: () => auth });
          break;
        }
        case "launcher": {
          const launcher: LauncherPort = {
            tier: "none",
            mountCapability: { file: true, directory: false, modes: ["ro"] },
            async spawn(): Promise<RuntimeHandle> {
              return "runtime:contract" as RuntimeHandle;
            },
            async health() {
              return "up";
            },
            async stop() {},
          };
          ctx.registerLauncher(spec.id, { create: () => launcher });
          break;
        }
        case "entrypoint": {
          const entrypoint: HumanEntrypointPort = {
            async open() {
              return {
                resourceId: "entrypoint:contract",
                provider: spec.id,
                client: { kind: "contract-client" },
                transport: {
                  kind: "reverse-proxy",
                  protocol: "websocket",
                  upstream: "ws://127.0.0.1:1",
                },
              };
            },
          };
          ctx.registerHumanEntrypoint(spec.id, { create: () => entrypoint });
          break;
        }
        case "connector": {
          const connector: AgentConnectorPort = {
            async attach() {
              return {
                type: "contract-connector",
                resourceId: "connector:contract",
                provider: spec.id,
              };
            },
          };
          ctx.registerAgentConnector(spec.id, { create: () => connector });
          break;
        }
        case "workspace": {
          const workspace: WorkspacePort = {
            async realize(): Promise<WorkspaceHandle> {
              return "workspace:contract" as WorkspaceHandle;
            },
            async reap() {},
          };
          ctx.registerWorkspace(spec.id, { create: () => workspace });
          break;
        }
        case "detector": {
          const detector: CompletionDetectorPort = {
            contract: {
              status: { type: "enum", enum: ["contract-complete"], required: true },
            },
            async *watch(): AsyncIterable<RawCompletionSignal> {
              yield {
                detector: spec.id,
                status: "contract-complete",
                at: new Date(0).toISOString() as never,
              };
            },
          };
          ctx.registerCompletionDetector(spec.id, { create: () => detector });
          break;
        }
        case "channel": {
          const channel: ChannelPort = {
            async deliver() {},
            async *receive() {},
          };
          ctx.registerChannel(spec.id, { create: () => channel });
          break;
        }
        case "secret-store": {
          const secretStore: SecretStorePort = {
            async put() {
              return "secret:contract/ref" as Ref<"secret-ref">;
            },
            async injectInto() {},
          };
          ctx.registerSecretStore(spec.id, { create: () => secretStore });
          ctx.registerStateSchema(spec.id, {
            slots: { refs: { sensitive: true, summary: "contract secret refs" } },
          });
          break;
        }
      }
      ctx.registerProbe(spec.id, () => "available");
    },
  };
}

describe("referenceProviderModules", () => {
  it("loads today's reference providers through ProviderHost without app-maintained provider tables", async () => {
    const host = new ProviderHost().registerModules(referenceProviderModules);

    expect(host.providerIds()).toEqual(
      expect.arrayContaining([
        "webauthn",
        "authentik",
        "launcher-process",
        "entrypoint-novnc",
        "connector-cdp",
        "workspace-profile",
        "url-watcher",
        "user-done",
        "channel-cli",
        "secret-store-reference",
      ]),
    );
    expect(host.providerManifest("launcher-process")?.spec.requires?.[0]?.dependency).toBe(
      "browser-runtime",
    );
    expect(host.providerStateSchema("authentik")?.slots).toHaveProperty("attempts");
    expect(host.providerStateSchema(SECRET_STORE_REFERENCE_PROVIDER_ID)?.slots).toMatchObject({
      refs: { sensitive: true },
    });

    const auth = await host.createProvider("auth", "webauthn", {
      config: {
        rpID: "localhost",
        expectedOrigin: ["http://localhost:3000", "https://gla.example"],
      },
    });
    expect(auth).toHaveProperty("beginEnrollment");
    expect<AuthProviderPort>(auth).toBe(auth);

    const channel = await host.createProvider("channel", "channel-cli", {
      services: providerServices({ identity: fakeIdentity }),
    });
    expect(channel).toHaveProperty("deliver");

    const secretStore = await host.createProvider(
      "secret-store",
      SECRET_STORE_REFERENCE_PROVIDER_ID,
    );
    const ref = await secretStore.put("raw-secret-canary", "test-audience");
    expect(ref).toMatch(/^secret:gla\/reference\//);
    expect(JSON.stringify(host.diagnostics())).not.toContain("raw-secret-canary");
  });

  it("derives catalog store content from the same ProviderHost registrations", () => {
    const host = createReferenceProviderHost();
    const content = referenceProviderStoreContent(host);

    expect(content.providers.map((provider) => provider.metadata.name)).toEqual(host.providerIds());
    expect(content.templates.map((template) => template.metadata.name)).toEqual([
      "browser-handoff",
    ]);
  });

  it("exposes provider-neutral auth assurance capability through reference graph read models", () => {
    const host = createReferenceProviderHost();
    const content = referenceProviderStoreContent(host);
    const webauthnManifest = content.providers.find(
      (provider) => provider.metadata.name === AUTH_WEBAUTHN_PROVIDER_ID,
    );
    const authentikManifest = content.providers.find(
      (provider) => provider.metadata.name === AUTH_AUTHENTIK_PROVIDER_ID,
    );

    expect(webauthnManifest?.spec.capability).toMatchObject({
      authAssurance: {
        supportedPolicies: ["phishing-resistant", "password-permitted"],
        maxLevel: "phishing-resistant",
        requiredEvidence: ["userVerified", "recipientBound", "replayResistant"],
        degradesTo: "none",
      },
    });
    expect(authentikManifest?.spec.capability).toMatchObject({
      authAssurance: {
        supportedPolicies: ["phishing-resistant", "password-permitted"],
        maxLevel: "phishing-resistant",
        requiredEvidence: ["userVerified", "recipientBound", "replayResistant"],
        degradesTo: "password",
        diagnostics: expect.arrayContaining([
          "missing-user-verification",
          "method-unresolved",
          "ambiguous-provider-evidence",
          "password-grade-proof",
        ]),
      },
    });

    const graph = resolveProviderGraphProjection({
      providerSet: {
        id: "@gla/provider-set-reference",
        providers: content.providers,
        templates: content.templates,
      },
      baseProfile: referenceProviderProfile(REFERENCE_PROFILE_SINGLE_OPERATOR_ID).manifest,
      dependencyBindings: referenceWpmDependencyBindings(),
      configValidationMode: "factory",
    });
    const catalog = new CatalogService({
      content,
      dependencyBindings: referenceWpmDependencyBindings(),
      providerGraph: graph,
    });

    expect(catalog.show(AUTH_WEBAUTHN_PROVIDER_ID)?.authAssurance).toMatchObject({
      maxLevel: "phishing-resistant",
      requiredEvidence: ["userVerified", "recipientBound", "replayResistant"],
    });
    expect(
      toAdmissionCatalogFromProviderGraphProjection(graph).provider(AUTH_WEBAUTHN_PROVIDER_ID)
        ?.authAssurance,
    ).toMatchObject({
      supportedPolicies: ["phishing-resistant", "password-permitted"],
    });
    expect(
      providerGraphDoctorReport(graph).providers.find(
        (provider) => provider.providerId === AUTH_WEBAUTHN_PROVIDER_ID,
      )?.authAssurance,
    ).toMatchObject({
      maxLevel: "phishing-resistant",
      degradesTo: "none",
    });
  });

  it("exposes named reference profiles with explicit posture selections and template defaults", () => {
    const host = createReferenceProviderHost();
    const content = referenceProviderStoreContent(host);

    expect(referenceProviderProfiles.map((profile) => profile.id)).toEqual([
      REFERENCE_PROFILE_LOCAL_DEV_ID,
      REFERENCE_PROFILE_SINGLE_OPERATOR_ID,
      REFERENCE_PROFILE_SCENARIO_01_ID,
      REFERENCE_PROFILE_HARDENED_IDP_ID,
    ]);
    expect(referenceProviderProfiles.map((profile) => profile.purpose).join("\n")).toContain(
      "Scenario-01",
    );
    expect(
      validateProviderProfileInputs({
        profiles: referenceProviderProfileManifests,
        providers: content.providers,
      }),
    ).toEqual({ ok: true, diagnostics: [] });

    expect(referenceProviderRuntimeProfile(REFERENCE_PROFILE_LOCAL_DEV_ID)).toMatchObject({
      auth: "webauthn",
      detector: "user-done",
      channel: "channel-cli",
    });
    expect(referenceProviderRuntimeProfile(REFERENCE_PROFILE_SCENARIO_01_ID)).toMatchObject({
      auth: "webauthn",
      detector: "url-watcher",
    });
    expect(referenceProviderRuntimeProfile(REFERENCE_PROFILE_HARDENED_IDP_ID)).toMatchObject({
      auth: "authentik",
      detector: "url-watcher",
    });
    expect(
      referenceTemplateProviderDefaultsForProfile(REFERENCE_PROFILE_LOCAL_DEV_ID),
    ).toMatchObject({
      detector: "user-done",
    });
  });

  it("validates named reference profiles through the provider graph with profile-specific diagnostics", () => {
    const host = createReferenceProviderHost();
    const dependencyBindings = referenceWpmDependencyBindings();

    for (const profileId of [
      REFERENCE_PROFILE_LOCAL_DEV_ID,
      REFERENCE_PROFILE_SINGLE_OPERATOR_ID,
      REFERENCE_PROFILE_SCENARIO_01_ID,
    ]) {
      const content = referenceProviderStoreContent(
        host,
        referenceTemplateProviderDefaultsForProfile(profileId),
      );
      const graph = resolveProviderGraphProjection({
        providerSet: {
          id: "@gla/provider-set-reference",
          providers: content.providers,
          templates: content.templates,
        },
        baseProfile: referenceProviderProfile(profileId).manifest,
        dependencyBindings,
        configValidationMode: "factory",
      });

      expect(graph.ok).toBe(true);
      expect(providerGraphDoctorReport(graph)).toMatchObject({
        status: "PASS",
        profileId,
        selectedProviders: expect.objectContaining({
          AuthProvider: "webauthn",
          ChannelAdapter: "channel-cli",
        }),
      });
    }

    const hardenedContent = referenceProviderStoreContent(
      host,
      referenceTemplateProviderDefaultsForProfile(REFERENCE_PROFILE_HARDENED_IDP_ID),
    );
    const hardened = resolveProviderGraphProjection({
      providerSet: {
        id: "@gla/provider-set-reference",
        providers: hardenedContent.providers,
        templates: hardenedContent.templates,
      },
      baseProfile: referenceProviderProfile(REFERENCE_PROFILE_HARDENED_IDP_ID).manifest,
      dependencyBindings,
      configValidationMode: "factory",
    });

    expect(hardened.ok).toBe(false);
    expect(hardened.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "graph.config_invalid",
          providerId: "authentik",
        }),
      ]),
    );
    expect(providerGraphDoctorReport(hardened)).toMatchObject({
      status: "FAIL",
      profileId: REFERENCE_PROFILE_HARDENED_IDP_ID,
      selectedProviders: expect.objectContaining({ AuthProvider: "authentik" }),
    });
  });

  it("applies operator-selected template defaults without embedding compatibility tables in the provider set", () => {
    const host = createReferenceProviderHost();
    const content = referenceProviderStoreContent(host, {
      connector: "connector-cdp",
      detector: "user-done",
    });
    const template = content.templates[0];

    expect(template?.spec.requiredParts).toMatchObject({
      connector: "connector-cdp",
      detector: "user-done",
    });
    expect(template?.spec.compatibleProviders).toBeUndefined();
    const catalog = new CatalogService({
      content,
      dependencyBindings: referenceWpmDependencyBindings(),
    });
    expect(catalog.templateShow("browser-handoff").compatibleProviders).toMatchObject({
      connector: expect.arrayContaining(["connector-cdp"]),
      detector: expect.arrayContaining(["url-watcher", "user-done"]),
    });
  });

  it("accepts fake providers in every migrated family through one Provider Host contract", async () => {
    const host = new ProviderHost().registerModules(contractModuleSpecs.map(contractModule));
    const content = referenceProviderStoreContent(host);
    const catalog = new CatalogService({ content });
    const admissionCatalog = toAdmissionCatalog(catalog, content);

    for (const spec of contractModuleSpecs) {
      const manifest = host.providerManifest(spec.id);
      expect(manifest).toMatchObject({
        kind: spec.kind,
        metadata: { name: spec.id, version: "0.1.0" },
        spec: {
          family: spec.family,
          config_schema: { mode: { enum: ["ok"], required: true } },
          probe: spec.id,
          skills: [{ id: `use-${spec.id}`, for: spec.id }],
        },
      });
      expect(host.providerIds(spec.family)).toContain(spec.id);
      expect(catalog.show(spec.id)).toMatchObject({
        name: spec.id,
        kind: spec.kind,
        family: spec.family,
        availability: "available",
      });
      expect(catalog.skillShow(`use-${spec.id}`)).toMatchObject({
        id: `use-${spec.id}`,
        for: spec.id,
      });
      expect(admissionCatalog.provider(spec.id)?.config_schema).toEqual({
        mode: { type: "enum", enum: ["ok"], required: true },
      });

      await expect(
        host.createProvider(spec.family, spec.id, { config: { mode: "ok" } }),
      ).resolves.toBeDefined();
      await expect(
        host.createProvider(spec.family, spec.id, { config: { mode: "bad" } }),
      ).rejects.toMatchObject({ code: "policy.denied" });
    }

    expect(catalog.templateShow("browser-handoff").compatibleProviders).toMatchObject({
      entrypoint: expect.arrayContaining(["entrypoint-contract"]),
      connector: expect.arrayContaining(["connector-contract"]),
      detector: expect.arrayContaining(["detector-contract"]),
    });
    expect(host.providerStateSchema("secret-store-contract")?.slots).toMatchObject({
      refs: { sensitive: true },
    });
  });

  it("keeps reference provider package manifests coherent with factories, probes, skills, dependencies, and relations", () => {
    const host = createReferenceProviderHost();
    const content = referenceProviderStoreContent(host);
    const catalog = new CatalogService({
      content,
      dependencyBindings: referenceWpmDependencyBindings(),
    });
    const admissionCatalog = toAdmissionCatalog(catalog, content);

    for (const manifest of content.providers) {
      const providerId = manifest.metadata.name;
      const family = manifest.spec.family as RuntimeProviderFamily;
      expect(host.providerManifest(providerId)).toMatchObject({
        metadata: { name: providerId, version: manifest.metadata.version },
        spec: { family, probe: manifest.spec.probe },
      });
      expect(host.providerIds(family)).toContain(providerId);
      expect(catalog.show(providerId)).toMatchObject({
        name: providerId,
        family,
        availability: expect.stringMatching(/available|degraded|unavailable/),
      });

      if (manifest.spec.config_schema !== undefined) {
        expect(admissionCatalog.provider(providerId)?.config_schema).toEqual(
          manifest.spec.config_schema,
        );
      }
      for (const requirement of manifest.spec.requires ?? []) {
        expect(catalog.show(providerId)?.requires.map((binding) => binding.dependency)).toContain(
          requirement.dependency,
        );
      }
      for (const skill of manifest.spec.skills ?? []) {
        expect(catalog.skillShow(skill.id)).toMatchObject({ id: skill.id, for: skill.for });
        expect(catalog.skillShow(skill.id).body).toContain(skill.id);
      }
      for (const targets of Object.values(manifest.spec.relations?.compatibleWith ?? {})) {
        expect(targets.length).toBeGreaterThan(0);
      }
    }

    expect(catalog.templateShow("browser-handoff").compatibleProviders).toMatchObject({
      entrypoint: expect.arrayContaining(["entrypoint-novnc"]),
      connector: expect.arrayContaining(["connector-cdp"]),
      detector: expect.arrayContaining(["url-watcher", "user-done"]),
    });
  });

  it("keeps host-touching reference providers unavailable without WPM dependency evidence", async () => {
    const host = new ProviderHost().registerModules(referenceProviderModules);

    await expect(
      host.createProvider("launcher", "launcher-process", {
        config: { headless: true },
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

  it("creates launcher and workspace ports from provider-owned schemas and catalog dependency evidence", async () => {
    const host = createReferenceProviderHost();
    const content = referenceProviderStoreContent(host);
    const catalog = new CatalogService({
      content,
      dependencyBindings: referenceWpmDependencyBindings(),
    });

    expect(host.providerManifest("launcher-process")?.spec.config_schema).toMatchObject({
      mode: { type: "enum", enum: ["auto", "headless", "full"] },
      chromiumPath: { type: "string" },
      startTimeoutMs: { type: "number" },
    });
    expect(host.providerManifest("workspace-profile")?.spec.config_schema).toMatchObject({
      root: { type: "string" },
    });

    const launcherDependencyEvidence = catalog.show("launcher-process")?.requires;
    expect(launcherDependencyEvidence).toBeDefined();

    const launcher = await host.createProvider("launcher", "launcher-process", {
      config: { mode: "headless", startTimeoutMs: 40_000 },
      dependencyBindings: launcherDependencyEvidence ?? [],
    });
    expect(launcher.tier).toBe("local-process");
    expect(launcher.mountCapability).toMatchObject({
      file: true,
      directory: true,
      modes: ["ro", "rw"],
    });

    const workspace = await host.createProvider("workspace", "workspace-profile", {
      config: { root: "/tmp/gla-provider-host-workspaces" },
    });
    expect(workspace).toHaveProperty("realize");
    expect(workspace).toHaveProperty("reap");
  });

  it("keeps the WebAuthn Provider Host config compatible with multiple expected origins", async () => {
    const host = createReferenceProviderHost();

    await expect(
      host.createProvider("auth", "webauthn", {
        config: {
          rpID: "localhost",
          expectedOrigin: ["http://localhost:3000", "https://gla.example"],
        },
      }),
    ).resolves.toHaveProperty("verifyAssertion");
  });

  it("does not leak authentik client secrets through config diagnostics", async () => {
    const host = new ProviderHost().registerModules(referenceProviderModules);

    await expect(
      host.createProvider("auth", "authentik", {
        config: {
          issuerUrl: "https://idp.example/application/o/gla/",
          clientId: "gla",
          clientSecret: "top-secret-client-secret",
          unexpected: "bad",
        },
      }),
    ).rejects.toMatchObject({ code: "policy.denied" });
    expect(JSON.stringify(host.diagnostics())).not.toContain("top-secret-client-secret");
  });

  it("surfaces channel config schema and redacts channel secret-shaped config diagnostics", async () => {
    const host = createReferenceProviderHost();

    expect(host.providerManifest("channel-cli")?.spec.config_schema).toMatchObject({
      delivery: { type: "enum", enum: ["stdout", "injected"] },
      inbound: { type: "enum", enum: ["memory", "injected"] },
    });
    expect(() =>
      host.createProviderSync("channel", "channel-cli", {
        config: { botToken: "raw-channel-secret-canary" },
        services: providerServices({ identity: fakeIdentity }),
      }),
    ).toThrow(/config/i);
    expect(JSON.stringify(host.diagnostics())).not.toContain("raw-channel-secret-canary");
  });

  it("honors channel-cli injected config modes fail-closed", () => {
    const host = createReferenceProviderHost();

    expect(() =>
      host.createProviderSync("channel", "channel-cli", {
        config: { delivery: "injected" },
        services: providerServices({ identity: fakeIdentity }),
      }),
    ).toThrow(/channel\.sink/);
    expect(() =>
      host.createProviderSync("channel", "channel-cli", {
        config: { inbound: "injected" },
        services: providerServices({ identity: fakeIdentity }),
      }),
    ).toThrow(/channel\.source/);
    expect(() =>
      host.createProviderSync("channel", "channel-cli", {
        config: { delivery: "injected", inbound: "injected" },
        services: providerServices({
          identity: fakeIdentity,
          "channel.sink": { write: () => {} },
          "channel.source": { next: async () => undefined },
        }),
      }),
    ).not.toThrow();
  });

  it("creates the reference SecretStore with secret-ref-only external behavior", async () => {
    const injected: Array<{ ref: Ref<"secret-ref">; value: unknown }> = [];
    const { provider: secretStore } = createReferenceSecretStoreProvider({
      config: { namespace: "tests" },
    });

    const ref = await secretStore.put("literal-secret-never-diagnostic", "recipient-step");
    expect(ref).toMatch(/^secret:gla\/tests\//);
    await secretStore.injectInto(ref, {
      injectSecret: (secretRef: Ref<"secret-ref">, value: unknown) =>
        void injected.push({ ref: secretRef, value }),
    });

    expect(injected).toEqual([{ ref, value: "literal-secret-never-diagnostic" }]);
    expect(JSON.stringify({ ref })).not.toContain("literal-secret-never-diagnostic");
  });

  it("catalog content carries the SecretStore manifest without literal secret values", () => {
    const content = referenceProviderStoreContent(createReferenceProviderHost());
    const secretStore = content.providers.find(
      (provider) => provider.metadata.name === SECRET_STORE_REFERENCE_PROVIDER_ID,
    );

    expect(secretStore).toMatchObject({
      kind: "SecretStore",
      spec: {
        family: "secret-store",
        config_schema: { namespace: { type: "string" } },
        probe: "secret-store-reference",
      },
    });
    expect(JSON.stringify(secretStore)).not.toContain("literal-secret");
  });

  it("accepts fake channel and SecretStore providers through the same host registration path", async () => {
    const delivered: Array<{ recipient: RecipientRef; link: string }> = [];
    const fakeChannel: ChannelPort = {
      async deliver(recipient, link) {
        delivered.push({ recipient, link });
      },
      async *receive() {},
    };
    const fakeSecretStore: SecretStorePort = {
      async put() {
        return "secret:fake/ref-1" as Ref<"secret-ref">;
      },
      async injectInto() {},
    };
    const modules: GlaProviderModule[] = [
      {
        manifest: {
          apiVersion: "gla.dev/v1",
          kind: "ChannelAdapter",
          metadata: { name: "channel-fake", version: "0.1.0" },
          spec: {
            family: "channel",
            capability: { summary: "fake channel" },
            config_schema: { mode: { type: "enum", enum: ["record"], required: false } },
            probe: "channel-fake",
          },
        },
        register(ctx) {
          ctx.registerChannel("channel-fake", { create: () => fakeChannel });
          ctx.registerProbe("channel-fake", () => "available");
        },
      },
      {
        manifest: {
          apiVersion: "gla.dev/v1",
          kind: "SecretStore",
          metadata: { name: "secret-store-fake", version: "0.1.0" },
          spec: {
            family: "secret-store",
            capability: { summary: "fake secret store", diagnostics: "secret-ref-only" },
            config_schema: { namespace: { type: "string", required: false } },
            probe: "secret-store-fake",
          },
        },
        register(ctx) {
          ctx.registerSecretStore("secret-store-fake", { create: () => fakeSecretStore });
          ctx.registerProbe("secret-store-fake", () => "available");
          ctx.registerStateSchema("secret-store-fake", {
            slots: { refs: { sensitive: true, summary: "fake secret refs" } },
          });
        },
      },
    ];
    const host = new ProviderHost().registerModules(modules);

    const channel = host.createProviderSync("channel", "channel-fake", {
      config: { mode: "record" },
      services: providerServices({ identity: fakeIdentity }),
    });
    await channel.deliver(
      "tg:user:fake" as RecipientRef,
      "https://gla.example/handoff",
      "cap_1" as OpaqueToken,
    );
    const secretStore = host.createProviderSync("secret-store", "secret-store-fake", {
      config: { namespace: "tests" },
    });

    expect(delivered).toEqual([{ recipient: "tg:user:fake", link: "https://gla.example/handoff" }]);
    await expect(secretStore.put("raw-fake-secret", "audience")).resolves.toBe("secret:fake/ref-1");
    expect(host.providerStateSchema("secret-store-fake")?.slots).toMatchObject({
      refs: { sensitive: true },
    });
  });
});
