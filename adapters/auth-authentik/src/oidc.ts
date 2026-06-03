// @gla/auth-authentik · the OIDC relying-party MACHINERY (authentik-integration.md §2/§3).
//
// The security-critical core: PKCE (S256) generation, the authorization-request URL, OIDC discovery, the
// token exchange, and id_token VALIDATION (signature via JWKS + iss/aud/exp/iat/nbf/nonce). Every check
// is explicit and classified with a typed {@link AuthFailReason} (doc §3, AC #3), so a reviewer/test can
// see exactly which check rejected. Uses `jose` for signature/claims, Node 22 native `fetch` (token
// exchange — injected as a seam so tests route it to a fake authentik with NO real network), and
// `crypto.subtle`/`randomUUID` for PKCE/state/nonce (also injectable for determinism).
//
// Boundary: depends only on `jose` + Node builtins (`node:crypto`) + the kernel port types — no GLA core.

import { webcrypto } from "node:crypto";
import {
  type JWTPayload,
  type JWTVerifyGetKey,
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
} from "jose";
import type { AuthFailReason } from "./stores.js";

// ── Injectable seams (defaults are production; tests inject deterministic/fake versions) ──────────────

/** The `fetch` seam (default global `fetch`). Tests inject a router to a fake authentik (no real network). */
export type FetchLike = typeof fetch;

/** A JWKS key resolver for `jose.jwtVerify` (default built from the JWKS URI; tests inject a local set). */
export type JwksResolver = JWTVerifyGetKey;

/** The PKCE pair: the high-entropy `verifier` (kept secret) + its `S256` `challenge` (sent to authentik). */
export interface PkcePair {
  /** The PKCE `code_verifier` — high-entropy, base64url, never leaves GLA (doc §3). */
  verifier: string;
  /** The PKCE `code_challenge` = base64url(SHA-256(verifier)) (sent as `code_challenge`, method `S256`). */
  challenge: string;
}

/** The deterministic-randomness seams the provider injects into the OIDC machinery (tests pin them). */
export interface OidcRandomness {
  /** Mint a fresh PKCE pair (default: 32 random bytes → verifier, SHA-256 → challenge). */
  pkce(): Promise<PkcePair>;
  /** Mint a one-time `state` (default: `randomUUID`). */
  randomState(): string;
  /** Mint a one-time `nonce` (default: `randomUUID`). */
  randomNonce(): string;
}

