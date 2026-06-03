// Wiring test for the AUTH-PROVIDER SELECTION at the composition root (packages/app), GLA-068 AC#1/#6.
// Proves: (a) the DEFAULT (provider unset / "webauthn") wires the in-tree WebAuthn adapter — the existing
// path is unchanged; (b) opting into "authentik" flips ONLY the adapter the composition constructs (the
// wiring record names @gla/auth-authentik) while everything downstream (the IdentityService injection, the
// gateway, the route) is identical because both adapters satisfy the SAME kernel AuthProviderPort; (c) the
// daemon's parseServeArgs threads GLA_AUTH_PROVIDER + the GLA_AUTHENTIK_* OIDC config; (d) the structural
// boundary claim — selecting authentik touches only the adapter + app, never the gateway/kernel (enforced by
// the import-boundary lint + the package graph, asserted here by checking neither core package declares an
// auth adapter dependency).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AUTH_AUTHENTIK_MODULE } from "@gla/auth-authentik";
import { AUTH_WEBAUTHN_MODULE } from "@gla/auth-webauthn";
import { describe, expect, it } from "vitest";
import { parseServeArgs } from "./daemon.js";
import { type AuthentikConfig, createEnrollmentStack, createProvisioningBridge } from "./index.js";

const AUTHENTIK: AuthentikConfig = {
  issuerUrl: "https://idp.example/application/o/gla/",
  clientId: "gla-client",
  clientSecret: "super-secret",
  redirectUri: "https://gla.example/auth/callback",
};

const ENROLL_BASE = {
  expectedOrigin: "http://localhost:3000",
  publicBaseUrl: "http://localhost:3000",
  host: "127.0.0.1",
  port: 0,
  deliverySink: { write: () => {} },
};

describe("AC#6 · the DEFAULT provider is the in-tree WebAuthn adapter (path unchanged)", () => {
  it("createEnrollmentStack() with no authProvider wires @gla/auth-webauthn", () => {
    const stack = createEnrollmentStack({ ...ENROLL_BASE });
    expect(stack.authModule).toBe(AUTH_WEBAUTHN_MODULE);
    // The provider satisfies the port and is the in-tree default (enrolled-vs-not observable, no OIDC config used).
    expect(stack.identity.isEnrolled("tg:user:1" as never)).toBe(false);
  });

  it('createEnrollmentStack({ authProvider: "webauthn" }) is identical to the default (explicit == implicit)', () => {
    const a = createEnrollmentStack({ ...ENROLL_BASE });
    const b = createEnrollmentStack({ ...ENROLL_BASE, authProvider: "webauthn" });
    expect(a.authModule).toBe(b.authModule);
    expect(b.authModule).toBe(AUTH_WEBAUTHN_MODULE);
  });

  it("createProvisioningBridge() handoff with no authProvider records the WebAuthn module", () => {
    const stack = createProvisioningBridge({
      launcherMode: "headless",
      handoff: { ...ENROLL_BASE },
    });
    expect(stack.authModule).toBe(AUTH_WEBAUTHN_MODULE);
  });

  it("createApp().wiring.auth (the static default profile) still names @gla/auth-webauthn", async () => {
    const { createApp } = await import("./index.js");
    expect(createApp().wiring.auth).toBe(AUTH_WEBAUTHN_MODULE);
  });
});

describe("AC#1/#6 · opting into authentik flips ONLY the adapter the composition constructs", () => {
  it('createEnrollmentStack({ authProvider: "authentik", authentik }) wires @gla/auth-authentik', () => {
    const stack = createEnrollmentStack({
      ...ENROLL_BASE,
      authProvider: "authentik",
      authentik: AUTHENTIK,
    });
    expect(stack.authModule).toBe(AUTH_AUTHENTIK_MODULE);
    // Downstream is identical: the IdentityService is the same service wired against the SAME port — an
    // un-enrolled recipient is still un-enrolled, and authenticationOptions still denies it (port contract).
    expect(stack.identity.isEnrolled("tg:user:1" as never)).toBe(false);
  });

  it("createProvisioningBridge() handoff with authProvider=authentik records the authentik module", () => {
    const stack = createProvisioningBridge({
      launcherMode: "headless",
      handoff: { ...ENROLL_BASE, authProvider: "authentik", authentik: AUTHENTIK },
    });
    expect(stack.authModule).toBe(AUTH_AUTHENTIK_MODULE);
    // The gateway/route/identity are still wired (the swap is one `new …`, nothing downstream changes).
    expect(stack.gateway).toBeDefined();
    expect(stack.route).toBeDefined();
    expect(stack.identity).toBeDefined();
  });

  it("selecting authentik WITHOUT its OIDC config fails loud (no silent fallback to the default)", () => {
    expect(() => createEnrollmentStack({ ...ENROLL_BASE, authProvider: "authentik" })).toThrow(
      /authentik.*requires|issuer|client/i,
    );
  });
});

