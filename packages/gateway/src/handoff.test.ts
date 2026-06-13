// CONTRACT tests for the Access Gateway HANDOFF fronting (packages/gateway) — GLA-035/038/039.
// Drives the REAL node:http server on 127.0.0.1:<ephemeral> via fetch + a raw WS client, with STUB grant + step-up
// seams (so each refusal reason is controlled precisely) and a STUB WS UPSTREAM standing in for the capsule's noVNC
// endpoint (the real noVNC stack needs X, absent in dev — the real-noVNC test is gated for hermes-1; here the
// proxy logic is proven against the stub). Proves:
//   - VERIFY AT EDGE (GLA-035): a mounted handoff route's GET serves the step-up page ONLY on a valid grant; an
//     absent/expired/revoked/wrong-recipient/wrong-class grant is refused; an un-enrolled recipient → a catchable
//     refusal (not a crash); the step-up verify decision (auth ok + sufficient strength → authorize; else refuse).
//   - REACH/PROXY (GLA-038/039): an AUTHORIZED in-window WS upgrade is proxied to the capsule endpoint and bytes
//     flow both ways; an un-authorized/expired/revoked grant upgrade is refused (resolves to nothing); reachable
//     ONLY within an open window (unmount → unreachable); revoke → the live WS is FORCE-CLOSED and unreachable.

import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { type IncomingMessage, type Server, createServer } from "node:http";
import { type AddressInfo, type Socket, connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authAssurancePolicyFromProfile } from "@gla/kernel";
import type {
  AuthAssuranceEvidence,
  AuthStrength,
  CapabilityId,
  ErrorCode,
  OpaqueToken,
  RecipientRef,
  RouteId,
  SessionId,
} from "@gla/kernel";
import { afterEach, describe, expect, it } from "vitest";
import { handoffPageHtml, handoffReusedPageHtml } from "./handoff-page.js";
import {
  AccessGateway,
  type GatewayOptions,
  type IdentityStepUpPort,
  type RouteMountRequest,
  type SessionGrantPort,
  type SessionGrantVerifyResult,
} from "./index.js";

const recipient = "tg:user:123" as RecipientRef;
const GRANT_ID = "cap_grant1" as CapabilityId;
const SESS = "sess_abc1" as SessionId;
const ROUTE_PATH = `/handoff/${SESS}`;
const OUTER_PROXY_HEADERS = {
  "X-Outer-Proxy-User": "recipient@example.com",
  "X-Outer-Proxy-Groups": "gla-users",
  Cookie: "outer_proxy_session=outer-session",
};
const MALICIOUS_CLIENT = {
  kind: "provider-asset",
  ref: "evil",
  bootstrap: { payload: "</script><script>globalThis.pwned=1</script>" },
};

/**
 * A stub handoff-grant seam: a `valid` token verifies (reporting `recipient` + the grant id); anything else fails
 * with the configured reason. The grant id lets a test authorize/revoke it.
 */
class StubSessionGrants implements SessionGrantPort {
  validToken = "valid";
  grantId: CapabilityId = GRANT_ID;
  boundRecipient: RecipientRef = recipient;
  invalidReason: ErrorCode = "auth.malformed";
  invalidReasons = new Map<string, ErrorCode>();
  routeProofScopes = new Map<string, string>([["valid", ROUTE_PATH]]);
  cls: "session" | "task" = "session";

  verifySessionGrantToken(
    token: OpaqueToken,
    args: { scopePath: string; now?: string },
  ): SessionGrantVerifyResult {
    if (token !== this.validToken) {
      return { ok: false, reason: this.invalidReasons.get(token) ?? this.invalidReason };
    }
    if (this.routeProofScopes.get(token) !== args.scopePath) {
      return { ok: false, reason: "auth.insufficient" };
    }
    if (this.cls !== "session") {
      return { ok: false, reason: "auth.insufficient" };
    }
    return {
      ok: true,
      capability: { id: this.grantId, cls: "session", caveats: [] },
      recipient: this.boundRecipient,
    };
  }

  proveStaleSessionGrantRoute(
    token: OpaqueToken,
    args: { scopePath: string; now?: string },
  ): SessionGrantVerifyResult {
    if (this.routeProofScopes.get(token) !== args.scopePath) {
      return { ok: false, reason: "auth.insufficient" };
    }
    if (this.cls !== "session") {
      return { ok: false, reason: "auth.insufficient" };
    }
    return {
      ok: true,
      capability: { id: this.grantId, cls: "session", caveats: [] },
      recipient: this.boundRecipient,
    };
  }
}

/** A stub step-up seam recording calls; configurable enrollment + verify outcome + reported strength. */
class StubStepUp implements IdentityStepUpPort {
  enrolled = new Set<RecipientRef>([recipient]);
  optionsCalls = 0;
  verifyCalls = 0;
  verifyOk = true;
  reportedStrength: AuthStrength = "webauthn";
  reportedAssurance: AuthAssuranceEvidence | undefined;
  isEnrolled(r: RecipientRef): boolean {
    return this.enrolled.has(r);
  }
  async authenticationOptions(r: RecipientRef): Promise<unknown> {
    this.optionsCalls++;
    if (!this.enrolled.has(r)) {
      throw new Error("not enrolled");
    }
    return { challenge: "auth-challenge", rpId: "localhost" };
  }
  async verifyAuthentication(
    r: RecipientRef,
    _assertion: unknown,
  ): Promise<{
    ok: boolean;
    authStrength: AuthStrength;
    assurance?: AuthAssuranceEvidence;
    userId: string;
  }> {
    this.verifyCalls++;
    return {
      ok: this.verifyOk,
      authStrength: this.reportedStrength,
      ...(this.reportedAssurance !== undefined ? { assurance: this.reportedAssurance } : {}),
      userId: `user:${r}`,
    };
  }
}