/** Base64url-encode raw bytes with no padding (PKCE / RFC 7636). */
function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** The default PKCE generator: 32 random bytes → `verifier`, base64url(SHA-256(verifier)) → `challenge` (S256). */
export async function defaultPkce(): Promise<PkcePair> {
  const verifierBytes = webcrypto.getRandomValues(new Uint8Array(32));
  const verifier = b64url(verifierBytes);
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

/** The default randomness seams (production): real PKCE + `randomUUID` state/nonce. */
export const DEFAULT_RANDOMNESS: OidcRandomness = {
  pkce: defaultPkce,
  randomState: () => webcrypto.randomUUID(),
  randomNonce: () => webcrypto.randomUUID(),
};

// ── OIDC endpoints (explicit overrides OR discovery via the issuer's well-known document) ─────────────

/** The three OIDC endpoints the adapter needs (the authorization, token, and JWKS URLs). */
export interface OidcEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

/** The subset of the OIDC discovery document (`.well-known/openid-configuration`) the adapter reads. */
interface DiscoveryDocument {
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  issuer?: string;
}

/**
 * Resolve the OIDC endpoints: explicit overrides win; any missing one is discovered from the issuer's
 * `.well-known/openid-configuration`. Discovery is fetched at most once (cached on the returned object by
 * the caller). Throws a clear error if discovery is needed but fails or omits a required endpoint.
 *
 * @param issuerUrl the authentik OIDC issuer (e.g. `https://idp.example/application/o/gla/`)
 * @param overrides any explicitly-configured endpoints (skip discovery for those)
 * @param fetchImpl the `fetch` seam
 */
export async function resolveEndpoints(
  issuerUrl: string,
  overrides: Partial<OidcEndpoints>,
  fetchImpl: FetchLike,
): Promise<OidcEndpoints> {
  if (
    overrides.authorizationEndpoint !== undefined &&
    overrides.tokenEndpoint !== undefined &&
    overrides.jwksUri !== undefined
  ) {
    return {
      authorizationEndpoint: overrides.authorizationEndpoint,
      tokenEndpoint: overrides.tokenEndpoint,
      jwksUri: overrides.jwksUri,
    };
  }
  const wellKnown = new URL(
    ".well-known/openid-configuration",
    issuerUrl.endsWith("/") ? issuerUrl : `${issuerUrl}/`,
  ).toString();
  let doc: DiscoveryDocument;
  try {
    const res = await fetchImpl(wellKnown, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`discovery returned HTTP ${res.status}`);
    }
    doc = (await res.json()) as DiscoveryDocument;
  } catch (e) {
    throw new Error(`OIDC discovery failed for ${wellKnown}: ${String(e)}`);
  }
  const authorizationEndpoint = overrides.authorizationEndpoint ?? doc.authorization_endpoint;
  const tokenEndpoint = overrides.tokenEndpoint ?? doc.token_endpoint;
  const jwksUri = overrides.jwksUri ?? doc.jwks_uri;
  if (authorizationEndpoint === undefined || tokenEndpoint === undefined || jwksUri === undefined) {
    throw new Error(`OIDC discovery document missing a required endpoint at ${wellKnown}`);
  }
  return { authorizationEndpoint, tokenEndpoint, jwksUri };
}

/** A default JWKS resolver backed by `jose.createRemoteJWKSet` (cached internally by jose). */
export function remoteJwksResolver(jwksUri: string): JwksResolver {
  return createRemoteJWKSet(new URL(jwksUri));
}

// ── The authorization request (challenge / beginEnrollment build this) ────────────────────────────────

