// @gla/auth-authentik · the adapter's state seams + fact types (authentik-integration.md §3/§5).
//
// Mirrors `@gla/auth-webauthn`'s injectable `KvStore` discipline (an in-memory default, an injectable
// seam so `app`/tests can supply a shared/persistent store and inspect it). Two stores, the delegated
// analogues of WebAuthn's two:
//   - `subjects`  (DURABLE, keyed by userId)  — the recipient↔authentik-subject binding `{sub}`. This is
//                  the delegated analogue of WebAuthn's credential store (the provider-specific durable
//                  fact). The WebAuthn adapter holds a public key; this adapter holds only a stable `sub`
//                  (authentik holds the actual secret — §5).
//   - `attempts`  (TRANSIENT, keyed by state) — the in-flight OIDC attempt `{userId,state,nonce,
//                  codeVerifier,kind,createdAt}`, consumed ONE-TIME on callback (anti-CSRF / anti-replay,
//                  §3).

/**
 * A tiny key→value store seam (in-memory default; `app` can supply a persistent one). Identical in
 * shape to `@gla/auth-webauthn`'s `KvStore` so the two adapters share the same composition surface.
 */
export interface KvStore<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
}

/** The default in-memory {@link KvStore} (a `Map`); no I/O, process-local. */
export class InMemoryKv<V> implements KvStore<V> {
  private readonly map = new Map<string, V>();
  get(key: string): V | undefined {
    return this.map.get(key);
  }
  set(key: string, value: V): void {
    this.map.set(key, value);
  }
  delete(key: string): void {
    this.map.delete(key);
  }
}

/**
 * The durable recipient↔authentik-subject binding (doc §5). The recipient's `UserIdentity` is bound to a
 * STABLE OIDC subject; step-up later checks `id_token.sub === subjects.get(userId).sub`. The `sub` is the
 * "credential id" under this provider (`finishEnrollment` returns it). This is the ONLY durable fact the
 * delegated adapter holds — no secret, no key (those live in authentik).
 */
export interface BoundSubject {
  /** The stable authentik OIDC subject this recipient is bound to (the immutable user id, doc §9 risk 3). */
  sub: string;
}

/** Whether an in-flight OIDC attempt is a step-up (`authenticate`) or an enrollment (`register`) round-trip. */
export type AttemptKind = "authenticate" | "register";

/**
 * A transient pending OIDC authorization attempt, keyed by `state` (doc §3). It binds the one-time
 * `state`/`nonce` and the PKCE `codeVerifier` to the `userId` that began the request, so the callback can
 * (a) find the attempt by `state` (a replayed/forged `state` finds nothing → refused — anti-CSRF), (b)
 * confirm the bound `userId`, (c) supply the `codeVerifier` at token exchange (anti-interception), and
 * (d) check the `nonce` inside the id_token (anti-replay). Consumed ONE-TIME on use; expires on a TTL.
 */
export interface PendingAttempt {
  /** The recipient identity that began this attempt (re-checked on callback: `attempt.userId === userId`). */
  userId: string;
  /** The one-time `state` (the store key; echoed by authentik on the callback). */
  state: string;
  /** The one-time `nonce` (checked INSIDE the id_token, binding it to THIS request). */
  nonce: string;
  /** The PKCE `code_verifier` (never leaves GLA; required at token exchange to defeat code interception). */
  codeVerifier: string;
  /** Whether this is a step-up or an enrollment attempt (defensive: don't cross-use). */
  kind: AttemptKind;
  /** Epoch-ms the attempt was created (for the TTL expiry check). */
  createdAt: number;
}

/**
 * A typed classification of every rejection in the OIDC verify/finish path (doc §3, AC #3). The kernel
 * port result stays `{ok, authStrength}` (no kernel change), but INTERNALLY each failure is one of these
 * reasons, surfaced via the injectable diagnostic sink and the non-port `*Detailed` methods so tests can
 * assert each rejection's exact cause. On ANY of these, NO identity/strength is asserted (`authStrength`
 * is `"none"`, no `sub` is bound).
 */
export type AuthFailReason =
  /** No pending attempt for the supplied `state` (unknown/expired/replayed callback — anti-CSRF). */
  | "state_unknown"
  /** The attempt's `userId` does not match the supplied `userId` (a callback for a different recipient). */
  | "user_mismatch"
  /** The attempt's `kind` is wrong for the call (a `register` attempt used at `verifyAssertion`, or vice-versa). */
  | "wrong_attempt_kind"
  /** The pending attempt is older than the TTL (a stale callback). */
  | "attempt_expired"
  /** The token endpoint returned a non-2xx / unparseable response (exchange failed). */
  | "token_exchange_failed"
  /** The token response carried no `id_token`. */
  | "no_id_token"
  /** The id_token signature did not verify against the JWKS. */
  | "bad_signature"
  /** The id_token `iss` did not equal the configured issuer. */
  | "wrong_issuer"
  /** The id_token `aud` did not include the configured client id. */
  | "wrong_audience"
  /**
   * The id_token carried MULTIPLE audiences but its `azp` (Authorized Party) was absent or did not equal the
   * configured client id (OIDC Core §3.1.3.7) — a multi-audience token not actually issued FOR this client.
   */
  | "azp_mismatch"
  /** The id_token is expired / not-yet-valid / issued-in-the-future beyond clock tolerance (`exp`/`nbf`/`iat`). */
  | "expired"
  /** The id_token `nonce` did not equal the attempt's nonce (anti-replay). */
  | "nonce_mismatch"
  /** The id_token carried no `sub` (cannot bind / cannot check the binding). */
  | "no_subject"
  /** The id_token `sub` did not match the recipient's bound subject (a valid login by the WRONG person). */
  | "subject_mismatch"
  /** Any other id_token claim/shape validation failure not covered above. */
  | "invalid_token";

/**
 * The outcome of an internal verify/finish attempt — the discriminated result the non-port `*Detailed`
 * methods return and the diagnostic sink receives. On success it carries the derived `authStrength` (and,
 * for enrollment, the bound `sub`); on failure it carries the typed {@link AuthFailReason}. `kind`
 * distinguishes a step-up outcome from an enrollment outcome for observability.
 */
export type VerifyOutcome =
  | {
      ok: true;
      kind: AttemptKind;
      authStrength: "password" | "webauthn";
      sub: string;
      methodResolvable: boolean;
    }
  | { ok: false; kind: AttemptKind; reason: AuthFailReason };
