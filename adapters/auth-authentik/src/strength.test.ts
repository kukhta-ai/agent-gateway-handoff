// Unit tests for the method→AuthStrength mapping (adapters/auth-authentik/src/strength.ts), GLA-068 AC#5.
// Exercises the WHOLE doc §4 table: amr passkey set → webauthn; amr pwd (with/without MFA) → password;
// acr fallback (passkey vs password context); valid-token-but-unresolvable → password (NEVER up-map);
// plus operator overrides of the maps. The crux invariant pinned: a missing/ambiguous method never yields
// webauthn (that would silently weaken phishing-resistance) — the floor is password for a valid token.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_METHOD_MAPS,
  type MethodClaims,
  mapMethodToAssurance,
  mapMethodToStrength,
  methodMaps,
  methodResolvable,
} from "./strength.js";

describe("AC#5 · amr passkey set → webauthn (highest matching method wins)", () => {
  it.each([["hwk"], ["swk"], ["webauthn"], ["fido"]])(
    "amr [%s] (a phishing-resistant key) → webauthn",
    (token) => {
      expect(mapMethodToStrength({ amr: [token] })).toBe("webauthn");
    },
  );

  it("amr [pwd, swk] (password AND passkey) → webauthn (the strongest method wins)", () => {
    expect(mapMethodToStrength({ amr: ["pwd", "swk"] })).toBe("webauthn");
  });

  it("matching is case-insensitive (authentik labels vary in case): amr [SWK] → webauthn", () => {
    expect(mapMethodToStrength({ amr: ["SWK"] })).toBe("webauthn");
  });
});

describe("AC#5 · amr pwd (with/without MFA companions) → password (MFA never up-maps)", () => {
  it("amr [pwd] → password", () => {
    expect(mapMethodToStrength({ amr: ["pwd"] })).toBe("password");
  });

  it.each([["mfa"], ["otp"], ["sms"]])(
    "amr [pwd, %s] (MFA on top of a password is still not key auth) → password",
    (companion) => {
      expect(mapMethodToStrength({ amr: ["pwd", companion] })).toBe("password");
    },
  );

  it("amr [mfa] alone (no pwd, no key) → password floor (a valid token, unresolvable key method)", () => {
    expect(mapMethodToStrength({ amr: ["mfa"] })).toBe("password");
  });
});

describe("AC#5 · acr fallback when amr is absent", () => {
  it("acr 'phr' (phishing-resistant context) → webauthn", () => {
    expect(mapMethodToStrength({ acr: "phr" })).toBe("webauthn");
  });

  it("acr 'password' (operator-mapped password context) → password", () => {
    expect(mapMethodToStrength({ acr: "password" })).toBe("password");
  });

  it("acr that maps to nothing → password floor (never up-map)", () => {
    expect(mapMethodToStrength({ acr: "urn:unknown:context" })).toBe("password");
  });

  it("amr present-but-unmatched takes precedence over acr resolution path → still resolves via acr", () => {
    // amr has no passkey/pwd token, so we fall to acr; acr says passkey → webauthn.
    expect(mapMethodToStrength({ amr: ["unknown-method"], acr: "phr" })).toBe("webauthn");
  });
});

describe("AC#5 · valid token but unresolvable method → password (NEVER webauthn, NEVER none)", () => {
  it("no amr and no acr → password floor", () => {
    expect(mapMethodToStrength({})).toBe("password");
  });

  it("empty amr array → password floor", () => {
    expect(mapMethodToStrength({ amr: [] })).toBe("password");
  });

  it("the floor is reported as UNRESOLVABLE (so the caller can record a CONCERN, doc §9)", () => {
    expect(methodResolvable({})).toBe(false);
    expect(methodResolvable({ amr: ["swk"] })).toBe(true);
    expect(methodResolvable({ amr: ["pwd"] })).toBe(true);
    expect(methodResolvable({ acr: "phr" })).toBe(true);
    expect(methodResolvable({ amr: ["nonsense"] })).toBe(false);
  });
});

describe("AC#4 · authentik claims project into provider-neutral assurance evidence", () => {
  it("passkey amr claims produce phishing-resistant assurance evidence", () => {
    expect(mapMethodToAssurance({ amr: ["swk"] })).toEqual({
      authStrength: "webauthn",
      level: "phishing-resistant",
      methodResolvable: true,
      providerEvidence: { amr: ["swk"] },
    });
  });

  it("ambiguous valid claims degrade only to the password-grade floor", () => {
    expect(mapMethodToAssurance({ amr: ["mfa"], acr: "unknown" })).toEqual({
      authStrength: "password",
      level: "password",
      methodResolvable: false,
      providerEvidence: { amr: ["mfa"], acr: "unknown" },
    });
  });
});

describe("AC#5 · the maps are operator-overridable (a deployment with different labels needs no code change)", () => {
  it("an extra webauthn amr label maps to webauthn via an override", () => {
    const maps = methodMaps({ webauthnAmr: ["hwk", "swk", "webauthn", "fido", "passkey"] });
    expect(mapMethodToStrength({ amr: ["passkey"] }, maps)).toBe("webauthn");
    // The default maps DON'T know 'passkey' → it would be the password floor.
    expect(mapMethodToStrength({ amr: ["passkey"] }, DEFAULT_METHOD_MAPS)).toBe("password");
  });

  it("overriding one set keeps the others at their defaults (partial override)", () => {
    const maps = methodMaps({ passwordAmr: ["pwd", "pw"] });
    expect(mapMethodToStrength({ amr: ["pw"] }, maps)).toBe("password");
    // Defaults for the passkey set are retained.
    expect(mapMethodToStrength({ amr: ["swk"] }, maps)).toBe("webauthn");
  });

  it("the default maps are the §4 contract", () => {
    expect([...DEFAULT_METHOD_MAPS.webauthnAmr].sort()).toEqual(
      ["fido", "hwk", "swk", "webauthn"].sort(),
    );
    expect([...DEFAULT_METHOD_MAPS.passwordAmr]).toEqual(["pwd"]);
  });
});

describe("AC#5 · the mapping never returns 'none' (that tier is the verifier's, for an INVALID token)", () => {
  it.each<MethodClaims>([
    {},
    { amr: [] },
    { amr: ["pwd"] },
    { amr: ["swk"] },
    { acr: "phr" },
    { acr: "whatever" },
  ])("claims %j → a non-none tier", (claims) => {
    expect(mapMethodToStrength(claims)).not.toBe("none");
  });
});
