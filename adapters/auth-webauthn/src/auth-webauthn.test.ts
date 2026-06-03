// Unit tests for the in-tree WebAuthn AuthProvider (adapters/auth-webauthn). These prove the SERVER-SIDE verify
// logic + atomicity deterministically, with NO browser — so enrollment logic is proven regardless of whether the
// REAL virtual-authenticator E2E (packages/app) runs (GLA-013). The full cryptographic-success path is exercised
// for real by that E2E (Chromium + a CDP virtual authenticator); here we pin the negative/atomic/option paths.

import type { OpaqueToken, UserIdentity } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { AuthWebauthnProvider, InMemoryKv, type StoredCredential } from "./index.js";

const userId = "user:tg:user:123" as UserIdentity["id"];
const discharge = "discharge-token" as OpaqueToken;

function provider(creds?: InMemoryKv<StoredCredential>): AuthWebauthnProvider {
  return new AuthWebauthnProvider({
    rpID: "localhost",
    rpName: "GLA test",
    expectedOrigin: "http://localhost:3000",
    ...(creds !== undefined ? { credentials: creds } : {}),
  });
}

describe("AuthWebauthnProvider — registration options (beginEnrollment)", () => {
  it("produces registration options carrying a challenge + the bound user, and records a pending challenge", async () => {
    const p = provider();
    const options = (await p.beginEnrollment(userId, discharge)) as {
      challenge: string;
      rp: { id: string };
      user: { id: string; name: string };
    };
    expect(typeof options.challenge).toBe("string");
    expect(options.challenge.length).toBeGreaterThan(0);
    expect(options.rp.id).toBe("localhost");
    // The user is bound (the username is the identity; the id is the base64url of it).
    expect(options.user.name).toBe(userId);
    // Not enrolled yet — options are not a credential.
    expect(p.isEnrolled(userId)).toBe(false);
  });
});

describe("AuthWebauthnProvider — finishEnrollment is ATOMIC (no half-bound; GLA-013 AC#4)", () => {
  it("throws and stores NOTHING when there is no pending registration challenge", async () => {
    const p = provider();
    await expect(p.finishEnrollment(userId, { id: "x" })).rejects.toThrow(/no pending/i);
    expect(p.isEnrolled(userId)).toBe(false);
  });

  it("throws and stores NOTHING on a malformed/garbage attestation (a failed ceremony)", async () => {
    const creds = new InMemoryKv<StoredCredential>();
    const p = provider(creds);
    // Begin (records a pending challenge), then submit garbage — verify must throw, store nothing.
    await p.beginEnrollment(userId, discharge);
    await expect(p.finishEnrollment(userId, { not: "a real attestation" })).rejects.toThrow(
      /webauthn registration|verification failed/i,
    );
    // ATOMIC: no credential was written, so the user is still not enrolled and is retryable.
    expect(p.isEnrolled(userId)).toBe(false);
    expect(creds.get(userId)).toBeUndefined();
  });
});

describe("AuthWebauthnProvider — authentication preconditions (GLA-013 AC#3)", () => {
  it("challenge() throws for an un-enrolled user (no credential to challenge against)", async () => {
    const p = provider();
    await expect(p.challenge(userId)).rejects.toThrow(/un-enrolled|no registered credential/i);
  });

  it("verifyAssertion() denies (ok:false) for an un-enrolled user — never throws", async () => {
    const p = provider();
    const r = await p.verifyAssertion(userId, { any: "assertion" });
    expect(r.ok).toBe(false);
    expect(r.authStrength).toBe("none");
  });

  it("verifyAssertion() denies when a credential exists but no authn challenge is pending", async () => {
    // Seed a stored credential directly, but DON'T issue a challenge → verify has no pending challenge → deny.
    const creds = new InMemoryKv<StoredCredential>();
    creds.set(userId, { id: "cred-abc", publicKeyB64: "AAAA", counter: 0 });
    const p = provider(creds);
    const r = await p.verifyAssertion(userId, { any: "assertion" });
    expect(r.ok).toBe(false);
  });
});

describe("AuthWebauthnProvider — the swap-IdP store seam", () => {
  it("uses an injected credential store (so app can supply a shared/persistent one)", async () => {
    const creds = new InMemoryKv<StoredCredential>();
    const p = provider(creds);
    // isEnrolled reflects the injected store directly.
    expect(p.isEnrolled(userId)).toBe(false);
    creds.set(userId, { id: "cred-1", publicKeyB64: "BBBB", counter: 3 });
    expect(p.isEnrolled(userId)).toBe(true);
    expect(p.getStoredCredential(userId)?.counter).toBe(3);
  });
});