describe("AC#6 · daemon parseServeArgs threads the provider switch + the authentik OIDC config", () => {
  it("parses --auth-provider + the --authentik-* flags", () => {
    const parsed = parseServeArgs(
      [
        "--auth-provider",
        "authentik",
        "--authentik-issuer-url",
        "https://idp.example/application/o/gla/",
        "--authentik-client-id",
        "gla-client",
        "--authentik-client-secret",
        "shh",
        "--authentik-redirect-uri",
        "https://gla.example/auth/callback",
        "--authentik-scopes",
        "openid profile email",
      ],
      {} as NodeJS.ProcessEnv,
    );
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.authProvider).toBe("authentik");
      expect(parsed.options.authentikIssuerUrl).toBe("https://idp.example/application/o/gla/");
      expect(parsed.options.authentikClientId).toBe("gla-client");
      expect(parsed.options.authentikClientSecret).toBe("shh");
      expect(parsed.options.authentikRedirectUri).toBe("https://gla.example/auth/callback");
      expect(parsed.options.authentikScopes).toBe("openid profile email");
    }
  });

  it("falls back to env (GLA_AUTH_PROVIDER / GLA_AUTHENTIK_*); a flag overrides env", () => {
    const env = {
      GLA_AUTH_PROVIDER: "authentik",
      GLA_AUTHENTIK_ISSUER_URL: "https://from-env/application/o/gla/",
      GLA_AUTHENTIK_CLIENT_ID: "from-env",
      GLA_AUTHENTIK_CLIENT_SECRET: "env-secret",
      GLA_AUTHENTIK_REDIRECT_URI: "https://gla.example/auth/callback",
    } as NodeJS.ProcessEnv;
    const parsed = parseServeArgs(["--authentik-client-id", "from-flag"], env);
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.authProvider).toBe("authentik"); // from env
      expect(parsed.options.authentikIssuerUrl).toBe("https://from-env/application/o/gla/"); // from env
      expect(parsed.options.authentikClientId).toBe("from-flag"); // flag wins
    }
  });

  it("an invalid --auth-provider throws a stable error", () => {
    expect(() => parseServeArgs(["--auth-provider", "ldap"], {} as NodeJS.ProcessEnv)).toThrow(
      /auth-provider/i,
    );
  });

  it("the default (no GLA_AUTH_PROVIDER) leaves authProvider unset — the default boot path is untouched", () => {
    const parsed = parseServeArgs([], {} as NodeJS.ProcessEnv);
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.authProvider).toBeUndefined();
    }
  });
});

describe("AC#1 · structural: selecting authentik changes only the adapter + app (no gateway/kernel edit)", () => {
  /** Read a package.json's dependency names (relative to this test file's compiled location). */
  function deps(relFromRepoRoot: string): string[] {
    const here = fileURLToPath(import.meta.url);
    // .../packages/app/dist/auth-provider-selection.test.js (or src/ under vitest) → repo root is 3 up from packages/app.
    const repoRoot = here.replace(/\/packages\/app\/(dist|src)\/.*$/, "");
    const pkg = JSON.parse(readFileSync(`${repoRoot}/${relFromRepoRoot}`, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  }

  it("the gateway package declares NO auth adapter dependency (it depends only on the kernel port)", () => {
    const gatewayDeps = deps("packages/gateway/package.json");
    expect(gatewayDeps).not.toContain("@gla/auth-authentik");
    expect(gatewayDeps).not.toContain("@gla/auth-webauthn");
  });

  it("the kernel package declares NO auth adapter dependency (the port names no concrete provider)", () => {
    const kernelDeps = deps("packages/kernel/package.json");
    expect(kernelDeps).not.toContain("@gla/auth-authentik");
    expect(kernelDeps).not.toContain("@gla/auth-webauthn");
  });

  it("the identity (core-adjacent) package declares NO auth adapter dependency (it depends on the port)", () => {
    const identityDeps = deps("packages/identity/package.json");
    expect(identityDeps).not.toContain("@gla/auth-authentik");
    expect(identityDeps).not.toContain("@gla/auth-webauthn");
  });

  it("ONLY packages/app declares the authentik adapter dependency (the single adapter-importing package)", () => {
    const appDeps = deps("packages/app/package.json");
    expect(appDeps).toContain("@gla/auth-authentik");
    expect(appDeps).toContain("@gla/auth-webauthn");
  });
});
