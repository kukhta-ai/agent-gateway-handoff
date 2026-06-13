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
import { referenceWpmDependencyBindings } from "@gla/catalog";
import { describe, expect, it } from "vitest";
import {
  authEnrollmentDiagnostics,
  parseAuthDeploymentRolesJson,
  parseAuthEnrollmentPolicyJson,
} from "./auth-enrollment-policy.js";
import { authAssuranceProviderDiagnostic, parseServeArgs } from "./daemon.js";
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

const AUTHENTIK_ENROLLMENT_POLICY_JSON = JSON.stringify({
  provider: "authentik",
  declared: true,
  enrollmentFlow: "gla-invitation-enrollment",
  authenticationFlow: "gla-login-passkey-or-password",
  invitationStage: "gla-invitation-stage",
  userWriteStage: "gla-user-write-stage",
  userLoginStage: "gla-user-login-stage",
  credentialSetupStages: [
    {
      method: "password",
      stage: "gla-password-prompt",
      label: "recipient-owned password",
      authStrength: "password",
      assuranceLevel: "password",
      required: false,
      choiceGroup: "primary-credential",
      providerEvidence: { amr: ["pwd"] },
    },
    {
      method: "webauthn-passkey",
      stage: "gla-webauthn-setup",
      label: "recipient-owned passkey",
      authStrength: "webauthn",
      assuranceLevel: "phishing-resistant",
      required: false,
      choiceGroup: "primary-credential",
      providerEvidence: { amr: ["swk"] },
    },
  ],
  externalSources: [
    {
      kind: "oauth",
      name: "github",
      source: "github-oauth",
      choiceGroup: "primary-credential",
      assuranceLevel: "password",
      providerEvidence: { source: "github-oauth" },
    },
  ],
  mfaRecoveryMethods: [
    {
      method: "totp",
      stage: "gla-totp-setup",
      purpose: "mfa",
      required: false,
      providerEvidence: { amr: ["otp"] },
    },
  ],
  requiredMethods: [],
  optionalRecipientChoices: [
    {
      id: "primary-credential",
      choices: ["password", "webauthn-passkey", "oauth:github"],
      required: true,
    },
  ],
  notes: ["WPM verified invitation flow exposes password, passkey, and OAuth source choices."],
});

const AUTHENTIK_EDGE_GUARD_ROLES_JSON = JSON.stringify([
  {
    role: "authentik-forward-auth",
    provider: "authentik",
    mode: "forward-auth",
    label: "authentik outpost in front of GLA",
    optional: true,
    publicSurface: "https://gla.example/team-a/",
    providerEvidence: { outpost: "embedded", access_token: "EDGE_TOKEN_CANARY_087" },
  },
  {
    role: "future-zero-trust-edge",
    provider: "future-idp",
    mode: "browser-session-guard",
    label: "future outer guard",
    optional: true,
  },
]);

