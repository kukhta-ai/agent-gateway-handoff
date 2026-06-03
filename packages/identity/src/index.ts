// @gla/identity — core-adjacent ring (baseline §1).
// The recipient-identity surface (kernel-contracts.md §7, identity-and-auth.md). Slice 1 implemented binding:
// map a channel-specific recipient ref (e.g. "tg:user:123") to a stable UserIdentity → a RecipientBinding,
// narrow-only, auth_strength "none". Slice 4a adds ENROLLMENT + edge VERIFICATION (scenario-01 Phase E / Phase 6):
//   enrollmentOptions(recipient)      → a registration challenge from the AuthProvider, bound to the recipient
//   enrollComplete(recipient, attest) → verify the attestation, ATOMICALLY store the credential bound to the
//                                       UserIdentity, set auth_strength=webauthn (no half-bound on failure)
//   isEnrolled(recipient)             → the outside-observable enrolled-vs-not fact
//   getCredential(recipient)          → the recorded enrollment record (for a later verify)
//   authenticationOptions(recipient)  → an authn challenge (Phase 6 step-up; un-enrolled ⇒ deny)
//   verifyAuthentication(recipient,a) → { ok, auth_strength, userId }; un-enrolled ⇒ deny
// It also satisfies the kernel IdentityPort shape (bind/enroll/verify).
//
// Frozen invariants honored (identity-and-auth.md, §7): recipient-binding originates from the channel and is
// ONLY EVER narrowed; a recipient is verifiable ONLY if previously enrolled; enrollment is one-time and
// operator-initiated, authorized by a single-use operator-discharge grant (the GATEWAY verifies it before
// reaching here — identity owns the credential, not the grant check); the agent NEVER enrolls recipients and
// never sees credentials. auth_strength is a FACT this service reports, never an access decision.
//
// Boundary: this is core-adjacent — it depends on the kernel `AuthProviderPort` (a PORT), never on a concrete
// auth adapter (`@gla/auth-webauthn`). `app` injects the WebAuthn provider; swapping the IdP changes no code
// here (GLA-013 AC#5; the import-boundary lint proves it).

import {
  type AuthChallenge,
  type AuthProviderPort,
  type AuthStrength,
  type EnrollmentChallenge,
  type IdentityPort,
  type OpaqueToken,
  type RecipientBinding,
  type RecipientRef,
  type UserIdentity,
  glaError,
} from "@gla/kernel";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const IDENTITY_MODULE = "@gla/identity" as const;
/** Ring classification from the architecture baseline (informational). */
export const IDENTITY_RING = "core-adjacent" as const;

/**
 * The identity-level enrollment record for a recipient (distinct from the provider's WebAuthn credential
 * material, which lives in the adapter). It is the FACT that the recipient is enrolled and how strongly —
 * what `isEnrolled`/`verifyStrength` read, and what makes a later handoff verifiable.
 */
export interface EnrollmentRecord {
  userId: UserIdentity["id"];
  /** The credential id the provider registered (the passkey handle). */
  credentialId: string;
  /** The strength established at enrollment (webauthn for a passkey). */
  authStrength: AuthStrength;
  /** ISO-8601 instant enrollment completed (for audit/observability). */
  enrolledAt: string;
}

/**
 * Derive a stable `UserIdentity.id` from a channel-specific recipient ref. The ref already encodes the channel +
 * the channel-local user (`<channel>:user:<n>`); the derived id is stable across channels for the *same* ref and
 * never invents information the channel did not supply. (A richer deployment would consult an enrollment record
 * to merge refs across channels onto one identity; this keeps the mapping 1:1 and deterministic — narrow-only.)
 */
function deriveUserId(recipient: RecipientRef): UserIdentity["id"] {
  return `user:${recipient}`;
}

/**
 * Parse the channel out of a recipient ref of the form `<channel>:user:<id>` (e.g. `tg`, `cli`). Used to record
 * binding provenance. Falls back to the literal ref when it is not in that shape.
 */
function channelOf(recipient: RecipientRef): string {
  const [channel] = recipient.split(":");
  return channel && channel.length > 0 ? channel : String(recipient);
}

/** Construction options for the identity service. */
export interface IdentityServiceOptions {
  /**
   * The auth provider (kernel `AuthProviderPort`) that runs the registration/authentication ceremony — the
   * in-tree WebAuthn adapter in the default profile, injected by `app`. Optional: a Slice-1 caller that only
   * binds (no enrollment) constructs the service without one, and the enrollment/verify methods then throw a
   * clear `dependency.unavailable` rather than pretending.
   */
  authProvider?: AuthProviderPort;
}

/**
 * The recipient-binding + enrollment service (identity-and-auth.md). Maps inbound channel refs to stable
 * identities (Slice 1), and owns the **identity-level enrollment fact** + edge verification (Slice 4a) on top of
 * an injected {@link AuthProviderPort}. Implements the kernel {@link IdentityPort}. It reports facts; it makes no
 * access decision (that is the enforcement point).
 */
