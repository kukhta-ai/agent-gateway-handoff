// Unit tests for the recipient-binding service (packages/identity). Slice 1 binds only:
// a channel ref → stable UserIdentity, narrow-only, no enrollment (kernel-contracts.md §7).
import type { RecipientRef } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { IdentityService } from "./index.js";

const tg = "tg:user:123" as RecipientRef;
const cli = "cli:user:1" as RecipientRef;

describe("IdentityService.bindFromInbound", () => {
  it("maps a channel ref to a stable UserIdentity with channel provenance", () => {
    const svc = new IdentityService();
    const b = svc.bindFromInbound(tg);
    expect(b.recipient).toBe(tg);
    expect(b.userId).toBe("user:tg:user:123");
    expect(b.provenance).toBe("tg"); // parsed from the ref prefix
    // No proof yet — binding establishes who via the channel, not how strongly.
    expect(b.authStrength).toBe("none");
  });

  it("derives the channel for a CLI recipient ref", () => {
    const svc = new IdentityService();
    expect(svc.bindFromInbound(cli).provenance).toBe("cli");
  });

  it("is deterministic for the same ref (stable across calls)", () => {
    const svc = new IdentityService();
    expect(svc.bindFromInbound(tg)).toEqual(svc.bindFromInbound(tg));
  });

  it("different refs map to different identities (no merging in Slice 1)", () => {
    const svc = new IdentityService();
    expect(svc.bindFromInbound(tg).userId).not.toBe(svc.bindFromInbound(cli).userId);
  });
});

describe("IdentityService.bind (port shape)", () => {
  it("binds with the supplied channel as provenance", async () => {
    const svc = new IdentityService();
    const b = await svc.bind(tg, { channel: "telegram" });
    expect(b.provenance).toBe("telegram");
    expect(b.userId).toBe("user:tg:user:123");
  });
});

describe("enrollment/verification are deferred to Slice 4", () => {
  it("enroll throws a typed error (not implemented in Slice 1)", async () => {
    const svc = new IdentityService();
    await expect(svc.enroll()).rejects.toThrow(/not implemented/i);
  });
  it("verify throws a typed error (not implemented in Slice 1)", async () => {
    const svc = new IdentityService();
    await expect(svc.verify()).rejects.toThrow(/not implemented/i);
  });
});
