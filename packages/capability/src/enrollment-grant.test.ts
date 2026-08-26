// Unit tests for the single-use operator-discharge ENROLLMENT GRANT (packages/capability) — GLA-012 AC#3,
// GLA-013 AC#2. Covers: minting a recipient-bound enrollment grant DISTINCT from a handoff grant; verifying it
// (the gateway's token-only path); and each negative — absent/wrong-recipient/expired/reused — refused with the
// right stable reason. Pure in-process; no I/O.

import {
  HmacCapabilitySigner,
  type Iso8601,
  type OpaqueToken,
  type RecipientRef,
} from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { CapabilityService } from "./index.js";

const recipient = "tg:user:123" as RecipientRef;
const other = "tg:user:999" as RecipientRef;
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

describe("CapabilityService.mintEnrollmentGrant — distinct from a handoff grant (GLA-012 AC#3)", () => {
  it("mints an operator-discharge grant carrying recipient + purpose=enroll + single-use + ttl", async () => {
    const svc = new CapabilityService();
    const { capability, nonce } = await svc.mintEnrollmentGrant(recipient);
    expect(capability.cls).toBe("operator-discharge");
    const kinds = capability.caveats.map((c) => c.kind).sort();
    expect(kinds).toEqual(["purpose", "recipient", "single-use", "ttl"]);
    const purpose = capability.caveats.find((c) => c.kind === "purpose");
    expect(purpose).toEqual({ kind: "purpose", value: "enroll" });
    const rec = capability.caveats.find((c) => c.kind === "recipient");
    expect(rec).toEqual({ kind: "recipient", recipient });
    const su = capability.caveats.find((c) => c.kind === "single-use");
    expect(su).toEqual({ kind: "single-use", nonce });
    // It is NOT a session-class handoff grant.
    expect(capability.cls).not.toBe("session");
  });
});

describe("CapabilityService.verifyEnrollmentGrant{,Token} — the happy path", () => {
  it("verifies a fresh grant by the token alone (reading the recipient from the signed grant)", async () => {
    const svc = new CapabilityService();
    const { token, nonce } = await svc.mintEnrollmentGrant(recipient);
    const r = svc.verifyEnrollmentGrantToken(token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recipient).toBe(recipient);
      expect(r.nonce).toBe(nonce);
      expect(r.capability.cls).toBe("operator-discharge");
    }
  });

  it("verifies a fresh grant against the explicit recipient", async () => {
    const svc = new CapabilityService();
    const { token } = await svc.mintEnrollmentGrant(recipient);
    expect(svc.verifyEnrollmentGrant(token, recipient).ok).toBe(true);
  });
});

