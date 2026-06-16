// Wiring test for AUTH-PROVIDER SELECTION through Provider Host, GLA-096 AC#1/#6.
// Proves: (a) the DEFAULT (provider unset / "webauthn") wires the in-tree WebAuthn adapter — the existing
// path is unchanged; (b) opting into "authentik" resolves through the trusted reference provider set while
// everything downstream (IdentityService, gateway, route) consumes only AuthProviderPort; (c) the daemon's
// parseServeArgs threads opaque provider ids plus the reference authentik OIDC config; (d) structural
// boundaries keep auth adapter implementations out of app runtime files and core packages.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AUTH_AUTHENTIK_MODULE } from "@gla/auth-authentik";
import { AUTH_WEBAUTHN_MODULE } from "@gla/auth-webauthn";
import { referenceWpmDependencyBindings } from "@gla/catalog";
import {
  DETECTOR_USER_DONE_PROVIDER_ID,
  REFERENCE_PROFILE_HARDENED_IDP_ID,
  REFERENCE_PROFILE_LOCAL_DEV_ID,
} from "@gla/provider-set-reference";
import { describe, expect, it } from "vitest";
import {
  authEnrollmentDiagnostics,
  parseAuthDeploymentRolesJson,
  parseAuthEnrollmentPolicyJson,
} from "../../src/auth-enrollment-policy.js";
import { authAssuranceProviderDiagnostic, parseServeArgs } from "../../src/daemon.js";
import {
  type AuthProviderConfig,
  createEnrollmentStack,
  createProvisioningBridge,
  referenceProviderSet,
} from "../../src/index.js";

