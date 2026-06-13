import { describe, expect, it } from "vitest";
import {
  AUTH_ASSURANCE_PROFILE_VALUES,
  DEFAULT_AUTH_ASSURANCE_PROFILE,
  assuranceFromAuthStrength,
  authAssurancePolicyFromProfile,
  authAssurancePolicyFromRequiredAuthStrength,
  authAssuranceSufficient,
  parseAuthAssuranceProfile,
} from "./index.js";

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
    const passkey = assuranceFromAuthStrength("webauthn");

    expect(authAssuranceSufficient(password, authAssurancePolicyFromProfile())).toBe(false);
    expect(
      authAssuranceSufficient(password, authAssurancePolicyFromProfile("password-permitted")),
    ).toBe(true);
    expect(authAssuranceSufficient(passkey, authAssurancePolicyFromProfile())).toBe(true);
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
