import { describe, expect, it } from "vitest";
import {
  AUTH_ASSURANCE_PROFILE_VALUES,
  DEFAULT_AUTH_ASSURANCE_PROFILE,
  assuranceFromAuthStrength,
  authAssurancePolicyFromProfile,
  authAssurancePolicyFromRequiredAuthStrength,
  authAssuranceSufficient,
  parseAuthAssuranceProfile,
} from "../../src/index.js";

describe("auth assurance policy profiles", () => {
  it("defaults to phishing-resistant assurance", () => {
    expect(DEFAULT_AUTH_ASSURANCE_PROFILE).toBe("phishing-resistant");
    expect(authAssurancePolicyFromProfile()).toEqual({
      profile: "phishing-resistant",
      minimumLevel: "phishing-resistant",
    });
  });

  it("accepts password evidence only through the explicit password-permitted profile", () => {
    const password = assuranceFromAuthStrength("password");
    const passkey = assuranceFromAuthStrength("webauthn", {
      userVerified: true,
      recipientBound: true,
      replayResistant: true,
    });

    expect(authAssuranceSufficient(password, authAssurancePolicyFromProfile())).toBe(false);
    expect(
      authAssuranceSufficient(password, authAssurancePolicyFromProfile("password-permitted")),
    ).toBe(true);
    expect(authAssuranceSufficient(passkey, authAssurancePolicyFromProfile())).toBe(true);
  });

  it("does not treat coarse WebAuthn strength as phishing-resistant proof without UV, binding, and replay facts", () => {
    const coarsePasskey = assuranceFromAuthStrength("webauthn", {
      methodResolvable: true,
      diagnostics: ["missing-user-verification"],
    });
    const verifiedPasskey = assuranceFromAuthStrength("webauthn", {
      methodResolvable: true,
      userPresent: true,
      userVerified: true,
      recipientBound: true,
      replayResistant: true,
    });

    expect(authAssuranceSufficient(coarsePasskey, authAssurancePolicyFromProfile())).toBe(false);
    expect(authAssuranceSufficient(verifiedPasskey, authAssurancePolicyFromProfile())).toBe(true);
    expect(coarsePasskey).toMatchObject({
      authStrength: "webauthn",
      level: "phishing-resistant",
      diagnostics: ["missing-user-verification"],
    });
  });

  it("does not let a legacy WebAuthn strength string satisfy assurance policies without proof evidence", () => {
    expect(authAssuranceSufficient("webauthn", authAssurancePolicyFromProfile())).toBe(false);
    expect(
      authAssuranceSufficient("webauthn", authAssurancePolicyFromProfile("password-permitted")),
    ).toBe(false);
    expect(
      authAssuranceSufficient("password", authAssurancePolicyFromProfile("password-permitted")),
    ).toBe(true);
  });

  it("keeps password-permitted as a lower-assurance profile without upgrading non-UV passkey evidence", () => {
    const downgradedPasskey = assuranceFromAuthStrength("password", {
      methodResolvable: true,
      userPresent: true,
      userVerified: false,
      diagnostics: ["missing-user-verification"],
    });

    expect(authAssuranceSufficient(downgradedPasskey, authAssurancePolicyFromProfile())).toBe(
      false,
    );
    expect(
      authAssuranceSufficient(
        downgradedPasskey,
        authAssurancePolicyFromProfile("password-permitted"),
      ),
    ).toBe(true);
    expect(downgradedPasskey.level).toBe("password");
  });

  it("keeps legacy AuthStrength compatibility behind profile-shaped policy", () => {
    expect(authAssurancePolicyFromRequiredAuthStrength("webauthn")).toEqual(
      authAssurancePolicyFromProfile("phishing-resistant"),
    );
    expect(authAssurancePolicyFromRequiredAuthStrength("password")).toEqual(
      authAssurancePolicyFromProfile("password-permitted"),
    );
  });

  it("returns a stable diagnostic object for unknown policy profiles", () => {
    expect(parseAuthAssuranceProfile("totp")).toEqual({
      ok: false,
      reason: "unknown-profile",
      value: "totp",
      expected: AUTH_ASSURANCE_PROFILE_VALUES,
    });
  });
});
