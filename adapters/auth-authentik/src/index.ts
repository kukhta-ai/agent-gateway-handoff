// @gla/auth-authentik — adapter ring (baseline §1).
// The DELEGATED AuthProvider (authentik-integration.md, GLA-067/068): an in-tree OIDC RELYING-PARTY
// client that implements the kernel `AuthProviderPort` (kernel-contracts.md §6) over an OIDC
// authorization-code + PKCE round-trip to authentik. It is the heavyweight ALTERNATIVE behind the SAME
// seam the in-tree default `@gla/auth-webauthn` implements — selecting it changes NO gateway/core code,
// only `packages/app`'s wiring (§1; GLA-013 AC#5; baseline §6).
//
// It MIRRORS the WebAuthn adapter's structure (injectable `KvStore` seams, in-memory defaults, atomic-on-
// verified, returns FACTS not decisions, this header style), substituting OIDC for WebAuthn:
//   challenge(userId)                   → build the OIDC authorization request → {kind:"redirect", authorizeUrl}
//   verifyAssertion(userId,{code,state})→ exchange + validate the id_token + check `sub` vs the binding
//   beginEnrollment(userId, discharge)  → the same authorization request (kind:"register")
//   finishEnrollment(userId,{code,state})→ exchange + validate → ATOMICALLY bind the `sub`
// It reports FACTS (ok + auth_strength + optional assurance evidence), never an access decision. The human
// authenticates AT authentik (passkey/password/MFA) — GLA never sees the credential; authentik holds it
// (§5). What GLA stores instead is the STABLE OIDC `sub` the recipient is bound to.
//
// Boundary: this is an adapter; it depends ONLY on `@gla/kernel` port types + the one library it wraps
// (`jose`, for id_token signature/claims) + Node builtins (`fetch`/`crypto`). Core/edge packages depend on
// the kernel `AuthProviderPort`, never on this package — `app` injects it (the import-boundary lint proves it).
//
// State seams (injectable so `app` can supply a shared/persistent store and a test can inspect):
//   - a SUBJECTS store (durable: the recipient↔authentik-subject binding {sub}, keyed by userId) — the
//     delegated analogue of WebAuthn's credential store; the provider-specific DURABLE fact.
//   - an ATTEMPTS store (transient: the in-flight OIDC attempt {state,nonce,codeVerifier,…}, keyed by state)
//     — consumed ONE-TIME on callback (anti-CSRF / anti-replay, §3).
// The actual secret (passkey/password) lives REMOTELY in authentik — this adapter "holds nothing locally"
// but the `sub` binding (exactly the split the auth-webauthn header anticipated for "an authentik adapter").
//
// NOTE — built around THIS adapter, but not inside it:
//   • The GLA-served browser callback page + step-up-page redirect (location.assign(authorizeUrl)) + the dual-method
//     UX are GLA-072 (§2: the adapter's challenge() return is the opaque {kind:"redirect", authorizeUrl}; the
//     gateway page only needs to START the redirect; the callback re-POSTs {code,state} to the gateway's
//     existing /handoff/auth/verify as the opaque assertion — the gateway stays byte-for-byte unchanged).
//   • The enrollment OPERATOR flow (linking the subject on the identity-service side) is GLA-070 (this adapter
//     exposes beginEnrollment/finishEnrollment so 070 wires them).
//   • Standing authentik up (server+worker+Postgres+Redis + flow/stages emitting amr/acr) + the Caddy callback
//     route is the GLA-074 wpm installer (§6) — a host concern, never runtime code.

import type {
  AuthChallenge,
  AuthProviderEnrollmentResult,
  AuthProviderPort,
  AuthProviderVerificationResult,
  EnrollmentChallenge,
  OpaqueToken,
  UserIdentity,
} from "@gla/kernel";
import {
  DEFAULT_RANDOMNESS,
  type FetchLike,
  type JwksResolver,
  type OidcEndpoints,
  type OidcRandomness,
  buildAuthorizeUrl,
  exchangeCode,
  remoteJwksResolver,
  resolveEndpoints,
  validateIdToken,
} from "./oidc.js";
import {
  type AttemptKind,
  type AuthFailReason,
  type BoundSubject,
  InMemoryKv,
  type KvStore,
  type PendingAttempt,
  type VerifyOutcome,
} from "./stores.js";
import { type MethodMaps, mapMethodToAssurance, methodMaps } from "./strength.js";

