import { CatalogService, referenceWpmDependencyBindings } from "@gla/catalog";
import type {
  AuthProviderPort,
  IdentityPort,
  IdentityVerificationResult,
  OpaqueToken,
  RecipientBinding,
  RecipientRef,
} from "@gla/kernel";
import { ProviderHost, providerServices } from "@gla/provider-host";
import { describe, expect, it } from "vitest";
import {
  createReferenceProviderHost,
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
      ]),
    );
    expect(host.providerManifest("launcher-process")?.spec.requires?.[0]?.dependency).toBe(
      "browser-runtime",
    );
    expect(host.providerStateSchema("authentik")?.slots).toHaveProperty("attempts");

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
  });

  it("derives catalog store content from the same ProviderHost registrations", () => {
    const host = createReferenceProviderHost();
    const content = referenceProviderStoreContent(host);

    expect(content.providers.map((provider) => provider.metadata.name)).toEqual(host.providerIds());
    expect(content.templates.map((template) => template.metadata.name)).toEqual([
      "browser-handoff",
    ]);
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
});
