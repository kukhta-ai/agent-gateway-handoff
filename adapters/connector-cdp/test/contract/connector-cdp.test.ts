// CONTRACT tests for the CDP Agent-Connector adapter (adapters/connector-cdp, GLA-024/025, GLA-040/041).
// attach → { type:"cdp", cdp_url, secret_ref } where cdp_url points at the GLA-side CDP BROKER (tunnelled, never a
// direct socket to Chromium). AGENT-BLIND: the secret_ref is a capability REFERENCE (bound by the session saga), never
// a raw secret/signing key. The S-2 SEVERANCE: suspend DESTROYS a live agent↔broker socket (proven against a stub CDP
// upstream); resume re-allows. A handle with no CDP endpoint → state.no_live_capsule.

import { createHash } from "node:crypto";
import { createServer as createHttp } from "node:http";
import { type AddressInfo, type Socket, connect as netConnect } from "node:net";
import { type Ref, type RuntimeHandle, encodeRuntimeHandle } from "@gla/kernel";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectorCdpAdapter } from "../../src/index.js";

function runtimeWithCdp(url: string): RuntimeHandle {
  return encodeRuntimeHandle({
    launchMode: "headless",
    endpoints: [
      {
        resourceId: "connector:cdp:test",
        family: "agent-connector",
        provider: "cdp",
        transport: "websocket",
        address: url,
      },
    ],
    cdpPort: 9,
  });
}

const FAKE_SECRET_REF = "cap_connector_abc" as unknown as Ref<"secret-ref">;

const adapters: ConnectorCdpAdapter[] = [];
const stubClosers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const a of adapters.splice(0)) {
    await a.close().catch(() => {});
  }
  for (const c of stubClosers.splice(0)) {
    await c().catch(() => {});
  }
});

function newAdapter(
  opts?: ConstructorParameters<typeof ConnectorCdpAdapter>[0],
): ConnectorCdpAdapter {
  const a = new ConnectorCdpAdapter(opts);
  adapters.push(a);
  return a;
}

