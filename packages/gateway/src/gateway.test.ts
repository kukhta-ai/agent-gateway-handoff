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
const OUTER_PROXY_HEADERS = {
  "x-outer-proxy-user": "recipient@example.com",
  "x-outer-proxy-groups": "gla-users",
  cookie: "outer_proxy_session=outer-session",
};

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

  private verify(
    token: string,
    spentMode: "reject-spent" | "require-spent" = "reject-spent",
  ): EnrollmentGrantVerifyResult {
    const nonce = this.validTokens.get(token);
    if (nonce === undefined) {
      // A spent nonce mimics the reused-grant refusal (auth.revoked); an unknown token uses invalidReason.
      return { ok: false, reason: this.invalidReason };
    }
    const isSpent = this.spent.includes(nonce);
    if (spentMode === "reject-spent" && isSpent) {
      return { ok: false, reason: "auth.revoked" };
    }
    if (spentMode === "require-spent" && !isSpent) {
      return { ok: false, reason: "auth.revoked" };
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
  /** Verify a signed token whose nonce has already been spent by the delegated options step. */
  verifyConsumedEnrollmentGrantToken(token: OpaqueToken): EnrollmentGrantVerifyResult {
    return this.verify(token, "require-spent");
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
  /** An async delay inside enrollmentOptions (ms), so concurrent delegated begins can overlap. */
  optionsDelayMs = 0;
  redirectOptions = false;
  async enrollmentOptions(_recipient: RecipientRef, _discharge: OpaqueToken): Promise<unknown> {
    this.optionsCalls++;
    if (this.optionsDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.optionsDelayMs));
    }
    if (this.redirectOptions) {
      return { kind: "redirect", authorizeUrl: "https://idp.example/authorize?state=state-1" };
    }
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
    // Return a faithful EnrollmentRecord shape (the real IdentityService always includes authStrength) so the
    // /enroll/verify response echoes the recorded fact, not the fail-closed default.
    return { credentialId: "cred-1", authStrength: "webauthn" };
  }
}