const AUTHENTIK: AuthProviderConfig = {
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
      providerEvidence: {
        amr: ["swk"],
        userVerified: true,
        recipientBound: true,
        replayResistant: true,
      },
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
  loginMethodProofs: [
    {
      method: "password",
      kind: "password",
      label: "Password",
      stage: "gla-password-prompt",
      status: "verified",
      authStrength: "password",
      assuranceLevel: "password",
      observedAt: "2026-06-13T22:00:00Z",
      evidence: { amr: ["pwd"] },
    },
    {
      method: "webauthn-passkey",
      kind: "webauthn-passkey",
      label: "Passkey",
      stage: "gla-webauthn-setup",
      status: "verified",
      authStrength: "webauthn",
      assuranceLevel: "phishing-resistant",
      observedAt: "2026-06-13T22:00:00Z",
      evidence: {
        amr: ["swk"],
        gla_uv: true,
        userVerified: true,
        recipientBound: true,
        replayResistant: true,
      },
    },
    {
      method: "oauth:github",
      kind: "external-source",
      source: "github-oauth",
      status: "verified",
      authStrength: "password",
      assuranceLevel: "password",
      subjectStable: true,
      observedAt: "2026-06-13T22:00:00Z",
      evidence: { source: "github-oauth", subjectMode: "stable" },
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
  return here.replace(/\/packages\/app\/(?:dist|src|test)\/.*$/, "");
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

  it("preserves WebAuthn's existing multi-origin configuration shape through Provider Host", () => {
    const stack = createEnrollmentStack({
      ...ENROLL_BASE,
      expectedOrigin: ["http://localhost:3000", "https://gla.example"],
    });
    expect(stack.authModule).toBe(AUTH_WEBAUTHN_MODULE);
  });

  it("createProvisioningBridge() handoff with no authProvider records the WebAuthn module", () => {
    const stack = createProvisioningBridge({
      dependencyBindings: referenceWpmDependencyBindings(),
      launcherMode: "headless",
      handoff: { ...ENROLL_BASE },
    });
    expect(stack.authModule).toBe(AUTH_WEBAUTHN_MODULE);
  });

  it("createProvisioningBridge() applies an explicit named reference provider profile at boot", async () => {
    const stack = createProvisioningBridge({
      providerProfileId: REFERENCE_PROFILE_LOCAL_DEV_ID,
      dependencyBindings: referenceWpmDependencyBindings(),
      launcherMode: "headless",
      handoff: { ...ENROLL_BASE },
    });
    try {
      expect(stack.providerGraphDoctor).toMatchObject({
        status: "PASS",
        profileId: REFERENCE_PROFILE_LOCAL_DEV_ID,
        selectedProviders: expect.objectContaining({
          CompletionDetector: DETECTOR_USER_DONE_PROVIDER_ID,
        }),
      });
    } finally {
      await stack.close();
    }
  });

  it("createApp().wiring.auth (the static default profile) still names @gla/auth-webauthn", async () => {
    const { createApp } = await import("../../src/index.js");
    expect(createApp().wiring.auth).toBe(AUTH_WEBAUTHN_MODULE);
  });
});

describe("AC#1/#6 · opting into authentik flips ONLY the adapter the composition constructs", () => {
  it('createEnrollmentStack({ authProvider: "authentik", authProviderConfig }) wires @gla/auth-authentik', () => {
    const stack = createEnrollmentStack({
      ...ENROLL_BASE,
      authProvider: "authentik",
      authProviderConfig: AUTHENTIK,
      dependencyBindings: referenceWpmDependencyBindings(),
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
      handoff: { ...ENROLL_BASE, authProvider: "authentik", authProviderConfig: AUTHENTIK },
    });
    expect(stack.authModule).toBe(AUTH_AUTHENTIK_MODULE);
    // The gateway/route/identity are still wired (the swap is one `new …`, nothing downstream changes).
    expect(stack.gateway).toBeDefined();
    expect(stack.route).toBeDefined();
    expect(stack.identity).toBeDefined();
  });

  it("selecting authentik WITHOUT its OIDC config fails loud (no silent fallback to the default)", () => {
    expect(() =>
      createEnrollmentStack({
        ...ENROLL_BASE,
        authProvider: "authentik",
        dependencyBindings: referenceWpmDependencyBindings(),
      }),
    ).toThrow(/authentik.*requires|issuer|client/i);
  });

  it("selecting authentik WITHOUT identity-provider dependency evidence fails closed (no silent fallback)", () => {
    expect(() =>
      createEnrollmentStack({
        ...ENROLL_BASE,
        authProvider: "authentik",
        authProviderConfig: AUTHENTIK,
      }),
    ).toThrow(/authentik.*unavailable dependencies|identity-provider/i);
  });
});

describe("AC#6 · daemon parseServeArgs threads opaque provider ids and provider-owned config", () => {
  it("parses --auth-provider plus generic provider config JSON", () => {
    const parsed = parseServeArgs(
      [
        "--auth-provider",
        "authentik",
        "--auth-provider-config-json",
        JSON.stringify({ ...AUTHENTIK, clientSecret: "shh", scopes: "openid profile email" }),
      ],
      {} as NodeJS.ProcessEnv,
    );
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.authProvider).toBe("authentik");
      expect(parsed.options.authProviderConfig).toMatchObject({
        issuerUrl: "https://idp.example/application/o/gla/",
        clientId: "gla-client",
        clientSecret: "shh",
        redirectUri: "https://gla.example/auth/callback",
        scopes: "openid profile email",
      });
    }
  });

  it("falls back to env (GLA_AUTH_PROVIDER / GLA_AUTH_PROVIDER_CONFIG_JSON); a flag overrides env", () => {
    const env = {
      GLA_AUTH_PROVIDER: "authentik",
      GLA_AUTH_PROVIDER_CONFIG_JSON: JSON.stringify({
        ...AUTHENTIK,
        issuerUrl: "https://from-env/application/o/gla/",
      }),
    } as NodeJS.ProcessEnv;
    const parsed = parseServeArgs(
      ["--auth-provider-config-json", JSON.stringify({ ...AUTHENTIK, clientId: "from-flag" })],
      env,
    );
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.authProvider).toBe("authentik"); // from env
      expect(parsed.options.authProviderConfig?.issuerUrl).toBe(AUTHENTIK.issuerUrl); // flag wins
      expect(parsed.options.authProviderConfig?.clientId).toBe("from-flag");
    }
  });

  it("parses WPM dependency bindings JSON for the real serve command path", () => {
    const parsed = parseServeArgs(
      ["--dependency-bindings-json", JSON.stringify(referenceWpmDependencyBindings())],
      {} as NodeJS.ProcessEnv,
    );
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.dependencyBindings?.map((binding) => binding.dependency)).toContain(
        "identity-provider",
      );
    }
  });

  it("an unknown --auth-provider remains an opaque provider id for Provider Host diagnostics", () => {
    const parsed = parseServeArgs(["--auth-provider", "ldap"], {} as NodeJS.ProcessEnv);
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.authProvider).toBe("ldap");
    }
    expect(() => createEnrollmentStack({ ...ENROLL_BASE, authProvider: "ldap" })).toThrow(
      /unknown provider "ldap"/i,
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
      expect(parsed.options.authEnrollmentPolicy?.loginMethodProofs?.map((p) => p.method)).toEqual([
        "password",
        "webauthn-passkey",
        "oauth:github",
      ]);
    }
  });

  it("parses enrollment policy JSON against a provider selected by provider profile", () => {
    const parsed = parseServeArgs(
      ["--provider-profile", REFERENCE_PROFILE_HARDENED_IDP_ID],
      {
        GLA_AUTH_ENROLLMENT_POLICY_JSON: JSON.stringify({
          declared: true,
          credentialSetupStages: [],
          externalSources: [],
          mfaRecoveryMethods: [],
          requiredMethods: [],
          optionalRecipientChoices: [],
        }),
      } as NodeJS.ProcessEnv,
      { providerSet: referenceProviderSet },
    );
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.authEnrollmentPolicy?.provider).toBe("authentik");
    }
  });

  it("parses enrollment policy JSON against a provider selected by app deployment config", () => {
    const parsed = parseServeArgs(
      [],
      {
        GLA_AUTH_ENROLLMENT_POLICY_JSON: JSON.stringify({
          declared: true,
          credentialSetupStages: [],
          externalSources: [],
          mfaRecoveryMethods: [],
          requiredMethods: [],
          optionalRecipientChoices: [],
        }),
      } as NodeJS.ProcessEnv,
      {
        providerSet: referenceProviderSet,
        appDeploymentConfig: { auth: "authentik" },
      },
    );
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.authEnrollmentPolicy?.provider).toBe("authentik");
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
    expect(d.enrollmentPolicy.loginMethodProofs?.map((p) => `${p.method}:${p.status}`)).toEqual([
      "password:verified",
      "webauthn-passkey:verified",
      "oauth:github:verified",
    ]);
    expect(d.summary).toContain("loginMethodProofs=password:verified");
    expect(d.bindingSemantics.providerAccount).toMatch(/not a GLA enrollment/i);
    expect(d.actions.join("\n")).toMatch(/MFA\/recovery factors as provider evidence/i);
  });

  it("accepts deployed passkey proof matched by stage when GLA UV, binding, and replay evidence are present", () => {
    const policy = parseAuthEnrollmentPolicyJson(
      JSON.stringify({
        provider: "authentik",
        enrollmentFlow: "gla-invitation-enrollment",
        invitationStage: "gla-invitation-stage",
        userWriteStage: "gla-user-write-stage",
        credentialSetupStages: [
          {
            method: "password",
            stage: "ak-stage-password",
            authStrength: "password",
            assuranceLevel: "password",
          },
          {
            method: "passkey-choice",
            stage: "ak-stage-webauthn-login",
            label: "Passkey autofill",
            authStrength: "webauthn",
            assuranceLevel: "phishing-resistant",
            providerEvidence: {
              userVerified: true,
              recipientBound: true,
              replayResistant: true,
            },
          },
        ],
        loginMethodProofs: [
          {
            method: "observed-password-path",
            stage: "ak-stage-password",
            status: "verified",
            authStrength: "password",
            assuranceLevel: "password",
            evidence: { amr: ["pwd"] },
          },
          {
            method: "observed-passkey-path",
            stage: "ak-stage-webauthn-login",
            status: "verified",
            authStrength: "webauthn",
            assuranceLevel: "phishing-resistant",
            evidence: {
              amr: ["swk"],
              gla_uv: true,
              recipientBound: true,
              replayResistant: true,
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
    expect(d.concerns).toEqual([]);
    expect(d.summary).toContain("observed-passkey-path:verified");
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
    expect(d.actions.join("\n")).toMatch(/GLA_AUTH_PROVIDER_CONFIG_JSON/i);
    expect(d.actions.join("\n")).toMatch(/issuerUrl.*clientId.*clientSecret.*redirectUri/i);
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
        loginMethodProofs: [
          {
            method: "password",
            status: "verified",
            authStrength: "password",
            assuranceLevel: "password",
            evidence: { amr: ["pwd"] },
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
    expect(d.concerns.join("\n")).toMatch(/do not prove.*phishing-resistant/i);
    expect(d.actions.join("\n")).toMatch(/WebAuthn\/passkey/i);
  });

  it("flags declared authentik methods when no deployed login-method proof was recorded", () => {
    const policy = parseAuthEnrollmentPolicyJson(
      JSON.stringify({
        provider: "authentik",
        enrollmentFlow: "gla-invitation-enrollment",
        invitationStage: "gla-invitation-stage",
        userWriteStage: "gla-user-write-stage",
        credentialSetupStages: [
          { method: "password", authStrength: "password", assuranceLevel: "password" },
          {
            method: "webauthn-passkey",
            authStrength: "webauthn",
            assuranceLevel: "phishing-resistant",
            providerEvidence: {
              userVerified: true,
              recipientBound: true,
              replayResistant: true,
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
    expect(d.concerns.join("\n")).toMatch(/deployed login-method proof is not declared/i);
    expect(d.actions.join("\n")).toMatch(/record loginMethodProofs/i);
  });

  it("flags verified login-method proofs that omit emitted evidence or GLA assurance mapping", () => {
    const policy = parseAuthEnrollmentPolicyJson(
      JSON.stringify({
        provider: "authentik",
        enrollmentFlow: "gla-invitation-enrollment",
        invitationStage: "gla-invitation-stage",
        userWriteStage: "gla-user-write-stage",
        credentialSetupStages: [
          { method: "password", authStrength: "password", assuranceLevel: "password" },
        ],
        externalSources: [
          {
            kind: "oauth",
            name: "github",
            source: "github-oauth",
            assuranceLevel: "password",
          },
        ],
        loginMethodProofs: [
          {
            method: "password",
            status: "verified",
          },
          {
            method: "oauth:github",
            source: "github-oauth",
            status: "verified",
            subjectStable: true,
          },
        ],
      }),
      "authentik",
    );
    const d = authEnrollmentDiagnostics({
      authProvider: "authentik",
      authAssuranceProfile: "password-permitted",
      enrollmentPolicy: policy,
    });
    expect(d.concerns.join("\n")).toMatch(/password.*lacks GLA assurance mapping/i);
    expect(d.concerns.join("\n")).toMatch(/password.*lacks emitted provider evidence/i);
    expect(d.concerns.join("\n")).toMatch(/password fallback.*no verified deployed password/i);
    expect(d.concerns.join("\n")).toMatch(/oauth:github.*lacks GLA assurance mapping/i);
    expect(d.concerns.join("\n")).toMatch(/oauth:github.*lacks emitted provider evidence/i);
    expect(d.concerns.join("\n")).toMatch(/oauth:github.*no verified deployed source/i);
  });

  it("flags login-method proofs that overstate phishing-resistant assurance beyond reported strength", () => {
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
              userVerified: true,
              recipientBound: true,
              replayResistant: true,
            },
          },
        ],
        loginMethodProofs: [
          {
            method: "webauthn-passkey",
            status: "verified",
            authStrength: "password",
            assuranceLevel: "phishing-resistant",
            evidence: {
              amr: ["swk"],
              gla_uv: true,
              recipientBound: true,
              replayResistant: true,
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
    expect(d.concerns.join("\n")).toMatch(/webauthn-passkey.*overstates.*phishing-resistant/i);
    expect(d.concerns.join("\n")).toMatch(/no verified deployed proof shows UV-backed/i);
  });

  it("flags deferred passkey proof as password-only risk under phishing-resistant policy", () => {
    const policy = parseAuthEnrollmentPolicyJson(
      JSON.stringify({
        provider: "authentik",
        enrollmentFlow: "gla-invitation-enrollment",
        invitationStage: "gla-invitation-stage",
        userWriteStage: "gla-user-write-stage",
        credentialSetupStages: [
          { method: "password", authStrength: "password", assuranceLevel: "password" },
          {
            method: "webauthn-passkey",
            authStrength: "webauthn",
            assuranceLevel: "phishing-resistant",
            providerEvidence: {
              userVerified: true,
              recipientBound: true,
              replayResistant: true,
            },
          },
        ],
        loginMethodProofs: [
          {
            method: "password",
            status: "verified",
            authStrength: "password",
            assuranceLevel: "password",
            evidence: { amr: ["pwd"] },
          },
          {
            method: "webauthn-passkey",
            status: "deferred",
            authStrength: "webauthn",
            assuranceLevel: "phishing-resistant",
            diagnostics: ["live-passkey-browser-proof-not-run"],
            evidence: { amr: ["swk"], gla_uv: true },
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
    expect(d.concerns.join("\n")).toMatch(/webauthn-passkey.*deferred/i);
    expect(d.concerns.join("\n")).toMatch(/may see only password-grade choices/i);
    expect(d.actions.join("\n")).toMatch(/Identification\/WebAuthn flow/i);
  });

  it("flags external source proof that lacks stable subject evidence", () => {
    const policy = parseAuthEnrollmentPolicyJson(
      JSON.stringify({
        provider: "authentik",
        enrollmentFlow: "gla-invitation-enrollment",
        invitationStage: "gla-invitation-stage",
        userWriteStage: "gla-user-write-stage",
        credentialSetupStages: [
          { method: "password", authStrength: "password", assuranceLevel: "password" },
        ],
        externalSources: [
          {
            kind: "oauth",
            name: "github",
            source: "github-oauth",
            assuranceLevel: "password",
          },
        ],
        loginMethodProofs: [
          {
            method: "password",
            status: "verified",
            authStrength: "password",
            assuranceLevel: "password",
            evidence: { amr: ["pwd"] },
          },
          {
            method: "oauth:github",
            kind: "external-source",
            source: "github-oauth",
            status: "verified",
            authStrength: "password",
            assuranceLevel: "password",
            subjectStable: false,
            evidence: { source: "github-oauth", subjectMode: "stable" },
          },
        ],
      }),
      "authentik",
    );
    const d = authEnrollmentDiagnostics({
      authProvider: "authentik",
      authAssuranceProfile: "password-permitted",
      enrollmentPolicy: policy,
    });
    expect(d.concerns.join("\n")).toMatch(/oauth:github.*stable subject evidence/i);
    expect(d.actions.join("\n")).toMatch(/Record stable subject proof/i);
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

  it("flags a phishing-resistant credential stage that lacks UV, binding, and replay proof", () => {
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
            providerEvidence: { amr: ["swk"] },
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
    expect(d.concerns.join("\n")).toMatch(
      /user-verification, recipient-binding, and replay-resistant/i,
    );
    expect(d.actions.join("\n")).toMatch(/provider-neutral UV\/binding\/replay proof/i);
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
              userVerified: true,
              recipientBound: true,
              replayResistant: true,
              access_token: "ACCESS_TOKEN_CANARY_085",
              password: "PASSWORD_CANARY_085",
              credential: "CREDENTIAL_CANARY_085",
            },
          },
        ],
        loginMethodProofs: [
          {
            method: "webauthn-passkey",
            status: "verified",
            authStrength: "webauthn",
            assuranceLevel: "phishing-resistant",
            diagnostics: ["safe field LOGIN_PROOF_PASSWORD_CANARY_086"],
            evidence: {
              amr: ["swk"],
              gla_uv: true,
              recipientBound: true,
              replayResistant: true,
              claim: "LOGIN_PROOF_CREDENTIAL_CANARY_086",
              access_token: "LOGIN_PROOF_ACCESS_TOKEN_CANARY_086",
              password: "LOGIN_PROOF_PASSWORD_KEY_CANARY_086",
              credential: "LOGIN_PROOF_CREDENTIAL_KEY_CANARY_086",
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
    expect(text).not.toContain("LOGIN_PROOF_ACCESS_TOKEN_CANARY_086");
    expect(text).not.toContain("LOGIN_PROOF_PASSWORD_CANARY_086");
    expect(text).not.toContain("LOGIN_PROOF_CREDENTIAL_CANARY_086");
    expect(text).not.toContain("LOGIN_PROOF_PASSWORD_KEY_CANARY_086");
    expect(text).not.toContain("LOGIN_PROOF_CREDENTIAL_KEY_CANARY_086");
    expect(text).toContain("<redacted>");
    expect(text).toContain("<redacted-canary>");
  });
});

describe("AC#1/#2 · structural: auth adapters live behind the provider set, not app/core runtime", () => {
  /** Read a package.json's dependency names (relative to this test file's compiled location). */
  function pkgDeps(relFromRepoRoot: string): {
    dependencies: string[];
    devDependencies: string[];
  } {
    const pkg = JSON.parse(readFileSync(`${repoRootFromHere()}/${relFromRepoRoot}`, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      dependencies: Object.keys(pkg.dependencies ?? {}),
      devDependencies: Object.keys(pkg.devDependencies ?? {}),
    };
  }

  function deps(relFromRepoRoot: string): string[] {
    const pkg = pkgDeps(relFromRepoRoot);
    return [...pkg.dependencies, ...pkg.devDependencies];
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

  it("the trusted reference provider set declares the concrete auth adapter dependencies", () => {
    const providerSetDeps = deps("packages/provider-set-reference/package.json");
    expect(providerSetDeps).toContain("@gla/auth-authentik");
    expect(providerSetDeps).toContain("@gla/auth-webauthn");
  });

  it("app production dependencies name the provider set, not concrete auth adapters", () => {
    const appDeps = pkgDeps("packages/app/package.json");
    expect(appDeps.dependencies).toContain("@gla/provider-set-reference");
    expect(appDeps.dependencies).not.toContain("@gla/auth-authentik");
    expect(appDeps.dependencies).not.toContain("@gla/auth-webauthn");
    expect(appDeps.devDependencies).toContain("@gla/auth-authentik");
    expect(appDeps.devDependencies).toContain("@gla/auth-webauthn");
  });

  it("app runtime composition files do not import concrete auth adapters or authentik state types", () => {
    const indexSource = readFileSync(`${repoRootFromHere()}/packages/app/src/index.ts`, "utf8");
    const daemonSource = readFileSync(`${repoRootFromHere()}/packages/app/src/daemon.ts`, "utf8");
    for (const source of [indexSource, daemonSource]) {
      expect(source).not.toMatch(/from ["']@gla\/auth-authentik["']/);
      expect(source).not.toMatch(/from ["']@gla\/auth-webauthn["']/);
      expect(source).not.toMatch(
        /BoundSubject|PendingAttempt|interface AuthentikConfig|type AuthentikConfig/,
      );
    }
  });
});