function repoRootFromHere(): string {
  const here = fileURLToPath(import.meta.url);
  return here.replace(/\/packages\/app\/(dist|src)\/.*$/, "");
}

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
      dependencyBindings: referenceWpmDependencyBindings(),
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
      dependencyBindings: referenceWpmDependencyBindings(),
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

  it("parses --auth-assurance-policy as a profile-shaped deployment contract", () => {
    const parsed = parseServeArgs(
      ["--auth-assurance-policy", "password-permitted"],
      {} as NodeJS.ProcessEnv,
    );
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.authAssuranceProfile).toBe("password-permitted");
    }
  });

  it("falls back to env (GLA_AUTH_ASSURANCE_POLICY); a flag overrides env", () => {
    const parsed = parseServeArgs(["--auth-assurance-policy", "password-permitted"], {
      GLA_AUTH_ASSURANCE_POLICY: "phishing-resistant",
    } as NodeJS.ProcessEnv);
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.authAssuranceProfile).toBe("password-permitted");
    }
  });

  it("parses a provider-extensible enrollment policy descriptor from env", () => {
    const parsed = parseServeArgs([], {
      GLA_AUTH_PROVIDER: "authentik",
      GLA_AUTH_ENROLLMENT_POLICY_JSON: AUTHENTIK_ENROLLMENT_POLICY_JSON,
    } as NodeJS.ProcessEnv);
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.authEnrollmentPolicy?.provider).toBe("authentik");
      expect(parsed.options.authEnrollmentPolicy?.enrollmentFlow).toBe("gla-invitation-enrollment");
      expect(
        parsed.options.authEnrollmentPolicy?.credentialSetupStages.map((s) => s.method),
      ).toEqual(["password", "webauthn-passkey"]);
      expect(parsed.options.authEnrollmentPolicy?.externalSources[0]?.kind).toBe("oauth");
      expect(parsed.options.authEnrollmentPolicy?.optionalRecipientChoices[0]?.choices).toContain(
        "webauthn-passkey",
      );
    }
  });

  it("parses provider-extensible deployment roles from env and flags without closing the role vocabulary", () => {
    const envParsed = parseServeArgs([], {
      GLA_AUTH_DEPLOYMENT_ROLES_JSON: AUTHENTIK_EDGE_GUARD_ROLES_JSON,
    } as NodeJS.ProcessEnv);
    expect(envParsed.help).toBe(false);
    if (!envParsed.help) {
      expect(envParsed.options.authDeploymentRoles?.map((r) => r.role)).toEqual([
        "authentik-forward-auth",
        "future-zero-trust-edge",
      ]);
      expect(envParsed.options.authDeploymentRoles?.[1]?.provider).toBe("future-idp");
    }

    const flagParsed = parseServeArgs(
      ["--auth-deployment-roles-json", AUTHENTIK_EDGE_GUARD_ROLES_JSON],
      {} as NodeJS.ProcessEnv,
    );
    expect(flagParsed.help).toBe(false);
    if (!flagParsed.help) {
      expect(flagParsed.options.authDeploymentRoles?.[0]?.mode).toBe("forward-auth");
    }
  });

  it("an invalid --auth-assurance-policy throws a stable actionable error", () => {
    expect(() =>
      parseServeArgs(["--auth-assurance-policy", "totp"], {} as NodeJS.ProcessEnv),
    ).toThrow(/auth-assurance-policy.*phishing-resistant.*password-permitted/i);
  });

  it("the default (no GLA_AUTH_PROVIDER) leaves authProvider unset — the default boot path is untouched", () => {
    const parsed = parseServeArgs([], {} as NodeJS.ProcessEnv);
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.authProvider).toBeUndefined();
    }
  });
});

describe("AC#6 · WPM env template exposes the selected assurance policy", () => {
  it("ships the secure phishing-resistant default and names the explicit password-permitted profile", () => {
    const tmpl = readFileSync(
      `${repoRootFromHere()}/wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`,
      "utf8",
    );
    expect(tmpl).toContain("GLA_AUTH_ASSURANCE_POLICY=phishing-resistant");
    expect(tmpl).toMatch(/password-permitted/);
  });
});