export class IdentityService implements IdentityPort {
  private readonly authProvider?: AuthProviderPort;
  /**
   * The identity-level enrollment store, keyed by userId. A record here is the **enrolled** fact (atomic — written
   * ONLY after the provider returns a verified credential, so a failed ceremony leaves no half-bound identity:
   * GLA-013 AC#4). The provider holds the WebAuthn credential material; this holds the identity fact.
   */
  private readonly enrollments = new Map<UserIdentity["id"], EnrollmentRecord>();

  constructor(opts: IdentityServiceOptions = {}) {
    if (opts.authProvider !== undefined) {
      this.authProvider = opts.authProvider;
    }
  }

  /**
   * Bind a channel-specific recipient ref to a stable {@link UserIdentity} (kernel-contracts.md §7). **Narrow-only:**
   * the binding carries exactly the channel's provenance and the recipient's current `authStrength` — `webauthn`
   * once enrolled, else `none`. It writes no task/session state. The Channel adapter attaches the returned binding
   * to each inbound message (GLA-015 AC#1).
   */
  async bind(recipient: RecipientRef, ctx: { channel: string }): Promise<RecipientBinding> {
    return {
      recipient,
      userId: deriveUserId(recipient),
      provenance: ctx.channel,
      authStrength: this.strengthOf(recipient),
    };
  }

  /**
   * Synchronous convenience for the inbound path: derive the {@link RecipientBinding} for a recipient ref, taking
   * the channel from the ref's prefix. Equivalent to {@link bind} with the channel parsed from the ref — used by
   * the channel adapter so `receive()` can attach the binding without awaiting a port round-trip.
   */
  bindFromInbound(recipient: RecipientRef): RecipientBinding {
    return {
      recipient,
      userId: deriveUserId(recipient),
      provenance: channelOf(recipient),
      authStrength: this.strengthOf(recipient),
    };
  }

  // ── Enrollment (Slice 4a, scenario-01 Phase E) ─────────────────────────────────────────────────────

  /**
   * Produce the **registration options** (a WebAuthn challenge) for a recipient's enrollment, bound to their
   * `UserIdentity` (GLA-012 AC#1, GLA-013 AC#1). Delegates to the injected {@link AuthProviderPort.beginEnrollment}.
   * The `discharge` is the operator-discharge grant token the gateway already verified — passed through to the
   * provider as the authorization context. Returns the options the enrollment page hands to
   * `navigator.credentials.create`. NOT a binding yet — the credential is recorded only on {@link enrollComplete}.
   *
   * @param recipient  the recipient being enrolled
   * @param discharge  the verified operator-discharge grant token (authorization context)
   */
  async enrollmentOptions(
    recipient: RecipientRef,
    discharge: OpaqueToken,
  ): Promise<EnrollmentChallenge> {
    const provider = this.requireProvider();
    return provider.beginEnrollment(deriveUserId(recipient), discharge);
  }

  /**
   * Complete enrollment (GLA-012 AC#1, GLA-013 AC#1/#4). Verify the registration attestation via the provider and
   * — **only on success** — record the identity-level enrollment fact (the credential id + `auth_strength`),
   * atomically. A failed/abandoned ceremony (the provider throws or reports unverified) records **nothing**, so
   * `isEnrolled` stays false and the recipient is safely retryable with a fresh grant (the no-half-bound property,
   * GLA-013 AC#4). Returns the recorded enrollment.
   *
   * @param recipient   the recipient being enrolled
   * @param attestation the browser's registration response (the WebAuthn attestation)
   * @throws GlaErrorException (`auth.insufficient`) if the attestation does not verify — nothing is stored.
   */
  async enrollComplete(recipient: RecipientRef, attestation: unknown): Promise<EnrollmentRecord> {
    const provider = this.requireProvider();
    const userId = deriveUserId(recipient);
    let finished: { credentialId: string; authStrength: AuthStrength };
    try {
      finished = await provider.finishEnrollment(userId, attestation);
    } catch (e) {
      // The provider's verification failed (malformed/forged/abandoned ceremony). Record nothing (atomic) and
      // surface a stable, typed error the gateway maps to a refusal.
      throw glaError("auth.insufficient", `enrollment attestation did not verify: ${String(e)}`, {
        detail: { recipient },
      });
    }
    const record: EnrollmentRecord = {
      userId,
      credentialId: finished.credentialId,
      authStrength: finished.authStrength,
      enrolledAt: new Date().toISOString(),
    };
    // Commit the identity-level fact only now (after a verified ceremony). Idempotent re-enrollment REPLACES the
    // prior record (recovery = re-enrollment with a fresh grant).
    this.enrollments.set(userId, record);
    return record;
  }

