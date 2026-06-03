// Regression tests for four capability-token security findings (code review of GLA-004):
//   #1 lineage must be tamper-evident (folded into the signed tag)
//   #2 verify must reject if SELF or ANY ancestor is revoked (full signed chain, stateless)
//   #3 a `scope` caveat must FAIL CLOSED when ctx.scopePath is omitted
//   #4 caveat canonical encoding must be recursive (nested inner keys are signed)
// All exercise the reference HMAC signer; verify stays pure (no I/O, snapshot passed in).
import { describe, expect, it } from "vitest";
import type { CapabilityId, Iso8601, RecipientRef } from "./brands.js";
import type { OpaqueToken } from "./brands.js";
import { InMemoryRevocations } from "./capability.js";
import type { Caveat } from "./caveats.js";
import { HmacCapabilitySigner } from "./hmac-signer.js";

const NEVER = new InMemoryRevocations().snapshot();
const now = (s: string) => s as Iso8601;
const T0 = now("2026-06-03T00:00:00.000Z");

/** Decode a token's base64url JSON payload (to tamper with it for the negative tests). */
function decodePayload(token: OpaqueToken): Record<string, unknown> {
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
}
/** Re-encode a (tampered) payload back into a token. */
function encodePayload(p: Record<string, unknown>): OpaqueToken {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url") as OpaqueToken;
}

describe("#1 — lineage is tamper-evident (signed into the tag)", () => {
  it("STRIPPING parentRef/lineage from the token breaks verification", async () => {
    const signer = new HmacCapabilitySigner();
    const { token: root } = await signer.mint({ cls: "agent-authority", caveats: [] });
    const child = await signer.attenuate(root, []);

    // sanity: the untouched child verifies
    expect(signer.verify(child.token, { now: T0, revocations: NEVER }).ok).toBe(true);

    // attacker strips the lineage (to dodge ancestor revocation) but keeps the original tag.
    // (`parentRef = undefined` serializes identically to deleting it — JSON.stringify omits it.)
    const p = decodePayload(child.token);
    expect(Array.isArray(p.lineage) && (p.lineage as unknown[]).length).toBeGreaterThan(0);
    p.lineage = [];
    p.parentRef = undefined;
    const forged = encodePayload(p);

    const r = signer.verify(forged, { now: T0, revocations: NEVER });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("auth.malformed");
    }
  });

  it("ALTERING an ancestor id in the lineage breaks verification", async () => {
    const signer = new HmacCapabilitySigner();
    const { token: root } = await signer.mint({ cls: "agent-authority", caveats: [] });
    const child = await signer.attenuate(root, []);

    const p = decodePayload(child.token);
    (p.lineage as string[])[0] = "cap_attacker_swapped" as CapabilityId; // point lineage elsewhere
    const forged = encodePayload(p);

    const r = signer.verify(forged, { now: T0, revocations: NEVER });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("auth.malformed");
    }
  });
});

describe("#2 — verify rejects if self OR any ancestor is revoked (full chain, stateless)", () => {
  it("a clean three-level chain still verifies", async () => {
    const signer = new HmacCapabilitySigner();
    const { token: root } = await signer.mint({ cls: "agent-authority", caveats: [] });
    const mid = await signer.attenuate(root, []);
    const leaf = await signer.attenuate(mid.token, []);
    expect(signer.verify(leaf.token, { now: T0, revocations: NEVER }).ok).toBe(true);
    // the leaf actually carries both ancestors, root-first
    const r = signer.verify(leaf.token, { now: T0, revocations: NEVER });
    if (r.ok) {
      expect(r.capability.lineage).toHaveLength(2);
    }
  });

  it("revoking the IMMEDIATE parent invalidates the descendant", async () => {
    const signer = new HmacCapabilitySigner();
    const { token: root } = await signer.mint({ cls: "agent-authority", caveats: [] });
    const parent = await signer.attenuate(root, []);
    const leaf = await signer.attenuate(parent.token, []);

    const revs = new InMemoryRevocations();
    revs.add(parent.capability.id);
    const r = signer.verify(leaf.token, { now: T0, revocations: revs.snapshot() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("auth.revoked");
    }
  });

  it("revoking the GRANDPARENT (root) two levels up invalidates the descendant", async () => {
    const signer = new HmacCapabilitySigner();
    const { token: root, capability: rootCap } = await signer.mint({
      cls: "agent-authority",
      caveats: [],
    });
    const mid = await signer.attenuate(root, []);
    const leaf = await signer.attenuate(mid.token, []); // two levels below the root

    const revs = new InMemoryRevocations();
    revs.add(rootCap.id); // revoke the grandparent only
    const r = signer.verify(leaf.token, { now: T0, revocations: revs.snapshot() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("auth.revoked");
    }
  });

  it("revoking an UNRELATED capability does not invalidate the descendant", async () => {
    const signer = new HmacCapabilitySigner();
    const { token: root } = await signer.mint({ cls: "agent-authority", caveats: [] });
    const leaf = await signer.attenuate(root, []);
    const revs = new InMemoryRevocations();
    revs.add("cap_unrelated_999" as CapabilityId);
    expect(signer.verify(leaf.token, { now: T0, revocations: revs.snapshot() }).ok).toBe(true);
  });
});

describe("#3 — scope caveat FAILS CLOSED when ctx.scopePath is omitted", () => {
  it("rejects with auth.scope_required when a scoped grant is presented without a path", async () => {
    const signer = new HmacCapabilitySigner();
    const { token } = await signer.mint({
      cls: "session",
      caveats: [{ kind: "scope", path: "/a/b" }],
    });
    // omitted path → fail closed
    const missing = signer.verify(token, { now: T0, revocations: NEVER });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe("auth.scope_required");
    }
    // path within scope → ok
    expect(signer.verify(token, { now: T0, scopePath: "/a/b/c", revocations: NEVER }).ok).toBe(
      true,
    );
    // path outside scope → insufficient
    const out = signer.verify(token, { now: T0, scopePath: "/other", revocations: NEVER });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("auth.insufficient");
    }
  });

  it("a capability WITHOUT a scope caveat still verifies when no path is supplied", async () => {
    const signer = new HmacCapabilitySigner();
    const { token } = await signer.mint({ cls: "task", caveats: [] });
    expect(signer.verify(token, { now: T0, revocations: NEVER }).ok).toBe(true);
  });
});

