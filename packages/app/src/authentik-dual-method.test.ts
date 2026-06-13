// GLA-072 — Dual-method step-up via the DELEGATED authentik provider, proven DETERMINISTICALLY in-process with
// `FakeAuthentik` (no real browser, no network). The recipient completes a step-up with a PASSKEY (strongest) OR,
// lacking one, a PASSWORD (password strength), both hosted by authentik; the gateway gates by the route's
// auth assurance profile. GLA = redirect → read (amr→strength) → gate (authentik-dual-method-flow.md §2-§4).
//
// This test lives in `packages/app` because it wires the concrete `AuthAuthentikProvider` (only the composition
// root may import an adapter — the boundary lint forbids it in `packages/gateway`). It mirrors the harness of
// `packages/gateway/src/handoff.test.ts` but injects the REAL IdentityService+AuthAuthentikProvider as `stepUp`, so
// the strength is genuinely DERIVED from the minted `amr` (not a stub) — and drives the UNCHANGED /handoff/auth/verify
// route in-process. The browser redirect/return path (the served page's `location.assign`/return-detection) is
// exercised by the GLA-076 E2E; here we POST {code,state} straight to verify, the way that page's return arm would.
//
// Coverage map: AC#1 passkey→webauthn authorized · AC#2 password→password authorized (route permits it) ·
// AC#3 too-weak rejected where the stronger method is required (403 auth.insufficient, grant NOT authorized, WS
// upgrade refused) · AC#4 a failed assertion → typed-reason refusal, nothing authorized · AC#5 the method is in the
// fact (auth_strength distinguishes the two). Plus: the provider-agnostic gateway proof (no provider string in
// packages/gateway/src) and the /enroll/verify strength-echo.

import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { type AddressInfo, type Socket, connect as netConnect } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import {
  AuthAuthentikProvider,
  type BoundSubject,
  InMemoryKv,
  type PendingAttempt,
} from "@gla/auth-authentik";
import { FakeAuthentik } from "@gla/auth-authentik/testing";
import {
  AccessGateway,
  type EnrollmentGrantPort,
  type EnrollmentGrantVerifyResult,
  type GatewayOptions,
  type RouteMountRequest,
  type SessionGrantPort,
  type SessionGrantVerifyResult,
} from "@gla/gateway";
import { IdentityService } from "@gla/identity";
import {
  type AuthAssuranceProfile,
  type CapabilityId,
  type ErrorCode,
  type OpaqueToken,
  type RecipientRef,
  type RouteId,
  type SessionId,
  authAssurancePolicyFromProfile,
} from "@gla/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";

const recipient = "tg:user:123" as RecipientRef;
const GRANT_ID = "cap_grant1" as CapabilityId;
const SESS = "sess_abc1" as SessionId;
const ROUTE_PATH = `/handoff/${SESS}`;

/** A stub handoff-grant seam: `valid` verifies (reporting `recipient` + the grant id); else fails with `invalidReason`. */
class StubSessionGrants implements SessionGrantPort {
  validToken = "valid";
  grantId: CapabilityId = GRANT_ID;
  boundRecipient: RecipientRef = recipient;
  invalidReason: ErrorCode = "auth.malformed";
  verifySessionGrantToken(
    token: OpaqueToken,
    _args: { scopePath: string; now?: string },
  ): SessionGrantVerifyResult {
    if (token !== this.validToken) {
      return { ok: false, reason: this.invalidReason };
    }
    return {
      ok: true,
      capability: { id: this.grantId, cls: "session", caveats: [] },
      recipient: this.boundRecipient,
    };
  }
}

/** A stub WS upstream (the capsule's noVNC endpoint): completes the 101 handshake and announces a hello marker. */
function startStubUpstream(): Promise<{ endpoint: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
      socket.write("UPSTREAM_NOVNC_HELLO");
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        endpoint: `ws://127.0.0.1:${port}/`,
        close: () =>
          new Promise<void>((r) => {
            (server as { closeAllConnections?: () => void }).closeAllConnections?.();
            const t = setTimeout(r, 200);
            t.unref?.();
            server.close(() => r());
          }),
      });
    });
  });
}