/** The inputs to build an OIDC authorization-request URL. */
export interface AuthorizeRequest {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

/**
 * Build the OIDC authorization-request URL (doc §2/§3): `response_type=code` + `client_id` + `redirect_uri`
 * + `scope` + one-time `state` + one-time `nonce` + PKCE `code_challenge`/`code_challenge_method=S256`. The
 * returned URL is the opaque "challenge" the kernel sees (`AuthChallenge = unknown`); the human authenticates
 * AT authentik and is redirected back to `redirect_uri` with `?code&state`.
 */
export function buildAuthorizeUrl(req: AuthorizeRequest): string {
  const url = new URL(req.authorizationEndpoint);
  const p = url.searchParams;
  p.set("response_type", "code");
  p.set("client_id", req.clientId);
  p.set("redirect_uri", req.redirectUri);
  p.set("scope", req.scope);
  p.set("state", req.state);
  p.set("nonce", req.nonce);
  p.set("code_challenge", req.codeChallenge);
  p.set("code_challenge_method", "S256");
  return url.toString();
}

// ── The token exchange (verifyAssertion / finishEnrollment do this) ───────────────────────────────────

/** The token-endpoint response shape the adapter reads (only `id_token` is required for validation). */
interface TokenResponse {
  id_token?: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

/** A discriminated token-exchange result: the raw `id_token`, or a typed failure reason. */
export type TokenExchangeResult =
  | { ok: true; idToken: string }
  | { ok: false; reason: Extract<AuthFailReason, "token_exchange_failed" | "no_id_token"> };

/** The inputs to exchange an authorization `code` for tokens (authorization_code grant + PKCE + client auth). */
export interface TokenExchangeRequest {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}

/**
 * Exchange an authorization `code` (+ the stored PKCE `code_verifier`) at the token endpoint for tokens,
 * authenticating the confidential client with `client_secret` (doc §2/§3). On any non-2xx / network /
 * parse failure → `token_exchange_failed`; on a 2xx with no `id_token` → `no_id_token`. The `client_secret`
 * is sent in the POST body (standard `client_secret_post`) and is NEVER logged.
 */
export async function exchangeCode(
  req: TokenExchangeRequest,
  fetchImpl: FetchLike,
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: req.code,
    redirect_uri: req.redirectUri,
    client_id: req.clientId,
    client_secret: req.clientSecret,
    code_verifier: req.codeVerifier,
  });
  let res: Response;
  try {
    res = await fetchImpl(req.tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
  } catch {
    // Network/transport failure — the provider is unreachable (doc §9 risk 6: fail closed).
    return { ok: false, reason: "token_exchange_failed" };
  }
  if (!res.ok) {
    return { ok: false, reason: "token_exchange_failed" };
  }
  let parsed: TokenResponse;
  try {
    parsed = (await res.json()) as TokenResponse;
  } catch {
    return { ok: false, reason: "token_exchange_failed" };
  }
  if (typeof parsed.id_token !== "string" || parsed.id_token.length === 0) {
    return { ok: false, reason: "no_id_token" };
  }
  return { ok: true, idToken: parsed.id_token };
}

// ── id_token validation (the heart of verifyAssertion / finishEnrollment) ─────────────────────────────

/** The validated id_token claims the adapter acts on: the subject + the method claims (`amr`/`acr`) + nonce. */
export interface ValidatedIdToken {
  sub: string;
  amr?: string[];
  acr?: string;
  nonce?: string;
}

/** A discriminated id_token validation result: the validated claims, or a typed failure reason. */
export type IdTokenValidation =
  | { ok: true; claims: ValidatedIdToken }
  | { ok: false; reason: AuthFailReason };

/** The inputs to validate an id_token. */
export interface ValidateIdTokenRequest {
  idToken: string;
  issuerUrl: string;
  clientId: string;
  expectedNonce: string;
  clockToleranceSec: number;
  /** Current epoch-ms (the `now()` seam) — used for the `iat`-not-in-future check jose does not do by default. */
  nowMs: number;
}

/**
 * Map a `jose` verification error to the precise typed {@link AuthFailReason} (doc §3, AC #3). A claim
 * failure carries the offending `.claim` (`iss`/`aud`/`exp`/`nbf`/`iat`); a signature / no-matching-key /
 * unsupported-alg failure is a `bad_signature` (a rejected `alg:none`/HMAC/unsupported algorithm is a
 * signature-integrity failure, not a generic shape error); anything else is a generic `invalid_token`.
 */
function reasonForJoseError(e: unknown): AuthFailReason {
  if (e instanceof joseErrors.JWTExpired) {
    return "expired"; // exp in the past (jose's dedicated subclass).
  }
  if (e instanceof joseErrors.JWTClaimValidationFailed) {
    switch (e.claim) {
      case "iss":
        return "wrong_issuer";
      case "aud":
        return "wrong_audience";
      case "exp":
      case "nbf":
      case "iat":
        return "expired"; // not-yet-valid / issued-in-future skew → the "expired/skew" tier.
      default:
        return "invalid_token";
    }
  }
  if (
    e instanceof joseErrors.JWSSignatureVerificationFailed ||
    e instanceof joseErrors.JWKSNoMatchingKey ||
    e instanceof joseErrors.JWSInvalid ||
    e instanceof joseErrors.JWTInvalid ||
    // An unsupported / disallowed algorithm (`alg:none`, HMAC against a public key, a non-allow-listed alg)
    // is a signature-integrity rejection — FIX 3: classify it as `bad_signature`, not `invalid_token`.
    e instanceof joseErrors.JOSENotSupported ||
    e instanceof joseErrors.JOSEAlgNotAllowed
  ) {
    return "bad_signature";
  }
  return "invalid_token";
}

/**
 * Validate an id_token (doc §3 step (d), AC #3). In order:
 *  1. signature via the JWKS resolver (`jose.jwtVerify`), with the signing algorithm PINNED to an
 *     asymmetric allow-list (`ES256`/`RS256`) — `alg:none`/HMAC/any other alg is refused as `bad_signature`,
 *  2. `iss === issuerUrl` (jose, typed `wrong_issuer`),
 *  3. `aud` includes `clientId` (jose, typed `wrong_audience`),
 *  4. when `aud` is an ARRAY with >1 audience, `azp === clientId` (OIDC Core §3.1.3.7; typed `azp_mismatch`) —
 *     jose only checks `aud` MEMBERSHIP, so a multi-audience token would otherwise pass for a co-listed client,
 *  5. `exp`/`nbf` within `clockTolerance` (jose, typed `expired`),
 *  6. `iat` not in the future beyond `clockTolerance` (checked here — jose skips `iat` by default),
 *  7. `nonce === expectedNonce` (checked here — jose does not check nonce; typed `nonce_mismatch`),
 *  8. a non-empty `sub` is present (typed `no_subject`).
 * Returns the validated `{sub, amr, acr, nonce}` on success, else a typed failure. No strength is derived
 * here (that is `strength.ts`); this only validates and surfaces the claims.
 */
export async function validateIdToken(
  req: ValidateIdTokenRequest,
  jwks: JwksResolver,
): Promise<IdTokenValidation> {
  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(req.idToken, jwks, {
      issuer: req.issuerUrl,
      audience: req.clientId,
      clockTolerance: req.clockToleranceSec,
      // FIX 3 — pin the signing algorithm to an asymmetric allow-list. jose already structurally refuses
      // `none`/symmetric keys against an asymmetric JWKS, but stating the intent makes it auditable and
      // closes any alg-confusion surface explicitly. An out-of-list alg → `JOSEAlgNotAllowed` → `bad_signature`.
      algorithms: ["ES256", "RS256"],
    });
    payload = verified.payload;
  } catch (e) {
    return { ok: false, reason: reasonForJoseError(e) };
  }