describe("#4 — caveat canonical encoding is recursive (nested inner keys are signed)", () => {
  it("a token whose nested caveat inner field is altered fails verification", async () => {
    const signer = new HmacCapabilitySigner();
    // A caveat carrying a nested object. (The Caveat union is flat today; we use a structurally
    // nested value via a forward-compatible cast to prove the SIGNER signs nested fields.)
    const nested = {
      kind: "net-confine",
      cidrs: ["10.0.0.0/8"],
      meta: { region: "eu", tier: 1 },
    } as unknown as Caveat;
    const { token } = await signer.mint({ cls: "session", caveats: [nested] });
    expect(signer.verify(token, { now: T0, revocations: NEVER }).ok).toBe(true);

    // tamper with the DEEP inner field only
    const p = decodePayload(token);
    const cav0 = (p.caveats as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    (cav0.meta as Record<string, unknown>).region = "us"; // change a nested-object inner key
    const forged = encodePayload(p);

    const r = signer.verify(forged, { now: T0, revocations: NEVER });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // proves the inner field was part of the signed bytes (recursive canonicalization)
      expect(r.reason).toBe("auth.malformed");
    }
  });

  it("key ORDER of a nested object does not change the signature (canonical, depth-sorted)", async () => {
    const signer = new HmacCapabilitySigner();
    const cav = {
      kind: "net-confine",
      cidrs: ["10.0.0.0/8"],
      meta: { region: "eu", tier: 1 },
    } as unknown as Caveat;
    const { token } = await signer.mint({ cls: "session", caveats: [cav] });

    // Re-serialize the SAME caveat with reordered nested keys; recompute is order-independent, so
    // a re-encoded payload with the same canonical form still verifies.
    const p = decodePayload(token);
    const cav0 = (p.caveats as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    cav0.meta = { tier: 1, region: "eu" }; // same data, different key order
    const reordered = encodePayload(p);

    // tag was computed over the canonical (sorted-at-every-depth) form, so order doesn't matter
    expect(signer.verify(reordered, { now: T0, revocations: NEVER }).ok).toBe(true);
  });
});

// A tiny guard that the new error code maps to the documented auth exit (4), so callers can branch.
describe("auth.scope_required maps to the auth exit code", async () => {
  const { exitCodeFor, ExitCode } = await import("./errors.js");
  it("exitCodeFor(auth.scope_required) === ExitCode.AUTH", () => {
    expect(exitCodeFor("auth.scope_required")).toBe(ExitCode.AUTH);
  });
});

// keep the RecipientRef import meaningful (used to assert the recipient path is unaffected by #3)
describe("recipient binding still fails closed alongside scope (no regression)", () => {
  it("a recipient+scope grant needs BOTH a matching recipient and a path", async () => {
    const signer = new HmacCapabilitySigner();
    const bound = "tg:user:7" as RecipientRef;
    const { token } = await signer.mint({
      cls: "session",
      caveats: [
        { kind: "recipient", recipient: bound },
        { kind: "scope", path: "/x" },
      ],
    });
    // right recipient but missing path → scope_required
    const r1 = signer.verify(token, { now: T0, recipient: bound, revocations: NEVER });
    expect(r1.ok).toBe(false);
    // both present and valid → ok
    const r2 = signer.verify(token, {
      now: T0,
      recipient: bound,
      scopePath: "/x/y",
      revocations: NEVER,
    });
    expect(r2.ok).toBe(true);
  });
});