/** Open a raw WS-upgrade to the gateway; resolve the first bytes (a 101+hello if proxied, else an HTTP refusal). */
function openUpgrade(
  host: string,
  port: number,
  path: string,
  grant: string,
  headers: Readonly<Record<string, string>> = {},
  opts: { grantPlacement?: "query" | "none" } = {},
): Promise<{ firstChunk: string; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host, port }, () => {
      const target =
        (opts.grantPlacement ?? "query") === "query"
          ? `${path}?grant=${encodeURIComponent(grant)}`
          : path;
      const extraHeaders = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join("");
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: ${host}:${port}\r\n${extraHeaders}Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let firstChunk = "";
    let resolved = false;
    socket.on("data", (chunk) => {
      firstChunk += (chunk as Buffer).toString("utf8");
      if (!resolved) {
        resolved = true;
        resolve({ firstChunk, socket });
      }
    });
    socket.on("close", () => {
      if (!resolved) {
        resolved = true;
        resolve({ firstChunk, socket });
      }
    });
    socket.on("error", (e) => {
      if (!resolved) reject(e);
    });
  });
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

function executeHandoffCallback(
  html: string,
  args: {
    base: string;
    search: string;
    streamPath: string;
    cookie?: string;
  },
): {
  fetchCalls: Array<{ input: string; init: RequestInit; response: Response }>;
  status: { textContent: string };
} {
  const status = { textContent: "", className: "" };
  const fetchCalls: Array<{ input: string; init: RequestInit; response: Response }> = [];
  const handoffState = {
    path: ROUTE_PATH,
    streamPath: args.streamPath,
  };
  const base = new URL(args.base);
  const context = {
    URLSearchParams,
    WebSocket: vi.fn(() => ({ binaryType: "", onclose: undefined, onopen: undefined })),
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
    encodeURIComponent,
    fetch: vi.fn(async (input: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      if (args.cookie !== undefined) {
        headers.set("cookie", args.cookie);
      }
      const nextInit = { ...init, headers };
      const response = await fetch(new URL(input, args.base).toString(), nextInit);
      fetchCalls.push({ input, init: nextInit, response });
      return response;
    }),
    history: { replaceState: vi.fn() },
    location: {
      host: base.host,
      pathname: "/auth/callback",
      protocol: `${base.protocol}`,
      search: args.search,
    },
    sessionStorage: {
      getItem: vi.fn((key: string) =>
        key === "gla.handoff" ? JSON.stringify(handoffState) : null,
      ),
      removeItem: vi.fn(),
    },
  };

  runInNewContext(callbackScript(html), context);
  return { fetchCalls, status };
}

