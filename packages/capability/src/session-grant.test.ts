// Unit tests for the recipient-bound HANDOFF (session) GRANT (packages/capability) — GLA-032/033/035.
// Covers: minting a recipient-bound, short-TTL, session/capsule-scoped grant ATTENUATED from the session/task
// capability (child ⊆ parent — never widened by the request); and the gateway's stateless verify-at-edge, with
// every negative covered hard — wrong-recipient / absent-recipient / expired / revoked / wrong-class / wrong-scope.
// Pure in-process; no I/O. The signing math + the attenuation algebra are the kernel's (reused here).

import {
  type CapabilityId,
  HmacCapabilitySigner,
  type Iso8601,
  type OpaqueToken,
  type RecipientRef,
} from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { CapabilityService } from "./index.js";

const recipient = "tg:user:123" as RecipientRef;
const other = "tg:user:999" as RecipientRef;
const FUTURE = "2999-01-01T00:00:00.000Z" as Iso8601;
const PAST = "2000-01-01T00:00:00.000Z" as Iso8601;
const SESS = "sess_abc1";

/** Mint a parent (task) capability bound to the recipient with a generous TTL + a scope the grant narrows within. */
async function parentTaskGrant(
  signer: HmacCapabilitySigner,
  opts: { recipient?: RecipientRef; notAfter?: Iso8601; scope?: string } = {},
): Promise<OpaqueToken> {
  const { token } = await signer.mint({
    cls: "task",
    caveats: [
      { kind: "recipient", recipient: opts.recipient ?? recipient },
      { kind: "ttl", notAfter: opts.notAfter ?? FUTURE },
      { kind: "scope", path: opts.scope ?? "/handoff" },
    ],
  });
  return token;
}

describe("CapabilityService.mintSessionGrant — recipient-bound, short-TTL, scoped (GLA-032/033)", () => {
  it("mints a session-class grant carrying recipient + ttl + scope (session-bound via the scope path)", async () => {
    const svc = new CapabilityService();
    const { capability, scopePath } = await svc.mintSessionGrant({ sessionId: SESS, recipient });
    expect(capability.cls).toBe("session");
    const kinds = capability.caveats.map((c) => c.kind).sort();
    // The grant binds the session via its `scope` path (the gateway verifies recipient + scope + class). It carries
    // NO separate `audience` caveat — that would widen the exact-match audience dimension when the grant attenuates
    // from the task cap (which inherits the agent-authority's identity audience).
    expect(kinds).toEqual(["recipient", "scope", "ttl"]);
    expect(capability.caveats).toEqual(
      expect.arrayContaining([
        { kind: "recipient", recipient },
        { kind: "scope", path: `/handoff/${SESS}` },
      ]),
    );
    expect(scopePath).toBe(`/handoff/${SESS}`);
  });

  it("the grant's TTL is SHORT by default (≈15m), not the parent's long TTL", async () => {
    const svc = new CapabilityService();
    const before = Date.now();
    const { capability } = await svc.mintSessionGrant({ sessionId: SESS, recipient });
    const ttl = capability.caveats.find((c) => c.kind === "ttl");
    expect(ttl?.kind).toBe("ttl");
    if (ttl?.kind === "ttl") {
      const ms = new Date(ttl.notAfter).getTime() - before;
      // Short window: comfortably under an hour (the default is 15m).
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThan(60 * 60 * 1000);
    }
  });

  it("ATTENUATES from the session/task capability — the grant is a CHILD (descends by lineage)", async () => {
    const signer = new HmacCapabilitySigner();
    const svc = new CapabilityService(signer);
    const parent = await parentTaskGrant(signer);
    const { capability } = await svc.mintSessionGrant({
      sessionId: SESS,
      recipient,
      parentToken: parent,
    });
    // A genuine child: it has a parent ref + a non-empty lineage (so revoking the parent cascades).
    expect(capability.parentRef).toBeDefined();
    expect((capability.lineage ?? []).length).toBeGreaterThan(0);
  });

  it("CANNOT be widened by the request — a DIFFERENT recipient than the parent is REJECTED", async () => {
    const signer = new HmacCapabilitySigner();
    const svc = new CapabilityService(signer);
    // Parent is bound to `recipient`; requesting a grant for `other` would WIDEN (re-target) the recipient.
    const parent = await parentTaskGrant(signer, { recipient });
    await expect(
      svc.mintSessionGrant({ sessionId: SESS, recipient: other, parentToken: parent }),
    ).rejects.toMatchObject({ code: "auth.attenuation_widened" });
  });

  it("CANNOT be widened by the request — a scope OUTSIDE the parent's scope is REJECTED", async () => {
    const signer = new HmacCapabilitySigner();
    const svc = new CapabilityService(signer);
    // Parent scope is `/handoff/<sess>`; requesting `/admin` would WIDEN the scope.
    const parent = await parentTaskGrant(signer, { scope: `/handoff/${SESS}` });
    await expect(
      svc.mintSessionGrant({
        sessionId: SESS,
        recipient,
        parentToken: parent,
        scopePath: "/admin",
      }),
    ).rejects.toMatchObject({ code: "auth.attenuation_widened" });
  });

  it("CANNOT be widened by the request — a TTL past the parent's expiry is REJECTED", async () => {
    const signer = new HmacCapabilitySigner();
    const svc = new CapabilityService(signer);
    // Parent expires sooner than the requested grant TTL → widening the lifetime → rejected.
    const parentExpiry = "2030-01-01T00:00:00.000Z" as Iso8601;
    const parent = await parentTaskGrant(signer, { notAfter: parentExpiry });
    await expect(
      svc.mintSessionGrant({
        sessionId: SESS,
        recipient,
        parentToken: parent,
        notAfter: "2099-01-01T00:00:00.000Z" as Iso8601,
      }),
    ).rejects.toMatchObject({ code: "auth.attenuation_widened" });
  });
});

