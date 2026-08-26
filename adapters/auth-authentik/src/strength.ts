// @gla/auth-authentik · method → AuthStrength mapping (authentik-integration.md §4, AC #3/#5).
//
// authentik reports HOW a human authenticated in the id_token claims (`amr` — RFC 8176 method
// references — with `acr` as the coarse fallback). A WebAuthn/passkey label is only a method signal: it
// becomes GLA's strongest tier when the token also carries an explicit user-verification/equivalent proof.
// Without that proof, the valid login degrades to the password floor with diagnostics.
//
// The mapping is a PURE function of `{amr?, acr?}` + the (operator-overridable) method maps — no I/O,
// no clock, no state. It is the single place the §4 table lives, exhaustively unit-tested. The hard
// rule it encodes (doc §4): NEVER up-map — a missing/ambiguous method must never silently become
// `webauthn` (that would weaken the phishing-resistance guarantee); the floor for a VALID token is
// `password`, and `none` is reserved for an INVALID token (decided by the verifier, not here).

import {
  type AuthAssuranceDiagnostic,
  type AuthAssuranceEvidence,
  type AuthStrength,
  assuranceFromAuthStrength,
} from "@gla/kernel";

/**
 * The subset of `id_token` claims this mapping keys on. `amr` is the precise per-method signal (an
 * OIDC-standard JSON array, RFC 8176); `acr` is the coarser single-value fallback some flows set. A
 * deployment-owned custom claim supplies the provider-neutral user-verification proof. All are optional —
 * a valid token may carry no resolvable method (→ the `password` floor).
 */
export interface MethodClaims {
  /** Authentication Methods References (RFC 8176), e.g. `["swk"]` (passkey) or `["pwd","mfa"]`. */
  amr?: string[];
  /** Authentication Context Class Reference — the coarse fallback when `amr` is absent. */
  acr?: string;
  /** Provider-confirmed user verification or equivalent proof for passkey/WebAuthn-labelled methods. */
  userVerified?: boolean;
}

/** Provider-neutral facts known by the OIDC verifier outside native method labels. */
export interface MethodAssuranceContext {
  /** The id_token subject/audience was bound to the intended recipient/client. */
  recipientBound?: boolean;
  /** The one-time OIDC state/nonce/PKCE exchange was consumed and validated. */
  replayResistant?: boolean;
}

/**
 * The operator-overridable method→strength maps (doc §4: "driven from a small, operator-visible map so
 * a deployment whose authentik labels differ does not require a code change — but the defaults are the
 * contract"). `webauthnAmr`/`passwordAmr` are the `amr` token sets; `webauthnAcr`/`passwordAcr` are the
 * `acr` context values. All matching is case-insensitive (authentik labels vary in case across builds).
 */
export interface MethodMaps {
  /** `amr` tokens that mean a phishing-resistant key (→ `webauthn`). Default `{hwk,swk,webauthn,fido}`. */
  webauthnAmr: ReadonlySet<string>;
  /** `amr` tokens that mean a typed password (→ `password`). Default `{pwd}`. */
  passwordAmr: ReadonlySet<string>;
  /** `acr` values an operator maps to a passkey/phishing-resistant context (→ `webauthn`). Default `{phr}`. */
  webauthnAcr: ReadonlySet<string>;
  /** `acr` values an operator maps to a password context (→ `password`). Default `{phrh}` is NOT here (it is *not* asserted). */
  passwordAcr: ReadonlySet<string>;
}

/**
 * The §4 default maps (the CONTRACT). The passkey set is the canonical RFC 8176 key tokens
 * `{hwk, swk, webauthn, fido}`; the password set is `{pwd}`. The MFA companions `{mfa, otp, sms}` are
 * deliberately NOT in any set: MFA on top of a password is still not phishing-resistant key auth, so a
 * `["pwd","mfa"]` login stays `password` (the `pwd` match wins at the password tier, the companions are
 * ignored). For `acr`, the OIDC well-known phishing-resistant indicator `"phr"` maps to `webauthn`;
 * `"phrh"` (phishing-resistant *hardware*) would too if an operator adds it, but the default keeps only
 * `phr` — and crucially `phrh` is *not* a password context either, so an unmapped `acr` falls to the
 * `password` floor (never up-mapped).
 */
export const DEFAULT_METHOD_MAPS: MethodMaps = {
  webauthnAmr: new Set(["hwk", "swk", "webauthn", "fido"]),
  passwordAmr: new Set(["pwd"]),
  webauthnAcr: new Set(["phr"]),
  passwordAcr: new Set(["pwd", "password"]),
};

/** Lower-case a token for case-insensitive matching against the maps. */
function norm(token: string): string {
  return token.toLowerCase();
}

/** Does the (normalized) `amr` array intersect the given (already-normalized) token set? */
function amrHasAny(amr: readonly string[] | undefined, set: ReadonlySet<string>): boolean {
  if (amr === undefined) {
    return false;
  }
  for (const token of amr) {
    if (set.has(norm(token))) {
      return true;
    }
  }
  return false;
}

function matchedMethod(
  claims: MethodClaims,
  maps: MethodMaps,
): "webauthn" | "password" | "unresolved" {
  if (amrHasAny(claims.amr, maps.webauthnAmr)) {
    return "webauthn";
  }
  if (amrHasAny(claims.amr, maps.passwordAmr)) {
    return "password";
  }
  if (claims.acr !== undefined) {
    const acr = norm(claims.acr);
    if (maps.webauthnAcr.has(acr)) {
      return "webauthn";
    }
    if (maps.passwordAcr.has(acr)) {
      return "password";
    }
  }
  return "unresolved";
}