describe("ConnectorCdpAdapter.attach — the agent's BROKERED CDP handle (GLA-024/025/040/041)", () => {
  it("returns {type:cdp, cdp_url} where cdp_url points at the GLA BROKER (not directly at Chromium)", async () => {
    const c = newAdapter();
    const realUrl = "ws://127.0.0.1:42799/devtools/browser/abc-123";
    const connector = await c.attach(runtimeWithCdp(realUrl));
    expect(connector.type).toBe("cdp");
    expect(connector.resourceId).toBe("connector:cdp:test");
    // The agent's cdp_url is the BROKERED url — a loopback broker port, the SAME CDP path, NOT the real Chromium port.
    expect(connector.cdp_url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/abc-123$/);
    expect(connector.cdp_url).not.toBe(realUrl);
    expect(connector.cdp_url).not.toContain(":42799"); // never the real Chromium port
  });

  it("AGENT-BLIND: a bound secret_ref is a capability REFERENCE on the connector, never a raw secret", async () => {
    const c = newAdapter();
    const realUrl = "ws://127.0.0.1:42799/devtools/browser/abc-123";
    // First attach to learn the (stable) brokered url, then bind the secret_ref against it, then re-attach.
    const first = await c.attach(runtimeWithCdp(realUrl));
    c.bindSecretRef(first.resourceId, FAKE_SECRET_REF);
    const connector = await c.attach(runtimeWithCdp(realUrl));
    expect(connector.secret_ref).toBe(FAKE_SECRET_REF);
    // SCAN the connector JSON: it carries a secret_ref (a cap ref) and NO raw secret / signing material.
    const json = JSON.stringify(connector);
    expect(json).toContain("secret_ref");
    expect(String(connector.secret_ref)).toMatch(/^cap_/);
    expect(json).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    expect(json.toLowerCase()).not.toContain("signing");
    expect(json.toLowerCase()).not.toContain("hmac");
  });

  it("without a bound ref, the connector still returns the brokered CDP url (secret_ref omitted)", async () => {
    const c = newAdapter();
    const connector = await c.attach(
      runtimeWithCdp("ws://127.0.0.1:42799/devtools/browser/abc-123"),
    );
    expect(connector.cdp_url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//);
    expect(connector.secret_ref).toBeUndefined();
  });

  it("the brokered cdp_url is STABLE across re-attach and across suspend/resume", async () => {
    const c = newAdapter();
    const realUrl = "ws://127.0.0.1:42799/devtools/browser/abc-123";
    const a = await c.attach(runtimeWithCdp(realUrl));
    c.suspendByCdpUrl(a.cdp_url as string);
    const b = await c.attach(runtimeWithCdp(realUrl));
    c.resumeByCdpUrl(a.cdp_url as string);
    const d = await c.attach(runtimeWithCdp(realUrl));
    expect(b.cdp_url).toBe(a.cdp_url); // same url while suspended
    expect(d.cdp_url).toBe(a.cdp_url); // same url after resume — the agent re-attaches onto the SAME url
  });

  it("unbindSecretRef drops the ref (teardown); a re-attach then omits it", async () => {
    const c = newAdapter();
    const realUrl = "ws://127.0.0.1:42799/devtools/browser/abc-123";
    const first = await c.attach(runtimeWithCdp(realUrl));
    c.bindSecretRef(first.resourceId, FAKE_SECRET_REF);
    expect((await c.attach(runtimeWithCdp(realUrl))).secret_ref).toBe(FAKE_SECRET_REF);
    c.unbindSecretRef(first.resourceId);
    expect((await c.attach(runtimeWithCdp(realUrl))).secret_ref).toBeUndefined();
  });

  it("a runtime handle with no CDP endpoint → state.no_live_capsule (not a crash)", async () => {
    const c = newAdapter();
    const noCdp = encodeRuntimeHandle({ launchMode: "headless" });
    await expect(c.attach(noCdp)).rejects.toMatchObject({ code: "state.no_live_capsule" });
    await expect(c.attach("garbage" as unknown as RuntimeHandle)).rejects.toMatchObject({
      code: "state.no_live_capsule",
    });
  });

  it("a custom secretRefFor resolver is honored (the saga can wire its own lookup)", async () => {
    const c = newAdapter({ secretRefFor: () => FAKE_SECRET_REF });
    expect(
      (await c.attach(runtimeWithCdp("ws://127.0.0.1:42799/devtools/browser/abc-123"))).secret_ref,
    ).toBe(FAKE_SECRET_REF);
  });
});

// ── The S-2 SEVERANCE — a live agent socket is CUT the instant a window opens (against a stub CDP upstream) ──

/**
 * A stub "Chromium CDP" upstream: a node:http server that accepts a WS upgrade and stays open, standing in for
 * Chromium's CDP endpoint so the broker has a real upstream to forward to. Returns its `webSocketDebuggerUrl`.
 */
async function startStubCdpUpstream(): Promise<{ wsUrl: string; close: () => Promise<void> }> {
  const server = createHttp();
  const liveUpstreams: Socket[] = [];
  server.on("upgrade", (req, socket) => {
    const key = (req.headers["sec-websocket-key"] as string | undefined) ?? "x";
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    liveUpstreams.push(socket as Socket);
    (socket as Socket).on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    wsUrl: `ws://127.0.0.1:${port}/devtools/browser/stub-1`,
    close: () =>
      new Promise<void>((r) => {
        for (const s of liveUpstreams) {
          s.destroy();
        }
        (server as { closeAllConnections?: () => void }).closeAllConnections?.();
        const t = setTimeout(() => r(), 100);
        t.unref?.();
        server.close(() => r());
      }),
  };
}

/** Open a raw WS upgrade to a brokered cdp_url; resolves once the handshake response arrives, with the live socket. */
function openBrokeredUpgrade(
  cdpUrl: string,
): Promise<{ socket: Socket; firstChunk: string; closed: Promise<void> }> {
  const u = new URL(cdpUrl.replace(/^ws:/, "http:"));
  const host = u.hostname;
  const port = Number(u.port);
  const path = `${u.pathname}${u.search}`;
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host, port }, () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let firstChunk = "";
    let resolved = false;
    let closeResolve: () => void = () => {};
    const closed = new Promise<void>((r) => {
      closeResolve = r;
    });
    socket.on("data", (c) => {
      firstChunk += (c as Buffer).toString("utf8");
      if (!resolved) {
        resolved = true;
        resolve({ socket, firstChunk, closed });
      }
    });
    socket.on("close", () => {
      if (!resolved) {
        resolved = true;
        resolve({ socket, firstChunk, closed });
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

describe("ConnectorCdpAdapter — S-2 SEVERANCE: suspend CUTS a live agent CDP socket (GLA-040/041)", () => {
  it("an agent's ALREADY-OPEN brokered CDP socket is DESTROYED the instant a window opens (suspend)", async () => {
    const upstream = await startStubCdpUpstream();
    stubClosers.push(upstream.close);
    const c = newAdapter();
    const connector = await c.attach(runtimeWithCdp(upstream.wsUrl));
    const brokeredUrl = connector.cdp_url as string;

    // The agent opens its CDP connection BEFORE any window (Phase 4) — the WS upgrade is proxied to the stub upstream.
    const up = await openBrokeredUpgrade(brokeredUrl);
    expect(up.firstChunk).toContain("101 Switching Protocols");
    expect(c.liveSocketCount(brokeredUrl)).toBeGreaterThan(0); // the agent has a LIVE brokered socket

    // ── A recipient-bound window OPENS → suspend → the agent's EXISTING socket is SEVERED this instant (not merely
    //    a refused re-attach). The agent cannot read the capsule while the human enters a secret.
    c.suspendByCdpUrl(brokeredUrl);
    await up.closed; // the live socket the agent held is closed
    expect(up.socket.destroyed).toBe(true);
    expect(c.liveSocketCount(brokeredUrl)).toBe(0);

    // A FRESH connection while suspended is ALSO refused (no new channel onto the capsule).
    const refused = await openBrokeredUpgrade(brokeredUrl);
    expect(refused.firstChunk).not.toContain("101 Switching Protocols");

    // ── The window CLOSES → resume → the agent re-attaches onto the SAME brokered url and drives again (Phase 9). ──
    c.resumeByCdpUrl(brokeredUrl);
    const again = await openBrokeredUpgrade(brokeredUrl);
    expect(again.firstChunk).toContain("101 Switching Protocols");
    again.socket.destroy();
  });
});
