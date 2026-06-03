// @gla/auth-authentik · a CONTROLLABLE fake-authentik OIDC test double (GLA-068 tests).
//
// An in-process helper (NO real network) that stands in for authentik so the adapter's OIDC client can be
// driven deterministically: an EC keypair (via `jose`), a function to MINT a signed id_token with chosen
// claims (`{sub, amr, acr, nonce, aud, iss, exp, …}`), a JWKS resolver backed by that key, and a fake token
// endpoint the adapter's injected `fetch` seam routes to (mapping an authorization `code` → a minted id_token,
// or a chosen HTTP failure). This lets the tests cover the happy path AND every typed rejection (bad signature,
// wrong issuer/audience, expired, nonce mismatch, replay, token-exchange failure, subject mismatch) with the
// `crypto.subtle`-shaped flow the production adapter uses — only the network is faked.
//
// This is a TEST helper (imported only by the adapter's tests); it is boundary-clean (depends only on `jose`).

import {
  type CryptoKey,
  type JWK,
  type JWTVerifyGetKey,
  SignJWT,
  UnsecuredJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import type { FetchLike } from "./oidc.js";

/** The algorithm the fake IdP signs id_tokens with (ES256 — a passkey-grade EC signature). */
const ALG = "ES256";

/** Claims the test chooses for a minted id_token. Sensible defaults are filled by {@link FakeAuthentik.mintIdToken}. */
export interface MintIdTokenClaims {
  /** The subject (the stable authentik user id). Default `"sub-default"`. */
  sub?: string;
  /** The `nonce` (must equal the attempt's nonce for a valid token). Default omitted (→ a nonce-mismatch). */
  nonce?: string;
  /** The `amr` method references (RFC 8176), e.g. `["swk"]` (passkey) or `["pwd"]` (password). */
  amr?: string[];
  /** The `acr` context value (the coarse fallback). */
  acr?: string;
  /** Override the issuer (`iss`). Default the fake's configured issuer. */
  iss?: string;
  /** Override the audience (`aud`) — a single value OR an ARRAY (a multi-audience token). Default the client id. */
  aud?: string | string[];
  /** The Authorized Party (`azp`) claim — set it for a multi-audience token (OIDC Core §3.1.3.7). */
  azp?: string;
  /** Override `iat` (epoch SECONDS). Default `now`. */
  iat?: number;
  /** Override `exp` (epoch SECONDS). Default `now + 300`. */
  exp?: number;
  /** Override `nbf` (epoch SECONDS). Default `iat`. */
  nbf?: number;
}

/** How the fake token endpoint should respond to a given `code` (a minted token, or a chosen HTTP failure). */
type TokenEndpointResponse =
  | { kind: "id_token"; idToken: string }
  | { kind: "http_error"; status: number }
  | { kind: "no_id_token" };

/** Construction options for the fake IdP. */
export interface FakeAuthentikOptions {
  /** The issuer (`iss`) this fake asserts. Default `"https://idp.example/application/o/gla/"`. */
  issuerUrl?: string;
  /** The OIDC client id (the `aud`). Default `"gla-client"`. */
  clientId?: string;
  /** The token endpoint URL the adapter is configured with (the fake `fetch` routes this path). Default discovered. */
  tokenEndpoint?: string;
}

/**
 * A controllable in-process fake authentik. Construct it (optionally async via {@link create}), then:
 *  - `endpoints` / `jwks` — feed these into the adapter's config (no real network),
 *  - `mintIdToken(claims)` — produce a signed id_token with chosen claims,
 *  - `stageToken(code, idToken)` / `stageHttpError(code, status)` — script what the token endpoint returns for a `code`,
 *  - `fetch` — the `fetch` seam to inject into the adapter.
 */
export class FakeAuthentik {
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;

  /** The JWKS resolver (a LOCAL set over the fake's public key) — inject as the adapter's `jwks` seam. */
  readonly jwks: JWTVerifyGetKey;

  private readonly privateKey: CryptoKey;
  /** `code` → the staged token-endpoint response. A `code` with no staging yields an HTTP 400. */
  private readonly staged = new Map<string, TokenEndpointResponse>();
  /** A second JWKS (a DIFFERENT key) for minting bad-signature tokens jose will reject. */
  private readonly wrongKey: CryptoKey;

  private constructor(args: {
    issuerUrl: string;
    clientId: string;
    privateKey: CryptoKey;
    publicJwk: JWK;
    wrongKey: CryptoKey;
    tokenEndpoint?: string;
  }) {
    this.issuerUrl = args.issuerUrl;
    this.clientId = args.clientId;
    this.privateKey = args.privateKey;
    this.wrongKey = args.wrongKey;
    const base = args.issuerUrl.endsWith("/") ? args.issuerUrl : `${args.issuerUrl}/`;
    this.authorizationEndpoint = new URL("authorize/", base).toString();
    this.tokenEndpoint = args.tokenEndpoint ?? new URL("token/", base).toString();
    this.jwksUri = new URL("jwks/", base).toString();
    this.jwks = createLocalJWKSet({ keys: [args.publicJwk] });
  }

  /** Create a fake IdP (mints the EC keypair + a second "wrong" key for bad-signature tests). */
  static async create(opts: FakeAuthentikOptions = {}): Promise<FakeAuthentik> {
    const issuerUrl = opts.issuerUrl ?? "https://idp.example/application/o/gla/";
    const clientId = opts.clientId ?? "gla-client";
    const { publicKey, privateKey } = await generateKeyPair(ALG);
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "fake-key-1";
    publicJwk.alg = ALG;
    publicJwk.use = "sig";
    const wrong = await generateKeyPair(ALG);
    return new FakeAuthentik({
      issuerUrl,
      clientId,
      privateKey,
      publicJwk,
      wrongKey: wrong.privateKey,
      ...(opts.tokenEndpoint !== undefined ? { tokenEndpoint: opts.tokenEndpoint } : {}),
    });
  }

  /** The endpoint set to feed the adapter's `endpoints` override (skips discovery entirely). */
  endpoints(): { authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string } {
    return {
      authorizationEndpoint: this.authorizationEndpoint,
      tokenEndpoint: this.tokenEndpoint,
      jwksUri: this.jwksUri,
    };
  }

  /** Mint a signed id_token with the chosen claims (defaults: this fake's iss/aud, sub-default, now..+300s). */
  async mintIdToken(claims: MintIdTokenClaims = {}): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const iat = claims.iat ?? nowSec;
    const exp = claims.exp ?? nowSec + 300;
    const nbf = claims.nbf ?? iat;
    const payload: Record<string, unknown> = {};
    if (claims.nonce !== undefined) {
      payload.nonce = claims.nonce;
    }
    if (claims.amr !== undefined) {
      payload.amr = claims.amr;
    }
    if (claims.acr !== undefined) {
      payload.acr = claims.acr;
    }
    if (claims.azp !== undefined) {
      payload.azp = claims.azp;
    }
    return new SignJWT(payload)
      .setProtectedHeader({ alg: ALG, kid: "fake-key-1" })
      .setIssuer(claims.iss ?? this.issuerUrl)
      .setAudience(claims.aud ?? this.clientId)
      .setSubject(claims.sub ?? "sub-default")
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .setNotBefore(nbf)
      .sign(this.privateKey);
  }

  /**
   * Mint an UNSECURED (`alg:none`) id_token — no signature at all (the classic OIDC bypass attempt). The
   * adapter pins the signing algorithm to an asymmetric allow-list, so jose refuses `none` outright →
   * `bad_signature`. Used by the FIX-3 regression test.
   */
  async mintNoneAlgIdToken(claims: MintIdTokenClaims = {}): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const jwt = new UnsecuredJWT(claims.nonce !== undefined ? { nonce: claims.nonce } : {})
      .setIssuer(claims.iss ?? this.issuerUrl)
      .setAudience(claims.aud ?? this.clientId)
      .setSubject(claims.sub ?? "sub-default")
      .setIssuedAt(claims.iat ?? nowSec)
      .setExpirationTime(claims.exp ?? nowSec + 300);
    return jwt.encode();
  }

  /**
   * Mint an HMAC-signed (`HS256`) id_token using a symmetric secret — the alg-confusion attempt where an
   * attacker signs with a symmetric key while the IdP publishes an asymmetric JWKS. The adapter's pinned
   * asymmetric allow-list refuses `HS256` → `bad_signature`. Used by the FIX-3 regression test.
   */
  async mintHmacIdToken(claims: MintIdTokenClaims = {}): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const secret = new TextEncoder().encode("symmetric-secret-not-the-jwks-key");
    const payload: Record<string, unknown> = {};
    if (claims.nonce !== undefined) {
      payload.nonce = claims.nonce;
    }
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", kid: "fake-key-1" })
      .setIssuer(claims.iss ?? this.issuerUrl)
      .setAudience(claims.aud ?? this.clientId)
      .setSubject(claims.sub ?? "sub-default")
      .setIssuedAt(claims.iat ?? nowSec)
      .setExpirationTime(claims.exp ?? nowSec + 300)
      .sign(secret);
  }

  /**
   * Mint an id_token signed with a DIFFERENT key than the published JWKS (so `jose.jwtVerify` rejects the
   * signature → the adapter's `bad_signature` reason). The header still advertises `kid: fake-key-1`, so the
   * resolver finds a key but the signature does not verify against it.
   */
  async mintBadlySignedIdToken(claims: MintIdTokenClaims = {}): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {};
    if (claims.nonce !== undefined) {
      payload.nonce = claims.nonce;
    }
    if (claims.amr !== undefined) {
      payload.amr = claims.amr;
    }
    return new SignJWT(payload)
      .setProtectedHeader({ alg: ALG, kid: "fake-key-1" })
      .setIssuer(claims.iss ?? this.issuerUrl)
      .setAudience(claims.aud ?? this.clientId)
      .setSubject(claims.sub ?? "sub-default")
      .setIssuedAt(claims.iat ?? nowSec)
      .setExpirationTime(claims.exp ?? nowSec + 300)
      .sign(this.wrongKey);
  }

  /** Stage: the token endpoint returns this id_token for `code`. */
  stageToken(code: string, idToken: string): void {
    this.staged.set(code, { kind: "id_token", idToken });
  }

  /** Stage: the token endpoint returns an HTTP error (e.g. 400/500) for `code`. */
  stageHttpError(code: string, status: number): void {
    this.staged.set(code, { kind: "http_error", status });
  }

  /** Stage: the token endpoint returns a 2xx with NO `id_token` for `code` (a malformed token response). */
  stageNoIdToken(code: string): void {
    this.staged.set(code, { kind: "no_id_token" });
  }

  /** Convenience: mint a valid id_token for `claims` AND stage it for `code` in one call; returns the sub used. */
  async stageValidLogin(code: string, claims: MintIdTokenClaims = {}): Promise<string> {
    const idToken = await this.mintIdToken(claims);
    this.stageToken(code, idToken);
    return claims.sub ?? "sub-default";
  }

  /**
   * The `fetch` seam to inject into the adapter. It handles ONLY the configured token endpoint (a POST). It
   * parses the form body, reads `code`, and returns the staged response (a JSON `{id_token}`, an HTTP error,
   * or a 2xx with no id_token). Any other URL → a network error (the adapter should never call out otherwise,
   * since endpoints are injected and the JWKS is a local set). It also asserts the client auth + grant fields
   * are present (so a missing `client_secret`/`code_verifier` would surface in a test).
   */
  readonly fetch: FetchLike = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url !== this.tokenEndpoint) {
      throw new TypeError(`fake-authentik: unexpected fetch to ${url}`);
    }
    const bodyStr = typeof init?.body === "string" ? init.body : "";
    const form = new URLSearchParams(bodyStr);
    const code = form.get("code") ?? "";
    // Assert the relying-party sent the confidential-client auth + PKCE verifier + the code grant.
    this.lastTokenRequest = {
      grantType: form.get("grant_type") ?? "",
      code,
      clientId: form.get("client_id") ?? "",
      hasClientSecret: (form.get("client_secret") ?? "").length > 0,
      hasCodeVerifier: (form.get("code_verifier") ?? "").length > 0,
      redirectUri: form.get("redirect_uri") ?? "",
    };
    const staged = this.staged.get(code);
    if (staged === undefined) {
      return jsonResponse({ error: "invalid_grant" }, 400);
    }
    if (staged.kind === "http_error") {
      return jsonResponse({ error: "server_error" }, staged.status);
    }
    if (staged.kind === "no_id_token") {
      return jsonResponse({ access_token: "at", token_type: "Bearer" }, 200);
    }
    return jsonResponse({ id_token: staged.idToken, token_type: "Bearer" }, 200);
  };

  /** The fields of the most recent token-endpoint request (so a test can assert client-auth + PKCE were sent). */
  lastTokenRequest?: {
    grantType: string;
    code: string;
    clientId: string;
    hasClientSecret: boolean;
    hasCodeVerifier: boolean;
    redirectUri: string;
  };
}

/** Build a `Response` carrying a JSON body + status (for the fake token endpoint). */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