function diagnosticsFor(
  claims: MethodClaims,
  maps: MethodMaps,
  context: MethodAssuranceContext,
): AuthAssuranceDiagnostic[] {
  const method = matchedMethod(claims, maps);
  const diagnostics: AuthAssuranceDiagnostic[] = [];
  if (method === "webauthn" && claims.userVerified !== true) {
    diagnostics.push("missing-user-verification");
  }
  if (method === "webauthn" && claims.userVerified === true && context.recipientBound !== true) {
    diagnostics.push("missing-recipient-binding");
  }
  if (method === "webauthn" && claims.userVerified === true && context.replayResistant !== true) {
    diagnostics.push("missing-replay-resistant-challenge");
  }
  if (method === "unresolved") {
    diagnostics.push("method-unresolved", "ambiguous-provider-evidence");
  }
  if (method === "password") {
    diagnostics.push("password-grade-proof");
  }
  return diagnostics;
}

/**
 * Map an id_token's method claims onto `AuthStrength`, per doc §4 (AC #3/#5). The token is assumed
 * already VALID (signature/issuer/audience/nonce/exp checked by the verifier) — this only classifies
 * the *method*, so it never returns `"none"` (that tier is the verifier's, for an INVALID token).
 *
 * Precedence (highest matching method wins only when its assurance proof is present):
 *  1. `amr` ∩ webauthn-set with `userVerified:true`             → `"webauthn"`
 *  2. else `amr` ∩ password-set (`{pwd}`, with/without MFA)     → `"password"`
 *  3. else `acr` ∈ webauthn-acr with `userVerified:true`        → `"webauthn"`
 *  4. else `acr` ∈ password-acr (password context)              → `"password"`
 *  5. else (valid token, unverified or unresolvable method)     → `"password"`  (the floor; NEVER up-map)
 *
 * Step 5 is the doc's "valid token but no resolvable method → `password` (never silently `webauthn`,
 * never `none`)" rule — and the caller records it as an operator CONCERN (doc §9).
 *
 * @param claims the `{amr, acr}` read off the validated id_token
 * @param maps   the method maps (defaults to {@link DEFAULT_METHOD_MAPS}; operator-overridable)
 * @returns the derived `AuthStrength` (`"webauthn"` or `"password"` — never `"none"`)
 */
export function mapMethodToStrength(
  claims: MethodClaims,
  maps: MethodMaps = DEFAULT_METHOD_MAPS,
): AuthStrength {
  const method = matchedMethod(claims, maps);
  if (method === "webauthn" && claims.userVerified === true) {
    return "webauthn";
  }
  return "password";
}

/**
 * Does this method claim resolve to a concrete tier, or did it fall through to the `password` floor
 * (the doc §4 "unresolvable method" case the caller flags as a CONCERN, doc §9)? Returns `false` when
 * neither `amr` nor `acr` matched any configured set — i.e. step 5 above produced the floor.
 */
export function methodResolvable(
  claims: MethodClaims,
  maps: MethodMaps = DEFAULT_METHOD_MAPS,
): boolean {
  return matchedMethod(claims, maps) !== "unresolved";
}

/** Project authentik method claims into GLA's provider-neutral assurance evidence contract. */
export function mapMethodToAssurance(
  claims: MethodClaims,
  maps: MethodMaps = DEFAULT_METHOD_MAPS,
  context: MethodAssuranceContext = {},
): AuthAssuranceEvidence {
  const providerEvidence: Record<string, unknown> = {};
  if (claims.amr !== undefined) {
    providerEvidence.amr = claims.amr;
  }
  if (claims.acr !== undefined) {
    providerEvidence.acr = claims.acr;
  }
  if (claims.userVerified !== undefined) {
    providerEvidence.userVerified = claims.userVerified;
  }
  const diagnostics = diagnosticsFor(claims, maps, context);
  return assuranceFromAuthStrength(mapMethodToStrength(claims, maps), {
    methodResolvable: methodResolvable(claims, maps),
    ...(claims.userVerified !== undefined ? { userVerified: claims.userVerified } : {}),
    ...(context.recipientBound !== undefined ? { recipientBound: context.recipientBound } : {}),
    ...(context.replayResistant !== undefined ? { replayResistant: context.replayResistant } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    providerEvidence,
  });
}

/**
 * Build a {@link MethodMaps} from optional operator overrides (the `GLA_AUTHENTIK_AMR_MAP` /
 * `GLA_AUTHENTIK_ACR_MAP` config, doc §7). Any set left undefined keeps its {@link DEFAULT_METHOD_MAPS}
 * value, so a partial override (e.g. only extra `webauthnAmr` labels) still honors the rest of the
 * contract. Tokens are normalized to lower-case so matching is case-insensitive.
 */
export function methodMaps(
  overrides?: Partial<Record<keyof MethodMaps, Iterable<string>>>,
): MethodMaps {
  const pick = (key: keyof MethodMaps): ReadonlySet<string> => {
    const ov = overrides?.[key];
    if (ov === undefined) {
      return DEFAULT_METHOD_MAPS[key];
    }
    return new Set([...ov].map(norm));
  };
  return {
    webauthnAmr: pick("webauthnAmr"),
    passwordAmr: pick("passwordAmr"),
    webauthnAcr: pick("webauthnAcr"),
    passwordAcr: pick("passwordAcr"),
  };
}
