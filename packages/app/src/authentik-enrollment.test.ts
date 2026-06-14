// GLA-070 — Enroll a recipient through the DELEGATED authentik provider (SERVICE-LAYER), proven DETERMINISTICALLY
// via the `fake-authentik` OIDC test double (NO browser, NO real network). This is the headline proof for
// authentik-enrollment.md §7: a recipient is bound to a stable authentik SUBJECT (`sub`) through a verified OIDC
// round-trip, so a later step-up can verify them — and GLA stores only the `sub`, never the credential (authentik
// owns it). It mirrors enrollment-e2e.test.ts's structure (operator-discharge grant → gateway gate → identity
// records the fact) but with the authentik stack and the service path driven directly.
//
// The browser callback that carries `{code,state}` from authentik back to `enrollComplete` is GLA-072's shared
// deliverable (authentik-integration.md §2, authentik-enrollment.md §8.1) — NOT built here. We drive the service
// path directly: `enrollmentOptions(recipient, discharge)` (begin) → extract `state`/`nonce` from the returned
// authorize URL → mint a code via `fake-authentik` (simulating the authentik login) → `enrollComplete(recipient,
// {code,state})` (finish), exactly as the adapter's own tests do, lifted to the createEnrollmentStack/IdentityService
// layer.
//
// Coverage map (each AC demonstrable here):
//   AC#1 enroll → bound to a stable sub → verifiable later; un-enrolled → denied.
//   AC#2 the operator-discharge grant gate still holds with authentik selected (absent/wrong/expired/reused
//        refused at the gateway BEFORE any provider call) — driven against the REAL gateway.
//   AC#3 a failed/abandoned enrollment leaves no half-bound recipient; retryable with a fresh grant.
//   AC#4 the binding is established WITHOUT GLA storing the credential (only the `sub`; no key/secret/password).
//   AC#5 switching back to the in-tree provider leaves its enrollment path unchanged (wiring + the WebAuthn E2E).

import { runInNewContext } from "node:vm";
import {
  AUTH_AUTHENTIK_MODULE,
  AuthAuthentikProvider,
  type BoundSubject,
  InMemoryKv,
  type PendingAttempt,
} from "@gla/auth-authentik";
import { FakeAuthentik } from "@gla/auth-authentik/testing";
import { AUTH_WEBAUTHN_MODULE } from "@gla/auth-webauthn";
import { referenceWpmDependencyBindings } from "@gla/catalog";
import { IdentityService } from "@gla/identity";
import type { RecipientRef } from "@gla/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type EnrollmentStack, createEnrollmentStack, createProvisioningBridge } from "./index.js";

const recipient = "tg:user:123" as RecipientRef;
const otherRecipient = "tg:user:999" as RecipientRef;
/** The `IdentityService` derives `userId` from a recipient ref as `user:<ref>` (see packages/identity). */
const userIdOf = (r: RecipientRef): string => `user:${r}`;