/** Stable identifier for this module (used by the `app` composition root's wiring record). */
export const AUTH_AUTHENTIK_MODULE = "@gla/auth-authentik" as const;
/** Ring classification from the architecture baseline (informational). */
export const AUTH_AUTHENTIK_RING = "adapter" as const;

/** The opaque challenge this adapter returns (doc §2): a top-level REDIRECT to authentik's authorize endpoint. */
export interface RedirectChallenge {
  /** Discriminant — distinguishes this from WebAuthn's options JSON behind the opaque `AuthChallenge`. */
  kind: "redirect";
  /** The fully-built OIDC authorization-request URL the step-up page does `location.assign(...)` on (GLA-072). */
  authorizeUrl: string;
}

/** The assertion this adapter's verify/finish methods consume (doc §3): the callback's `?code&state` params. */
export interface OidcAssertion {
  /** The authorization `code` authentik redirected back with. */
  code: string;
  /** The one-time `state` (looks up + consumes the pending attempt — anti-CSRF). */
  state: string;
}

/** The default scopes requested when none are configured (doc §7). */
const DEFAULT_SCOPES = "openid profile";
/** The default clock tolerance for id_token `exp`/`iat`/`nbf` checks (seconds). */
const DEFAULT_CLOCK_TOLERANCE_SEC = 60;
/** The default TTL for a pending OIDC attempt (ms) — a stale callback past this is refused (doc §3). */
const DEFAULT_ATTEMPT_TTL_MS = 10 * 60 * 1000;

/**
 * Construction options for the authentik (OIDC) auth provider. Mirrors `AuthWebauthnOptions` in spirit (an
 * injectable options object with in-memory store defaults), carrying the OIDC config the relying-party needs.
 * The `clientSecret` is OPAQUE/secret — it is sent only to the token endpoint and is NEVER logged (doc §9.5).
 */
export interface AuthAuthentikOptions {
  /** The authentik OIDC issuer, e.g. `https://idp.example/application/o/gla/` (the `iss` the id_token must carry). */
  issuerUrl: string;
  /** The OIDC client/application id (the `id_token` audience). */
  clientId: string;
  /** The confidential-client secret for the token exchange (`sensitive` — never logged, doc §9.5). */
  clientSecret: string;
  /** The GLA-served callback URL (the `redirect_uri`, doc §2) — fronted by the same host Caddy. */
  redirectUri: string;
  /** The OIDC scopes (space-separated). Default `"openid profile"`. */
  scopes?: string;
  /** Explicit endpoint overrides; any omitted endpoint is DISCOVERED from the issuer's well-known document. */
  endpoints?: Partial<OidcEndpoints>;
  /** The method→strength maps (operator overrides of the §4 defaults — see {@link DEFAULT_METHOD_MAPS}). */
  methodMaps?: MethodMaps;
  /** The clock tolerance (seconds) for id_token `exp`/`iat`/`nbf`. Default 60. */
  clockToleranceSec?: number;
  /** The pending-attempt TTL (ms). Default 10 minutes. */
  attemptTtlMs?: number;
  /** The durable recipient↔subject binding store (keyed by userId). Defaults to in-memory. */
  subjects?: KvStore<BoundSubject>;
  /** The transient pending-attempt store (keyed by state). Defaults to in-memory. */
  attempts?: KvStore<PendingAttempt>;
  /** The `fetch` seam (token exchange + discovery). Defaults to global `fetch`. */
  fetch?: FetchLike;
  /** The JWKS resolver for id_token signatures. Defaults to a remote JWKS set built from the discovered `jwks_uri`. */
  jwks?: JwksResolver;
  /** The randomness seams (PKCE / state / nonce). Defaults to real crypto + `randomUUID`. */
  randomness?: OidcRandomness;
  /** The wall-clock seam (epoch-ms). Defaults to `Date.now`. */
  now?: () => number;
  /**
   * A diagnostic sink invoked with the discriminated outcome of every verify/finish attempt (AC #3), so a
   * caller/test can observe the typed reason WITHOUT it leaking into the port result. Never receives the secret.
   */
  onVerifyOutcome?: (outcome: VerifyOutcome) => void;
}

/**
 * The delegated authentik {@link AuthProviderPort}. Construct with the OIDC config (issuer / client id /
 * secret / redirect uri) and optionally shared stores + deterministic seams. It runs the real OIDC
 * authorization-code + PKCE ceremony against authentik: build the authorization request → (the human
 * authenticates at authentik) → exchange the code → validate the id_token → check the `sub` against the
 * recipient's binding → report `{ok, authStrength, assurance?}`. It is the heavyweight ALTERNATIVE identity
 * provider behind the same port the in-tree WebAuthn default implements.
 */