/** A stub WebSocket upstream: a raw TCP server that completes the WS handshake and echoes a marker, then echoes. */
function startStubUpstream(): Promise<{
  endpoint: string;
  close: () => Promise<void>;
  server: Server;
  requests: IncomingMessage[];
}> {
  return new Promise((resolve) => {
    const requests: IncomingMessage[] = [];
    // Use a bare net server so we can complete the upgrade handshake ourselves (no `ws` dependency).
    const server = createServer();
    server.on("upgrade", (req, socket, _head) => {
      requests.push(req);
      // Minimal WS handshake completion (we don't need the Sec-WebSocket-Accept to be cryptographically correct for
      // the proxy-conduit test — the gateway pipes bytes verbatim; the test asserts the bytes traverse the proxy).
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
      // Announce the upstream so the client can assert it reached the capsule endpoint and nothing else.
      socket.write("UPSTREAM_NOVNC_HELLO");
      socket.on("data", (chunk) => {
        // Echo back any client bytes prefixed, proving bidirectional piping through the gateway.
        socket.write(Buffer.concat([Buffer.from("ECHO:"), chunk as Buffer]));
      });
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        endpoint: `ws://127.0.0.1:${port}/`,
        requests,
        close: () =>
          new Promise<void>((r) => {
            // Force-terminate the upgraded sockets so close() doesn't hang on a live proxied connection.
            (server as { closeAllConnections?: () => void }).closeAllConnections?.();
            let done = false;
            const finish = (): void => {
              if (!done) {
                done = true;
                r();
              }
            };
            server.close(() => finish());
            const t = setTimeout(finish, 250);
            t.unref?.();
          }),
        server,
      });
    });
  });
}

/** Boot a handoff gateway on an ephemeral loopback port with the given stubs; returns the base URL + closer. */
async function bootHandoffGateway(
  grants: SessionGrantPort,
  stepUp: StubStepUp,
  extra: Partial<GatewayOptions> = {},
): Promise<{
  base: string;
  host: string;
  port: number;
  gateway: AccessGateway;
  close: () => Promise<void>;
}> {
  const opts: GatewayOptions = {
    sessionGrants: grants,
    stepUp,
    host: "127.0.0.1",
    port: 0,
    ...extra,
  };
  const gateway = new AccessGateway(opts);
  const { host, port } = await gateway.listen();
  return { base: `http://${host}:${port}`, host, port, gateway, close: () => gateway.close() };
}

/**
 * A SILENT WS upstream: it accepts the WS upgrade (completes the 101 handshake) but then sends NOTHING and never
 * echoes — modelling a capsule endpoint that stalls mid-stream. Used to exercise the proxy IDLE timeout.
 */
function startSilentUpstream(): Promise<{
  endpoint: string;
  close: () => Promise<void>;
  server: Server;
}> {
  return new Promise((resolve) => {
    const server = createServer();
    server.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
      // Then stay silent forever (no hello, no echo) — the stalled-stream case.
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
        server,
      });
    });
  });
}

/**
 * A NON-CONNECTING upstream endpoint: a TCP listener whose backlog is saturated will NOT actually refuse, so to model
 * a connect that never completes we point at a discard/black-hole address. `192.0.2.0/24` (TEST-NET-1, RFC 5737) is
 * guaranteed non-routable, so a `connect` to it neither completes nor RSTs quickly — exactly the stalled-dial case
 * the connect timeout guards. Returns a `ws://` endpoint on that address.
 */
function blackholeEndpoint(): string {
  // TEST-NET-1 is reserved + non-routable: a TCP connect hangs (no SYN-ACK, no RST) until the OS connect timeout —
  // long past our short proxy connect timeout, which fires first.
  return "ws://192.0.2.1:9/";
}

type MountReqOverrides = Partial<RouteMountRequest> & Partial<RouteMountRequest["authorization"]>;

function mountReq(endpoint: string, overrides: MountReqOverrides = {}): RouteMountRequest {
  const authorization: RouteMountRequest["authorization"] = {
    routeId: overrides.routeId ?? ("route_1" as RouteId),
    path: overrides.path ?? ROUTE_PATH,
    boundGrantId: overrides.boundGrantId ?? GRANT_ID,
    sessionId: overrides.sessionId ?? SESS,
    entrypointResourceId: overrides.entrypointResourceId ?? "entrypoint:test-handoff",
    ...overrides.authorization,
  };
  return {
    authorization,
    transport: overrides.transport ?? {
      kind: "reverse-proxy",
      protocol: "websocket",
      upstream: endpoint,
    },
    client: overrides.client ?? {
      kind: "rfb-web-client",
      ref: "novnc",
      bootstrap: { module: "core/rfb.js" },
    },
  };
}

/**
 * Open a raw WS-upgrade to the gateway and return what the gateway sent back. If `upstreamHello` is reached, the
 * upgrade was proxied; otherwise the first bytes are the HTTP refusal status line. Resolves once data arrives or the
 * socket closes. Also returns the live socket so a test can send bytes / observe a force-close.
 */
function openUpgrade(
  host: string,
  port: number,
  path: string,
  grant: string,
  headers: Readonly<Record<string, string>> = {},
  opts: { grantPlacement?: "query" | "protocol" | "none" } = {},
): Promise<{ firstChunk: string; socket: Socket; closed: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host, port }, () => {
      const grantPlacement = opts.grantPlacement ?? "query";
      const target =
        grantPlacement === "query" ? `${path}?grant=${encodeURIComponent(grant)}` : path;
      const protocolHeader =
        grantPlacement === "protocol" ? `Sec-WebSocket-Protocol: ${grant}\r\n` : "";
      const extraHeaders = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join("");
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: ${host}:${port}\r\n${extraHeaders}${protocolHeader}Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let firstChunk = "";
    let resolved = false;
    let closeResolve: () => void = () => {};
    const closed = new Promise<void>((r) => {
      closeResolve = r;
    });
    socket.on("data", (chunk) => {
      firstChunk += (chunk as Buffer).toString("utf8");
      if (!resolved) {
        resolved = true;
        resolve({ firstChunk, socket, closed });
      }
    });
    socket.on("close", () => {
      if (!resolved) {
        resolved = true;
        resolve({ firstChunk, socket, closed });
      }
      closeResolve();
    });
    socket.on("error", (e) => {
      if (!resolved) {
        reject(e);
      }
    });
  });
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

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY AT EDGE (GLA-035) — the handoff page + step-up decision
// ─────────────────────────────────────────────────────────────────────────────

