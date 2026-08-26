// Unit tests for IdentityService ENROLLMENT (packages/identity, Slice 4a). Uses a STUB AuthProviderPort (so the
// identity-level fact + atomicity + un-enrolled-deny are tested without a browser or @simplewebauthn). Proves:
//   - enroll → isEnrolled true + auth_strength=webauthn, and bind() then reflects the strength (GLA-013 AC#1)
//   - a FAILED finishEnrollment leaves isEnrolled false (atomic; no half-bound — GLA-013 AC#4) and is retryable
//   - verifyAuthentication denies an un-enrolled recipient (GLA-013 AC#3) and verifies an enrolled one (facts)
//   - identity depends on the PORT (the stub), not a concrete adapter (the swap-IdP boundary — GLA-013 AC#5)

import type {
  AuthChallenge,
  AuthProviderPort,
  AuthStrength,
  EnrollmentChallenge,
  OpaqueToken,
  RecipientRef,
  UserIdentity,
} from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { IdentityService } from "./index.js";

const recipient = "tg:user:123" as RecipientRef;
const unEnrolled = "tg:user:777" as RecipientRef;
const discharge = "discharge-token" as OpaqueToken;

/** A configurable stub AuthProvider: it records "enrolled" userIds and lets a test force success/failure. */
class StubAuthProvider implements AuthProviderPort {
  enrolled = new Set<UserIdentity["id"]>();
  /** When set, finishEnrollment throws (a failed/abandoned ceremony). */
  failFinish = false;
  /** When set, verifyAssertion reports this ok-ness. */
  assertionOk = true;

  async beginEnrollment(
    _userId: UserIdentity["id"],
    _discharge: OpaqueToken,
  ): Promise<EnrollmentChallenge> {
    return { challenge: "stub-reg-challenge" };
  }
  async finishEnrollment(
    userId: UserIdentity["id"],
    _assertion: unknown,
  ): Promise<{ credentialId: string; authStrength: AuthStrength }> {
    if (this.failFinish) {
      throw new Error("ceremony failed");
    }
    this.enrolled.add(userId);
    return { credentialId: `cred-${userId}`, authStrength: "webauthn" };
  }
  async challenge(userId: UserIdentity["id"]): Promise<AuthChallenge> {
    if (!this.enrolled.has(userId)) {
      throw new Error("un-enrolled");
    }
    return { challenge: "stub-authn-challenge" };
  }
  async verifyAssertion(
    userId: UserIdentity["id"],
    _assertion: unknown,
  ): Promise<{ ok: boolean; authStrength: AuthStrength }> {
    if (!this.enrolled.has(userId)) {
      return { ok: false, authStrength: "none" };
    }
    return this.assertionOk
      ? { ok: true, authStrength: "webauthn" }
      : { ok: false, authStrength: "none" };
  }
}

describe("IdentityService.enrollComplete — the enrolled fact (GLA-013 AC#1)", () => {
  it("after enrollment the recipient is enrolled with auth_strength=webauthn, and bind() reflects it", async () => {
    const provider = new StubAuthProvider();
    const svc = new IdentityService({ authProvider: provider });
    // Before: not enrolled, strength none.
    expect(svc.isEnrolled(recipient)).toBe(false);
    expect((await svc.bind(recipient, { channel: "tg" })).authStrength).toBe("none");

    await svc.enrollmentOptions(recipient, discharge);
    const record = await svc.enrollComplete(recipient, { fake: "attestation" });

    expect(record.authStrength).toBe("webauthn");
    expect(svc.isEnrolled(recipient)).toBe(true);
    expect(svc.verifyStrength(recipient)).toBe("webauthn");
    expect(svc.getCredential(recipient)?.credentialId).toBe("cred-user:tg:user:123");
    // The binding now carries the recorded strength (narrow-only otherwise).
    expect((await svc.bind(recipient, { channel: "tg" })).authStrength).toBe("webauthn");
  });
});

describe("IdentityService — atomic, no half-bound (GLA-013 AC#4)", () => {
  it("a FAILED finishEnrollment leaves isEnrolled false and is retryable with a fresh attempt", async () => {
    const provider = new StubAuthProvider();
    const svc = new IdentityService({ authProvider: provider });

    await svc.enrollmentOptions(recipient, discharge);
    provider.failFinish = true;
    await expect(svc.enrollComplete(recipient, { fake: "attestation" })).rejects.toThrow(
      /did not verify|auth/i,
    );
    // ATOMIC: nothing was recorded.
    expect(svc.isEnrolled(recipient)).toBe(false);
    expect(svc.verifyStrength(recipient)).toBe("none");

    // Retry with the ceremony now succeeding — enrollment completes (safely retryable).
    provider.failFinish = false;
    await svc.enrollComplete(recipient, { fake: "attestation-2" });
    expect(svc.isEnrolled(recipient)).toBe(true);
  });
});

describe("IdentityService.verifyAuthentication — un-enrolled denies (GLA-013 AC#3)", () => {
  it("denies an un-enrolled recipient (ok:false, none) without consulting the provider", async () => {
    const provider = new StubAuthProvider();
    const svc = new IdentityService({ authProvider: provider });
    const r = await svc.verifyAuthentication(unEnrolled, { any: "assertion" });
    expect(r.ok).toBe(false);
    expect(r.authStrength).toBe("none");
    expect(r.userId).toBe("user:tg:user:777");
  });

  it("verifies an ENROLLED recipient's assertion (facts: ok + webauthn)", async () => {
    const provider = new StubAuthProvider();
    const svc = new IdentityService({ authProvider: provider });
    await svc.enrollmentOptions(recipient, discharge);
    await svc.enrollComplete(recipient, { fake: "attestation" });
    const r = await svc.verifyAuthentication(recipient, { good: "assertion" });
    expect(r.ok).toBe(true);
    expect(r.authStrength).toBe("webauthn");
  });

  it("authenticationOptions throws for an un-enrolled recipient (a recipient is verifiable only if enrolled)", async () => {
    const provider = new StubAuthProvider();
    const svc = new IdentityService({ authProvider: provider });
    await expect(svc.authenticationOptions(unEnrolled)).rejects.toThrow(/not enrolled/i);
  });
});

describe("IdentityService — swap-IdP boundary (GLA-013 AC#5)", () => {
  it("works against ANY AuthProviderPort implementation (the stub) — no concrete adapter dependency", async () => {
    // The service is constructed with a stub provider — proof that identity depends on the PORT, not on
    // @gla/auth-webauthn. Swapping the provider changes no identity code.
    const provider = new StubAuthProvider();
    const svc = new IdentityService({ authProvider: provider });
    await svc.enrollmentOptions(recipient, discharge);
    await svc.enrollComplete(recipient, {});
    expect(svc.isEnrolled(recipient)).toBe(true);
  });
});