export class AuthAuthentikProvider implements AuthProviderPort {
  private readonly issuerUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly scopes: string;
  private readonly endpointOverrides: Partial<OidcEndpoints>;
  private readonly maps: MethodMaps;
  private readonly clockToleranceSec: number;
  private readonly attemptTtlMs: number;
  private readonly subjects: KvStore<BoundSubject>;
  private readonly attempts: KvStore<PendingAttempt>;
  private readonly fetchImpl: FetchLike;
  private readonly randomness: OidcRandomness;
  private readonly now: () => number;
  private readonly onVerifyOutcome: ((outcome: VerifyOutcome) => void) | undefined;
  private readonly jwksInjected: boolean;

  /** A configured JWKS resolver (injected, or built lazily from the discovered `jwks_uri` on first use). */
  private jwksResolver: JwksResolver | undefined;
  /** Discovered/overridden endpoints, resolved at most once (then cached). */
  private endpoints: OidcEndpoints | undefined;

  constructor(opts: AuthAuthentikOptions) {
    this.issuerUrl = opts.issuerUrl;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.redirectUri = opts.redirectUri;
    this.scopes = opts.scopes ?? DEFAULT_SCOPES;
    this.endpointOverrides = opts.endpoints ?? {};
    this.maps = opts.methodMaps ?? methodMaps();
    this.clockToleranceSec = opts.clockToleranceSec ?? DEFAULT_CLOCK_TOLERANCE_SEC;
    this.attemptTtlMs = opts.attemptTtlMs ?? DEFAULT_ATTEMPT_TTL_MS;
    this.subjects = opts.subjects ?? new InMemoryKv<BoundSubject>();
    this.attempts = opts.attempts ?? new InMemoryKv<PendingAttempt>();
    this.fetchImpl = opts.fetch ?? fetch;
    this.jwksResolver = opts.jwks;
    this.jwksInjected = opts.jwks !== undefined;
    this.randomness = opts.randomness ?? DEFAULT_RANDOMNESS;
    this.now = opts.now ?? Date.now;
    this.onVerifyOutcome = opts.onVerifyOutcome;
  }

  // ── Port: challenge (step-up) ──────────────────────────────────────────────────────────────────────

  /**
   * Begin authentication (kernel `AuthProviderPort.challenge`): build the OIDC authorization request and
   * record the pending attempt keyed by `state`. **Throws if the user has no bound subject** — an un-enrolled
   * recipient cannot be stepped up (mirrors WebAuthn's `challenge` precondition; doc §3). Returns the opaque
   * {@link RedirectChallenge} (`{kind:"redirect", authorizeUrl}`); the human authenticates at authentik and is
   * redirected back to GLA's callback page with `?code&state`.
   */
  async challenge(userId: UserIdentity["id"]): Promise<AuthChallenge> {
    if (this.subjects.get(userId) === undefined) {
      throw new Error("cannot challenge an un-enrolled user (no bound authentik subject)");
    }
    return this.beginAuthorization(userId, "authenticate");
  }

  // ── Port: verifyAssertion (step-up) ─────────────────────────────────────────────────────────────────

  /**
   * Verify a step-up assertion (kernel `AuthProviderPort.verifyAssertion`): the OIDC callback's `{code,state}`.
   * Returns FACTS — `{ok, authStrength, assurance?}` — never an allow/deny. Internally classifies every rejection
   * with a typed {@link AuthFailReason} (surfaced via {@link AuthAuthentikOptions.onVerifyOutcome} +
   * {@link verifyAssertionDetailed}). On ANY failure → `{ok:false, authStrength:"none"}` and NOTHING is bound. On
   * success the attempt is consumed (one-time) and `{ok:true, authStrength, assurance}` is returned.
   */
  async verifyAssertion(
    userId: UserIdentity["id"],
    assertion: unknown,
  ): Promise<AuthProviderVerificationResult> {
    const outcome = await this.verifyAssertionDetailed(userId, assertion);
    return outcome.ok
      ? { ok: true, authStrength: outcome.authStrength, assurance: outcome.assurance }
      : { ok: false, authStrength: "none" };
  }