describe("Access Gateway — handoff page grant enforcement (GLA-035)", () => {
  it("serves the step-up page on a VALID grant for the enrolled bound recipient", async () => {
    const { base, gateway, close } = await bootHandoffGateway(
      new StubSessionGrants(),
      new StubStepUp(),
    );
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}${ROUTE_PATH}?grant=valid`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toMatch(/Verify with passkey/);
    expect(html).toMatch(/navigator\.credentials\.get/);
    expect(html).toContain('id="viewer"');
    expect(html).toContain("rfb-web-client");
    expect(html).not.toContain("new WebSocket");
  });

  it("keeps the raw grant out of public handoff HTML, response headers, and browser stream URLs after bootstrap", async () => {
    const canary = "grant-canary-089";
    const grants = new StubSessionGrants();
    grants.validToken = canary;
    grants.routeProofScopes.set(canary, ROUTE_PATH);
    const stepUp = new StubStepUp();
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));

    const page = await fetch(`${base}${ROUTE_PATH}?grant=${encodeURIComponent(canary)}`);
    expect(page.status).toBe(200);
    const pageHeaders = headerText(page.headers);
    const html = await page.text();
    expect(pageHeaders).not.toContain(canary);
    expect(html).not.toContain(canary);
    const bootstrapCookie = cookiePair(page.headers.get("set-cookie") ?? "", "gla_handoff_boot");
    expect(bootstrapCookie).toMatch(/^gla_handoff_boot=/);

    const options = await fetch(`${base}/handoff/auth/options`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bootstrapCookie },
      body: JSON.stringify({ path: ROUTE_PATH }),
    });
    expect(options.status).toBe(200);
    expect(headerText(options.headers)).not.toContain(canary);
    expect(await options.text()).not.toContain(canary);

    const verify = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bootstrapCookie },
      body: JSON.stringify({ path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(verify.status).toBe(200);
    const verifyHeaders = headerText(verify.headers);
    expect(verifyHeaders).not.toContain(canary);
    expect(await verify.text()).not.toContain(canary);
    const streamCookie = cookiePair(verify.headers.get("set-cookie") ?? "", "gla_handoff");
    expect(streamCookie).toMatch(/^gla_handoff=/);

    const up = await openUpgrade(
      host,
      port,
      ROUTE_PATH,
      canary,
      { Cookie: streamCookie },
      { grantPlacement: "none" },
    );
    expect(up.firstChunk).toMatch(/101 Switching Protocols/);
    expect(upstream.requests[0]?.url).toBe("/");
    expect(upstream.requests[0]?.headers.cookie).toBeUndefined();
    expect(String(upstream.requests[0]?.headers["sec-websocket-protocol"] ?? "")).not.toContain(
      canary,
    );
    up.socket.destroy();
  });

  it("scrubs grant-bearing bootstrap URLs from enrollment and handoff browser history", () => {
    const handoff = handoffPageHtml("valid", ROUTE_PATH, String(recipient));
    expect(handoff).toContain('history.replaceState(null, "", location.pathname)');
    expect(handoff).toContain('new URLSearchParams(location.search).has("grant")');
  });

  it("embeds the provider-declared browser client binding in the handoff page contract", async () => {
    const { base, gateway, close } = await bootHandoffGateway(
      new StubSessionGrants(),
      new StubStepUp(),
    );
    closers.push(close);
    await gateway.mount(
      mountReq("ws://127.0.0.1:1/", {
        client: { kind: "provider-asset", ref: "fake-viewer", bootstrap: { mode: "test" } },
      }),
    );

    const res = await fetch(`${base}${ROUTE_PATH}?grant=valid`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(
      '"client":{"kind":"provider-asset","ref":"fake-viewer","bootstrap":{"mode":"test"}}',
    );
    expect(html).toContain('"clientAssets":"/handoff/client-assets"');
  });

  it("serves configured provider client assets safely under the generic handoff asset route", async () => {
    const root = await mkdtemp(join(tmpdir(), "gla-client-assets-"));
    const outside = await mkdtemp(join(tmpdir(), "gla-client-assets-outside-"));
    closers.push(() => rm(root, { recursive: true, force: true }));
    closers.push(() => rm(outside, { recursive: true, force: true }));
    await writeFile(join(root, "viewer.js"), "export default class TestViewer {}\n");
    await writeFile(join(outside, "leak.js"), "export default 'outside root';\n");
    await symlink(join(outside, "leak.js"), join(root, "leak.js"));
    const { base, close } = await bootHandoffGateway(new StubSessionGrants(), new StubStepUp(), {
      entrypointClientAssets: [{ ref: "test-viewer", root }],
    });
    closers.push(close);

    const ok = await fetch(`${base}/handoff/client-assets/test-viewer/viewer.js`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toMatch(/text\/javascript/);
    expect(ok.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await ok.text()).toContain("TestViewer");

    const traversal = await fetch(`${base}/handoff/client-assets/test-viewer/%2e%2e/package.json`);
    expect(traversal.status).toBe(404);
    const symlinkEscape = await fetch(`${base}/handoff/client-assets/test-viewer/leak.js`);
    expect(symlinkEscape.status).toBe(404);
    const missingRef = await fetch(`${base}/handoff/client-assets/unknown/viewer.js`);
    expect(missingRef.status).toBe(404);
    expect(missingRef.headers.get("cache-control")).toBe("no-store");
    expect(missingRef.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("rejects malformed reverse-proxy transport at mount without exposing a public route", async () => {
    const { base, gateway, close } = await bootHandoffGateway(
      new StubSessionGrants(),
      new StubStepUp(),
    );
    closers.push(close);

    await expect(gateway.mount(mountReq("http://127.0.0.1:6080/"))).rejects.toMatchObject({
      layer: "reverse-proxy-transport",
    });
    const res = await fetch(`${base}${ROUTE_PATH}?grant=valid`);
    expect(res.status).toBe(404);
  });

  it("serves handoff under a configured public base path while keeping the internal scope path unchanged", async () => {
    const { base, gateway, close } = await bootHandoffGateway(
      new StubSessionGrants(),
      new StubStepUp(),
      { publicBaseUrl: "https://gla.example/gla/" },
    );
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));

    const res = await fetch(`${base}/gla${ROUTE_PATH}?grant=valid`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`"path":"${ROUTE_PATH}"`);
    expect(html).toContain(`"streamPath":"/gla${ROUTE_PATH}"`);
    expect(html).toContain('"authOptions":"/gla/handoff/auth/options"');
    expect(html).toContain('"authVerify":"/gla/handoff/auth/verify"');

    const rootAlias = await fetch(`${base}${ROUTE_PATH}?grant=valid`);
    expect(rootAlias.status).toBe(404);
  });

  it("ABSENT grant on a mounted route → 400, the refusal page", async () => {
    const { base, gateway, close } = await bootHandoffGateway(
      new StubSessionGrants(),
      new StubStepUp(),
    );
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}${ROUTE_PATH}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/invalid|expired|recipient/i);
  });

  it("outer proxy headers/cookies do not replace the GLA handoff grant", async () => {
    const stepUp = new StubStepUp();
    const { base, gateway, close } = await bootHandoffGateway(new StubSessionGrants(), stepUp);
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));

    const page = await fetch(`${base}${ROUTE_PATH}`, {
      headers: OUTER_PROXY_HEADERS,
    });
    expect(page.status).toBe(400);

    const options = await fetch(`${base}/handoff/auth/options`, {
      method: "POST",
      headers: { "content-type": "application/json", ...OUTER_PROXY_HEADERS },
      body: JSON.stringify({ path: ROUTE_PATH }),
    });
    expect(options.status).toBe(400);
    expect(stepUp.optionsCalls).toBe(0);
  });

  it("a request to an UNMOUNTED path → 404 (reachable only within an open window — GLA-039 AC#2)", async () => {
    const { base, close } = await bootHandoffGateway(new StubSessionGrants(), new StubStepUp());
    closers.push(close);
    // No route mounted: the path is not publicly reachable.
    const res = await fetch(`${base}${ROUTE_PATH}?grant=valid`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe(
      "catalog.unknown",
    );
  });

  it("EXPIRED grant → typed JSON refusal, never catalog.unknown", async () => {
    const grants = new StubSessionGrants();
    grants.invalidReason = "auth.expired";
    const { base, gateway, close } = await bootHandoffGateway(grants, new StubStepUp());
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}${ROUTE_PATH}?grant=expired-token`);
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe("auth.expired");
  });

  it("REVOKED grant → typed JSON refusal, never catalog.unknown", async () => {
    const grants = new StubSessionGrants();
    grants.invalidReason = "auth.revoked";
    const { base, gateway, close } = await bootHandoffGateway(grants, new StubStepUp());
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}${ROUTE_PATH}?grant=revoked-token`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe("auth.revoked");
  });

  it("WRONG-RECIPIENT grant → 403 refusal page (recipient mismatch)", async () => {
    const grants = new StubSessionGrants();
    grants.invalidReason = "auth.recipient_mismatch";
    const { base, gateway, close } = await bootHandoffGateway(grants, new StubStepUp());
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}${ROUTE_PATH}?grant=other-token`);
    expect(res.status).toBe(403);
  });

  it("an UN-ENROLLED bound recipient → a catchable refusal page, NOT a crash (GLA-035 AC#4)", async () => {
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    stepUp.enrolled.clear(); // the bound recipient is NOT enrolled
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}${ROUTE_PATH}?grant=valid`);
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/not enrolled/i);
  });
});

describe("Access Gateway — handoff page data-island escaping", () => {
  it("escapes provider bootstrap metadata in both normal and reused handoff pages", () => {
    const normal = handoffPageHtml("grant", ROUTE_PATH, String(recipient), {
      authOptions: "/handoff/auth/options",
      authVerify: "/handoff/auth/verify",
      stream: ROUTE_PATH,
      entrypointClient: MALICIOUS_CLIENT,
    });
    const reused = handoffReusedPageHtml(
      "grant",
      ROUTE_PATH,
      String(recipient),
      ROUTE_PATH,
      MALICIOUS_CLIENT,
    );

    for (const html of [normal, reused]) {
      expect(html).not.toContain("</script><script>globalThis.pwned=1</script>");
      expect(html).toContain(
        "\\u003c/script\\u003e\\u003cscript\\u003eglobalThis.pwned=1\\u003c/script\\u003e",
      );
    }
  });
});

describe("Access Gateway — handoff step-up options + verify decision (GLA-035)", () => {
  it("POST /handoff/auth/options returns step-up options on a valid grant for an enrolled recipient", async () => {
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}/handoff/auth/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(((await res.json()) as { challenge?: string }).challenge).toBe("auth-challenge");
    expect(stepUp.optionsCalls).toBe(1);
  });

  it("POST /handoff/auth/options for an un-enrolled recipient → 403, no crash (GLA-035 AC#4)", async () => {
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    stepUp.enrolled.clear();
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}/handoff/auth/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /handoff/auth/verify with a VERIFIED assertion (sufficient strength) → authorizes the grant", async () => {
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    stepUp.verifyOk = true;
    stepUp.reportedStrength = "webauthn";
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { authorized?: boolean }).authorized).toBe(true);
    expect(gateway.isGrantAuthorized(GRANT_ID)).toBe(true);
  });

  it("POST /handoff/auth/verify works through the public prefix but verifies the internal route scope", async () => {
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp, {
      publicBaseUrl: "https://gla.example/gla/",
    });
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));

    const res = await fetch(`${base}/gla/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(res.status).toBe(200);
    expect(gateway.isGrantAuthorized(GRANT_ID)).toBe(true);

    const publicPathInBody = await fetch(`${base}/gla/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant: "valid",
        path: `/gla${ROUTE_PATH}`,
        assertion: { fake: true },
      }),
    });
    expect(publicPathInBody.status).toBe(400);
  });

  it("POST /handoff/auth/verify with a FAILED assertion → 403, the grant is NOT authorized", async () => {
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    stepUp.verifyOk = false; // a wrong/forged assertion
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(res.status).toBe(403);
    expect(gateway.isGrantAuthorized(GRANT_ID)).toBe(false);
  });

  it("POST /handoff/auth/verify with INSUFFICIENT strength → 403, NOT authorized", async () => {
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    stepUp.verifyOk = true;
    stepUp.reportedStrength = "password"; // below the required webauthn
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(res.status).toBe(403);
    expect(gateway.isGrantAuthorized(GRANT_ID)).toBe(false);
  });

  it("POST /handoff/auth/verify with weaker assurance evidence than legacy strength → 403, NOT authorized", async () => {
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    stepUp.verifyOk = true;
    stepUp.reportedStrength = "webauthn";
    stepUp.reportedAssurance = {
      authStrength: "password",
      level: "password",
      methodResolvable: false,
    };
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(res.status).toBe(403);
    expect(gateway.isGrantAuthorized(GRANT_ID)).toBe(false);
  });

  it("password-permitted assurance policy authorizes password-grade evidence without provider route logic", async () => {
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    stepUp.verifyOk = true;
    stepUp.reportedStrength = "password";
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp, {
      authAssurancePolicy: authAssurancePolicyFromProfile("password-permitted"),
    });
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { authorized?: boolean; auth_strength?: string }).toEqual({
      authorized: true,
      auth_strength: "password",
    });
    expect(gateway.isGrantAuthorized(GRANT_ID)).toBe(true);
  });

  it("POST /handoff/auth/verify with an INVALID grant → refused before any step-up (no bypass)", async () => {
    const grants = new StubSessionGrants();
    grants.invalidReason = "auth.expired";
    const stepUp = new StubStepUp();
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "bad", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(res.status).toBe(403);
    expect(stepUp.verifyCalls).toBe(0); // step-up never ran
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REACH/PROXY (GLA-038/039) — the verified human reaches the capsule surface
// ─────────────────────────────────────────────────────────────────────────────

describe("Access Gateway — WS upgrade proxy to the capsule (GLA-038/039)", () => {
  it("an AUTHORIZED in-window upgrade is PROXIED to the capsule endpoint; bytes flow both ways", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));

    // Step up first → authorize the grant.
    const verRes = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(verRes.status).toBe(200);

    // Now the WS upgrade is proxied to the capsule's noVNC endpoint.
    const up = await openUpgrade(host, port, ROUTE_PATH, "valid");
    // The first bytes are the upstream's 101 + its hello marker (proxied verbatim) — NOT a gateway refusal.
    expect(up.firstChunk).toMatch(/101 Switching Protocols/);
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");

    // Bytes flow BOTH ways: send a frame, the upstream echoes it back through the gateway. Accumulate from the
    // shared buffer (the openUpgrade listener keeps appending), then poll until the echo arrives.
    up.socket.write("PING");
    const got = await new Promise<string>((resolve) => {
      const onData = (c: Buffer): void => {
        if ((c as Buffer).toString("utf8").includes("ECHO:")) {
          up.socket.off("data", onData);
          resolve("ECHO:PING");
        }
      };
      up.socket.on("data", onData);
    });
    expect(got).toContain("ECHO:PING");
    up.socket.destroy();
  });

  it("an AUTHORIZED browser upgrade can use the short-lived stream ticket cookie without leaking the raw grant to URLs or upstream headers", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));

    const verRes = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(verRes.status).toBe(200);
    const streamCookie = verRes.headers.get("set-cookie") ?? "";
    expect(streamCookie).toContain("gla_handoff=");
    expect(streamCookie).toContain("HttpOnly");
    expect(streamCookie).toContain("SameSite=Strict");
    expect(streamCookie).toContain(`Path=${ROUTE_PATH}`);
    expect(streamCookie).not.toContain("valid");

    const up = await openUpgrade(
      host,
      port,
      ROUTE_PATH,
      "valid",
      { Cookie: streamCookie.match(/gla_handoff=[^;,]+/)?.[0] ?? "" },
      { grantPlacement: "none" },
    );
    expect(up.firstChunk).toMatch(/101 Switching Protocols/);
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]?.url).toBe("/");
    expect(upstream.requests[0]?.headers["sec-websocket-protocol"]).toBeUndefined();
    expect(upstream.requests[0]?.headers.cookie).toBeUndefined();
    up.socket.destroy();
  });

  it("an AUTHORIZED prefixed public WebSocket upgrade is proxied to the capsule endpoint", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp, {
      publicBaseUrl: "https://gla.example/gla/",
    });
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));

    const verRes = await fetch(`${base}/gla/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(verRes.status).toBe(200);

    const up = await openUpgrade(host, port, `/gla${ROUTE_PATH}`, "valid");
    expect(up.firstChunk).toMatch(/101 Switching Protocols/);
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
    up.socket.destroy();
  });

  it("an AUTHORIZED strip-prefix proxy WebSocket upgrade is accepted only with the matching forwarded prefix", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp, {
      publicBaseUrl: "https://gla.example/gla/",
      trustForwardedPrefix: true,
    });
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));

    const verRes = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-prefix": "/gla" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(verRes.status).toBe(200);

    const refused = await openUpgrade(host, port, ROUTE_PATH, "valid");
    expect(refused.firstChunk).toMatch(/404 Not Found/);
    refused.socket.destroy();

    const proxied = await openUpgrade(host, port, ROUTE_PATH, "valid", {
      "X-Forwarded-Prefix": "/gla",
    });
    expect(proxied.firstChunk).toMatch(/101 Switching Protocols/);
    expect(proxied.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
    proxied.socket.destroy();
  });

  it("does not trust spoofed X-Forwarded-Prefix for unprefixed handoff routes by default", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp, {
      publicBaseUrl: "https://gla.example/gla/",
    });
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));

    const verRes = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-prefix": "/gla" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(verRes.status).toBe(404);

    const refused = await openUpgrade(host, port, ROUTE_PATH, "valid", {
      "X-Forwarded-Prefix": "/gla",
    });
    expect(refused.firstChunk).toMatch(/404 Not Found/);
    refused.socket.destroy();
  });

  it("an UN-AUTHORIZED grant upgrade is REFUSED (resolves onward to nothing — GLA-035 AC#2)", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const { host, port, gateway, close } = await bootHandoffGateway(
      new StubSessionGrants(),
      new StubStepUp(),
    );
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));
    // No step-up → the grant is not authorized → the upgrade is refused (401), never proxied.
    const up = await openUpgrade(host, port, ROUTE_PATH, "valid");
    expect(up.firstChunk).toMatch(/401/);
    expect(up.firstChunk).toContain("Cache-Control: no-store");
    expect(up.firstChunk).toContain("Referrer-Policy: no-referrer");
    expect(up.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
  });

  it("an outer proxy session alone does not authorize the handoff WebSocket upgrade", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const { host, port, gateway, close } = await bootHandoffGateway(
      new StubSessionGrants(),
      new StubStepUp(),
    );
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));

    const up = await openUpgrade(host, port, ROUTE_PATH, "valid", OUTER_PROXY_HEADERS);
    expect(up.firstChunk).toMatch(/401/);
    expect(up.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
    up.socket.destroy();
  });

  it("a WRONG-RECIPIENT grant upgrade is REFUSED at the edge (GLA-035 AC#3)", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const grants = new StubSessionGrants();
    grants.invalidReason = "auth.recipient_mismatch";
    const { host, port, gateway, close } = await bootHandoffGateway(grants, new StubStepUp());
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));
    const up = await openUpgrade(host, port, ROUTE_PATH, "someone-elses-token");
    expect(up.firstChunk).toMatch(/403/);
    expect(up.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
  });

  it("an EXPIRED grant upgrade is REFUSED at the edge", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const grants = new StubSessionGrants();
    grants.invalidReason = "auth.expired";
    const { host, port, gateway, close } = await bootHandoffGateway(grants, new StubStepUp());
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));
    const up = await openUpgrade(host, port, ROUTE_PATH, "expired-token");
    expect(up.firstChunk).toMatch(/403/);
  });

  it("revoke (force-close the grant) SEVERS the live WS and the surface is unreachable (GLA-039 AC#3)", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));
    await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });

    const up = await openUpgrade(host, port, ROUTE_PATH, "valid");
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");

    // Now REVOKE: force-close the grant → the live socket is severed. In the real close path the grant is ALSO
    // revoked cryptographically (closeHandoff force-closes AND revokes), so mirror that here — a revoked grant fails
    // the stateless verify before any reuse can re-authorize it.
    gateway.forceCloseGrant(GRANT_ID);
    grants.invalidReason = "auth.revoked";
    grants.validToken = "REVOKED-no-token-matches"; // the grant no longer verifies (revoked)
    await up.closed; // the proxied client socket is closed by the gateway
    expect(up.socket.destroyed).toBe(true);

    // And the grant is no longer authorized — a fresh upgrade is refused (unreachable). A REVOKED grant fails the
    // stateless verify, so even recipient-auth REUSE (GLA-050/051) cannot re-authorize it (reuse never bypasses the
    // grant check).
    expect(gateway.isGrantAuthorized(GRANT_ID)).toBe(false);
    const again = await openUpgrade(host, port, ROUTE_PATH, "valid");
    expect(again.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
  });

  it("UNMOUNT makes the route unreachable and force-closes the live WS (GLA-039 AC#2/#3)", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));
    await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    const up = await openUpgrade(host, port, ROUTE_PATH, "valid");
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");

    // Unmount the route → the live WS is force-closed AND the path is no longer reachable.
    await gateway.unmount("route_1" as RouteId);
    await up.closed;
    expect(up.socket.destroyed).toBe(true);
    const res = await fetch(`${base}${ROUTE_PATH}?grant=valid`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe("auth.revoked");

    const noGrant = await fetch(`${base}${ROUTE_PATH}`);
    expect(noGrant.status).toBe(404);
    expect(((await noGrant.json()) as { error?: { code?: string } }).error?.code).toBe(
      "catalog.unknown",
    );

    const garbageGrant = await fetch(`${base}${ROUTE_PATH}?grant=garbage-token`);
    expect(garbageGrant.status).toBe(404);
    expect(((await garbageGrant.json()) as { error?: { code?: string } }).error?.code).toBe(
      "catalog.unknown",
    );

    grants.invalidReasons.set("cross-route-expired", "auth.expired");
    grants.routeProofScopes.set("cross-route-expired", "/handoff/other-session");
    const crossRouteExpired = await fetch(`${base}${ROUTE_PATH}?grant=cross-route-expired`);
    expect(crossRouteExpired.status).toBe(404);
    expect(((await crossRouteExpired.json()) as { error?: { code?: string } }).error?.code).toBe(
      "catalog.unknown",
    );

    grants.invalidReasons.set("cross-route-revoked", "auth.revoked");
    grants.routeProofScopes.set("cross-route-revoked", "/handoff/other-session");
    const crossRouteRevoked = await fetch(`${base}${ROUTE_PATH}?grant=cross-route-revoked`);
    expect(crossRouteRevoked.status).toBe(404);
    expect(((await crossRouteRevoked.json()) as { error?: { code?: string } }).error?.code).toBe(
      "catalog.unknown",
    );

    const options = await fetch(`${base}/handoff/auth/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH }),
    });
    expect(options.status).toBe(403);
    expect(((await options.json()) as { error?: { code?: string } }).error?.code).toBe(
      "auth.revoked",
    );

    const garbageOptions = await fetch(`${base}/handoff/auth/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "garbage-token", path: ROUTE_PATH }),
    });
    expect(garbageOptions.status).toBe(400);
    expect(((await garbageOptions.json()) as { error?: { code?: string } }).error?.code).toBe(
      "usage.bad_argument",
    );

    const verify = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(verify.status).toBe(403);
    expect(((await verify.json()) as { error?: { code?: string } }).error?.code).toBe(
      "auth.revoked",
    );

    const staleUpgrade = await openUpgrade(host, port, ROUTE_PATH, "valid");
    expect(staleUpgrade.firstChunk).toMatch(/403/);
    expect(staleUpgrade.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
    expect(gateway.liveSocketCount(GRANT_ID)).toBe(0);

    const garbageUpgrade = await openUpgrade(host, port, ROUTE_PATH, "garbage-token");
    expect(garbageUpgrade.firstChunk).toMatch(/404/);
    expect(garbageUpgrade.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
  });

  it("the gateway proxies to the capsule endpoint and NOTHING else (a different mounted endpoint is not reachable)", async () => {
    // Two upstreams; only the mounted one is reachable through the route.
    const capsule = await startStubUpstream();
    closers.push(capsule.close);
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(mountReq(capsule.endpoint));
    await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    // A path that is not a mounted route is 404 (no arbitrary proxy target reachable).
    const res = await fetch(`${base}/handoff/elsewhere?grant=valid`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe(
      "catalog.unknown",
    );
    // The mounted route reaches exactly the capsule endpoint.
    const up = await openUpgrade(host, port, ROUTE_PATH, "valid");
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
    up.socket.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WS-proxy timeouts — a stalled upstream cannot pin gateway fds (defense-in-depth at the crown-jewel surface)
// ─────────────────────────────────────────────────────────────────────────────

/** Authorize the grant (step-up decision) so a subsequent WS upgrade is forwarded. */
async function authorizeGrant(base: string): Promise<void> {
  const res = await fetch(`${base}/handoff/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant: "valid", path: ROUTE_PATH, assertion: { fake: true } }),
  });
  expect(res.status).toBe(200);
}

describe("Access Gateway — WS-proxy timeouts reap a stalled upstream (no fd leak)", () => {
  it("a STALLED upstream (accepts then never sends) is force-closed + UNTRACKED after the idle timeout", async () => {
    const upstream = await startSilentUpstream();
    closers.push(upstream.close);
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    // A short idle timeout; the connect completes (the upstream accepts), then nothing flows → idle reap.
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp, {
      proxyConnectTimeoutMs: 1000,
      proxyIdleTimeoutMs: 150,
    });
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));
    await authorizeGrant(base);

    // The upgrade connects to the silent upstream; the proxy pair is tracked.
    const up = await openUpgrade(host, port, ROUTE_PATH, "valid");
    // The silent upstream completed the 101 but sent no hello — the proxied client may see the 101 line only.
    expect(up.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
    expect(gateway.liveSocketCount(GRANT_ID)).toBeGreaterThan(0);

    // After the idle window, BOTH sockets are destroyed AND untracked (no fd leak).
    await up.closed;
    expect(up.socket.destroyed).toBe(true);
    expect(gateway.liveSocketCount(GRANT_ID)).toBe(0);
  });

  it("a non-completing CONNECT (black-hole dial) is abandoned (502) and the pair is reaped after the connect timeout", async () => {
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    // A short connect timeout; the dial targets a non-routable address that never completes the TCP connect.
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp, {
      proxyConnectTimeoutMs: 200,
      proxyIdleTimeoutMs: 0,
    });
    closers.push(close);
    await gateway.mount(mountReq(blackholeEndpoint()));
    await authorizeGrant(base);

    const up = await openUpgrade(host, port, ROUTE_PATH, "valid");
    // The connect timed out → the client upgrade is refused 502 and the upstream socket is reaped (no fd leak).
    expect(up.firstChunk).toMatch(/502/);
    expect(up.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
    await up.closed;
    expect(gateway.liveSocketCount(GRANT_ID)).toBe(0);
  });

  it("a LIVE stream is NOT killed by the idle timeout while bytes flow", async () => {
    const upstream = await startStubUpstream(); // the echoing upstream
    closers.push(upstream.close);
    const grants = new StubSessionGrants();
    const stepUp = new StubStepUp();
    const idleMs = 120;
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp, {
      proxyConnectTimeoutMs: 1000,
      proxyIdleTimeoutMs: idleMs,
    });
    closers.push(close);
    await gateway.mount(mountReq(upstream.endpoint));
    await authorizeGrant(base);

    const up = await openUpgrade(host, port, ROUTE_PATH, "valid");
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");

    // Keep the stream active across MORE than one idle interval: send a byte every idleMs/2, three times. The idle
    // timeout refreshes on each byte, so the socket must STILL be alive after > 2× idleMs of (active) elapsed time.
    for (let i = 0; i < 3; i++) {
      up.socket.write(`PING${i}`);
      await new Promise((r) => {
        const t = setTimeout(r, Math.floor(idleMs / 2));
        (t as { unref?: () => void }).unref?.();
      });
      expect(up.socket.destroyed).toBe(false); // not reaped while bytes flow
    }
    expect(gateway.liveSocketCount(GRANT_ID)).toBeGreaterThan(0);
    up.socket.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH REUSE on a second window (GLA-050/051, scenario-01 Phase 12) — "auth still valid, no re-prompt"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A multi-grant stub: each call resolves the bound recipient by TOKEN, so a test can model TWO distinct grants
 * (window-1's grant-1 + window-2's grant-2) for the SAME recipient. A token not in the map fails to verify. This is
 * what proves reuse is RECIPIENT-keyed (window-2's grant is a different token/id, yet the same recipient reuses).
 */
class MultiGrantStub implements SessionGrantPort {
  // token → { grantId, recipient }. Two grants for the same recipient model the two windows.
  readonly byToken = new Map<string, { grantId: CapabilityId; recipient: RecipientRef }>([
    ["grant1", { grantId: "cap_grant1" as CapabilityId, recipient }],
    ["grant2", { grantId: "cap_grant2" as CapabilityId, recipient }],
  ]);
  invalidReason: ErrorCode = "auth.malformed";
  verifySessionGrantToken(
    token: OpaqueToken,
    _args: { scopePath: string; now?: string },
  ): SessionGrantVerifyResult {
    const g = this.byToken.get(String(token));
    if (g === undefined) {
      return { ok: false, reason: this.invalidReason };
    }
    return {
      ok: true,
      capability: { id: g.grantId, cls: "session", caveats: [] },
      recipient: g.recipient,
    };
  }
}

describe("Access Gateway — auth reuse on a second window (GLA-050/051)", () => {
  const GRANT2 = "cap_grant2" as CapabilityId;

  it("a SECOND window's grant for the SAME recipient reuses the prior step-up — the WS upgrade proxies with NO fresh ceremony", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const grants = new MultiGrantStub();
    const stepUp = new StubStepUp();
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);

    // ── Window 1: mount grant-1's route + STEP UP (the one and only WebAuthn ceremony). ──
    await gateway.mount(
      mountReq(upstream.endpoint, { boundGrantId: "cap_grant1" as CapabilityId }),
    );
    const verRes = await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "grant1", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(verRes.status).toBe(200);
    expect(stepUp.verifyCalls).toBe(1);
    expect(gateway.isRecipientAuthValid(recipient)).toBe(true); // the recipient's auth is now recorded

    // ── Window 2: a NEW grant (grant-2) for the SAME recipient, on the same route (re-opened window). ──
    await gateway.mount(mountReq(upstream.endpoint, { boundGrantId: GRANT2 }));

    // The handoff PAGE for window-2 must NOT prompt — it serves the reused-auth page (opens straight away) and
    // authorizes grant-2 without a ceremony. (The page body proves there is no "Verify with passkey" button.)
    const pageRes = await fetch(`${base}${ROUTE_PATH}?grant=grant2`);
    expect(pageRes.status).toBe(200);
    const pageHtml = await pageRes.text();
    expect(pageHtml).toContain("already verified"); // the reused-auth page copy
    expect(pageHtml).not.toContain("Verify with passkey"); // NO step-up prompt
    expect(gateway.isGrantAuthorized(GRANT2)).toBe(true); // grant-2 authorized by REUSE

    // And the WS upgrade with grant-2 is PROXIED to the capsule — with NO additional step-up (verifyCalls unchanged).
    const up = await openUpgrade(host, port, ROUTE_PATH, "grant2");
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
    expect(stepUp.verifyCalls).toBe(1); // STILL 1 — the second window invoked NO WebAuthn ceremony
    up.socket.destroy();
  });

  it("a second window's WS upgrade reuses auth EVEN without first fetching the page (the upgrade itself authorizes by reuse)", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const grants = new MultiGrantStub();
    const stepUp = new StubStepUp();
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(
      mountReq(upstream.endpoint, { boundGrantId: "cap_grant1" as CapabilityId }),
    );
    await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "grant1", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(stepUp.verifyCalls).toBe(1);

    // Re-open with grant-2 and go STRAIGHT to the WS upgrade (no page fetch). The upgrade itself reuses the
    // recipient's still-valid auth and proxies — without a fresh step-up.
    await gateway.mount(mountReq(upstream.endpoint, { boundGrantId: GRANT2 }));
    const up = await openUpgrade(host, port, ROUTE_PATH, "grant2");
    expect(up.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
    expect(stepUp.verifyCalls).toBe(1);
    up.socket.destroy();
  });

  it("an EXPIRED auth re-prompts (TTL-bounded) — the second window serves the step-up page, NOT the reused page", async () => {
    const grants = new MultiGrantStub();
    const stepUp = new StubStepUp();
    // A 1ms reuse TTL so the recorded auth expires before the second window.
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp, {
      authReuseTtlMs: 1,
    });
    closers.push(close);
    await gateway.mount(
      mountReq("ws://127.0.0.1:1/", { boundGrantId: "cap_grant1" as CapabilityId }),
    );
    await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "grant1", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    // Wait past the 1ms TTL.
    await new Promise((r) => {
      const t = setTimeout(r, 25);
      (t as { unref?: () => void }).unref?.();
    });
    expect(gateway.isRecipientAuthValid(recipient)).toBe(false); // expired → no reuse

    // The second window's page must be the FULL step-up page (re-prompt), not the reused-auth page.
    await gateway.mount(mountReq("ws://127.0.0.1:1/", { boundGrantId: GRANT2 }));
    const pageRes = await fetch(`${base}${ROUTE_PATH}?grant=grant2`);
    const pageHtml = await pageRes.text();
    expect(pageHtml).toContain("Verify with passkey"); // RE-PROMPT (Phase 6 behaviour)
    expect(pageHtml).not.toContain("already verified");
    expect(gateway.isGrantAuthorized(GRANT2)).toBe(false); // NOT authorized — a step-up is required
  });

  it("reuse is RECIPIENT-CONFINED — a DIFFERENT recipient's grant does NOT reuse; it re-prompts", async () => {
    const grants = new MultiGrantStub();
    // grant-2 here is bound to a DIFFERENT recipient than grant-1 (who stepped up).
    const other = "tg:user:999" as RecipientRef;
    grants.byToken.set("grant2", { grantId: GRANT2, recipient: other });
    const stepUp = new StubStepUp();
    stepUp.enrolled.add(other); // the other recipient is enrolled (so the page is reached, not a not-enrolled refusal)
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(
      mountReq("ws://127.0.0.1:1/", { boundGrantId: "cap_grant1" as CapabilityId }),
    );
    // recipient (user:123) steps up.
    await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "grant1", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(gateway.isRecipientAuthValid(recipient)).toBe(true);
    expect(gateway.isRecipientAuthValid(other)).toBe(false); // the OTHER recipient never authenticated

    // grant-2 is bound to `other` — the page must RE-PROMPT (no reuse leaks across recipients).
    await gateway.mount(mountReq("ws://127.0.0.1:1/", { boundGrantId: GRANT2 }));
    const pageRes = await fetch(`${base}${ROUTE_PATH}?grant=grant2`);
    const pageHtml = await pageRes.text();
    expect(pageHtml).toContain("Verify with passkey"); // a different recipient must step up
    expect(pageHtml).not.toContain("already verified");
    expect(gateway.isGrantAuthorized(GRANT2)).toBe(false);
  });

  it("reuse NEVER bypasses the grant check — an INVALID/forged grant for an already-authenticated recipient is refused", async () => {
    const upstream = await startStubUpstream();
    closers.push(upstream.close);
    const grants = new MultiGrantStub();
    const stepUp = new StubStepUp();
    const { base, host, port, gateway, close } = await bootHandoffGateway(grants, stepUp);
    closers.push(close);
    await gateway.mount(
      mountReq(upstream.endpoint, { boundGrantId: "cap_grant1" as CapabilityId }),
    );
    await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "grant1", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(gateway.isRecipientAuthValid(recipient)).toBe(true);

    // A FORGED grant (not in the stub's token map → fails verify) cannot ride the recipient's valid auth: the WS
    // upgrade is refused BEFORE any reuse, because the grant itself does not verify (reuse is gated on a verified
    // grant whose SIGNED recipient is the one with valid auth).
    const up = await openUpgrade(host, port, ROUTE_PATH, "forged-token");
    expect(up.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
    // And the page for a forged grant is the refusal page (not the reused-auth page).
    const pageRes = await fetch(`${base}${ROUTE_PATH}?grant=forged-token`);
    expect(pageRes.status).toBe(403);
  });

  it("reuse DISABLED (authReuseTtlMs=0) always re-prompts — even the same recipient's second window steps up again", async () => {
    const grants = new MultiGrantStub();
    const stepUp = new StubStepUp();
    const { base, gateway, close } = await bootHandoffGateway(grants, stepUp, {
      authReuseTtlMs: 0,
    });
    closers.push(close);
    await gateway.mount(
      mountReq("ws://127.0.0.1:1/", { boundGrantId: "cap_grant1" as CapabilityId }),
    );
    await fetch(`${base}/handoff/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: "grant1", path: ROUTE_PATH, assertion: { fake: true } }),
    });
    expect(gateway.isRecipientAuthValid(recipient)).toBe(false); // reuse disabled → nothing recorded

    await gateway.mount(mountReq("ws://127.0.0.1:1/", { boundGrantId: GRANT2 }));
    const pageRes = await fetch(`${base}${ROUTE_PATH}?grant=grant2`);
    const pageHtml = await pageRes.text();
    expect(pageHtml).toContain("Verify with passkey"); // always re-prompt when reuse is off
    expect(gateway.isGrantAuthorized(GRANT2)).toBe(false);
  });
});
