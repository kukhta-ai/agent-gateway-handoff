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

describe("AC#5 · amr passkey set requires explicit UV proof before it becomes webauthn", () => {
  it.each([["hwk"], ["swk"], ["webauthn"], ["fido"]])(
    "amr [%s] plus userVerified:true → webauthn",
    (token) => {
      expect(mapMethodToStrength({ amr: [token], userVerified: true })).toBe("webauthn");
    },
  );

  it.each([["hwk"], ["swk"], ["webauthn"], ["fido"]])(
    "amr [%s] without UV proof → password floor",
    (token) => {
      expect(mapMethodToStrength({ amr: [token] })).toBe("password");
    },
  );

  it("amr [pwd, swk] plus UV → webauthn (the strongest verified method wins)", () => {
    expect(mapMethodToStrength({ amr: ["pwd", "swk"], userVerified: true })).toBe("webauthn");
  });

  it("matching is case-insensitive (authentik labels vary in case): amr [SWK] plus UV → webauthn", () => {
    expect(mapMethodToStrength({ amr: ["SWK"], userVerified: true })).toBe("webauthn");
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
  it("acr 'phr' (phishing-resistant context) plus UV → webauthn", () => {
    expect(mapMethodToStrength({ acr: "phr", userVerified: true })).toBe("webauthn");
  });

  it("acr 'phr' without UV proof → password floor", () => {
    expect(mapMethodToStrength({ acr: "phr" })).toBe("password");
  });

  it("acr 'password' (operator-mapped password context) → password", () => {
    expect(mapMethodToStrength({ acr: "password" })).toBe("password");
  });

  it("acr that maps to nothing → password floor (never up-map)", () => {
    expect(mapMethodToStrength({ acr: "urn:unknown:context" })).toBe("password");
  });

  it("amr present-but-unmatched takes precedence over acr resolution path → still resolves via acr", () => {
    // amr has no passkey/pwd token, so we fall to acr; acr plus UV says passkey → webauthn.
    expect(mapMethodToStrength({ amr: ["unknown-method"], acr: "phr", userVerified: true })).toBe(
      "webauthn",
    );
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
  it("passkey amr claims plus UV/binding/replay facts produce phishing-resistant assurance evidence", () => {
    expect(
      mapMethodToAssurance({ amr: ["swk"], userVerified: true }, DEFAULT_METHOD_MAPS, {
        recipientBound: true,
        replayResistant: true,
      }),
    ).toEqual({
      authStrength: "webauthn",
      level: "phishing-resistant",
      methodResolvable: true,
      userVerified: true,
      recipientBound: true,
      replayResistant: true,
      providerEvidence: { amr: ["swk"], userVerified: true },
    });
  });

  it("passkey amr claims without UV proof degrade with actionable diagnostics", () => {
    expect(mapMethodToAssurance({ amr: ["swk"] })).toEqual({
      authStrength: "password",
      level: "password",
      methodResolvable: true,
      diagnostics: ["missing-user-verification"],
      providerEvidence: { amr: ["swk"] },
    });
  });

  it("ambiguous valid claims degrade only to the password-grade floor", () => {
    expect(mapMethodToAssurance({ amr: ["mfa"], acr: "unknown" })).toEqual({
      authStrength: "password",
      level: "password",
      methodResolvable: false,
      diagnostics: ["method-unresolved", "ambiguous-provider-evidence"],
      providerEvidence: { amr: ["mfa"], acr: "unknown" },
    });
  });
});

describe("AC#5 · the maps are operator-overridable (a deployment with different labels needs no code change)", () => {
  it("an extra webauthn amr label maps to webauthn via an override", () => {
    const maps = methodMaps({ webauthnAmr: ["hwk", "swk", "webauthn", "fido", "passkey"] });
    expect(mapMethodToStrength({ amr: ["passkey"], userVerified: true }, maps)).toBe("webauthn");
    // The default maps DON'T know 'passkey' → it would be the password floor.
    expect(mapMethodToStrength({ amr: ["passkey"] }, DEFAULT_METHOD_MAPS)).toBe("password");
  });

  it("overriding one set keeps the others at their defaults (partial override)", () => {
    const maps = methodMaps({ passwordAmr: ["pwd", "pw"] });
    expect(mapMethodToStrength({ amr: ["pw"] }, maps)).toBe("password");
    // Defaults for the passkey set are retained.
    expect(mapMethodToStrength({ amr: ["swk"], userVerified: true }, maps)).toBe("webauthn");
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
    { amr: ["swk"], userVerified: true },
    { acr: "phr", userVerified: true },
    { acr: "whatever" },
  ])("claims %j → a non-none tier", (claims) => {
    expect(mapMethodToStrength(claims)).not.toBe("none");
  });
});
