// CONTRACT tests for the Access Gateway enrollment fronting (packages/gateway) — GLA-012 AC#2 / GLA-013 AC#2.
// Drives the REAL node:http server on 127.0.0.1:<ephemeral> via fetch, with STUB grant + identity seams so each
// refusal reason is controlled precisely. Proves:
//   - the enrollment page is served ONLY on a valid grant; an absent/invalid/expired/wrong-recipient/REUSED grant
//     is refused with a stable status, and NO credential is stored (no enrollComplete is called)
//   - NO BYPASS: a direct POST /enroll/verify without a valid grant is refused before any credential work
//   - the happy path: GET serves the page, POST options returns options, POST verify stores + marks the grant spent
// The REAL WebAuthn ceremony is exercised end-to-end in packages/app (a virtual authenticator); here the seams
// are stubbed to pin the gateway's grant-enforcement + no-bypass contract deterministically.

import type { Capability, ErrorCode, OpaqueToken, RecipientRef } from "@gla/kernel";
import { afterEach, describe, expect, it } from "vitest";
import { AccessGateway, type EnrollmentGrantVerifyResult, type GatewayOptions } from "./index.js";

const recipient = "tg:user:123" as RecipientRef;

/** A fake verified operator-discharge capability (only the fields the gateway reads). */
const fakeCap: Capability = {
  id: "cap_fake1",
  cls: "operator-discharge",
  caveats: [
    { kind: "recipient", recipient },
    { kind: "purpose", value: "enroll" },
  ],
};

/**
 * A stub grant seam: a `valid` token verifies (and reports `recipient`); anything else fails with the configured
 * reason. `markSpent` records the spent nonce so a test can assert the happy path consumed the grant.
 */
class StubGrants {
  spent: string[] = [];
  /** Tokens that verify, keyed by token → the nonce they carry. */
  validTokens = new Map<string, string>([["valid", "nonce-1"]]);
  /** The reason an invalid token fails with (default malformed). */
  invalidReason: ErrorCode = "auth.malformed";

  private verify(token: string): EnrollmentGrantVerifyResult {
    const nonce = this.validTokens.get(token);
    if (nonce === undefined || this.spent.includes(nonce)) {
      // A spent nonce mimics the reused-grant refusal (auth.revoked); an unknown token uses invalidReason.
      const reason: ErrorCode = nonce !== undefined ? "auth.revoked" : this.invalidReason;
      return { ok: false, reason };
    }
    return { ok: true, capability: fakeCap, recipient, nonce };
  }
  /** Read-only verify (no consume) — the GET page + options route. */
  verifyEnrollmentGrantToken(token: OpaqueToken): EnrollmentGrantVerifyResult {
    return this.verify(token);
  }
  /** Atomic verify-and-consume — the verify route. Adds the nonce to `spent` in the same step as the verify. */
  tryConsumeEnrollmentGrantToken(token: OpaqueToken): EnrollmentGrantVerifyResult {
    const r = this.verify(token);
    if (r.ok) {
      this.spent.push(r.nonce);
    }
    return r;
  }
  /** Roll back an optimistic consume (un-spend) — called on a ceremony failure. */
  unspend(nonce: string): void {
    this.spent = this.spent.filter((n) => n !== nonce);
  }
}

/** A stub identity seam recording whether enrollComplete ran (i.e. whether a credential would be stored). */
class StubIdentity {
  optionsCalls = 0;
  completeCalls = 0;
  /** When set, enrollComplete throws (a failed attestation). */
  failComplete = false;
  /** An async delay inside enrollComplete (ms), so two requests are genuinely in-flight in the concurrency test. */
  completeDelayMs = 0;
  async enrollmentOptions(_recipient: RecipientRef, _discharge: OpaqueToken): Promise<unknown> {
    this.optionsCalls++;
    return { challenge: "opts-challenge", rp: { id: "localhost" } };
  }
  async enrollComplete(_recipient: RecipientRef, _attestation: unknown): Promise<unknown> {
    this.completeCalls++;
    if (this.completeDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.completeDelayMs));
    }
    if (this.failComplete) {
      const err = Object.assign(new Error("attestation rejected"), { code: "auth.insufficient" });
      throw err;
    }
    return { credentialId: "cred-1" };
  }
}

/** Boot a gateway on an ephemeral loopback port with the given stubs; returns the base URL + a closer. */
async function bootGateway(
  grants: StubGrants,
  identity: StubIdentity,
): Promise<{ base: string; close: () => Promise<void>; gateway: AccessGateway }> {
  const opts: GatewayOptions = { grants, identity, host: "127.0.0.1", port: 0 };
  const gateway = new AccessGateway(opts);
  const { host, port } = await gateway.listen();
  return { base: `http://${host}:${port}`, close: () => gateway.close(), gateway };
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) {
    const c = closers.pop();
    if (c) await c();
  }
});