describe("CapabilityService enrollment-grant negatives (GLA-013 AC#2)", () => {
  it("ABSENT/garbage token → refused (auth.malformed)", async () => {
    const svc = new CapabilityService();
    const r = svc.verifyEnrollmentGrantToken("not-a-real-token" as OpaqueToken);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("auth.malformed");
  });

  it("WRONG-RECIPIENT → refused (auth.recipient_mismatch) on the explicit-recipient path", async () => {
    const svc = new CapabilityService();
    const { token } = await svc.mintEnrollmentGrant(recipient);
    const r = svc.verifyEnrollmentGrant(token, other);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("auth.recipient_mismatch");
  });

  it("EXPIRED → refused (auth.expired)", async () => {
    const svc = new CapabilityService();
    // Mint already-expired (notAfter in the past), then verify at 'now' past it.
    const { token } = await svc.mintEnrollmentGrant(recipient, PAST as Iso8601);
    const r = svc.verifyEnrollmentGrantToken(token, "2026-06-03T00:00:00.000Z");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("auth.expired");
  });

  it("REUSED (spent) → refused (auth.revoked); verifies once, then never again", async () => {
    const svc = new CapabilityService();
    const { token, nonce } = await svc.mintEnrollmentGrant(recipient, FUTURE as Iso8601);
    // First verify succeeds.
    expect(svc.verifyEnrollmentGrantToken(token).ok).toBe(true);
    // Consume it (as the gateway does after a successful enrollment).
    svc.markSpent(nonce);
    expect(svc.isSpent(nonce)).toBe(true);
    // A reuse now fails with a stable revoked reason — single-use enforced.
    const r = svc.verifyEnrollmentGrantToken(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("auth.revoked");
  });

  it("a NON-enrollment capability presented as an enrollment grant → refused (auth.insufficient)", async () => {
    // Mint an agent-authority via the same signer, present it as an enrollment grant — wrong class/purpose.
    const signer = new HmacCapabilitySigner();
    const svc = new CapabilityService(signer);
    const { token } = await svc.mintAgentAuthority({
      profile: "local-single-operator",
      identity: "agent:local",
      allowedOps: ["whoami"],
    });
    const r = svc.verifyEnrollmentGrant(token, recipient);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("auth.insufficient");
  });
});

describe("CapabilityService.tryConsumeEnrollmentGrantToken — atomic single-use (GLA-013 AC#2; TOCTOU close)", () => {
  it("CONCURRENT consumes of the same grant: exactly ONE succeeds, the rest are refused (auth.revoked)", async () => {
    const svc = new CapabilityService();
    const { token } = await svc.mintEnrollmentGrant(recipient, FUTURE as Iso8601);
    // Fire many consumes "concurrently". tryConsume is synchronous + atomic (check-and-add in one step, no await
    // between), so even back-to-back in one microtask batch exactly one wins.
    const results = await Promise.all(
      Array.from({ length: 8 }, async () => svc.tryConsumeEnrollmentGrantToken(token)),
    );
    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);
    expect(wins.length).toBe(1);
    expect(losses.length).toBe(7);
    for (const l of losses) {
      if (!l.ok) expect(l.reason).toBe("auth.revoked");
    }
  });

  it("a single consume marks the grant spent (a later read-only verify then fails auth.revoked)", async () => {
    const svc = new CapabilityService();
    const { token, nonce } = await svc.mintEnrollmentGrant(recipient, FUTURE as Iso8601);
    expect(svc.tryConsumeEnrollmentGrantToken(token).ok).toBe(true);
    expect(svc.isSpent(nonce)).toBe(true);
    const reuse = svc.verifyEnrollmentGrantToken(token);
    expect(reuse.ok).toBe(false);
    if (!reuse.ok) expect(reuse.reason).toBe("auth.revoked");
  });

  it("verifyConsumedEnrollmentGrantToken accepts only an already-spent signed enrollment grant", async () => {
    const svc = new CapabilityService();
    const { token, nonce } = await svc.mintEnrollmentGrant(recipient, FUTURE as Iso8601);

    const fresh = svc.verifyConsumedEnrollmentGrantToken(token);
    expect(fresh.ok).toBe(false);
    if (!fresh.ok) expect(fresh.reason).toBe("auth.revoked");

    expect(svc.tryConsumeEnrollmentGrantToken(token).ok).toBe(true);
    const consumed = svc.verifyConsumedEnrollmentGrantToken(token);
    expect(consumed.ok).toBe(true);
    if (consumed.ok) {
      expect(consumed.recipient).toBe(recipient);
      expect(consumed.nonce).toBe(nonce);
    }
  });

  it("unspend ROLLS BACK a consume (a failed ceremony stays retryable with the same grant)", async () => {
    const svc = new CapabilityService();
    const { token, nonce } = await svc.mintEnrollmentGrant(recipient, FUTURE as Iso8601);
    // Optimistically consume (as the gateway does before the ceremony).
    expect(svc.tryConsumeEnrollmentGrantToken(token).ok).toBe(true);
    expect(svc.isSpent(nonce)).toBe(true);
    // The ceremony failed → roll back.
    svc.unspend(nonce);
    expect(svc.isSpent(nonce)).toBe(false);
    // The same still-valid grant can now be consumed again (retry).
    expect(svc.tryConsumeEnrollmentGrantToken(token).ok).toBe(true);
  });

  it("tryConsume on an INVALID grant leaves the spent-set untouched (no consume on a refusal)", async () => {
    const svc = new CapabilityService();
    const before = svc.tryConsumeEnrollmentGrantToken("garbage" as OpaqueToken);
    expect(before.ok).toBe(false);
    // A fresh valid grant then consumes fine — the bad token did not pollute the spent-set.
    const { token } = await svc.mintEnrollmentGrant(recipient, FUTURE as Iso8601);
    expect(svc.tryConsumeEnrollmentGrantToken(token).ok).toBe(true);
  });
});