/** Boot a gateway on an ephemeral loopback port with the given stubs; returns the base URL + a closer. */
async function bootGateway(
  grants: StubGrants,
  identity: StubIdentity,
  extra: Partial<GatewayOptions> = {},
): Promise<{ base: string; close: () => Promise<void>; gateway: AccessGateway }> {
  const opts: GatewayOptions = { grants, identity, host: "127.0.0.1", port: 0, ...extra };
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

function headerText(headers: Headers): string {
  const lines: string[] = [];
  headers.forEach((value, key) => lines.push(`${key}: ${value}`));
  return lines.join("\n");
}

function cookiePair(setCookie: string, name: string): string {
  return setCookie.match(new RegExp(`${name}=[^;,]+`))?.[0] ?? "";
}

describe("Access Gateway — GET /enroll grant enforcement (GLA-012 AC#2)", () => {
  it("serves the enrollment page on a VALID grant (HTML + the WebAuthn ceremony)", async () => {
    const { base, close } = await bootGateway(new StubGrants(), new StubIdentity());
    closers.push(close);
    const res = await fetch(`${base}/enroll?grant=valid`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const html = await res.text();
    expect(html).toMatch(/Complete enrollment/);
    expect(html).toMatch(/Start enrollment/);
    expect(html).toMatch(/navigator\.credentials\.create/);
    expect(html).toContain('new URLSearchParams(location.search).has("grant")');
    expect(html).toContain('history.replaceState(null, "", location.pathname)');
  });

  it("keeps the raw enrollment grant out of public HTML and response headers after bootstrap", async () => {
    const canary = "enroll-grant-canary-089";
    const grants = new StubGrants();
    grants.validTokens.set(canary, "nonce-canary-089");
    const identity = new StubIdentity();
    const { base, close } = await bootGateway(grants, identity);
    closers.push(close);

    const page = await fetch(`${base}/enroll?grant=${encodeURIComponent(canary)}`);
    expect(page.status).toBe(200);
    const pageHeaders = headerText(page.headers);
    const html = await page.text();
    expect(pageHeaders).not.toContain(canary);
    expect(html).not.toContain(canary);
    const bootstrapCookie = cookiePair(page.headers.get("set-cookie") ?? "", "gla_enroll_boot");
    expect(bootstrapCookie).toMatch(/^gla_enroll_boot=/);

    const options = await fetch(`${base}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bootstrapCookie },
      body: JSON.stringify({}),
    });
    expect(options.status).toBe(200);
    expect(headerText(options.headers)).not.toContain(canary);
    expect(await options.text()).not.toContain(canary);

    const verify = await fetch(`${base}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bootstrapCookie },
      body: JSON.stringify({ attestation: { fake: true } }),
    });
    expect(verify.status).toBe(200);
    expect(headerText(verify.headers)).not.toContain(canary);
    expect(await verify.text()).not.toContain(canary);
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

  it("serves enrollment under a configured public base path and does not publish an unprefixed alias", async () => {
    const identity = new StubIdentity();
    const { base, close } = await bootGateway(new StubGrants(), identity, {
      publicBaseUrl: "https://gla.example/gla/",
    });
    closers.push(close);

    const prefixed = await fetch(`${base}/gla/enroll?grant=valid`);
    expect(prefixed.status).toBe(200);
    const html = await prefixed.text();
    expect(html).toContain('"options":"/gla/enroll/options"');
    expect(html).toContain('"verify":"/gla/enroll/verify"');

    const unprefixed = await fetch(`${base}/enroll?grant=valid`);
    expect(unprefixed.status).toBe(404);
  });

  it("does not trust spoofed X-Forwarded-Prefix unless strip-prefix mode is explicitly enabled", async () => {
    const identity = new StubIdentity();
    const { base, close } = await bootGateway(new StubGrants(), identity, {
      publicBaseUrl: "https://gla.example/gla/",
    });
    closers.push(close);

    const spoofed = await fetch(`${base}/enroll?grant=valid`, {
      headers: { "x-forwarded-prefix": "/gla" },
    });
    expect(spoofed.status).toBe(404);
  });

  it("accepts strip-prefix proxies only when explicitly trusted and X-Forwarded-Prefix matches", async () => {
    const identity = new StubIdentity();
    const { base, close } = await bootGateway(new StubGrants(), identity, {
      publicBaseUrl: "https://gla.example/gla/",
      trustForwardedPrefix: true,
    });
    closers.push(close);

    const stripped = await fetch(`${base}/enroll?grant=valid`, {
      headers: { "x-forwarded-prefix": "/gla" },
    });
    expect(stripped.status).toBe(200);

    const wrongPrefix = await fetch(`${base}/enroll?grant=valid`, {
      headers: { "x-forwarded-prefix": "/other" },
    });
    expect(wrongPrefix.status).toBe(404);
  });

  it("serves the delegated-auth callback landing page under the configured public base path", async () => {
    const { base, close } = await bootGateway(new StubGrants(), new StubIdentity(), {
      publicBaseUrl: "https://gla.example/gla/",
    });
    closers.push(close);

    const res = await fetch(`${base}/gla/auth/callback?code=c&state=s`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Completing sign-in");
    expect(html).toContain('"enrollVerify":"/gla/enroll/verify"');
    expect(html).toContain('"handoffVerify":"/gla/handoff/auth/verify"');
    expect(html).not.toContain("grant=secret");

    const rootAlias = await fetch(`${base}/auth/callback?code=c&state=s`);
    expect(rootAlias.status).toBe(404);
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

  it("delegated redirect options consume the GLA grant before the browser leaves this origin", async () => {
    const identity = new StubIdentity();
    identity.redirectOptions = true;
    identity.optionsDelayMs = 50;
    const grants = new StubGrants();
    const { base, close } = await bootGateway(grants, identity);
    closers.push(close);

    const res = await fetch(`${base}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind?: string; authorizeUrl?: string };
    expect(body.kind).toBe("redirect");
    expect(body.authorizeUrl).toMatch(/^https:\/\/idp\.example\//);
    expect(grants.spent).toContain("nonce-1");

    const abandonedReuse = await fetch(`${base}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid" }),
    });
    expect(abandonedReuse.status).toBe(403);
    expect(identity.completeCalls).toBe(0);
  });

  it("concurrent delegated options calls return at most one provider redirect URL", async () => {
    const identity = new StubIdentity();
    identity.redirectOptions = true;
    const grants = new StubGrants();
    const { base, close } = await bootGateway(grants, identity);
    closers.push(close);

    const post = () =>
      fetch(`${base}/enroll/options`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant: "valid" }),
      });
    const [a, b] = await Promise.all([post(), post()]);
    const responses = await Promise.all(
      [a, b].map(async (r) => ({ status: r.status, text: await r.text() })),
    );
    const ok = responses.filter((r) => r.status === 200);
    const refused = responses.filter((r) => r.status === 403);
    expect(ok.length).toBe(1);
    expect(refused.length).toBe(1);
    expect(JSON.parse(ok[0]?.text ?? "{}").authorizeUrl).toMatch(/^https:\/\/idp\.example\//);
    expect(refused[0]?.text).not.toContain("idp.example");
    expect(grants.spent).toEqual(["nonce-1"]);
  });

  it("delegated callback can complete only once against the pending consumed grant", async () => {
    const identity = new StubIdentity();
    identity.redirectOptions = true;
    const grants = new StubGrants();
    const { base, close } = await bootGateway(grants, identity);
    closers.push(close);

    const options = await fetch(`${base}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid" }),
    });
    expect(options.status).toBe(200);

    const verify = await fetch(`${base}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", attestation: { code: "code-1", state: "state-1" } }),
    });
    expect(verify.status).toBe(200);
    expect(identity.completeCalls).toBe(1);

    const replay = await fetch(`${base}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", attestation: { code: "code-1", state: "state-1" } }),
    });
    expect(replay.status).toBe(403);
    expect(identity.completeCalls).toBe(1);
  });

  it("failed delegated callback leaves the GLA grant spent and unreusable", async () => {
    const identity = new StubIdentity();
    identity.redirectOptions = true;
    identity.failComplete = true;
    const grants = new StubGrants();
    const { base, close } = await bootGateway(grants, identity);
    closers.push(close);

    const options = await fetch(`${base}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid" }),
    });
    expect(options.status).toBe(200);

    const verify = await fetch(`${base}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", attestation: { code: "bad-code", state: "state-1" } }),
    });
    expect(verify.status).toBe(403);
    expect(grants.spent).toContain("nonce-1");

    identity.failComplete = false;
    const retryOptions = await fetch(`${base}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid" }),
    });
    expect(retryOptions.status).toBe(403);
  });

  it("POST /enroll/options and /enroll/verify work through a configured public base path", async () => {
    const identity = new StubIdentity();
    const grants = new StubGrants();
    const { base, close } = await bootGateway(grants, identity, {
      publicBaseUrl: "https://gla.example/gla/",
    });
    closers.push(close);

    const options = await fetch(`${base}/gla/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid" }),
    });
    expect(options.status).toBe(200);

    const verify = await fetch(`${base}/gla/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", attestation: { fake: "attestation" } }),
    });
    expect(verify.status).toBe(200);
    expect(identity.optionsCalls).toBe(1);
    expect(identity.completeCalls).toBe(1);
    expect(grants.spent).toContain("nonce-1");
  });
});

describe("Access Gateway — NO BYPASS of grant verification (GLA-012 AC#2)", () => {
  it("outer proxy headers/cookies do not replace the GLA enrollment grant", async () => {
    const identity = new StubIdentity();
    const { base, close } = await bootGateway(new StubGrants(), identity);
    closers.push(close);

    const page = await fetch(`${base}/enroll`, {
      headers: OUTER_PROXY_HEADERS,
    });
    expect(page.status).toBe(400);

    const verify = await fetch(`${base}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", ...OUTER_PROXY_HEADERS },
      body: JSON.stringify({ attestation: { fake: "attestation" } }),
    });
    expect(verify.status).toBe(401);
    expect(identity.optionsCalls).toBe(0);
    expect(identity.completeCalls).toBe(0);
  });

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