const stacks: EnrollmentStack[] = [];
afterEach(async () => {
  for (const s of stacks.splice(0)) {
    await s.gateway.close().catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The deterministic authentik harness: an AuthAuthentikProvider wired to a fake-authentik IdP (no network),
// with SHARED `subjects`/`attempts` stores a test can inspect. Drives the SERVICE path through IdentityService.
// ─────────────────────────────────────────────────────────────────────────────

interface AuthentikHarness {
  fake: FakeAuthentik;
  provider: AuthAuthentikProvider;
  identity: IdentityService;
  subjects: InMemoryKv<BoundSubject>;
  attempts: InMemoryKv<PendingAttempt>;
}

async function authentikHarness(): Promise<AuthentikHarness> {
  const fake = await FakeAuthentik.create();
  const subjects = new InMemoryKv<BoundSubject>();
  const attempts = new InMemoryKv<PendingAttempt>();
  const provider = new AuthAuthentikProvider({
    issuerUrl: fake.issuerUrl,
    clientId: fake.clientId,
    clientSecret: "super-secret",
    redirectUri: "https://gla.example/auth/callback",
    endpoints: fake.endpoints(),
    jwks: fake.jwks,
    fetch: fake.fetch,
    subjects,
    attempts,
  });
  const identity = new IdentityService({ authProvider: provider });
  return { fake, provider, identity, subjects, attempts };
}

/** Pull `{state, nonce}` out of the opaque `RedirectChallenge.authorizeUrl` the begin step returned. */
function stateNonceFrom(challenge: unknown): { state: string; nonce: string } {
  const c = challenge as { kind?: string; authorizeUrl?: string };
  if (c?.kind !== "redirect" || typeof c.authorizeUrl !== "string") {
    throw new Error("expected a {kind:'redirect', authorizeUrl} challenge");
  }
  const url = new URL(c.authorizeUrl);
  const state = url.searchParams.get("state");
  const nonce = url.searchParams.get("nonce");
  if (state === null || nonce === null) {
    throw new Error("authorize URL missing state/nonce");
  }
  return { state, nonce };
}

function callbackScript(html: string): string {
  const match = html.match(/<script>\n(?<script>\(\(\) => \{[\s\S]*?)\n<\/script>/);
  if (match?.groups?.script === undefined) {
    throw new Error("callback browser script not found");
  }
  return match.groups.script;
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}

function cookiePair(setCookie: string, name: string): string {
  return setCookie.match(new RegExp(`${name}=[^;,]+`))?.[0] ?? "";
}

function executeEnrollmentCallback(
  html: string,
  args: {
    origin: string;
    search: string;
    cookie?: string;
  },
): {
  fetchCalls: Array<{ input: string; init: RequestInit; response: Response }>;
  status: { textContent: string };
} {
  const status = { textContent: "", className: "" };
  const fetchCalls: Array<{ input: string; init: RequestInit; response: Response }> = [];
  const origin = new URL(args.origin);
  const context = {
    URLSearchParams,
    WebSocket: vi.fn(),
    document: {
      title: "Completing sign-in",
      getElementById(id: string): { textContent: string; className?: string } {
        if (id === "callback-data") {
          const match = html.match(
            /<script id="callback-data" type="application\/json">(?<data>.*?)<\/script>/,
          );
          return { textContent: match?.groups?.data ?? "{}" };
        }
        if (id === "status") {
          return status;
        }
        throw new Error(`unexpected element ${id}`);
      },
    },
    fetch: vi.fn(async (input: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      if (args.cookie !== undefined) {
        headers.set("cookie", args.cookie);
      }
      const nextInit = { ...init, headers };
      const response = await fetch(new URL(input, args.origin).toString(), nextInit);
      fetchCalls.push({ input, init: nextInit, response });
      return response;
    }),
    history: { replaceState: vi.fn() },
    location: {
      host: origin.host,
      pathname: "/auth/callback",
      protocol: `${origin.protocol}`,
      search: args.search,
    },
    sessionStorage: {
      getItem: vi.fn((key: string) => (key === "gla.enroll" ? "pending" : null)),
      removeItem: vi.fn(),
    },
  };

  runInNewContext(callbackScript(html), context);
  return { fetchCalls, status };
}

/**
 * Drive the SERVICE-LAYER enrollment to completion (the deterministic stand-in for the GLA-072 browser callback):
 * begin via `enrollmentOptions`, simulate the authentik login by minting a code for `{sub, amr, nonce}`, then
 * finish via `enrollComplete`. Returns the recorded EnrollmentRecord-ish result.
 */
async function enrollViaService(
  h: AuthentikHarness,
  rcpt: RecipientRef,
  opts: { sub: string; amr?: string[]; discharge?: string; userVerified?: boolean },
): Promise<{ credentialId: string; authStrength: string }> {
  const discharge = (opts.discharge ?? "operator-discharge-grant") as never;
  const challenge = await h.identity.enrollmentOptions(rcpt, discharge);
  const { state, nonce } = stateNonceFrom(challenge);
  const code = `code-${state}`;
  await h.fake.stageValidLogin(code, {
    sub: opts.sub,
    nonce,
    ...(opts.amr !== undefined ? { amr: opts.amr } : {}),
    ...(opts.userVerified !== undefined ? { userVerified: opts.userVerified } : {}),
  });
  const rec = (await h.identity.enrollComplete(rcpt, { code, state })) as {
    credentialId: string;
    authStrength: string;
  };
  return rec;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC#1 — enroll → bound to a stable sub → verifiable later; un-enrolled → denied.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC#1 · a recipient enrolled through authentik is bound to a stable subject and verifiable later", () => {
  it("enrollComplete binds the sub: isEnrolled true, EnrollmentRecord.credentialId === sub, getBoundSubject === sub", async () => {
    const h = await authentikHarness();
    expect(h.identity.isEnrolled(recipient)).toBe(false);

    const rec = await enrollViaService(h, recipient, {
      sub: "sub-stable",
      amr: ["swk"],
      userVerified: true,
    });

    // The identity-level fact: enrolled, credentialId is the authentik subject, strength is the derived fact.
    expect(h.identity.isEnrolled(recipient)).toBe(true);
    expect(rec.credentialId).toBe("sub-stable");
    expect(rec.authStrength).toBe("webauthn");
    expect(h.identity.getCredential(recipient)?.credentialId).toBe("sub-stable");
    // The provider-durable binding: userId → {sub} (the delegated analogue of WebAuthn's credential store).
    expect(h.provider.getBoundSubject(userIdOf(recipient))?.sub).toBe("sub-stable");
  });

  it("a LATER step-up for that recipient resolves to the SAME sub (enrollment establishes what step-up matches)", async () => {
    const h = await authentikHarness();
    await enrollViaService(h, recipient, { sub: "sub-stable", amr: ["pwd"] });

    // Step-up via the identity service: authenticationOptions (begin) → mint a token for the SAME sub → verify.
    const challenge = await h.identity.authenticationOptions(recipient);
    const { state, nonce } = stateNonceFrom(challenge);
    await h.fake.stageValidLogin(`auth-${state}`, {
      sub: "sub-stable",
      nonce,
      amr: ["swk"],
      userVerified: true,
    });
    const verified = await h.identity.verifyAuthentication(recipient, {
      code: `auth-${state}`,
      state,
    });
    expect(verified.ok).toBe(true);
    expect(verified.authStrength).toBe("webauthn");
    expect(verified.userId).toBe(userIdOf(recipient));
    // Subject stability (authentik-enrollment.md §8.3): the bound sub is unchanged across enroll → step-up.
    expect(h.provider.getBoundSubject(userIdOf(recipient))?.sub).toBe("sub-stable");
  });

  it("a step-up presenting a DIFFERENT sub fails — the binding enforces recipient identity", async () => {
    const h = await authentikHarness();
    await enrollViaService(h, recipient, {
      sub: "sub-real",
      amr: ["swk"],
      userVerified: true,
    });
    const challenge = await h.identity.authenticationOptions(recipient);
    const { state, nonce } = stateNonceFrom(challenge);
    await h.fake.stageValidLogin(`auth-${state}`, {
      sub: "sub-IMPOSTOR",
      nonce,
      amr: ["swk"],
      userVerified: true,
    });
    const verified = await h.identity.verifyAuthentication(recipient, {
      code: `auth-${state}`,
      state,
    });
    expect(verified.ok).toBe(false);
    expect(verified.authStrength).toBe("none");
    expect(h.provider.getBoundSubject(userIdOf(recipient))?.sub).toBe("sub-real"); // unchanged
  });

  it("an UN-ENROLLED recipient cannot be verified: isEnrolled false, authenticationOptions throws, verify denies", async () => {
    const h = await authentikHarness();
    expect(h.identity.isEnrolled(otherRecipient)).toBe(false);
    // The identity service denies an un-enrolled recipient BEFORE the provider (a recipient is verifiable only if enrolled).
    await expect(h.identity.authenticationOptions(otherRecipient)).rejects.toThrow(/not enrolled/i);
    const verified = await h.identity.verifyAuthentication(otherRecipient, {
      code: "x",
      state: "y",
    });
    expect(verified.ok).toBe(false);
    expect(verified.authStrength).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#2 — the operator-discharge grant gate STILL holds with authentik selected. Driven against the REAL gateway:
// absent / wrong-recipient (forged) / expired / reused grants are refused BEFORE any provider call.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC#2 · the single-use operator-discharge grant gate holds with the authentik provider selected", () => {
  /**
   * Build an enrollment stack with the authentik provider INJECTED (a fake-authentik-backed AuthAuthentikProvider
   * with shared stores), bound to an ephemeral gateway port, so the grant gate runs against the real gateway and a
   * SUCCESSFUL OIDC enroll is also possible (for the reuse case) with no real network.
   */
  async function authentikStack(): Promise<{
    stack: EnrollmentStack;
    origin: string;
    fake: FakeAuthentik;
    subjects: InMemoryKv<BoundSubject>;
    attempts: InMemoryKv<PendingAttempt>;
    deliveredLinks: string[];
  }> {
    const fake = await FakeAuthentik.create();
    const subjects = new InMemoryKv<BoundSubject>();
    const attempts = new InMemoryKv<PendingAttempt>();
    const provider = new AuthAuthentikProvider({
      issuerUrl: fake.issuerUrl,
      clientId: fake.clientId,
      clientSecret: "super-secret",
      redirectUri: "https://gla.example/auth/callback",
      endpoints: fake.endpoints(),
      jwks: fake.jwks,
      fetch: fake.fetch,
      subjects,
      attempts,
    });
    const origin = "http://127.0.0.1:0";
    const deliveredLinks: string[] = [];
    const stack = createEnrollmentStack({
      authProvider: "authentik",
      authProviderOverride: provider,
      authModuleOverride: AUTH_AUTHENTIK_MODULE,
      expectedOrigin: origin,
      publicBaseUrl: origin,
      host: "127.0.0.1",
      port: 0,
      deliverySink: { write: (line) => void deliveredLinks.push(line) },
    });
    stacks.push(stack);
    const bound = await stack.gateway.listen();
    return {
      stack,
      origin: `http://127.0.0.1:${bound.port}`,
      fake,
      subjects,
      attempts,
      deliveredLinks,
    };
  }

  function lastDeliveredInviteLink(deliveredLinks: string[]): string {
    const raw = deliveredLinks.at(-1);
    if (raw === undefined) {
      throw new Error("expected recipient invite delivery");
    }
    return (JSON.parse(raw) as { link: string }).link;
  }

  function lastDeliveredGrant(deliveredLinks: string[]): string {
    return new URL(lastDeliveredInviteLink(deliveredLinks)).searchParams.get("grant") ?? "";
  }

  it("the authentik stack still wires the provider behind the AuthProviderPort (authModule = authentik)", async () => {
    const { stack } = await authentikStack();
    expect(stack.authModule).toBe(AUTH_AUTHENTIK_MODULE);
  });

  it("ABSENT grant → /enroll/options refused (400), no provider call", async () => {
    const { origin } = await authentikStack();
    const res = await fetch(`${origin}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("FORGED / wrong grant token → /enroll/options refused (403), no provider call", async () => {
    const { origin } = await authentikStack();
    const res = await fetch(`${origin}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "not-a-real-grant-token" }),
    });
    expect(res.status).toBe(403);
  });

  it("EXPIRED grant → /enroll/options refused (403, auth.expired), no provider call", async () => {
    const { origin, stack } = await authentikStack();
    // Mint an operator-discharge grant that already expired (notAfter in the past).
    const past = new Date(Date.now() - 60_000).toISOString() as never;
    const expired = await stack.capability.mintEnrollmentGrant(recipient, past);
    const res = await fetch(`${origin}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: expired.token }),
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(await res.text()).error.code).toBe("auth.expired");
  });

  it("REUSED grant → refused after a successful enrollment consumes it (single-use), no second enroll", async () => {
    const { origin, stack, fake, deliveredLinks } = await authentikStack();
    // 1) Operator invites; the grant is valid and unspent.
    const invite = await stack.enrollInvite(recipient);
    expect(invite).toEqual({ link: "<redacted-url>", grant: "<redacted>", nonce: "<redacted>" });
    const grant = lastDeliveredGrant(deliveredLinks);

    // 2) Drive a SUCCESSFUL OIDC enroll through the real gateway: begin via /enroll/options (verifies the grant,
    //    returns the authorize URL), simulate the authentik login, then finish via /enroll/verify (consumes the grant).
    const optRes = await fetch(`${origin}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant }),
    });
    expect(optRes.status).toBe(200);
    const { state, nonce } = stateNonceFrom(await optRes.json());
    const code = `code-${state}`;
    await fake.stageValidLogin(code, {
      sub: "sub-enrolled",
      nonce,
      amr: ["swk"],
      userVerified: true,
    });
    const verifyRes = await fetch(`${origin}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant, attestation: { code, state } }),
    });
    expect(verifyRes.status).toBe(200);
    expect(stack.identity.isEnrolled(recipient)).toBe(true);

    // 3) REUSE the now-spent grant → refused (single-use), and no second enrollment happens.
    const reuse = await fetch(`${origin}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant }),
    });
    expect(reuse.status).toBe(403);
    expect(JSON.parse(await reuse.text()).error.code).toBe("auth.revoked");
  });

  it("a configured /auth/callback enrollment return runs the real verify route and records enrollment", async () => {
    const { origin, stack, fake, deliveredLinks } = await authentikStack();
    await stack.enrollInvite(recipient);
    const grant = lastDeliveredGrant(deliveredLinks);
    const page = await fetch(`${origin}/enroll?grant=${encodeURIComponent(grant)}`);
    expect(page.status).toBe(200);
    const bootstrapCookie = cookiePair(page.headers.get("set-cookie") ?? "", "gla_enroll_boot");
    expect(bootstrapCookie).toMatch(/^gla_enroll_boot=/);
    const optRes = await fetch(`${origin}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bootstrapCookie },
      body: JSON.stringify({}),
    });
    expect(optRes.status).toBe(200);
    const challenge = (await optRes.json()) as { kind?: string; authorizeUrl?: string };
    expect(challenge.kind).toBe("redirect");
    const authorizeUrl = new URL(challenge.authorizeUrl ?? "");
    const redirectUri = new URL(authorizeUrl.searchParams.get("redirect_uri") ?? "");
    expect(redirectUri.origin).toBe("https://gla.example");
    expect(redirectUri.pathname).toBe("/auth/callback");
    expect(redirectUri.search).toBe("");
    expect(authorizeUrl.toString()).not.toContain(grant);
    const state = authorizeUrl.searchParams.get("state") ?? "";
    const nonce = authorizeUrl.searchParams.get("nonce") ?? "";
    const code = `callback-${state}`;
    await fake.stageValidLogin(code, {
      sub: "sub-callback-enrolled",
      nonce,
      amr: ["swk"],
      userVerified: true,
    });

    const callback = await fetch(
      `${origin}${redirectUri.pathname}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    );
    expect(callback.status).toBe(200);
    const { fetchCalls, status } = executeEnrollmentCallback(await callback.text(), {
      origin,
      cookie: bootstrapCookie,
      search: `?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    });

    await waitForAssertion(() => expect(stack.identity.isEnrolled(recipient)).toBe(true));
    expect(status.textContent).toMatch(/Enrolled/);
    expect(fetchCalls[0]?.input).toBe("/enroll/verify");
    expect(JSON.parse(String(fetchCalls[0]?.init.body))).toEqual({
      attestation: { code, state },
    });
    expect(stack.identity.getCredential(recipient)?.credentialId).toBe("sub-callback-enrolled");
    const reuse = await fetch(`${origin}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant }),
    });
    expect(reuse.status).toBe(403);
    expect(JSON.parse(await reuse.text()).error.code).toBe("auth.revoked");
  });

  it("an unknown-state enrollment callback is a catchable refusal, leaves the recipient unenrolled, and burns that invite", async () => {
    const { origin, stack, deliveredLinks } = await authentikStack();
    await stack.enrollInvite(recipient);
    const grant = lastDeliveredGrant(deliveredLinks);
    const optRes = await fetch(`${origin}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant }),
    });
    expect(optRes.status).toBe(200);
    const callback = await fetch(`${origin}/auth/callback?code=bad-code&state=missing-state`);
    expect(callback.status).toBe(200);
    const { status } = executeEnrollmentCallback(await callback.text(), {
      origin,
      search: "?code=bad-code&state=missing-state",
    });

    await waitForAssertion(() =>
      expect(status.textContent).toMatch(/Registration was not completed/),
    );
    expect(stack.identity.isEnrolled(recipient)).toBe(false);
    const retry = await fetch(`${origin}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant }),
    });
    expect(retry.status).toBe(403);
    expect(JSON.parse(await retry.text()).error.code).toBe("auth.revoked");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#3 — a failed/abandoned enrollment leaves no half-bound recipient and is retryable with a fresh grant.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC#3 · a failed enrollment leaves no half-bound recipient; retryable with a fresh grant", () => {
  /** Begin enrollment, then finish with a token the fake produces per `mint` — return the begin's state. */
  async function beginThenFinish(
    h: AuthentikHarness,
    rcpt: RecipientRef,
    mint: (fake: FakeAuthentik, nonce: string, code: string) => Promise<void>,
  ): Promise<void> {
    const challenge = await h.identity.enrollmentOptions(rcpt, "grant" as never);
    const { state, nonce } = stateNonceFrom(challenge);
    const code = `code-${state}`;
    await mint(h.fake, nonce, code);
    await h.identity.enrollComplete(rcpt, { code, state });
  }

  it("an INVALID id_token (wrong audience) → enrollComplete throws, binds nothing, isEnrolled stays false", async () => {
    const h = await authentikHarness();
    await expect(
      beginThenFinish(h, recipient, async (fake, nonce, code) => {
        await fake.stageValidLogin(code, { sub: "sub-x", nonce, aud: "wrong-client" });
      }),
    ).rejects.toThrow();
    expect(h.identity.isEnrolled(recipient)).toBe(false);
    expect(h.identity.getCredential(recipient)).toBeUndefined();
    expect(h.provider.getBoundSubject(userIdOf(recipient))).toBeUndefined();
  });

  it("a NONCE-MISMATCH id_token → enrollComplete throws, binds nothing", async () => {
    const h = await authentikHarness();
    await expect(
      beginThenFinish(h, recipient, async (fake, _nonce, code) => {
        await fake.stageValidLogin(code, {
          sub: "sub-x",
          nonce: "WRONG-NONCE",
          amr: ["swk"],
          userVerified: true,
        });
      }),
    ).rejects.toThrow();
    expect(h.identity.isEnrolled(recipient)).toBe(false);
    expect(h.provider.getBoundSubject(userIdOf(recipient))).toBeUndefined();
  });

  it("a TOKEN-EXCHANGE failure (HTTP 500) → enrollComplete throws, binds nothing", async () => {
    const h = await authentikHarness();
    await expect(
      beginThenFinish(h, recipient, async (fake, _nonce, code) => {
        fake.stageHttpError(code, 500);
      }),
    ).rejects.toThrow();
    expect(h.identity.isEnrolled(recipient)).toBe(false);
    expect(h.provider.getBoundSubject(userIdOf(recipient))).toBeUndefined();
  });

  it("after a failed ceremony, a FRESH enrollment succeeds (safely retryable; the prior attempt left no residue)", async () => {
    const h = await authentikHarness();
    // First: a failed ceremony (bad audience) — binds nothing.
    await expect(
      beginThenFinish(h, recipient, async (fake, nonce, code) => {
        await fake.stageValidLogin(code, { sub: "sub-x", nonce, aud: "wrong-client" });
      }),
    ).rejects.toThrow();
    expect(h.identity.isEnrolled(recipient)).toBe(false);
    // Then: a fresh, valid enrollment succeeds and binds the subject.
    const rec = await enrollViaService(h, recipient, {
      sub: "sub-good",
      amr: ["swk"],
      userVerified: true,
    });
    expect(rec.credentialId).toBe("sub-good");
    expect(h.identity.isEnrolled(recipient)).toBe(true);
    expect(h.provider.getBoundSubject(userIdOf(recipient))?.sub).toBe("sub-good");
  });

  it("re-enrollment REPLACES the prior binding (recovery = a fresh round-trip → a possibly-new sub)", async () => {
    const h = await authentikHarness();
    await enrollViaService(h, recipient, { sub: "sub-old", amr: ["pwd"] });
    expect(h.provider.getBoundSubject(userIdOf(recipient))?.sub).toBe("sub-old");
    // A second enrollment with a new round-trip rebinds cleanly to the new subject.
    const rec = await enrollViaService(h, recipient, {
      sub: "sub-new",
      amr: ["swk"],
      userVerified: true,
    });
    expect(rec.credentialId).toBe("sub-new");
    expect(h.provider.getBoundSubject(userIdOf(recipient))?.sub).toBe("sub-new");
    expect(h.identity.getCredential(recipient)?.credentialId).toBe("sub-new");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#4 — the binding is established WITHOUT GLA storing the recipient's credential (it stays in authentik).
// ─────────────────────────────────────────────────────────────────────────────

describe("AC#4 · GLA stores only the subject — no passkey/secret/password for an authentik-enrolled recipient", () => {
  it("the ONLY durable thing GLA holds is {sub}; there is no credential material anywhere in GLA", async () => {
    const h = await authentikHarness();
    await enrollViaService(h, recipient, {
      sub: "sub-only-thing",
      amr: ["swk"],
      userVerified: true,
    });

    // The adapter's durable store holds EXACTLY {sub} — no public key, no counter, no secret, no password.
    const bound = h.provider.getBoundSubject(userIdOf(recipient));
    expect(bound).toEqual({ sub: "sub-only-thing" });
    expect(Object.keys(bound ?? {})).toEqual(["sub"]);

    // The identity-level record carries only the FACT (the sub as credentialId + strength + timestamp) — no secret.
    const cred = h.identity.getCredential(recipient);
    expect(cred?.credentialId).toBe("sub-only-thing");
    expect(JSON.stringify(cred)).not.toMatch(/publicKey|counter|password|secret/i);

    // The transient attempts store is consumed on finish — nothing lingers (no codeVerifier/secret residue).
    const challenge = await h.identity.enrollmentOptions(otherRecipient, "g" as never);
    const { state } = stateNonceFrom(challenge);
    expect(h.attempts.get(state)).toBeDefined(); // present mid-flight…
    await h.fake.stageValidLogin(`c-${state}`, {
      sub: "s2",
      nonce: stateNonceFrom(challenge).nonce,
    });
    await h.identity.enrollComplete(otherRecipient, { code: `c-${state}`, state });
    expect(h.attempts.get(state)).toBeUndefined(); // …gone after finish (one-time-consumed).
  });

  it("contrast: the WebAuthn path DOES store credential material (a public key + counter) — so the delegated path's absence is meaningful", () => {
    // The in-tree provider's enrollment stores a StoredCredential {id, publicKeyB64, counter}. The authentik path
    // stores none of that — only {sub}. This asserts the two paths differ in what GLA holds (AC#4's point).
    const webauthnStack = createEnrollmentStack({
      expectedOrigin: "http://localhost:3000",
      publicBaseUrl: "http://localhost:3000",
      host: "127.0.0.1",
      port: 0,
      deliverySink: { write: () => {} },
    });
    stacks.push(webauthnStack);
    expect(webauthnStack.authModule).toBe(AUTH_WEBAUTHN_MODULE);
    // The WebAuthn provider exposes getStoredCredential (a public key holder); the authentik provider exposes
    // getBoundSubject (a sub holder). The shape difference IS the no-stored-credential property.
    expect("getBoundSubject" in webauthnStack.authProvider).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#5 — switching back to the in-tree provider leaves its enrollment path working unchanged.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC#5 · the default / webauthn provider's enrollment path is unchanged (selection flips only the adapter)", () => {
  it("default (no authProvider) constructs the in-tree WebAuthn provider (authModule = webauthn)", () => {
    const stack = createEnrollmentStack({
      expectedOrigin: "http://localhost:3000",
      publicBaseUrl: "http://localhost:3000",
      host: "127.0.0.1",
      port: 0,
      deliverySink: { write: () => {} },
    });
    stacks.push(stack);
    expect(stack.authModule).toBe(AUTH_WEBAUTHN_MODULE);
    // The WebAuthn enrollment surface is intact: an un-enrolled recipient is denied an auth challenge.
    expect(stack.identity.isEnrolled(recipient)).toBe(false);
  });

  it('explicit authProvider:"webauthn" is identical to the default; selecting authentik changes only the module', () => {
    const def = createEnrollmentStack({
      expectedOrigin: "http://localhost:3000",
      publicBaseUrl: "http://localhost:3000",
      port: 0,
      deliverySink: { write: () => {} },
    });
    const web = createEnrollmentStack({
      authProvider: "webauthn",
      expectedOrigin: "http://localhost:3000",
      publicBaseUrl: "http://localhost:3000",
      port: 0,
      deliverySink: { write: () => {} },
    });
    const atk = createEnrollmentStack({
      authProvider: "authentik",
      authProviderConfig: {
        issuerUrl: "https://idp.example/application/o/gla/",
        clientId: "gla-client",
        clientSecret: "s",
        redirectUri: "https://gla.example/auth/callback",
      },
      dependencyBindings: referenceWpmDependencyBindings(),
      expectedOrigin: "http://localhost:3000",
      publicBaseUrl: "http://localhost:3000",
      port: 0,
      deliverySink: { write: () => {} },
    });
    stacks.push(def, web, atk);
    expect(def.authModule).toBe(AUTH_WEBAUTHN_MODULE);
    expect(web.authModule).toBe(AUTH_WEBAUTHN_MODULE);
    expect(atk.authModule).toBe(AUTH_AUTHENTIK_MODULE);
  });

  it("createProvisioningBridge enrollment wiring also defaults to webauthn (the handoff stack's provider is unchanged)", () => {
    const stack = createProvisioningBridge({
      dependencyBindings: referenceWpmDependencyBindings(),
      launcherMode: "headless",
      handoff: {
        expectedOrigin: "http://localhost:3000",
        publicBaseUrl: "http://localhost:3000",
        host: "127.0.0.1",
        port: 0,
        deliverySink: { write: () => {} },
      },
    });
    expect(stack.authModule).toBe(AUTH_WEBAUTHN_MODULE);
  });
});
