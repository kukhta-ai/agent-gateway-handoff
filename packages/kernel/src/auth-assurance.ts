import type { AuthStrength } from "./ports.js";

/** Provider-neutral auth assurance tiers used by enforcement points. */
export type AuthAssuranceLevel = "none" | "password" | "phishing-resistant";

/** Operator-facing deployment profiles for recipient step-up requirements. */
export type AuthAssuranceProfile = "phishing-resistant" | "password-permitted";

/** A resolved assurance policy that can be evaluated without provider-specific method names. */
export interface AuthAssurancePolicy {
  /** The stable operator-facing profile name. */
  profile: AuthAssuranceProfile;
  /** The minimum provider-neutral assurance level required for this policy. */
  minimumLevel: Exclude<AuthAssuranceLevel, "none">;
}

/** Provider-reported evidence after adapter-local method claims have been projected into GLA terms. */
export interface AuthAssuranceEvidence {
  /** Compatibility fact kept for existing identity/gateway surfaces. */
  authStrength: AuthStrength;
  /** Provider-neutral assurance tier used for policy evaluation. */
  level: AuthAssuranceLevel;
  /** Whether provider-local claims matched a configured method map instead of falling to a safe floor. */
  methodResolvable?: boolean;
  /** Sanitized provider-local evidence for diagnostics; enforcement must not branch on these fields. */
  providerEvidence?: Record<string, unknown>;
}

/** Machine-distinguishable parse result for operator-provided assurance profile values. */
export type AuthAssuranceProfileParseResult =
  | { ok: true; profile: AuthAssuranceProfile }
  | {
      ok: false;
      reason: "unknown-profile";
      value: string;
      expected: readonly AuthAssuranceProfile[];
    };

/** All supported operator-facing assurance profile values. */
export const AUTH_ASSURANCE_PROFILE_VALUES = [
  "phishing-resistant",
  "password-permitted",
] as const satisfies readonly AuthAssuranceProfile[];

/** Secure default: require passkey/phishing-resistant-grade evidence. */
export const DEFAULT_AUTH_ASSURANCE_PROFILE: AuthAssuranceProfile = "phishing-resistant";

const LEVEL_RANK: Record<AuthAssuranceLevel, number> = {
  none: 0,
  password: 1,
  "phishing-resistant": 2,
};

/** Parse an optional operator profile value, defaulting securely and rejecting unknown values explicitly. */
export function parseAuthAssuranceProfile(
  value: string | undefined,
): AuthAssuranceProfileParseResult {
  if (value === undefined || value === "") {
    return { ok: true, profile: DEFAULT_AUTH_ASSURANCE_PROFILE };
  }
  if (isAuthAssuranceProfile(value)) {
    return { ok: true, profile: value };
  }
  return {
    ok: false,
    reason: "unknown-profile",
    value,
    expected: AUTH_ASSURANCE_PROFILE_VALUES,
  };
}

/** Return whether a string is one of the supported assurance profile names. */
export function isAuthAssuranceProfile(value: string): value is AuthAssuranceProfile {
  return (AUTH_ASSURANCE_PROFILE_VALUES as readonly string[]).includes(value);
}

/** Resolve an operator-facing profile into the policy enforced by the gateway. */
export function authAssurancePolicyFromProfile(
  profile: AuthAssuranceProfile = DEFAULT_AUTH_ASSURANCE_PROFILE,
): AuthAssurancePolicy {
  switch (profile) {
    case "password-permitted":
      return { profile, minimumLevel: "password" };
    case "phishing-resistant":
      return { profile, minimumLevel: "phishing-resistant" };
  }
}

/** Translate the deprecated `requiredAuthStrength` compatibility input into the new profile policy. */
export function authAssurancePolicyFromRequiredAuthStrength(
  strength: Exclude<AuthStrength, "none">,
): AuthAssurancePolicy {
  return authAssurancePolicyFromProfile(
    strength === "password" ? "password-permitted" : "phishing-resistant",
  );
}

/** Project the legacy `AuthStrength` fact into the provider-neutral assurance tier. */
export function assuranceLevelFromAuthStrength(strength: AuthStrength): AuthAssuranceLevel {
  switch (strength) {
    case "webauthn":
      return "phishing-resistant";
    case "password":
      return "password";
    case "none":
      return "none";
  }
}

/** Build common assurance evidence from a legacy strength fact plus optional provider diagnostics. */
export function assuranceFromAuthStrength(
  authStrength: AuthStrength,
  details: {
    methodResolvable?: boolean;
    providerEvidence?: Record<string, unknown>;
  } = {},
): AuthAssuranceEvidence {
  return {
    authStrength,
    level: assuranceLevelFromAuthStrength(authStrength),
    ...(details.methodResolvable !== undefined
      ? { methodResolvable: details.methodResolvable }
      : {}),
    ...(details.providerEvidence !== undefined
      ? { providerEvidence: details.providerEvidence }
      : {}),
  };
}

/** Decide whether common assurance evidence satisfies a resolved deployment policy. */
export function authAssuranceSufficient(
  evidence: AuthAssuranceEvidence | AuthStrength,
  policy: AuthAssurancePolicy = authAssurancePolicyFromProfile(),
): boolean {
  const level =
    typeof evidence === "string" ? assuranceLevelFromAuthStrength(evidence) : evidence.level;
  return LEVEL_RANK[level] >= LEVEL_RANK[policy.minimumLevel];
}