  // 4) Multi-audience guard (OIDC Core §3.1.3.7) — jose's `audience` option only checks MEMBERSHIP, so a
  //    token with `aud:["gla-client","attacker-client"]` passes step 3. When `aud` is an array of >1, the
  //    Authorized Party (`azp`) MUST be present AND equal our client id, else this token was not issued FOR us.
  //    A single-audience token (the common case) is unaffected — this guard never fires for it.
  if (Array.isArray(payload.aud) && payload.aud.length > 1) {
    if (payload.azp !== req.clientId) {
      return { ok: false, reason: "azp_mismatch" };
    }
  }

  // 6) `iat` not in the FUTURE beyond tolerance (jose only checks iat when `maxTokenAge` is set). A token
  //    minted in the future is suspect — classify as the skew/`expired` tier (doc: "iat within clockTolerance").
  if (typeof payload.iat === "number") {
    const nowSec = Math.floor(req.nowMs / 1000);
    if (payload.iat > nowSec + req.clockToleranceSec) {
      return { ok: false, reason: "expired" };
    }
  }

  // 6) `nonce` — bind the token to THIS authorization request (anti-replay). jose does NOT check nonce.
  const nonce = typeof payload.nonce === "string" ? payload.nonce : undefined;
  if (nonce !== req.expectedNonce) {
    return { ok: false, reason: "nonce_mismatch" };
  }

  // 7) a stable, non-empty `sub` must be present (we bind/check the recipient against it).
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return { ok: false, reason: "no_subject" };
  }

  const amr = Array.isArray(payload.amr)
    ? payload.amr.filter((m): m is string => typeof m === "string")
    : undefined;
  const acr = typeof payload.acr === "string" ? payload.acr : undefined;
  const claims: ValidatedIdToken = { sub: payload.sub };
  if (amr !== undefined) {
    claims.amr = amr;
  }
  if (acr !== undefined) {
    claims.acr = acr;
  }
  if (nonce !== undefined) {
    claims.nonce = nonce;
  }
  return { ok: true, claims };
}
