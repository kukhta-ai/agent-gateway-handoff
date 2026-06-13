// @gla/auth-webauthn — adapter ring (baseline §1).
// The DEFAULT AuthProvider (docs/03 §4, dependency-strategy.md §4 D6): the in-tree WebAuthn verifier.
// It implements the kernel `AuthProviderPort` (kernel-contracts.md §6) over `@simplewebauthn/server`:
//   beginEnrollment(userId, discharge)  → generateRegistrationOptions (a registration challenge), bound to the user
//   finishEnrollment(userId, assertion) → verifyRegistrationResponse → an ATOMICALLY-stored credential (pubkey, counter)
//   challenge(userId)                   → generateAuthenticationOptions (an authn challenge), scoped to the user's credential
//   verifyAssertion(userId, assertion)  → verifyAuthenticationResponse → facts (counter bumped on success)
// It reports FACTS (ok + auth_strength + assurance evidence), never an access decision. It is the in-tree
// default IdP; a different provider (authentik/OIDC) is a DIFFERENT adapter behind the SAME port — only `app`
// imports either (the swap-IdP property, GLA-013 AC#5; baseline §6).
//
// Boundary: this is an adapter; it depends ONLY on `@gla/kernel` port types + the one dependency it wraps
// (`@simplewebauthn/server`) + node builtins. Core/edge packages depend on the kernel `AuthProviderPort`, never
// on this package — `app` injects it (the import-boundary lint proves it).
//
// State seams (injectable so `app` can supply a shared/persistent store and a test can inspect):
//   - a CHALLENGE store (transient: the pending registration/authentication challenge, keyed by userId)
//   - a CREDENTIAL store (durable: the registered WebAuthn credential — public key + counter — keyed by userId)
// The WebAuthn credential material is provider-specific, so it lives in THIS adapter (an authentik adapter would
// hold nothing locally); the identity service owns the identity-level enrollment FACT (auth_strength) on top.

import { assuranceFromAuthStrength } from "@gla/kernel";
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
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

/** Stable identifier for this module (used by the `app` composition root's wiring record). */
export const AUTH_WEBAUTHN_MODULE = "@gla/auth-webauthn" as const;
/** Ring classification from the architecture baseline (informational). */
export const AUTH_WEBAUTHN_RING = "adapter" as const;

/**
 * A durable, stored WebAuthn credential (the part that MUST survive a registration ceremony to verify later
 * authentications — `verifyRegistrationResponse` docs: "Should be kept in a DB"). `publicKeyB64` is base64url-
 * encoded for storage (it is a `Uint8Array` in `@simplewebauthn`); `counter` is the signature counter
 * (replay-defense). This is agent-BLIND material — no agent ever sees it; only the adapter + the credential store
 * hold it.
 */
export interface StoredCredential {
  /** The credential id (base64url) — the authenticator's handle for this passkey. */
  id: string;
  /** The COSE public key, base64url-encoded (decoded back to bytes on verify). */
  publicKeyB64: string;
  /** The signature counter (bumped on each successful authentication; replay-defense). */
  counter: number;
  /** Transports the authenticator advertised (e.g. `internal`, `usb`), if any. */
  transports?: AuthenticatorTransportFuture[];
}

/** The transient pending challenge for an in-flight ceremony, keyed by userId. */
export interface PendingChallenge {
  /** The base64url challenge the options carried (re-checked on verify). */
  challenge: string;
  /** Whether it is a registration or authentication challenge (defensive: don't cross-use). */
  kind: "register" | "authenticate";
}

/** A tiny key→value store seam (in-memory default; `app` can supply a persistent one). */
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

/** Construction options for the WebAuthn auth provider. */
export interface AuthWebauthnOptions {
  /**
   * The Relying-Party ID — the registrable domain the passkey is bound to (no scheme/port). For hermes-1 this is
   * the gateway's host; for the loopback test it is `"localhost"`. MUST match the page origin's host.
   */
  rpID: string;
  /** The human-visible RP name shown in the OS passkey UI. Defaults to the rpID. */
  rpName?: string;
  /**
   * The expected page ORIGIN(s) the ceremony runs on (scheme + host + port), e.g. `http://localhost:3000`. The
   * registration/authentication response is verified against this. A single string or a list.
   */
  expectedOrigin: string | string[];
  /** The durable credential store (keyed by userId). Defaults to in-memory. */
  credentials?: KvStore<StoredCredential>;
  /** The transient challenge store (keyed by userId). Defaults to in-memory. */
  challenges?: KvStore<PendingChallenge>;
}

