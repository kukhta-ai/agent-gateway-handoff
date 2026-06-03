// AC#2 + AC#3 — the capability primitive: mint/attenuate/verify, signing-independent (the kernel
// names a port; this exercises the reference HMAC signer), stateless verify (pure from cap +
// request + revocation snapshot, NO async lookup), attenuation child ⊆ parent, and the
// recipient-binding FAIL-CLOSED negative (a dedicated test proves the wrong-recipient negative).
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Iso8601, RecipientRef } from "./brands.js";
import { InMemoryRevocations } from "./capability.js";
import type { Caveat } from "./caveats.js";
import { caveatsSubsetOf } from "./caveats.js";
import { GlaErrorException } from "./errors.js";
import { HmacCapabilitySigner } from "./hmac-signer.js";

const NEVER_REVOKED = new InMemoryRevocations().snapshot();
const now = (s: string) => s as Iso8601;
const rcpt = (s: string) => s as RecipientRef;

describe("Capability port — mint & verify (reference HMAC signer)", () => {
  it("mints a capability and verifies it back (ok) with no I/O", () => {
    const signer = new HmacCapabilitySigner();
    return signer
      .mint({ cls: "agent-authority", caveats: [{ kind: "allowed-ops", ops: ["task.create"] }] })
      .then(({ token, capability }) => {
        expect(capability.cls).toBe("agent-authority");
        const r = signer.verify(token, {
          now: now("2026-06-03T00:00:00.000Z"),
          revocations: NEVER_REVOKED,
        });
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.capability.cls).toBe("agent-authority");
        }
      });
  });

  it("rejects a forged/tampered token (auth.malformed), not throwing", () => {
    const signer = new HmacCapabilitySigner();
    const r = signer.verify("not-a-real-token" as never, {
      now: now("2026-06-03T00:00:00.000Z"),
      revocations: NEVER_REVOKED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("auth.malformed");
    }
  });

  it("a token minted by a DIFFERENT key fails verification (signing-independent seam holds)", async () => {
    const a = new HmacCapabilitySigner(randomBytes(32));
    const b = new HmacCapabilitySigner(randomBytes(32));
    const { token } = await a.mint({ cls: "task", caveats: [] });
    const r = b.verify(token, { now: now("2026-06-03T00:00:00.000Z"), revocations: NEVER_REVOKED });
    expect(r.ok).toBe(false);
  });
});

describe("verify() is stateless & pure (§2.4, invariant 4)", () => {
  it("expires from ctx.now vs the ttl caveat — no clock read inside verify", async () => {
    const signer = new HmacCapabilitySigner();
    const { token } = await signer.mint({
      cls: "session",
      caveats: [{ kind: "ttl", notAfter: now("2026-06-03T12:00:00.000Z") }],
    });
    // before expiry → ok
    expect(
      signer.verify(token, { now: now("2026-06-03T11:59:59.000Z"), revocations: NEVER_REVOKED }).ok,
    ).toBe(true);
    // after expiry → auth.expired (purely from the passed-in now)
    const late = signer.verify(token, {
      now: now("2026-06-03T12:00:01.000Z"),
      revocations: NEVER_REVOKED,
    });
    expect(late.ok).toBe(false);
    if (!late.ok) {
      expect(late.reason).toBe("auth.expired");
    }
  });

  it("revocation is read from the PASSED-IN snapshot, never a central lookup", async () => {
    const signer = new HmacCapabilitySigner();
    const { token, capability } = await signer.mint({ cls: "task", caveats: [] });
    const revs = new InMemoryRevocations();
    // not revoked yet
    expect(
      signer.verify(token, { now: now("2026-06-03T00:00:00.000Z"), revocations: revs.snapshot() })
        .ok,
    ).toBe(true);
    // revoke and pass a fresh snapshot → auth.revoked
    revs.add(capability.id);
    const r = signer.verify(token, {
      now: now("2026-06-03T00:00:00.000Z"),
      revocations: revs.snapshot(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("auth.revoked");
    }
  });
});

describe("attenuation: child ⊆ parent (§2.2, invariant 3)", () => {
  it("narrowing (subset ops, shorter ttl) is allowed", async () => {
    const signer = new HmacCapabilitySigner();
    const { token } = await signer.mint({
      cls: "agent-authority",
      caveats: [
        { kind: "allowed-ops", ops: ["task.create", "session.create"] },
        { kind: "ttl", notAfter: now("2026-06-03T23:00:00.000Z") },
      ],
    });
    const child = await signer.attenuate(token, [
      { kind: "allowed-ops", ops: ["task.create"] }, // a subset
      { kind: "ttl", notAfter: now("2026-06-03T12:00:00.000Z") }, // sooner
    ]);
    expect(child.capability.parentRef).toBeDefined();
    expect(child.capability.caveats.length).toBeGreaterThan(0);
  });

  it("WIDENING throws a typed auth.attenuation_widened (reject-or-narrow)", async () => {
    const signer = new HmacCapabilitySigner();
    const { token } = await signer.mint({
      cls: "session",
      caveats: [
        { kind: "allowed-ops", ops: ["read"] },
        { kind: "ttl", notAfter: now("2026-06-03T12:00:00.000Z") },
      ],
    });
    // try to add an op the parent never had → widening
    await expect(
      signer.attenuate(token, [{ kind: "allowed-ops", ops: ["read", "write"] }]),
    ).rejects.toBeInstanceOf(GlaErrorException);
    // try to extend the TTL → widening
    await expect(
      signer.attenuate(token, [{ kind: "ttl", notAfter: now("2026-06-04T00:00:00.000Z") }]),
    ).rejects.toMatchObject({ code: "auth.attenuation_widened" });
  });

  it("the caveat predicate itself: scope path containment & op subset", () => {
    const parent: Caveat[] = [{ kind: "scope", path: "/a" }];
    expect(caveatsSubsetOf([{ kind: "scope", path: "/a/b" }], parent)).toBe(true);
    expect(caveatsSubsetOf([{ kind: "scope", path: "/ab" }], parent)).toBe(false); // segment boundary
    expect(caveatsSubsetOf([], parent)).toBe(false); // dropping a parent constraint = widening
  });
});

describe("recipient-binding FAILS CLOSED for the wrong recipient (AC#3)", () => {
  it("verifies for the bound recipient and rejects every other (and a missing presenter)", async () => {
    const signer = new HmacCapabilitySigner();
    const bound = rcpt("tg:user:123");
    const { token } = await signer.mint({
      cls: "session",
      caveats: [{ kind: "recipient", recipient: bound }],
    });
    const t = now("2026-06-03T00:00:00.000Z");

    // bound recipient → ok
    const good = signer.verify(token, { now: t, recipient: bound, revocations: NEVER_REVOKED });
    expect(good.ok).toBe(true);

    // a DIFFERENT recipient → auth.recipient_mismatch (the dedicated negative)
    const wrong = signer.verify(token, {
      now: t,
      recipient: rcpt("tg:user:999"),
      revocations: NEVER_REVOKED,
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.reason).toBe("auth.recipient_mismatch");
    }

    // NO presenter at all → also fails closed
    const none = signer.verify(token, { now: t, revocations: NEVER_REVOKED });
    expect(none.ok).toBe(false);
    if (!none.ok) {
      expect(none.reason).toBe("auth.recipient_mismatch");
    }
  });
});