describe("CapabilityService.verifySessionGrant — stateless verify-at-edge; only the bound recipient passes (GLA-035)", () => {
  it("a valid grant for the bound recipient + the right scope → VERIFIES", async () => {
    const svc = new CapabilityService();
    const { token, scopePath } = await svc.mintSessionGrant({ sessionId: SESS, recipient });
    const r = svc.verifySessionGrant(token, { recipient, scopePath });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recipient).toBe(recipient);
      expect(r.capability.cls).toBe("session");
    }
  });

  it("a grant for a DIFFERENT recipient → REFUSED (auth.recipient_mismatch)", async () => {
    const svc = new CapabilityService();
    const { token, scopePath } = await svc.mintSessionGrant({ sessionId: SESS, recipient });
    // The presenter authenticated as `other`, but the grant is bound to `recipient` → refused.
    const r = svc.verifySessionGrant(token, { recipient: other, scopePath });
    expect(r).toEqual({ ok: false, reason: "auth.recipient_mismatch" });
  });

  it("an EXPIRED grant → REFUSED (auth.expired)", async () => {
    const svc = new CapabilityService();
    const { token, scopePath } = await svc.mintSessionGrant({
      sessionId: SESS,
      recipient,
      notAfter: PAST,
    });
    const r = svc.verifySessionGrant(token, { recipient, scopePath });
    expect(r).toEqual({ ok: false, reason: "auth.expired" });
  });

  it("a REVOKED grant → REFUSED (auth.revoked)", async () => {
    const svc = new CapabilityService();
    const { capability, token, scopePath } = await svc.mintSessionGrant({
      sessionId: SESS,
      recipient,
    });
    await svc.revoke(capability.id);
    const r = svc.verifySessionGrant(token, { recipient, scopePath });
    expect(r).toEqual({ ok: false, reason: "auth.revoked" });
  });

  it("revoking the PARENT cascades — the grant is REFUSED (auth.revoked) by lineage", async () => {
    const signer = new HmacCapabilitySigner();
    const svc = new CapabilityService(signer);
    const parent = await parentTaskGrant(signer);
    const { capability, token, scopePath } = await svc.mintSessionGrant({
      sessionId: SESS,
      recipient,
      parentToken: parent,
    });
    // Revoke the PARENT (the session/task cap), not the grant itself.
    const parentId = capability.parentRef as CapabilityId;
    await svc.revoke(parentId);
    const r = svc.verifySessionGrant(token, { recipient, scopePath });
    expect(r).toEqual({ ok: false, reason: "auth.revoked" });
  });

  it("a token of the WRONG CLASS (a task cap presented as a handoff grant) → REFUSED (auth.insufficient)", async () => {
    const signer = new HmacCapabilitySigner();
    const svc = new CapabilityService(signer);
    // Present the task cap itself (class `task`) at the edge — not a session grant.
    const taskToken = await parentTaskGrant(signer);
    const r = svc.verifySessionGrant(taskToken, { recipient, scopePath: `/handoff/${SESS}` });
    expect(r).toEqual({ ok: false, reason: "auth.insufficient" });
  });

  it("a request to the WRONG scope path → REFUSED (auth.insufficient, scope not within)", async () => {
    const svc = new CapabilityService();
    const { token } = await svc.mintSessionGrant({ sessionId: SESS, recipient });
    // The grant is scoped to /handoff/<sess>; a request for a sibling path is outside it.
    const r = svc.verifySessionGrant(token, { recipient, scopePath: "/handoff/other-session" });
    expect(r).toEqual({ ok: false, reason: "auth.insufficient" });
  });

  it("a FORGED/tampered token → REFUSED (auth.malformed)", async () => {
    const svc = new CapabilityService();
    const { token, scopePath } = await svc.mintSessionGrant({ sessionId: SESS, recipient });
    // Flip a character in the encoded token → the HMAC chain no longer verifies.
    const tampered = `${token.slice(0, -2)}xx` as OpaqueToken;
    const r = svc.verifySessionGrant(tampered, { recipient, scopePath });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("auth.malformed");
    }
  });
});