  /**
   * The non-port, DETAILED form of {@link verifyAssertion} (AC #3): returns the discriminated
   * {@link VerifyOutcome} so tests can assert the exact typed reason of each rejection. The port method is a
   * thin projection of this. Steps (doc §3, in order):
   *  (a) look up the attempt by `state` (absent → `state_unknown`; one-time-consumed on use),
   *  (b) `attempt.userId === userId` (else `user_mismatch`) + kind is `authenticate` + not expired,
   *  (c) exchange `code`+`codeVerifier` at the token endpoint (HTTP failure → `token_exchange_failed`),
   *  (d) validate the id_token (signature/iss/aud/exp/iat/nbf/nonce — each its own typed reason),
   *  (e) `id_token.sub === subjects.get(userId).sub` (else `subject_mismatch`),
   *  (f) derive `authStrength` from `amr`/`acr` (strength.ts).
   */
  async verifyAssertionDetailed(
    userId: UserIdentity["id"],
    assertion: unknown,
  ): Promise<VerifyOutcome> {
    return this.runVerify(userId, assertion, "authenticate", (sub) => {
      // (e) The recipient-binding enforcement (the crux of AC #2): the token's subject MUST equal the one
      //     THIS recipient is bound to. A valid authentik login by the WRONG person fails for THIS recipient.
      const bound = this.subjects.get(userId);
      if (bound === undefined) {
        return "subject_mismatch"; // un-enrolled at verify time → no subject to match.
      }
      if (bound.sub !== sub) {
        return "subject_mismatch";
      }
      return undefined; // bound — proceed.
    });
  }

  // ── Port: beginEnrollment ─────────────────────────────────────────────────────────────────────────

  /**
   * Begin enrollment (kernel `AuthProviderPort.beginEnrollment`): the SAME authorization-request machinery as
   * {@link challenge} but `kind:"register"` (doc §5). The `discharge` (the operator-discharge grant) is the
   * authorization the gateway already verified before reaching here; it is not re-checked by the adapter.
   * Returns the opaque {@link RedirectChallenge}; the operator-invited recipient authenticates at authentik
   * once, then {@link finishEnrollment} binds the resolved subject. (The identity-service-side subject-linking
   * is GLA-070; this method exists so 070 can wire it.)
   */
  async beginEnrollment(
    userId: UserIdentity["id"],
    _discharge: OpaqueToken,
  ): Promise<EnrollmentChallenge> {
    return this.beginAuthorization(userId, "register");
  }

  // ── Port: finishEnrollment ────────────────────────────────────────────────────────────────────────

  /**
   * Finish enrollment (kernel `AuthProviderPort.finishEnrollment`): exchange + validate the id_token exactly
   * as {@link verifyAssertion} (steps a–d), then **bind** the resolved subject ATOMICALLY — `subjects.set(userId,
   * {sub})` only AFTER a verified id_token (doc §5). **No half-bound:** on ANY failure it THROWS and stores
   * nothing (mirroring auth-webauthn's atomic `finishEnrollment`, so the identity service records no enrollment
   * fact). Returns `{credentialId: sub, authStrength, assurance}` — the `sub` IS the credential id under this provider (§5).
   */
  async finishEnrollment(
    userId: UserIdentity["id"],
    assertion: unknown,
  ): Promise<AuthProviderEnrollmentResult> {
    // The `register` attempt validates with no prior binding (the subject is being established now).
    const outcome = await this.runVerify(userId, assertion, "register", () => undefined);
    if (!outcome.ok) {
      // Atomic: bind NOTHING and surface a stable failure (the identity service records no fact).
      throw new Error(`authentik enrollment did not verify: ${outcome.reason}`);
    }
    // Commit only now (after a verified id_token) — the atomic bind.
    this.subjects.set(userId, { sub: outcome.sub });
    return {
      credentialId: outcome.sub,
      authStrength: outcome.authStrength,
      assurance: outcome.assurance,
    };
  }

  // ── Inspection (mirrors auth-webauthn's isEnrolled/getStoredCredential; never a secret) ──────────────

  /** Is a subject bound for this user? (Identity uses this to derive the enrollment fact.) */
  isEnrolled(userId: UserIdentity["id"]): boolean {
    return this.subjects.get(userId) !== undefined;
  }

