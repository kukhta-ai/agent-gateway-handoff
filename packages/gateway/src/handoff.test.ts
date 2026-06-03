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

import { type Server, createServer } from "node:http";
import { type AddressInfo, type Socket, connect as netConnect } from "node:net";
import type {
  AuthStrength,
  CapabilityId,
  ErrorCode,
  OpaqueToken,
  RecipientRef,
  RouteId,
  SessionId,
} from "@gla/kernel";
import { afterEach, describe, expect, it } from "vitest";
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

/**
 * A stub handoff-grant seam: a `valid` token verifies (reporting `recipient` + the grant id); anything else fails
 * with the configured reason. The grant id lets a test authorize/revoke it.
 */
class StubSessionGrants implements SessionGrantPort {
  validToken = "valid";
  grantId: CapabilityId = GRANT_ID;
  boundRecipient: RecipientRef = recipient;
  invalidReason: ErrorCode = "auth.malformed";
  cls: "session" | "task" = "session";

  verifySessionGrantToken(
    token: OpaqueToken,
    _args: { scopePath: string; now?: string },
  ): SessionGrantVerifyResult {
    if (token !== this.validToken) {
      return { ok: false, reason: this.invalidReason };
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
  ): Promise<{ ok: boolean; authStrength: AuthStrength; userId: string }> {
    this.verifyCalls++;
    return { ok: this.verifyOk, authStrength: this.reportedStrength, userId: `user:${r}` };
  }
}

/** A stub WebSocket upstream: a raw TCP server that completes the WS handshake and echoes a marker, then echoes. */
function startStubUpstream(): Promise<{
  endpoint: string;
  close: () => Promise<void>;
  server: Server;
}> {
  return new Promise((resolve) => {
    // Use a bare net server so we can complete the upgrade handshake ourselves (no `ws` dependency).
    const server = createServer();
    server.on("upgrade", (_req, socket, _head) => {
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
  grants: StubSessionGrants,
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

function mountReq(endpoint: string, overrides: Partial<RouteMountRequest> = {}): RouteMountRequest {
  return {
    routeId: "route_1" as RouteId,
    path: ROUTE_PATH,
    internalEndpoint: endpoint,
    boundGrantId: GRANT_ID,
    sessionId: SESS,
    ...overrides,
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
): Promise<{ firstChunk: string; socket: Socket; closed: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host, port }, () => {
      const target = `${path}?grant=${encodeURIComponent(grant)}`;
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
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
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toMatch(/Verify with passkey/);
    expect(html).toMatch(/navigator\.credentials\.get/);
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

  it("a request to an UNMOUNTED path → 404 (reachable only within an open window — GLA-039 AC#2)", async () => {
    const { base, close } = await bootHandoffGateway(new StubSessionGrants(), new StubStepUp());
    closers.push(close);
    // No route mounted: the path is not publicly reachable.
    const res = await fetch(`${base}${ROUTE_PATH}?grant=valid`);
    expect(res.status).toBe(404);
  });

  it("EXPIRED grant → 403 refusal page", async () => {
    const grants = new StubSessionGrants();
    grants.invalidReason = "auth.expired";
    const { base, gateway, close } = await bootHandoffGateway(grants, new StubStepUp());
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}${ROUTE_PATH}?grant=expired-token`);
    expect(res.status).toBe(403);
  });

  it("REVOKED grant → 403 refusal page", async () => {
    const grants = new StubSessionGrants();
    grants.invalidReason = "auth.revoked";
    const { base, gateway, close } = await bootHandoffGateway(grants, new StubStepUp());
    closers.push(close);
    await gateway.mount(mountReq("ws://127.0.0.1:1/"));
    const res = await fetch(`${base}${ROUTE_PATH}?grant=revoked-token`);
    expect(res.status).toBe(403);
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
    expect(up.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
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

    // Now REVOKE: force-close the grant → the live socket is severed.
    gateway.forceCloseGrant(GRANT_ID);
    await up.closed; // the proxied client socket is closed by the gateway
    expect(up.socket.destroyed).toBe(true);

    // And the grant is no longer authorized — a fresh upgrade is refused (unreachable).
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
    expect(res.status).toBe(404);
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
