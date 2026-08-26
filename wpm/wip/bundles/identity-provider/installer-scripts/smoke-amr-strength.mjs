#!/usr/bin/env node
// smoke-amr-strength.mjs — prove the amr/acr + gla_uv → AuthStrength mapping the authentik flow must FEED is correct
// (identity-provider · GLA-074). The deterministic stand-in for the real-instance "passkey→webauthn,
// password→password" proof (authentik-service-standup.md §7): a real running authentik isn't available in a
// constrained build, but the MAPPING the flow's emitted amr must satisfy is fixed and testable here. At the real
// deploy, the verify task drives an actual passkey login + an actual password login through the live flow and
// asserts the SAME outcomes (identity-provider-6 AC#3); this script proves the contract that proof checks against.
//
// This mirrors `adapters/auth-authentik/src/strength.ts` DEFAULT_METHOD_MAPS (the contract): passkey labels
// {hwk,swk,webauthn,fido} + gla_uv:true → webauthn; passkey labels without UV proof → password; {pwd}
// (+ MFA companions) → password; valid-but-unresolvable → password (the floor); NEVER up-map a missing/ambiguous
// method to webauthn. (Re-implemented inline — the wpm bundle is a separate shipped artifact and cannot import
// GLA's runtime code; keeping it in sync with strength.ts is the contract this script encodes.)
//
// EXIT: 0 iff every case maps as expected; 1 otherwise.

const WEBAUTHN_AMR = new Set(["hwk", "swk", "webauthn", "fido"]);
const PASSWORD_AMR = new Set(["pwd"]);
const WEBAUTHN_ACR = new Set(["phr"]);
const PASSWORD_ACR = new Set(["pwd", "password"]);

/** The §4 mapping (highest verified method wins; never up-map; floor = password for a valid token). */
function mapMethodToStrength({ amr, acr, gla_uv } = {}) {
  const has = (set) => Array.isArray(amr) && amr.some((m) => set.has(String(m).toLowerCase()));
  if (has(WEBAUTHN_AMR) && gla_uv === true) return "webauthn";
  if (has(PASSWORD_AMR)) return "password";
  if (typeof acr === "string") {
    const a = acr.toLowerCase();
    if (WEBAUTHN_ACR.has(a) && gla_uv === true) return "webauthn";
    if (PASSWORD_ACR.has(a)) return "password";
  }
  return "password"; // valid token, unresolvable method → the floor (NEVER webauthn, NEVER none)
}

// Cases: [label, claims, expected]. These are exactly what the flow must produce for each method.
const cases = [
  // Passkey logins → webauthn (the strongest).
  ["passkey: amr=[swk] + gla_uv=true", { amr: ["swk"], gla_uv: true }, "webauthn"],
  ["passkey: amr=[hwk] + gla_uv=true", { amr: ["hwk"], gla_uv: true }, "webauthn"],
  ["passkey: amr=[webauthn] + gla_uv=true", { amr: ["webauthn"], gla_uv: true }, "webauthn"],
  ["passkey: amr=[fido] + gla_uv=true", { amr: ["fido"], gla_uv: true }, "webauthn"],
  ["passkey case-insensitive: amr=[SWK] + gla_uv=true", { amr: ["SWK"], gla_uv: true }, "webauthn"],
  [
    "both methods: amr=[pwd,swk] + gla_uv=true → strongest wins",
    { amr: ["pwd", "swk"], gla_uv: true },
    "webauthn",
  ],
  ["acr passkey context: acr=phr + gla_uv=true", { acr: "phr", gla_uv: true }, "webauthn"],
  ["passkey label without UV proof: amr=[swk] → password floor", { amr: ["swk"] }, "password"],
  // Password logins → password (MFA never up-maps).
  ["password: amr=[pwd]", { amr: ["pwd"] }, "password"],
  ["password+MFA: amr=[pwd,mfa]", { amr: ["pwd", "mfa"] }, "password"],
  ["password+OTP: amr=[pwd,otp]", { amr: ["pwd", "otp"] }, "password"],
  ["acr password context: acr=password", { acr: "password" }, "password"],
  // The never-up-map floor: a valid token whose method is unresolvable → password, NEVER webauthn.
  ["unresolvable: no amr/acr → password floor", {}, "password"],
  ["unresolvable: amr=[] → password floor", { amr: [] }, "password"],
  ["unresolvable: amr=[unknown] → password floor", { amr: ["totally-unknown"] }, "password"],
  ["unresolvable: acr=urn:unknown → password floor", { acr: "urn:unknown:ctx" }, "password"],
];

let failures = 0;
for (const [label, claims, expected] of cases) {
  const got = mapMethodToStrength(claims);
  if (got === expected) {
    console.log(`PASS  ${label} → ${got}`);
  } else {
    failures++;
    console.log(`FAIL  ${label} → got ${got}, expected ${expected}`);
  }
}

// The crux invariant, stated explicitly: nothing maps a password/ambiguous method UP to webauthn.
const neverUp = cases
  .filter(([, , exp]) => exp !== "webauthn")
  .every(([, claims]) => mapMethodToStrength(claims) !== "webauthn");
if (!neverUp) {
  failures++;
  console.log(
    "FAIL  invariant: a non-passkey method mapped UP to webauthn (phishing-resistance weakened)",
  );
} else {
  console.log("PASS  invariant: no password/ambiguous method ever maps up to webauthn");
}

if (failures === 0) {
  console.log(
    "SMOKE_RESULT: amr+gla_uv->strength mapping correct (verified passkey=webauthn, password=password, never up-map)",
  );
  process.exit(0);
}
console.log(`SMOKE_RESULT: ${failures} case(s) failed`);
process.exit(1);