  /** The bound subject for a user (or undefined). Surfaced for inspection/test; the `sub` only, never a secret. */
  getBoundSubject(userId: UserIdentity["id"]): BoundSubject | undefined {
    return this.subjects.get(userId);
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────────────────

  /**
   * Build an OIDC authorization request (shared by `challenge` and `beginEnrollment`): mint PKCE + a one-time
   * `state`/`nonce`, store the pending attempt keyed by `state`, and return the opaque redirect challenge.
   */
  private async beginAuthorization(
    userId: UserIdentity["id"],
    kind: AttemptKind,
  ): Promise<RedirectChallenge> {
    const endpoints = await this.resolveEndpointsCached();
    const pkce = await this.randomness.pkce();
    const state = this.randomness.randomState();
    const nonce = this.randomness.randomNonce();
    const attempt: PendingAttempt = {
      userId,
      state,
      nonce,
      codeVerifier: pkce.verifier,
      kind,
      createdAt: this.now(),
    };
    this.attempts.set(state, attempt);
    const authorizeUrl = buildAuthorizeUrl({
      authorizationEndpoint: endpoints.authorizationEndpoint,
      clientId: this.clientId,
      redirectUri: this.redirectUri,
      scope: this.scopes,
      state,
      nonce,
      codeChallenge: pkce.challenge,
    });
    return { kind: "redirect", authorizeUrl };
  }

  /**
   * The shared verify/finish pipeline (doc §3 steps a–f). `bindingCheck` is the step-(e) hook: for step-up it
   * checks `sub` against the recipient's binding; for enrollment it is a no-op (the subject is being bound).
   * Emits the discriminated outcome to the diagnostic sink. The pending attempt is consumed ONE-TIME at CLAIM
   * time (step a — before any network round-trip), so a concurrent/replayed callback with the same `state`
   * gets `state_unknown` and a failed exchange/validation still burns the state (FIX 2 — TOCTOU-safe).
   */
  private async runVerify(
    userId: UserIdentity["id"],
    assertion: unknown,
    expectedKind: AttemptKind,
    bindingCheck: (sub: string) => AuthFailReason | undefined,
  ): Promise<VerifyOutcome> {
    const parsed = this.parseAssertion(assertion);
    if (parsed === undefined) {
      return this.fail(expectedKind, "state_unknown");
    }
    const { code, state } = parsed;

    // (a) CLAIM the attempt by `state`, ATOMICALLY (FIX 2 — one-time-use TOCTOU). Read AND delete it in the
    //     SAME synchronous turn, BEFORE the awaited token-exchange/JWKS round-trip below — so the `state` is
    //     burned the instant it is claimed. Two concurrent/replayed callbacks with the same `{code,state}`:
    //     only the first `get`+`delete` wins the live attempt; every other sees `undefined` → `state_unknown`.
    //     (The in-memory KvStore is synchronous, so no async interleaving can occur between get and delete.)
    //     Burning on CLAIM (not on success) also means a token-exchange/validation FAILURE leaves the state
    //     consumed — correct one-time semantics: the human simply re-initiates step-up for a fresh state.
    const attempt = this.attempts.get(state);
    if (attempt === undefined) {
      return this.fail(expectedKind, "state_unknown");
    }
    this.attempts.delete(state);

    // (b) The claimed attempt must match the caller's identity, be the right kind, and be fresh. The state is
    //     already burned (above), so a failure here does not leave it reusable.
    if (attempt.userId !== userId) {
      return this.fail(expectedKind, "user_mismatch");
    }
    if (attempt.kind !== expectedKind) {
      return this.fail(expectedKind, "wrong_attempt_kind");
    }
    if (this.now() - attempt.createdAt > this.attemptTtlMs) {
      return this.fail(expectedKind, "attempt_expired");
    }

    // (c) Exchange the code (+ PKCE verifier) at the token endpoint (confidential client auth).
    const endpoints = await this.resolveEndpointsCached();
    const exchanged = await exchangeCode(
      {
        tokenEndpoint: endpoints.tokenEndpoint,
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        redirectUri: this.redirectUri,
        code,
        codeVerifier: attempt.codeVerifier,
      },
      this.fetchImpl,
    );
    if (!exchanged.ok) {
      return this.fail(expectedKind, exchanged.reason);
    }

    // (d) Validate the id_token (signature/iss/aud/exp/iat/nbf/nonce). The nonce is the ATTEMPT's nonce.
    let validated = await validateIdToken(
      {
        idToken: exchanged.idToken,
        issuerUrl: this.issuerUrl,
        clientId: this.clientId,
        expectedNonce: attempt.nonce,
        clockToleranceSec: this.clockToleranceSec,
        nowMs: this.now(),
      },
      await this.resolveJwks(),
    );
    if (!validated.ok && validated.reason === "bad_signature" && !this.jwksInjected) {
      // Authentik can rotate signing keys. A cached remote JWKS resolver may not know a new key yet, so
      // rebuild it once and re-validate before classifying the token as a signature failure.
      this.jwksResolver = undefined;
      validated = await validateIdToken(
        {
          idToken: exchanged.idToken,
          issuerUrl: this.issuerUrl,
          clientId: this.clientId,
          expectedNonce: attempt.nonce,
          clockToleranceSec: this.clockToleranceSec,
          nowMs: this.now(),
        },
        await this.resolveJwks(),
      );
    }
    if (!validated.ok) {
      return this.fail(expectedKind, validated.reason);
    }
    const claims = validated.claims;

    // (e) Binding check (step-up: `sub` vs the recipient's binding; enrollment: no-op).
    const bindingReason = bindingCheck(claims.sub);
    if (bindingReason !== undefined) {
      return this.fail(expectedKind, bindingReason);
    }

    // (f) Derive provider-neutral assurance from method claims (never up-mapped; strength.ts).
    const assurance = mapMethodToAssurance(
      {
        ...(claims.amr !== undefined ? { amr: claims.amr } : {}),
        ...(claims.acr !== undefined ? { acr: claims.acr } : {}),
        ...(claims.userVerified !== undefined ? { userVerified: claims.userVerified } : {}),
      },
      this.maps,
      { recipientBound: true, replayResistant: true },
    );
    const authStrength = assurance.authStrength as "password" | "webauthn";

    // Success. The attempt was already consumed at CLAIM time (FIX 2), so a replay of the same `{code,state}`
    // already finds nothing — no further delete needed here.
    const outcome: VerifyOutcome = {
      ok: true,
      kind: expectedKind,
      authStrength,
      assurance,
      sub: claims.sub,
      methodResolvable: assurance.methodResolvable ?? false,
    };
    this.emit(outcome);
    return outcome;
  }

  /** Emit a failure outcome to the diagnostic sink and return it. Never carries the secret or the token. */
  private fail(kind: AttemptKind, reason: AuthFailReason): VerifyOutcome {
    const outcome: VerifyOutcome = { ok: false, kind, reason };
    this.emit(outcome);
    return outcome;
  }

  /** Invoke the diagnostic sink (best-effort; a throwing sink never breaks the verify path). */
  private emit(outcome: VerifyOutcome): void {
    if (this.onVerifyOutcome !== undefined) {
      try {
        this.onVerifyOutcome(outcome);
      } catch {
        // A diagnostic sink must never affect the auth outcome.
      }
    }
  }

  /** Parse the opaque assertion into `{code, state}`; returns undefined if it is not that shape. */
  private parseAssertion(assertion: unknown): OidcAssertion | undefined {
    if (typeof assertion !== "object" || assertion === null) {
      return undefined;
    }
    const a = assertion as Record<string, unknown>;
    if (typeof a.code !== "string" || a.code.length === 0) {
      return undefined;
    }
    if (typeof a.state !== "string" || a.state.length === 0) {
      return undefined;
    }
    return { code: a.code, state: a.state };
  }

  /** Resolve (and cache) the OIDC endpoints — explicit overrides win; the rest discovered from the issuer. */
  private async resolveEndpointsCached(): Promise<OidcEndpoints> {
    if (this.endpoints === undefined) {
      this.endpoints = await resolveEndpoints(
        this.issuerUrl,
        this.endpointOverrides,
        this.fetchImpl,
      );
    }
    return this.endpoints;
  }

  /** Resolve (and cache) the JWKS resolver — injected, or built from the discovered `jwks_uri`. */
  private async resolveJwks(): Promise<JwksResolver> {
    if (this.jwksResolver === undefined) {
      const endpoints = await this.resolveEndpointsCached();
      this.jwksResolver = remoteJwksResolver(endpoints.jwksUri);
    }
    return this.jwksResolver;
  }
}

// Re-export the seam/fact types so `app` + tests can name them (mirrors auth-webauthn's exported KvStore etc).
export {
  InMemoryKv,
  type KvStore,
  type BoundSubject,
  type PendingAttempt,
  type AuthFailReason,
  type VerifyOutcome,
  type AttemptKind,
} from "./stores.js";
export {
  type MethodMaps,
  type MethodClaims,
  DEFAULT_METHOD_MAPS,
  mapMethodToAssurance,
  mapMethodToStrength,
  methodMaps,
  methodResolvable,
} from "./strength.js";
export {
  type OidcEndpoints,
  type OidcRandomness,
  type FetchLike,
  type JwksResolver,
  type PkcePair,
  defaultPkce,
  remoteJwksResolver,
} from "./oidc.js";