function mountReq(endpoint: string): RouteMountRequest {
  return {
    authorization: {
      routeId: "route_1" as RouteId,
      path: ROUTE_PATH,
      boundGrantId: GRANT_ID,
      sessionId: SESS,
      entrypointResourceId: "entrypoint:authentik-test",
    },
    transport: { kind: "reverse-proxy", protocol: "websocket", upstream: endpoint },
    client: { kind: "gateway-page", ref: "handoff" },
  };
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) {
    const c = closers.pop();
    if (c) await c();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The dual-method harness: a gateway wired with the REAL IdentityService+AuthAuthentikProvider (fake-authentik
// seams) as `stepUp`, plus the recipient pre-enrolled (a bound subject). `authAssuranceProfile` is configurable.
// ─────────────────────────────────────────────────────────────────────────────

interface DualHarness {
  fake: FakeAuthentik;
  provider: AuthAuthentikProvider;
  identity: IdentityService;
  gateway: AccessGateway;
  grants: StubSessionGrants;
  base: string;
  host: string;
  port: number;
  /** The stable subject the recipient is bound to (enrolled below) — step-up tokens must carry this `sub`. */
  boundSub: string;
}

async function dualHarness(opts: {
  authAssuranceProfile?: AuthAssuranceProfile;
  requiredAuthStrength?: "password" | "webauthn";
  upstream?: string;
  enroll?: boolean;
}): Promise<DualHarness> {
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
  const boundSub = "sub-recipient-123";
  if (opts.enroll !== false) {
    // Enroll the recipient (bind the subject) via the real service path — the precondition for any step-up.
    const challenge = await identity.enrollmentOptions(recipient, "discharge" as OpaqueToken);
    const { state, nonce } = redirectParams(challenge);
    await fake.stageValidLogin(`enroll-${state}`, {
      sub: boundSub,
      nonce,
      amr: ["swk"],
      userVerified: true,
    });
    await identity.enrollComplete(recipient, { code: `enroll-${state}`, state });
  }
  const gatewayOpts: GatewayOptions = {
    sessionGrants: new StubSessionGrants(),
    stepUp: identity,
    host: "127.0.0.1",
    port: 0,
    ...(opts.authAssuranceProfile !== undefined
      ? { authAssurancePolicy: authAssurancePolicyFromProfile(opts.authAssuranceProfile) }
      : {}),
    ...(opts.requiredAuthStrength !== undefined
      ? { requiredAuthStrength: opts.requiredAuthStrength }
      : {}),
  };
  const grants = gatewayOpts.sessionGrants as StubSessionGrants;
  const gateway = new AccessGateway(gatewayOpts);
  const bound = await gateway.listen();
  closers.push(() => gateway.close());
  await gateway.mount(mountReq(opts.upstream ?? "ws://127.0.0.1:1/"));
  return {
    fake,
    provider,
    identity,
    gateway,
    grants,
    base: `http://${bound.host}:${bound.port}`,
    host: bound.host,
    port: bound.port,
    boundSub,
  };
}

/** Pull `{state, nonce}` out of an opaque `{kind:"redirect", authorizeUrl}` challenge. */
function redirectParams(challenge: unknown): { state: string; nonce: string } {
  const c = challenge as { kind?: string; authorizeUrl?: string };
  if (c?.kind !== "redirect" || typeof c.authorizeUrl !== "string") {
    throw new Error("expected a redirect challenge");
  }
  const url = new URL(c.authorizeUrl);
  const state = url.searchParams.get("state");
  const nonce = url.searchParams.get("nonce");
  if (state === null || nonce === null) throw new Error("missing state/nonce");
  return { state, nonce };
}

/**
 * Drive a step-up to the verify route the way the served page's redirect-return arm would: POST /handoff/auth/options
 * (→ the redirect challenge), have FakeAuthentik mint a token for `{sub, amr, nonce}` (the simulated authentik login),
 * then POST {code,state} to /handoff/auth/verify. Returns the verify HTTP response.
 */
async function stepUpWith(
  h: DualHarness,
  opts: { amr?: string[]; sub?: string; mint?: "valid" | "bad-nonce"; userVerified?: boolean },
): Promise<Response> {
  const optRes = await fetch(`${h.base}/handoff/auth/options`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant: "valid", path: ROUTE_PATH }),
  });
  if (optRes.status !== 200) {
    return optRes;
  }
  const { state, nonce } = redirectParams(await optRes.json());
  const code = `code-${state}`;
  const tokenNonce = opts.mint === "bad-nonce" ? "WRONG-NONCE" : nonce;
  await h.fake.stageValidLogin(code, {
    sub: opts.sub ?? h.boundSub,
    nonce: tokenNonce,
    ...(opts.amr !== undefined ? { amr: opts.amr } : {}),
    ...(opts.userVerified !== undefined ? { userVerified: opts.userVerified } : {}),
  });
  return fetch(`${h.base}/handoff/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { code, state } }),
  });
}

async function beginCallbackStepUp(
  h: DualHarness,
  grant: string,
): Promise<{ authorizeUrl: URL; code: string; state: string; bootstrapCookie: string }> {
  const page = await fetch(`${h.base}${ROUTE_PATH}?grant=${encodeURIComponent(grant)}`);
  expect(page.status).toBe(200);
  const bootstrapCookie = cookiePair(page.headers.get("set-cookie") ?? "", "gla_handoff_boot");
  expect(bootstrapCookie).toMatch(/^gla_handoff_boot=/);
  const optRes = await fetch(`${h.base}/handoff/auth/options`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: bootstrapCookie },
    body: JSON.stringify({ path: ROUTE_PATH }),
  });
  expect(optRes.status).toBe(200);
  const challenge = (await optRes.json()) as { kind?: string; authorizeUrl?: string };
  expect(challenge.kind).toBe("redirect");
  const authorizeUrl = new URL(challenge.authorizeUrl ?? "");
  const state = authorizeUrl.searchParams.get("state") ?? "";
  const nonce = authorizeUrl.searchParams.get("nonce") ?? "";
  const code = `callback-${state}`;
  await h.fake.stageValidLogin(code, {
    sub: h.boundSub,
    nonce,
    amr: ["swk"],
    userVerified: true,
  });
  return { authorizeUrl, code, state, bootstrapCookie };
}

function cookiePair(setCookie: string, name: string): string {
  return setCookie.match(new RegExp(`${name}=[^;,]+`))?.[0] ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// AC#1/#2/#5 — both methods independently satisfy a policy that explicitly permits the fallback.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC#1/#2/#5 · both methods satisfy password-permitted policy (passkey→webauthn, password→password)", () => {
  it("a configured /auth/callback handoff return runs the real verify route, authorizes the grant, and permits the WS upgrade", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const h = await dualHarness({
      authAssuranceProfile: "password-permitted",
      upstream: upstream.endpoint,
    });
    const grant = "session-grant-sentinel";
    h.grants.validToken = grant;
    const { authorizeUrl, code, state, bootstrapCookie } = await beginCallbackStepUp(h, grant);
    const redirectUri = new URL(authorizeUrl.searchParams.get("redirect_uri") ?? "");
    expect(redirectUri.origin).toBe("https://gla.example");
    expect(redirectUri.pathname).toBe("/auth/callback");
    expect(redirectUri.search).toBe("");
    expect(authorizeUrl.toString()).not.toContain(grant);

    const callback = await fetch(
      `${h.base}/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    );
    expect(callback.status).toBe(200);
    const html = await callback.text();
    expect(html).toContain("Completing sign-in");
    const { fetchCalls } = executeHandoffCallback(html, {
      base: h.base,
      cookie: bootstrapCookie,
      search: `?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      streamPath: ROUTE_PATH,
    });

    await waitForAssertion(() => expect(h.gateway.isGrantAuthorized(GRANT_ID)).toBe(true));
    expect(fetchCalls[0]?.input).toBe("/handoff/auth/verify");
    expect(JSON.parse(String(fetchCalls[0]?.init.body))).toEqual({
      path: ROUTE_PATH,
      assertion: { code, state },
    });
    const streamCookie = cookiePair(
      fetchCalls[0]?.response.headers.get("set-cookie") ?? "",
      "gla_handoff",
    );
    expect(streamCookie).toMatch(/^gla_handoff=/);
    expect(streamCookie).not.toContain(grant);
    const up = await openUpgrade(
      h.host,
      h.port,
      ROUTE_PATH,
      grant,
      { Cookie: streamCookie },
      { grantPlacement: "none" },
    );
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
    up.socket.destroy();
  });

  it("a callback landing with an unknown state is a catchable refusal and leaves the grant unauthorized", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const h = await dualHarness({
      authAssuranceProfile: "password-permitted",
      upstream: upstream.endpoint,
    });
    const grant = "session-grant-replay-sentinel";
    h.grants.validToken = grant;
    const callback = await fetch(`${h.base}/auth/callback?code=bad-code&state=missing-state`);
    expect(callback.status).toBe(200);
    const { status } = executeHandoffCallback(await callback.text(), {
      base: h.base,
      search: "?code=bad-code&state=missing-state",
      streamPath: ROUTE_PATH,
    });

    await waitForAssertion(() =>
      expect(status.textContent).toMatch(/Verification was not completed/),
    );
    expect(h.gateway.isGrantAuthorized(GRANT_ID)).toBe(false);
    const up = await openUpgrade(h.host, h.port, ROUTE_PATH, grant);
    expect(up.firstChunk).toMatch(/401/);
    expect(up.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
    up.socket.destroy();
  });

  it("AC#1 · a PASSKEY step-up (amr swk) → auth_strength webauthn → authorized; WS upgrade proxied", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const h = await dualHarness({
      authAssuranceProfile: "password-permitted",
      upstream: upstream.endpoint,
    });
    const res = await stepUpWith(h, { amr: ["swk"], userVerified: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorized?: boolean; auth_strength?: string };
    expect(body.authorized).toBe(true);
    expect(body.auth_strength).toBe("webauthn"); // AC#5: the method is in the fact
    expect(h.gateway.isGrantAuthorized(GRANT_ID)).toBe(true);
    // The WS upgrade is now proxied to the capsule.
    const up = await openUpgrade(h.host, h.port, ROUTE_PATH, "valid");
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
    up.socket.destroy();
  });

  it("AC#2 · a PASSWORD step-up (amr pwd, no passkey) → auth_strength password → authorized; WS upgrade proxied", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const h = await dualHarness({
      authAssuranceProfile: "password-permitted",
      upstream: upstream.endpoint,
    });
    const res = await stepUpWith(h, { amr: ["pwd"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorized?: boolean; auth_strength?: string };
    expect(body.authorized).toBe(true);
    expect(body.auth_strength).toBe("password"); // AC#5: the method is in the fact
    expect(h.gateway.isGrantAuthorized(GRANT_ID)).toBe(true);
    const up = await openUpgrade(h.host, h.port, ROUTE_PATH, "valid");
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
    up.socket.destroy();
  });

  it("AC#2 · password + MFA companions (amr [pwd,mfa]) is still password (MFA never up-maps)", async () => {
    const h = await dualHarness({ authAssuranceProfile: "password-permitted" });
    const res = await stepUpWith(h, { amr: ["pwd", "mfa"] });
    const body = (await res.json()) as { auth_strength?: string };
    expect(body.auth_strength).toBe("password");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#3 — a too-weak result is rejected where phishing-resistant assurance is required.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC#3 · phishing-resistant policy admits the passkey but rejects the password-only result", () => {
  it("PASSWORD result under phishing-resistant policy → 403 auth.insufficient, grant NOT authorized, WS upgrade refused (401)", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const h = await dualHarness({
      authAssuranceProfile: "phishing-resistant",
      upstream: upstream.endpoint,
    });
    const res = await stepUpWith(h, { amr: ["pwd"] });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe(
      "auth.insufficient",
    );
    expect(h.gateway.isGrantAuthorized(GRANT_ID)).toBe(false);
    // The WS upgrade is refused (the grant was never authorized).
    const up = await openUpgrade(h.host, h.port, ROUTE_PATH, "valid");
    expect(up.firstChunk).toMatch(/401/);
    expect(up.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
    up.socket.destroy();
  });

  it("PASSKEY result under the SAME phishing-resistant policy → authorized (the stronger method satisfies it)", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const h = await dualHarness({
      authAssuranceProfile: "phishing-resistant",
      upstream: upstream.endpoint,
    });
    const res = await stepUpWith(h, { amr: ["swk"], userVerified: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { authorized?: boolean }).authorized).toBe(true);
    expect(h.gateway.isGrantAuthorized(GRANT_ID)).toBe(true);
    const up = await openUpgrade(h.host, h.port, ROUTE_PATH, "valid");
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
    up.socket.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#4 — a failed/forged step-up → a typed-reason refusal, nothing authorized.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC#4 · a failed assertion is refused with a typed reason and authorizes no one", () => {
  it("a NONCE-MISMATCH id_token → {ok:false} → 403 auth.insufficient, grant NOT authorized", async () => {
    const h = await dualHarness({ authAssuranceProfile: "password-permitted" });
    const res = await stepUpWith(h, { amr: ["swk"], mint: "bad-nonce", userVerified: true });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe(
      "auth.insufficient",
    );
    expect(h.gateway.isGrantAuthorized(GRANT_ID)).toBe(false);
  });

  it("a SUBJECT-MISMATCH id_token (a valid login for the WRONG sub) → refused, nothing authorized", async () => {
    const h = await dualHarness({ authAssuranceProfile: "password-permitted" });
    const res = await stepUpWith(h, {
      amr: ["swk"],
      sub: "sub-IMPOSTOR",
      userVerified: true,
    });
    expect(res.status).toBe(403);
    expect(h.gateway.isGrantAuthorized(GRANT_ID)).toBe(false);
  });

  it("the adapter classifies the typed reason on the diagnostic sink (observability) while the recipient sees only a generic refusal", async () => {
    const fake = await FakeAuthentik.create();
    const subjects = new InMemoryKv<BoundSubject>();
    const outcomes: Array<{ ok: boolean; reason?: string }> = [];
    const provider = new AuthAuthentikProvider({
      issuerUrl: fake.issuerUrl,
      clientId: fake.clientId,
      clientSecret: "s",
      redirectUri: "https://gla.example/auth/callback",
      endpoints: fake.endpoints(),
      jwks: fake.jwks,
      fetch: fake.fetch,
      subjects,
      onVerifyOutcome: (o) => outcomes.push(o.ok ? { ok: true } : { ok: false, reason: o.reason }),
    });
    subjects.set(`user:${recipient}`, { sub: "sub-x" });
    const challenge = await provider.challenge(`user:${recipient}`);
    const { state, nonce } = redirectParams(challenge);
    await fake.stageValidLogin(`c-${state}`, {
      sub: "sub-x",
      nonce: "WRONG",
      amr: ["swk"],
      userVerified: true,
    });
    void nonce;
    const out = await provider.verifyAssertionDetailed(`user:${recipient}`, {
      code: `c-${state}`,
      state,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("nonce_mismatch");
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "nonce_mismatch" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth assurance policy wiring + the never-up-map floor.
// ─────────────────────────────────────────────────────────────────────────────

describe("authAssuranceProfile wiring + the never-up-map floor", () => {
  it("the DEFAULT gateway policy is phishing-resistant (a password-only step-up is rejected by default)", async () => {
    // No authAssuranceProfile → defaults to phishing-resistant.
    const h = await dualHarness({});
    const res = await stepUpWith(h, { amr: ["pwd"] });
    expect(res.status).toBe(403);
    expect(h.gateway.isGrantAuthorized(GRANT_ID)).toBe(false);
  });

  it("a valid token with an UNRESOLVABLE method (no amr) → password floor → admitted under password-permitted, rejected under phishing-resistant", async () => {
    const permit = await dualHarness({ authAssuranceProfile: "password-permitted" });
    const r1 = await stepUpWith(permit, {}); // no amr → the password floor
    expect(((await r1.json()) as { auth_strength?: string }).auth_strength).toBe("password");

    const demand = await dualHarness({ authAssuranceProfile: "phishing-resistant" });
    const r2 = await stepUpWith(demand, {}); // no amr → password floor → rejected under phishing-resistant
    expect(r2.status).toBe(403);
    expect(demand.gateway.isGrantAuthorized(GRANT_ID)).toBe(false);
  });

  it("deprecated requiredAuthStrength still translates to the equivalent assurance profile", async () => {
    const h = await dualHarness({ requiredAuthStrength: "password" });
    const res = await stepUpWith(h, { amr: ["pwd"] });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The provider-agnostic gateway proof (the central review gate) + the served-page generalization.
// ─────────────────────────────────────────────────────────────────────────────

describe("provider-agnostic gateway — no provider knowledge leaks into packages/gateway", () => {
  /** The repo root, derived from this test's location (works under both src/ and dist/). */
  function repoRoot(): string {
    const here = fileURLToPath(import.meta.url);
    return here.replace(/\/packages\/app\/(dist|src)\/.*$/, "");
  }

  /** Read every .ts file under packages/gateway/src (recursively). */
  function gatewaySrcFiles(): string[] {
    const root = join(repoRoot(), "packages/gateway/src");
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) walk(p);
        else if (name.name.endsWith(".ts")) out.push(p);
      }
    };
    walk(root);
    return out;
  }

  it("contains NO provider-specific token (authentik / issuer / amr / acr / openid / jwks / id_token / a method name)", () => {
    const forbidden =
      /authentik|\bissuer\b|\bamr\b|\bacr\b|openid|jwks|id_token|client_secret|\.well-known|\bswk\b|\bhwk\b|\bfido\b/i;
    const offenders: string[] = [];
    for (const file of gatewaySrcFiles()) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (forbidden.test(line)) {
          offenders.push(`${file.replace(repoRoot(), "")}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the served pages branch on a GENERIC options.kind discriminant (reachable by any redirect-based provider)", () => {
    const root = join(repoRoot(), "packages/gateway/src");
    const handoff = readFileSync(join(root, "handoff-page.ts"), "utf8");
    const enroll = readFileSync(join(root, "enroll-page.ts"), "utf8");
    // The generic discriminant is present in both pages…
    expect(handoff).toContain('options.kind === "redirect"');
    expect(enroll).toContain('options.kind === "redirect"');
    // …and the WebAuthn ceremony is still the else arm (unchanged) — both pages still call the in-page API.
    expect(handoff).toContain("navigator.credentials.get");
    expect(enroll).toContain("navigator.credentials.create");
    // The redirect arm navigates only to the server-built authorizeUrl (no request input → no open redirect).
    expect(handoff).toContain("location.assign(options.authorizeUrl)");
    expect(enroll).toContain("location.assign(options.authorizeUrl)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The /enroll/verify strength-echo fix (carried from GLA-070): the response echoes the RECORDED strength.
// ─────────────────────────────────────────────────────────────────────────────

describe("/enroll/verify echoes the recorded strength (provider-agnostic, no hardcoded webauthn)", () => {
  // A tiny enrollment-grant stub so /enroll/* runs without the real CapabilityService (we only assert the echo).
  class EnrollGrantStub implements EnrollmentGrantPort {
    spent = false;
    readonly token = "enroll-grant";
    readonly nonce = "nonce-1";
    verifyEnrollmentGrantToken(t: OpaqueToken): EnrollmentGrantVerifyResult {
      if (String(t) !== this.token || this.spent) {
        return { ok: false, reason: "auth.revoked" };
      }
      return {
        ok: true,
        capability: { id: "cap_enroll1" as CapabilityId, cls: "session", caveats: [] },
        recipient,
        nonce: this.nonce,
      };
    }
    tryConsumeEnrollmentGrantToken(t: OpaqueToken): EnrollmentGrantVerifyResult {
      const v = this.verifyEnrollmentGrantToken(t);
      if (v.ok) this.spent = true;
      return v;
    }
    verifyConsumedEnrollmentGrantToken(t: OpaqueToken): EnrollmentGrantVerifyResult {
      if (String(t) !== this.token || !this.spent) {
        return { ok: false, reason: "auth.revoked" };
      }
      return {
        ok: true,
        capability: { id: "cap_enroll1" as CapabilityId, cls: "session", caveats: [] },
        recipient,
        nonce: this.nonce,
      };
    }
    unspend(): void {
      this.spent = false;
    }
  }

  async function enrollHarness(): Promise<{
    base: string;
    fake: FakeAuthentik;
    identity: IdentityService;
    close: () => Promise<void>;
  }> {
    const fake = await FakeAuthentik.create();
    const subjects = new InMemoryKv<BoundSubject>();
    const attempts = new InMemoryKv<PendingAttempt>();
    const provider = new AuthAuthentikProvider({
      issuerUrl: fake.issuerUrl,
      clientId: fake.clientId,
      clientSecret: "s",
      redirectUri: "https://gla.example/auth/callback",
      endpoints: fake.endpoints(),
      jwks: fake.jwks,
      fetch: fake.fetch,
      subjects,
      attempts,
    });
    const identity = new IdentityService({ authProvider: provider });
    const gateway = new AccessGateway({
      grants: new EnrollGrantStub(),
      identity,
      host: "127.0.0.1",
      port: 0,
    });
    const bound = await gateway.listen();
    closers.push(() => gateway.close());
    return {
      base: `http://${bound.host}:${bound.port}`,
      fake,
      identity,
      close: () => gateway.close(),
    };
  }

  /** Run a delegated enroll through /enroll/options + /enroll/verify with a chosen `amr`; return the verify response. */
  async function enrollVerify(
    h: { base: string; fake: FakeAuthentik },
    amr: string[],
    userVerified?: boolean,
  ): Promise<Response> {
    const optRes = await fetch(`${h.base}/enroll/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "enroll-grant" }),
    });
    expect(optRes.status).toBe(200);
    const c = (await optRes.json()) as { kind?: string; authorizeUrl?: string };
    const url = new URL(c.authorizeUrl ?? "");
    const state = url.searchParams.get("state") ?? "";
    const nonce = url.searchParams.get("nonce") ?? "";
    await h.fake.stageValidLogin(`code-${state}`, {
      sub: "sub-e",
      nonce,
      amr,
      ...(userVerified !== undefined ? { userVerified } : {}),
    });
    return fetch(`${h.base}/enroll/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant: "enroll-grant",
        attestation: { code: `code-${state}`, state },
      }),
    });
  }

  it("a PASSWORD-grade delegated enroll → the response reports auth_strength password (not the old hardcoded webauthn)", async () => {
    const h = await enrollHarness();
    const res = await enrollVerify(h, ["pwd"]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { auth_strength?: string }).auth_strength).toBe("password");
  });

  it("a PASSKEY-grade delegated enroll → the response reports auth_strength webauthn", async () => {
    const h = await enrollHarness();
    const res = await enrollVerify(h, ["swk"], true);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { auth_strength?: string }).auth_strength).toBe("webauthn");
  });
});