  /** Is this recipient enrolled? (The outside-observable enrolled-vs-not fact; GLA-012 AC#6, GLA-013 AC#3.) */
  isEnrolled(recipient: RecipientRef): boolean {
    return this.enrollments.has(deriveUserId(recipient));
  }

  /** The recorded enrollment for a recipient (or undefined). For a later verify / audit; never a raw credential. */
  getCredential(recipient: RecipientRef): EnrollmentRecord | undefined {
    return this.enrollments.get(deriveUserId(recipient));
  }

  /** The recipient's current `auth_strength` FACT — `webauthn` once enrolled, else `none` (verifyStrength reads it). */
  verifyStrength(recipient: RecipientRef): AuthStrength {
    return this.strengthOf(recipient);
  }

  // ── Edge verification (Slice 4a foundation; Phase-6 step-up in Slice 4b) ────────────────────────────

  /**
   * Produce **authentication options** (a WebAuthn challenge) for a later handoff step-up, scoped to the
   * recipient's registered credential. **Deny (throw) an un-enrolled recipient** — a recipient is verifiable ONLY
   * if previously enrolled (GLA-013 AC#3, the frozen §7 invariant). Delegates to {@link AuthProviderPort.challenge}.
   */
  async authenticationOptions(recipient: RecipientRef): Promise<AuthChallenge> {
    const provider = this.requireProvider();
    if (!this.isEnrolled(recipient)) {
      throw glaError("auth.insufficient", "recipient is not enrolled; cannot authenticate", {
        detail: { recipient },
      });
    }
    return provider.challenge(deriveUserId(recipient));
  }

  /**
   * Verify a recipient at the edge (kernel `IdentityPort.verify`; GLA-013 AC#3). Returns **FACTS** —
   * `{ ok, authStrength, userId }` — never an allow/deny. An **un-enrolled** recipient (no stored credential)
   * yields `{ ok:false, authStrength:"none" }` directly (a recipient is verifiable only if enrolled); an enrolled
   * recipient's assertion is checked via {@link AuthProviderPort.verifyAssertion}.
   */
  async verifyAuthentication(
    recipient: RecipientRef,
    assertion: unknown,
  ): Promise<{ ok: boolean; authStrength: AuthStrength; userId: UserIdentity["id"] }> {
    const userId = deriveUserId(recipient);
    if (!this.isEnrolled(recipient)) {
      // UN-ENROLLED ⇒ DENY: there is no credential to verify (identity-and-auth.md failure mode).
      return { ok: false, authStrength: "none", userId };
    }
    const provider = this.requireProvider();
    const result = await provider.verifyAssertion(userId, assertion);
    return { ok: result.ok, authStrength: result.authStrength, userId };
  }

  // ── Kernel IdentityPort `enroll`/`verify` (the formal port shape) ───────────────────────────────────

  /**
   * Kernel {@link IdentityPort.enroll}: the one-shot port form — begin then finish is the gateway's two-step flow,
   * but the port models a single `enroll(recipient, discharge)`. Here the `discharge` is the verified grant token;
   * the actual attestation arrives via the gateway's `enrollComplete`. This port method exposes the **options**
   * step under the kernel signature (returning the binding-to-be once a credential exists), so a caller using the
   * bare port begins enrollment; completion is `enrollComplete`. It returns the current binding + strength.
   */
  async enroll(
    recipient: RecipientRef,
    discharge: OpaqueToken,
  ): Promise<{ binding: RecipientBinding; authStrength: AuthStrength }> {
    // Begin the ceremony (records the pending challenge in the provider). Completion is driven by the gateway's
    // POST /enroll/verify → enrollComplete; the kernel port's single-call shape begins it here.
    await this.enrollmentOptions(recipient, discharge);
    const binding = await this.bind(recipient, { channel: channelOf(recipient) });
    return { binding, authStrength: binding.authStrength };
  }

  /**
   * Kernel {@link IdentityPort.verify}: verify a recipient at the edge — delegates to {@link verifyAuthentication}
   * (FACTS, not a decision). An un-enrolled recipient denies.
   */
  async verify(
    recipient: RecipientRef,
    assertion: unknown,
  ): Promise<{ ok: boolean; authStrength: AuthStrength; userId: UserIdentity["id"] }> {
    return this.verifyAuthentication(recipient, assertion);
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────────────────

  /** The recipient's current strength: `webauthn` if an enrollment record exists, else `none`. */
  private strengthOf(recipient: RecipientRef): AuthStrength {
    return this.enrollments.get(deriveUserId(recipient))?.authStrength ?? "none";
  }

  /** Require an injected auth provider; throw a stable, typed error if a bind-only service was constructed. */
  private requireProvider(): AuthProviderPort {
    if (this.authProvider === undefined) {
      throw glaError(
        "dependency.unavailable",
        "no auth provider injected; enrollment/verification is unavailable",
      );
    }
    return this.authProvider;
  }
}
