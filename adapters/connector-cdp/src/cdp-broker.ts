// @gla/connector-cdp — the GLA-side CDP BROKER (the S-2 agent-blind severance, GLA-040/041).
//
// The agent's CDP connector must be TUNNELLED THROUGH GLA — never a direct socket to Chromium — so a recipient-bound
// handoff window can TRULY SEVER the agent's live connection the instant it opens (not merely refuse a fresh attach).
// This resolves the docs/05 §7 "connector brokering" open question in favour of TUNNELLING, which is exactly what
// agent-blind requires: while the human enters a secret over noVNC, the agent has NO live channel onto the capsule.
//
// The broker is a tiny local forwarder (the same `node:net` raw-pipe pattern the Access Gateway's WS proxy uses,
// `packages/gateway`): it binds 127.0.0.1:<brokerPort> ONLY and forwards both plain HTTP CDP requests (`/json*`) and
// the CDP WebSocket upgrade to Chromium's REAL endpoint at `127.0.0.1:<cdpPort>`. The agent connects to the BROKER's
// `ws://127.0.0.1:<brokerPort>/devtools/browser/<id>`, never directly to Chromium.
//
//   - `suspend(capsuleId)` DESTROYS every live agent↔broker (and broker↔Chromium) socket for that capsule — like the
//     gateway's `forceCloseGrant` — AND blocks new connections, so the agent's EXISTING connection is cut.
//   - `resume(capsuleId)` re-allows connections; the agent re-attaches onto the SAME brokered `cdp_url` after close.
//
// Boundary: this file depends ONLY on Node builtins (`node:http`, `node:net`) — no adapter import, no third-party
// dependency (the same dependency-frugality as the gateway's raw-WS proxy). It carries NO secret — it forwards bytes.

import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { type AddressInfo, type Socket, connect as netConnect } from "node:net";

/** The address the broker exposes to the agent + the real Chromium endpoint it forwards to, for one capsule. */
export interface BrokeredEndpoint {
  /** The capsule id this brokered endpoint is for (the suspend/resume key). */
  capsuleId: string;
  /** The agent-facing CDP WebSocket url, pointing at the broker (stable across suspend/resume). */
  brokeredCdpUrl: string;
  /** The real Chromium CDP host (always 127.0.0.1). */
  upstreamHost: string;
  /** The real Chromium CDP port. */
  upstreamPort: number;
}

/** Parse a `ws://host:port/path` (or `http://…`) CDP url into `{ host, port, path }`, or undefined if malformed. */
function parseCdpUrl(url: string): { host: string; port: number; path: string } | undefined {
  try {
    const normalized = url.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
    const u = new URL(normalized);
    const port = u.port.length > 0 ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    if (!Number.isInteger(port) || port <= 0) {
      return undefined;
    }
    return { host: u.hostname, port, path: `${u.pathname}${u.search}` };
  } catch {
    return undefined;
  }
}

/**
 * The GLA-side CDP broker (one server fronting many capsules). The agent connects to a per-capsule brokered url; the
 * broker forwards to that capsule's real Chromium CDP endpoint, tracking every live socket per capsule so `suspend`
 * can sever them. Bound to 127.0.0.1 only (baseline §3: nothing but the gateway is on 0.0.0.0).
 */
export class CdpBroker {
  private server: Server | undefined;
  private host = "127.0.0.1";
  private port = 0;
  /** Registered capsules, by id → the real Chromium endpoint to forward to. */
  private readonly capsules = new Map<string, { upstreamHost: string; upstreamPort: number }>();
  /** Capsules whose CDP is currently SUSPENDED (a window is open) — new connections refused. */
  private readonly suspended = new Set<string>();
  /** Live forwarded sockets per capsule id, so `suspend` can sever the agent's existing connection. */
  private readonly liveSockets = new Map<string, Set<Socket>>();
  /** Map a brokered request path's `devtools/browser/<id>` → the capsule id, so an upgrade resolves its upstream. */
  private readonly pathToCapsule = new Map<string, string>();

