import { CatalogService, referenceWpmDependencyBindings } from "@gla/catalog";
import type {
  AuthProviderPort,
  ChannelPort,
  IdentityPort,
  IdentityVerificationResult,
  OpaqueToken,
  RecipientBinding,
  RecipientRef,
  Ref,
  SecretStorePort,
} from "@gla/kernel";
import { type GlaProviderModule, ProviderHost, providerServices } from "@gla/provider-host";
import { describe, expect, it } from "vitest";
import {
  SECRET_STORE_REFERENCE_PROVIDER_ID,
  createReferenceProviderHost,
  createReferenceSecretStoreProvider,
  referenceProviderModules,
  referenceProviderStoreContent,
} from "./index.js";

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