describe("Access Gateway — GET /enroll grant enforcement (GLA-012 AC#2)", () => {
  it("serves the enrollment page on a VALID grant (HTML + the WebAuthn ceremony)", async () => {
    const { base, close } = await bootGateway(new StubGrants(), new StubIdentity());
    closers.push(close);
    const res = await fetch(`${base}/enroll?grant=valid`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toMatch(/Register your passkey/);
    expect(html).toMatch(/navigator\.credentials\.create/);
  });

  it("ABSENT grant → 400, the refusal page, no enrollment work", async () => {
    const identity = new StubIdentity();
    const { base, close } = await bootGateway(new StubGrants(), identity);
    closers.push(close);
    const res = await fetch(`${base}/enroll`);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/invalid or has already been used/i);
    expect(identity.optionsCalls).toBe(0);
    expect(identity.completeCalls).toBe(0);
  });

  it("INVALID/forged grant → 403, refusal page", async () => {
    const grants = new StubGrants();
    grants.invalidReason = "auth.malformed";
    const { base, close } = await bootGateway(grants, new StubIdentity());
    closers.push(close);
    const res = await fetch(`${base}/enroll?grant=forged`);
    expect(res.status).toBe(403);
  });

  it("EXPIRED grant → 403", async () => {
    const grants = new StubGrants();
    grants.invalidReason = "auth.expired";
    const { base, close } = await bootGateway(grants, new StubIdentity());
    closers.push(close);
    const res = await fetch(`${base}/enroll?grant=expired`);
    expect(res.status).toBe(403);
  });

  it("WRONG-RECIPIENT grant → 403", async () => {
    const grants = new StubGrants();
    grants.invalidReason = "auth.recipient_mismatch";
    const { base, close } = await bootGateway(grants, new StubIdentity());
    closers.push(close);
    const res = await fetch(`${base}/enroll?grant=wrongrecipient`);
    expect(res.status).toBe(403);
  });
});

describe("Access Gateway — POST /enroll/options + /enroll/verify grant enforcement", () => {
  it("POST /enroll/options refuses without a valid grant (no options produced)", async () => {
    const identity = new StubIdentity();
    const grants = new StubGrants();
    grants.invalidReason = "auth.expired";
    const { base, close } = await bootGateway(grants, identity);
    closers.push(close);
    const res = await fetch(`${base}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "expired" }),
    });
    expect(res.status).toBe(403);
    expect(identity.optionsCalls).toBe(0);
  });

  it("POST /enroll/options returns registration options on a valid grant", async () => {
    const identity = new StubIdentity();
    const { base, close } = await bootGateway(new StubGrants(), identity);
    closers.push(close);
    const res = await fetch(`${base}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge?: string };
    expect(body.challenge).toBe("opts-challenge");
    expect(identity.optionsCalls).toBe(1);
  });
});

describe("Access Gateway — NO BYPASS of grant verification (GLA-012 AC#2)", () => {
  it("a direct POST /enroll/verify WITHOUT a grant is refused (401), stores nothing", async () => {
    const identity = new StubIdentity();
    const { base, close } = await bootGateway(new StubGrants(), identity);
    closers.push(close);
    const res = await fetch(`${base}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attestation: { fake: "attestation" } }),
    });
    expect(res.status).toBe(401);
    // NO credential stored — enrollComplete was never reached.
    expect(identity.completeCalls).toBe(0);
  });

  it("a POST /enroll/verify with an INVALID grant is refused, stores nothing", async () => {
    const identity = new StubIdentity();
    const grants = new StubGrants();
    grants.invalidReason = "auth.recipient_mismatch";
    const { base, close } = await bootGateway(grants, identity);
    closers.push(close);
    const res = await fetch(`${base}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "wrong", attestation: { fake: "attestation" } }),
    });
    expect(res.status).toBe(403);
    expect(identity.completeCalls).toBe(0);
  });
});

describe("Access Gateway — happy-path verify consumes the single-use grant", () => {
  it("POST /enroll/verify on a valid grant stores the credential and MARKS THE GRANT SPENT", async () => {
    const identity = new StubIdentity();
    const grants = new StubGrants();
    const { base, close } = await bootGateway(grants, identity);
    closers.push(close);
    const res = await fetch(`${base}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", attestation: { fake: "attestation" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enrolled?: boolean; auth_strength?: string };
    expect(body.enrolled).toBe(true);
    expect(body.auth_strength).toBe("webauthn");
    expect(identity.completeCalls).toBe(1);
    // SINGLE-USE: the grant's nonce is now spent → a reuse fails.
    expect(grants.spent).toContain("nonce-1");
    const reuse = await fetch(`${base}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", attestation: { fake: "attestation" } }),
    });
    expect(reuse.status).toBe(403); // reused grant refused (auth.revoked)
  });

  it("a FAILED attestation refuses (403), stores nothing, and does NOT spend the grant (retryable)", async () => {
    const identity = new StubIdentity();
    identity.failComplete = true;
    const grants = new StubGrants();
    const { base, close } = await bootGateway(grants, identity);
    closers.push(close);
    const res = await fetch(`${base}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", attestation: { bad: "attestation" } }),
    });
    expect(res.status).toBe(403);
    // The grant was NOT spent — a retry with the same still-valid grant is possible (rolled back).
    expect(grants.spent).not.toContain("nonce-1");
    // Prove retryable: a second attempt with the same grant succeeds.
    identity.failComplete = false;
    const retry = await fetch(`${base}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", attestation: { fake: "attestation" } }),
    });
    expect(retry.status).toBe(200);
  });
});

describe("Access Gateway — single-use is atomic under concurrency (GLA-013 AC#2; TOCTOU close)", () => {
  it("two CONCURRENT POST /enroll/verify with the SAME grant: exactly ONE succeeds, the other is refused", async () => {
    const identity = new StubIdentity();
    // A delay inside the ceremony so both requests are genuinely in-flight; the consume happens BEFORE this await,
    // so the second request's atomic verify-and-consume must observe the nonce already spent and refuse.
    identity.completeDelayMs = 50;
    const grants = new StubGrants();
    const { base, close } = await bootGateway(grants, identity);
    closers.push(close);

    const post = () =>
      fetch(`${base}/enroll/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant: "valid", attestation: { fake: "attestation" } }),
      });
    const [a, b] = await Promise.all([post(), post()]);
    const statuses = [a.status, b.status].sort();
    // Exactly one 200 (the ceremony ran once), one 403 (the loser saw the grant already consumed → auth.revoked).
    expect(statuses).toEqual([200, 403]);
    expect(identity.completeCalls).toBe(1);
    expect(grants.spent).toEqual(["nonce-1"]);
  });
});