/** Base64url-encode raw bytes (for storing the COSE public key). */
function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
/**
 * Decode a base64url string back to bytes (the stored public key → `verifyAuthenticationResponse`). `Uint8Array.from`
 * yields a `Uint8Array<ArrayBuffer>` (not the pooled `ArrayBufferLike` a `Buffer` view shares), which is exactly the
 * `Uint8Array_` shape `@simplewebauthn`'s `WebAuthnCredential.publicKey` expects.
 */
function unb64url(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(s, "base64url"));
}

/**
 * The in-tree WebAuthn {@link AuthProviderPort}. Construct with the RP id + expected origin (and optionally a
 * shared credential/challenge store). It runs the real `@simplewebauthn/server` ceremony: registration options →
 * verify attestation → store the credential; authentication options → verify assertion → bump the counter. It is
 * the MVP's default identity provider; authentik/OIDC is a different adapter behind the SAME port.
 */
export class AuthWebauthnProvider implements AuthProviderPort {
  private readonly rpID: string;
  private readonly rpName: string;
  private readonly expectedOrigin: string | string[];
  private readonly credentials: KvStore<StoredCredential>;
  private readonly challenges: KvStore<PendingChallenge>;

  constructor(opts: AuthWebauthnOptions) {
    this.rpID = opts.rpID;
    this.rpName = opts.rpName ?? opts.rpID;
    this.expectedOrigin = opts.expectedOrigin;
    this.credentials = opts.credentials ?? new InMemoryKv<StoredCredential>();
    this.challenges = opts.challenges ?? new InMemoryKv<PendingChallenge>();
  }