describe("AC#6/#7 · operator diagnostics report provider ability to satisfy policy", () => {
  it("reports that the default WebAuthn provider satisfies phishing-resistant assurance", () => {
    expect(authAssuranceProviderDiagnostic({})).toMatch(/webauthn.*satisfies the selected policy/i);
  });

  it("warns when authentik is selected without a declared enrollment method policy", () => {
    expect(
      authAssuranceProviderDiagnostic({
        authProvider: "authentik",
        authAssuranceProfile: "phishing-resistant",
      }),
    ).toMatch(/authentik.*undeclared|not declared/i);
  });

  it("reports declared authentik password, passkey, external-source, and MFA/recovery options as policy data", () => {
    const policy = parseAuthEnrollmentPolicyJson(AUTHENTIK_ENROLLMENT_POLICY_JSON, "authentik");
    const d = authEnrollmentDiagnostics({
      authProvider: "authentik",
      authAssuranceProfile: "phishing-resistant",
      enrollmentPolicy: policy,
    });
    expect(d.concerns).toEqual([]);
    expect(d.enrollmentPolicy.enrollmentFlow).toBe("gla-invitation-enrollment");
    expect(d.enrollmentPolicy.invitationStage).toBe("gla-invitation-stage");
    expect(d.enrollmentPolicy.credentialSetupStages.map((s) => s.method)).toEqual([
      "password",
      "webauthn-passkey",
    ]);
    expect(d.enrollmentPolicy.externalSources.map((s) => `${s.kind}:${s.name}`)).toEqual([
      "oauth:github",
    ]);
    expect(d.enrollmentPolicy.mfaRecoveryMethods[0]?.method).toBe("totp");
    expect(d.enrollmentPolicy.optionalRecipientChoices[0]?.choices).toEqual([
      "password",
      "webauthn-passkey",
      "oauth:github",
    ]);
    expect(d.bindingSemantics.providerAccount).toMatch(/not a GLA enrollment/i);
    expect(d.actions.join("\n")).toMatch(/MFA\/recovery factors as provider evidence/i);
  });

  it("flags authentik proxy/forward-auth as an outer guard when GLA OIDC is not selected", () => {
    const deploymentRoles = parseAuthDeploymentRolesJson(AUTHENTIK_EDGE_GUARD_ROLES_JSON);
    const d = authEnrollmentDiagnostics({
      authProvider: "webauthn",
      deploymentRoles,
    });
    expect(d.deploymentRoles.map((r) => r.role)).toEqual([
      "authentik-forward-auth",
      "future-zero-trust-edge",
    ]);
    expect(d.deploymentRoles[0]?.recognizedRole).toBe("authentik-forward-auth");
    expect(d.deploymentRoles[1]?.recognizedRole).toBe("other");
    expect(d.edgeGuard.summary).toMatch(/authentik.*outer guard/i);
    expect(d.concerns.join("\n")).toMatch(/outer proxy.*does not perform GLA handoff step-up/i);
    expect(d.actions.join("\n")).toMatch(/GLA_AUTH_PROVIDER=authentik/i);
    expect(d.actions.join("\n")).toMatch(/GLA_AUTHENTIK_ISSUER_URL/i);
    expect(d.actions.join("\n")).toMatch(/GLA_AUTHENTIK_REDIRECT_URI/i);
    expect(d.actions.join("\n")).toMatch(/intentionally.*WebAuthn/i);
  });

  it("reports authentik proxy/forward-auth plus OIDC as defense-in-depth, not a bypass of GLA grants", () => {
    const policy = parseAuthEnrollmentPolicyJson(AUTHENTIK_ENROLLMENT_POLICY_JSON, "authentik");
    const deploymentRoles = parseAuthDeploymentRolesJson(AUTHENTIK_EDGE_GUARD_ROLES_JSON);
    const d = authEnrollmentDiagnostics({
      authProvider: "authentik",
      authAssuranceProfile: "phishing-resistant",
      enrollmentPolicy: policy,
      deploymentRoles,
    });
    expect(d.concerns).toEqual([]);
    expect(d.edgeGuard.summary).toMatch(/GLA OIDC provider selected/i);
    expect(d.actions.join("\n")).toMatch(/GLA still verifies handoff\/enrollment grants/i);
    expect(d.actions.join("\n")).toMatch(/proxy session alone cannot bypass/i);
    expect(JSON.stringify(d)).not.toContain("EDGE_TOKEN_CANARY_087");
    expect(JSON.stringify(d)).toContain("<redacted>");
  });

  it("flags a password-only authentik policy before relying on phishing-resistant handoff", () => {
    const policy = parseAuthEnrollmentPolicyJson(
      JSON.stringify({
        provider: "authentik",
        enrollmentFlow: "gla-invitation-enrollment",
        invitationStage: "gla-invitation-stage",
        userWriteStage: "gla-user-write-stage",
        credentialSetupStages: [
          { method: "password", authStrength: "password", assuranceLevel: "password" },
        ],
      }),
      "authentik",
    );
    const d = authEnrollmentDiagnostics({
      authProvider: "authentik",
      authAssuranceProfile: "phishing-resistant",
      enrollmentPolicy: policy,
    });
    expect(d.concerns.join("\n")).toMatch(/do not prove.*phishing-resistant/i);
    expect(d.actions.join("\n")).toMatch(/WebAuthn\/passkey/i);
  });

  it("flags a credential setup stage that overstates assurance beyond its reported strength", () => {
    const policy = parseAuthEnrollmentPolicyJson(
      JSON.stringify({
        provider: "authentik",
        enrollmentFlow: "gla-invitation-enrollment",
        invitationStage: "gla-invitation-stage",
        userWriteStage: "gla-user-write-stage",
        credentialSetupStages: [
          {
            method: "password",
            authStrength: "password",
            assuranceLevel: "phishing-resistant",
            providerEvidence: { amr: ["pwd"] },
          },
        ],
      }),
      "authentik",
    );
    const d = authEnrollmentDiagnostics({
      authProvider: "authentik",
      authAssuranceProfile: "phishing-resistant",
      enrollmentPolicy: policy,
    });
    expect(d.concerns.join("\n")).toMatch(/password.*overstates.*phishing-resistant/i);
    expect(d.actions.join("\n")).toMatch(/provider evidence.*password/i);
  });

  it("flags an external source claiming phishing resistance without explicit provider evidence", () => {
    const policy = parseAuthEnrollmentPolicyJson(
      JSON.stringify({
        provider: "authentik",
        enrollmentFlow: "gla-invitation-enrollment",
        invitationStage: "gla-invitation-stage",
        userWriteStage: "gla-user-write-stage",
        externalSources: [
          {
            kind: "oauth",
            name: "example-idp",
            assuranceLevel: "phishing-resistant",
          },
        ],
      }),
      "authentik",
    );
    const d = authEnrollmentDiagnostics({
      authProvider: "authentik",
      authAssuranceProfile: "phishing-resistant",
      enrollmentPolicy: policy,
    });
    expect(d.concerns.join("\n")).toMatch(/oauth:example-idp.*phishing-resistant.*evidence/i);
    expect(d.actions.join("\n")).toMatch(/source evidence/i);
  });

  it("flags optional choices and required methods that are not backed by configured provider methods", () => {
    const policy = parseAuthEnrollmentPolicyJson(
      JSON.stringify({
        provider: "authentik",
        enrollmentFlow: "gla-invitation-enrollment",
        invitationStage: "gla-invitation-stage",
        userWriteStage: "gla-user-write-stage",
        credentialSetupStages: [
          { method: "password", authStrength: "password", assuranceLevel: "password" },
        ],
        requiredMethods: ["unsupported-required"],
        optionalRecipientChoices: [
          { id: "primary-credential", choices: ["password", "unsupported-method"] },
        ],
      }),
      "authentik",
    );
    const d = authEnrollmentDiagnostics({
      authProvider: "authentik",
      authAssuranceProfile: "password-permitted",
      enrollmentPolicy: policy,
    });
    expect(d.concerns.join("\n")).toMatch(/unsupported-method/i);
    expect(d.concerns.join("\n")).toMatch(/unsupported-required/i);
    expect(d.actions.join("\n")).toMatch(/only operator-configured methods/i);
  });

  it("redacts secret-like provider evidence from policy diagnostics without erasing safe method fields", () => {
    const policy = parseAuthEnrollmentPolicyJson(
      JSON.stringify({
        provider: "authentik",
        enrollmentFlow: "gla-invitation-enrollment",
        invitationStage: "gla-invitation-stage",
        userWriteStage: "gla-user-write-stage",
        credentialSetupStages: [
          {
            method: "webauthn-passkey",
            authStrength: "webauthn",
            assuranceLevel: "phishing-resistant",
            providerEvidence: {
              amr: ["swk"],
              access_token: "ACCESS_TOKEN_CANARY_085",
              password: "PASSWORD_CANARY_085",
              credential: "CREDENTIAL_CANARY_085",
            },
          },
        ],
      }),
      "authentik",
    );
    const d = authEnrollmentDiagnostics({
      authProvider: "authentik",
      authAssuranceProfile: "phishing-resistant",
      enrollmentPolicy: policy,
    });
    const text = JSON.stringify(d);
    expect(d.enrollmentPolicy.credentialSetupStages[0]?.method).toBe("webauthn-passkey");
    expect(text).not.toContain("ACCESS_TOKEN_CANARY_085");
    expect(text).not.toContain("PASSWORD_CANARY_085");
    expect(text).not.toContain("CREDENTIAL_CANARY_085");
    expect(text).toContain("<redacted>");
  });
});

describe("AC#1 · structural: selecting authentik changes only the adapter + app (no gateway/kernel edit)", () => {
  /** Read a package.json's dependency names (relative to this test file's compiled location). */
  function deps(relFromRepoRoot: string): string[] {
    const pkg = JSON.parse(readFileSync(`${repoRootFromHere()}/${relFromRepoRoot}`, "utf8")) as {
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