  /** Start the broker listening on 127.0.0.1:<ephemeral>. Idempotent (a second call returns the bound address). */
  async listen(): Promise<{ host: string; port: number }> {
    if (this.server !== undefined) {
      return { host: this.host, port: this.port };
    }
    const server = createServer((req, res) => this.handleHttp(req, res));
    server.on("upgrade", (req, socket) => this.handleUpgrade(req, socket as Socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, this.host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    this.port = (server.address() as AddressInfo).port;
    return { host: this.host, port: this.port };
  }

  /**
   * Register a capsule (under a stable caller-supplied `capsuleId`) with its real Chromium CDP url, and return its
   * agent-facing BROKERED url (pointing at this broker, preserving the CDP path so a client given the ws url and one
   * that reads `/json` both resolve). The agent connects to the brokered url; the broker forwards to Chromium. The
   * `capsuleId` is the suspend/resume + sever key; the brokered url is stable across suspend/resume. Idempotent — a
   * re-register of the same capsule returns the same brokered url.
   */
  register(capsuleId: string, realCdpWebSocketUrl: string): BrokeredEndpoint {
    const parsed = parseCdpUrl(realCdpWebSocketUrl);
    if (parsed === undefined) {
      throw new Error(`cdp-broker: cannot parse real CDP url "${realCdpWebSocketUrl}"`);
    }
    this.capsules.set(capsuleId, { upstreamHost: parsed.host, upstreamPort: parsed.port });
    // Map the CDP path (e.g. /devtools/browser/<id>) → this capsule, so a brokered upgrade/HTTP request resolves the
    // upstream to forward to. The brokered path is the SAME CDP path, so the agent's client resolves it unchanged.
    this.pathToCapsule.set(parsed.path, capsuleId);
    const brokeredCdpUrl = `ws://${this.host}:${this.port}${parsed.path}`;
    return {
      capsuleId,
      brokeredCdpUrl,
      upstreamHost: parsed.host,
      upstreamPort: parsed.port,
    };
  }

  /** Forget a capsule (on teardown): drop its registration + sever any live sockets. Idempotent. */
  unregister(capsuleId: string): void {
    this.severCapsule(capsuleId);
    const cap = this.capsules.get(capsuleId);
    if (cap !== undefined) {
      this.capsules.delete(capsuleId);
    }
    this.suspended.delete(capsuleId);
    // Drop any path mappings that point at this capsule.
    for (const [path, id] of [...this.pathToCapsule.entries()]) {
      if (id === capsuleId) {
        this.pathToCapsule.delete(path);
      }
    }
  }

  /**
   * SUSPEND a capsule's CDP (a recipient-bound window opened) — the S-2 severance. DESTROYS every live agent↔broker
   * (and broker↔Chromium) socket for the capsule so the agent's EXISTING connection is cut THIS INSTANT, and blocks
   * new connections until {@link resume}. Idempotent.
   */
  suspend(capsuleId: string): void {
    this.suspended.add(capsuleId);
    this.severCapsule(capsuleId);
  }

  /** RESUME a capsule's CDP (the window closed) — re-allow connections; the agent re-attaches onto the SAME url. */
  resume(capsuleId: string): void {
    this.suspended.delete(capsuleId);
  }

  /** Is this capsule's CDP currently suspended (a window is open)? (For observability / the agent-blind test.) */
  isSuspended(capsuleId: string): boolean {
    return this.suspended.has(capsuleId);
  }

  /** The number of live forwarded sockets currently tracked for a capsule (0 after a sever). */
  liveSocketCount(capsuleId: string): number {
    return this.liveSockets.get(capsuleId)?.size ?? 0;
  }

  /** Stop the broker (idempotent): sever every live socket, then close the server. */
  async close(): Promise<void> {
    for (const id of [...this.liveSockets.keys()]) {
      this.severCapsule(id);
    }
    const server = this.server;
    if (server === undefined) {
      return;
    }
    const closeAll = (server as { closeAllConnections?: () => void }).closeAllConnections;
    if (typeof closeAll === "function") {
      closeAll.call(server);
    }
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      server.close(() => finish());
      const t = setTimeout(finish, 250);
      if (typeof t.unref === "function") {
        t.unref();
      }
    });
    this.server = undefined;
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────────────────

  /** Destroy every live socket tracked for a capsule and drop the set. The agent's existing connection is cut. */
  private severCapsule(capsuleId: string): void {
    const set = this.liveSockets.get(capsuleId);
    if (set !== undefined) {
      for (const s of set) {
        s.destroy();
      }
      this.liveSockets.delete(capsuleId);
    }
  }

  /** Resolve the capsule a request path belongs to (the registered CDP path), or undefined. */
  private capsuleForPath(path: string): string | undefined {
    // The CDP ws path is the registered one; a plain HTTP probe (`/json…`) is forwarded to the SINGLE capsule when
    // exactly one is registered (the common case), else by an exact path map.
    const exact = this.pathToCapsule.get(path);
    if (exact !== undefined) {
      return exact;
    }
    if (this.capsules.size === 1) {
      return [...this.capsules.keys()][0];
    }
    return undefined;
  }

  /**
   * Forward a plain HTTP CDP request (`GET /json/version`, `/json`, …) to the capsule's real Chromium endpoint and
   * pipe the response back, REWRITING any `webSocketDebuggerUrl` in a JSON body to point at the broker (so a client
   * that discovers the ws url via `/json` still connects through the broker, not directly to Chromium). A request for
   * a suspended/unknown capsule is refused.
   */
  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const path = req.url ?? "/";
    const capsuleId = this.capsuleForPath(path);
    if (capsuleId === undefined || this.suspended.has(capsuleId)) {
      res.writeHead(this.suspended.has(capsuleId ?? "") ? 409 : 404, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({ error: "cdp broker: unavailable" }));
      return;
    }
    const cap = this.capsules.get(capsuleId);
    if (cap === undefined) {
      res.writeHead(404).end();
      return;
    }
    // A small raw HTTP forward (CDP HTTP responses are tiny JSON). We rewrite the ws url in the body to the broker.
    const upstream = netConnect({ host: cap.upstreamHost, port: cap.upstreamPort }, () => {
      upstream.write(
        `${req.method ?? "GET"} ${path} HTTP/1.1\r\nHost: ${cap.upstreamHost}:${cap.upstreamPort}\r\nConnection: close\r\n\r\n`,
      );
    });
    const chunks: Buffer[] = [];
    upstream.on("data", (c) => chunks.push(c as Buffer));
    upstream.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const sep = raw.indexOf("\r\n\r\n");
      const body = sep >= 0 ? raw.slice(sep + 4) : raw;
      // Rewrite any ws://<chromium>/… to ws://<broker>/… so discovery stays brokered.
      const rewritten = body.replace(
        new RegExp(`ws://${cap.upstreamHost}:${cap.upstreamPort}`, "g"),
        `ws://${this.host}:${this.port}`,
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(rewritten);
    });
    upstream.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(502).end();
      }
    });
  }

  /**
   * Forward a CDP WebSocket upgrade to the capsule's real Chromium endpoint — the agent's live work channel, TUNNELLED
   * THROUGH GLA. Refuses a suspended/unknown capsule (so a window-open severance also blocks a fresh upgrade). On a
   * live forward it tracks both sockets per capsule so {@link suspend} can sever them. Reuses the gateway's raw-pipe
   * pattern: replay the upgrade request line + headers verbatim to Chromium (which computes Sec-WebSocket-Accept from
   * the agent's key), then pipe bytes both ways.
   */
  private handleUpgrade(req: IncomingMessage, clientSocket: Socket): void {
    const path = req.url ?? "/";
    const capsuleId = this.capsuleForPath(path);
    if (capsuleId === undefined || this.suspended.has(capsuleId)) {
      // A window is open (suspended) OR no such capsule — refuse; the agent's channel resolves onward to nothing.
      this.refuseUpgrade(clientSocket, this.suspended.has(capsuleId ?? "") ? 409 : 404);
      return;
    }
    const cap = this.capsules.get(capsuleId);
    if (cap === undefined) {
      this.refuseUpgrade(clientSocket, 404);
      return;
    }
    const upstream = netConnect({ host: cap.upstreamHost, port: cap.upstreamPort });
    this.trackSocket(capsuleId, clientSocket);
    this.trackSocket(capsuleId, upstream);

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      this.untrackSocket(capsuleId, clientSocket);
      this.untrackSocket(capsuleId, upstream);
      clientSocket.destroy();
      upstream.destroy();
    };

    upstream.on("connect", () => {
      // Replay the upgrade request line + headers verbatim (Chromium completes the WS handshake against the agent's
      // Sec-WebSocket-Key), then pipe bytes both ways — a transparent CDP conduit.
      const headerLines = this.upgradeHeaderLines(req, cap.upstreamHost, cap.upstreamPort);
      upstream.write(`GET ${path} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => {
      this.refuseUpgrade(clientSocket, 502);
      cleanup();
    });
    clientSocket.on("error", cleanup);
    upstream.on("close", cleanup);
    clientSocket.on("close", cleanup);
  }

  /** Build the upstream upgrade header block (Host overridden to Chromium; the rest of the handshake replayed). */
  private upgradeHeaderLines(req: IncomingMessage, host: string, port: number): string {
    const out: string[] = [`Host: ${host}:${port}`];
    for (const [k, v] of Object.entries(req.headers)) {
      const name = k.toLowerCase();
      if (name === "host") {
        continue;
      }
      const value = Array.isArray(v) ? v.join(", ") : (v ?? "");
      out.push(`${k}: ${value}`);
    }
    return out.join("\r\n");
  }

  /** Refuse a WS upgrade with a minimal HTTP status line, then destroy the socket (resolves onward to nothing). */
  private refuseUpgrade(socket: Socket, status: number): void {
    const text = status === 404 ? "Not Found" : status === 409 ? "Conflict" : "Bad Gateway";
    try {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
    } catch {
      // already gone
    }
    socket.destroy();
  }

  /** Track a live forwarded socket under a capsule id (so a sever can destroy it). */
  private trackSocket(capsuleId: string, socket: Socket): void {
    let set = this.liveSockets.get(capsuleId);
    if (set === undefined) {
      set = new Set<Socket>();
      this.liveSockets.set(capsuleId, set);
    }
    set.add(socket);
  }

  /** Stop tracking a forwarded socket under a capsule id (on close). */
  private untrackSocket(capsuleId: string, socket: Socket): void {
    const set = this.liveSockets.get(capsuleId);
    if (set !== undefined) {
      set.delete(socket);
      if (set.size === 0) {
        this.liveSockets.delete(capsuleId);
      }
    }
  }
}