  /**
   * Begin enrollment (kernel `AuthProviderPort.beginEnrollment`): produce `navigator.credentials.create` options
   * (a registration challenge) BOUND to the user. The `discharge` (the operator-discharge grant token) is the
   * authorization the GATEWAY already verified before reaching here; the provider records the pending challenge so
   * `finishEnrollment` can check the response was for THIS challenge. The userId is stamped into the options'
   * `user.id` so the ceremony is bound to exactly this identity. Returns the options JSON the page passes to the
   * browser.
   */
  async beginEnrollment(
    userId: UserIdentity["id"],
    _discharge: OpaqueToken,
  ): Promise<EnrollmentChallenge> {
    const existing = this.credentials.get(userId);
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: userId,
      // Bind the credential to this exact identity (the user handle the authenticator stores).
      userID: Uint8Array.from(Buffer.from(userId, "utf8")),
      // A resident key (discoverable passkey) verified by user presence — the reference passkey shape.
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      // Exclude any already-registered credential so the same authenticator can't double-register.
      excludeCredentials:
        existing !== undefined
          ? [
              existing.transports !== undefined
                ? { id: existing.id, transports: existing.transports }
                : { id: existing.id },
            ]
          : [],
    });
    this.challenges.set(userId, { challenge: options.challenge, kind: "register" });
    return options;
  }

  /**
   * Finish enrollment (kernel `AuthProviderPort.finishEnrollment`): verify the registration attestation against the
   * pending challenge and store the credential. **Atomic from the adapter's view:** the credential is written to the
   * store ONLY when `verifyRegistrationResponse` reports `verified` AND yields a credential; otherwise it throws and
   * stores nothing (so the caller — identity — records no enrollment fact: the no-half-bound property GLA-013 AC#4).
   * On success the pending challenge is cleared and `{ credentialId, authStrength: "webauthn", assurance }` (a
   * FACT) is returned.
   */
  async finishEnrollment(
    userId: UserIdentity["id"],
    assertion: unknown,
  ): Promise<AuthProviderEnrollmentResult> {
    const pending = this.challenges.get(userId);
    if (pending === undefined || pending.kind !== "register") {
      throw new Error("no pending registration challenge for this user");
    }
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        // The browser's RegistrationResponseJSON (validated by the library; an out-of-shape body fails here).
        response: assertion as RegistrationResponseJSON,
        expectedChallenge: pending.challenge,
        expectedOrigin: this.expectedOrigin,
        expectedRPID: this.rpID,
        requireUserPresence: true,
        requireUserVerification: false,
      });
    } catch (e) {
      // A malformed/forged attestation throws — surface a stable failure, store NOTHING (atomic).
      throw new Error(`webauthn registration verification failed: ${String(e)}`);
    }
    if (!verification.verified || verification.registrationInfo === undefined) {
      throw new Error("webauthn registration not verified");
    }
    const cred = verification.registrationInfo.credential;
    const stored: StoredCredential = {
      id: cred.id,
      publicKeyB64: b64url(cred.publicKey),
      counter: cred.counter,
      ...(cred.transports !== undefined ? { transports: [...cred.transports] } : {}),
    };
    // Commit only now (after a verified ceremony) — the atomic write.
    this.credentials.set(userId, stored);
    this.challenges.delete(userId);
    return {
      credentialId: stored.id,
      authStrength: "webauthn",
      assurance: assuranceFromAuthStrength("webauthn", { methodResolvable: true }),
    };
  }

  /**
   * Begin authentication (kernel `AuthProviderPort.challenge`): produce `navigator.credentials.get` options (an
   * authentication challenge) scoped to the user's registered credential. Throws if the user is not enrolled (no
   * credential to challenge against) — the precondition that an un-enrolled recipient cannot be verified (GLA-013
   * AC#3). Records the pending authentication challenge for `verifyAssertion`.
   */
  async challenge(userId: UserIdentity["id"]): Promise<AuthChallenge> {
    const cred = this.credentials.get(userId);
    if (cred === undefined) {
      throw new Error("cannot challenge an un-enrolled user (no registered credential)");
    }
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: [
        cred.transports !== undefined
          ? { id: cred.id, transports: cred.transports }
          : { id: cred.id },
      ],
      userVerification: "preferred",
    });
    this.challenges.set(userId, { challenge: options.challenge, kind: "authenticate" });
    return options;
  }

  /**
   * Verify an authentication assertion (kernel `AuthProviderPort.verifyAssertion`): check the assertion against the
   * stored credential + the pending challenge. Returns FACTS — `{ ok, authStrength }` — never an allow/deny. On a
   * verified assertion the stored counter is bumped (replay-defense) and `ok: true, authStrength: "webauthn",
   * assurance` is returned; an un-enrolled user, a wrong/forged assertion, or no pending challenge yields
   * `ok: false`.
   */
  async verifyAssertion(
    userId: UserIdentity["id"],
    assertion: unknown,
  ): Promise<AuthProviderVerificationResult> {
    const cred = this.credentials.get(userId);
    const pending = this.challenges.get(userId);
    if (cred === undefined || pending === undefined || pending.kind !== "authenticate") {
      return { ok: false, authStrength: "none" };
    }
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertion as AuthenticationResponseJSON,
        expectedChallenge: pending.challenge,
        expectedOrigin: this.expectedOrigin,
        expectedRPID: this.rpID,
        credential: {
          id: cred.id,
          publicKey: unb64url(cred.publicKeyB64),
          counter: cred.counter,
          ...(cred.transports !== undefined ? { transports: cred.transports } : {}),
        },
        requireUserVerification: false,
      });
    } catch {
      return { ok: false, authStrength: "none" };
    }
    if (!verification.verified) {
      return { ok: false, authStrength: "none" };
    }
    // Bump the stored counter (replay-defense) and clear the consumed challenge.
    this.credentials.set(userId, { ...cred, counter: verification.authenticationInfo.newCounter });
    this.challenges.delete(userId);
    return {
      ok: true,
      authStrength: "webauthn",
      assurance: assuranceFromAuthStrength("webauthn", { methodResolvable: true }),
    };
  }

  /** Is a credential stored for this user? (Identity uses this to derive the enrollment fact.) */
  isEnrolled(userId: UserIdentity["id"]): boolean {
    return this.credentials.get(userId) !== undefined;
  }

  /** The stored credential for a user (or undefined). Surfaced for inspection/test; the public key only, never a secret. */
  getStoredCredential(userId: UserIdentity["id"]): StoredCredential | undefined {
    return this.credentials.get(userId);
  }
}
