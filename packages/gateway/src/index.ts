// @gla/gateway — edge ring (baseline §1).
// The Access Gateway: the SOLE public entry (access-gateway.md, baseline §3). For scenario-01 Phase E it FRONTS
// recipient enrollment — admitting the flow ONLY on a verified single-use `operator-discharge` grant (no public
// path bypasses grant verification: GLA-012 AC#2 / GLA-013 AC#2). It VERIFIES; it does not MINT (Capability) and
// does not run the WebAuthn ceremony itself (the AuthProvider, behind Identity+Auth).
//
// Routes (Phase E):
//   GET  /enroll?grant=<token>  → verify the grant (sig, recipient caveat, TTL, single-use NOT-spent, class +
//                                 purpose) → serve the enrollment web page (HTML+JS running navigator.credentials.create)
//   POST /enroll/options        → re-verify the grant → registration options (a challenge) from Identity+Auth
//   POST /enroll/verify         → re-verify the grant → verify the attestation + ATOMICALLY store the credential
//                                 bound to the recipient + set auth_strength=webauthn + MARK THE GRANT SPENT
// On an absent/invalid/expired/wrong-recipient/REUSED grant → refuse (400/401/403) with a stable reason; NO
// credential is stored. The grant is re-checked on EVERY enrollment request (a stale page cannot complete).
//
// Boundary: `gateway` is edge — it depends on `@gla/kernel` + node builtins + INJECTED seams (a grant verifier,
// an identity-enroll surface). It imports NO adapter and NO concrete auth provider — `app` injects the WebAuthn
// provider (behind Identity+Auth) and the capability service; swapping the IdP changes no code here (GLA-013
// AC#5; the import-boundary lint proves it). The seams below are structural interfaces the capability/identity
// services satisfy.

import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { type AddressInfo, type Socket, connect as netConnect } from "node:net";
import type {
  AuthStrength,
  Capability,
  CapabilityId,
  ErrorCode,
  OpaqueToken,
  RecipientRef,
  RouteId,
  SessionId,
} from "@gla/kernel";
import { enrollPageHtml, refusalPageHtml } from "./enroll-page.js";
import { handoffPageHtml, handoffRefusalHtml } from "./handoff-page.js";

/** Stable identifier for this module (used by the `app` composition root's wiring record). */
export const GATEWAY_MODULE = "@gla/gateway" as const;
/** Ring classification from the architecture baseline (informational). */
export const GATEWAY_RING = "edge" as const;

/**
 * The result of verifying an enrollment grant (a {@link CapabilityService.verifyEnrollmentGrant}-shaped fact). On
 * success the verified capability + the bound recipient + the single-use nonce; on failure a stable error code.
 */
export type EnrollmentGrantVerifyResult =
  | { ok: true; capability: Capability; recipient: RecipientRef; nonce: string }
  | { ok: false; reason: ErrorCode };

/**
 * The grant-verification seam the gateway depends on (a subset of the Capability service). `app` injects the real
 * `CapabilityService`; a test injects a stub. The gateway VERIFIES (never `mint`s): a read-only verify for the
 * GET page + the options route, and an **atomic verify-and-consume** for the verify route (so the single-use
 * grant cannot drive two concurrent ceremonies — the TOCTOU close).
 */
export interface EnrollmentGrantPort {
  /**
   * Verify a grant when the recipient is UNKNOWN to the caller (the GET/POST has only the token). The gateway
   * reads the recipient OUT OF the verified grant's caveats, so it never trusts a client-supplied recipient.
   * **Read-only** (does NOT consume the single-use nonce) — used by the GET page + the options route, which may be
   * hit repeatedly before the ceremony completes.
   */
  verifyEnrollmentGrantToken(token: OpaqueToken, now?: string): EnrollmentGrantVerifyResult;
  /**
   * **Atomically verify-and-consume** a grant: verify it AND mark its single-use nonce spent in one synchronous,
   * un-interleavable step. Exactly one of two concurrent calls with the same still-valid grant succeeds; the loser
   * is refused (`auth.revoked`). The verify route uses this before running the ceremony; on a ceremony failure it
   * calls {@link unspend} to roll the nonce back (so a genuine failure stays retryable).
   */
  tryConsumeEnrollmentGrantToken(token: OpaqueToken, now?: string): EnrollmentGrantVerifyResult;
  /** Roll back an optimistic consume (un-spend a nonce) when the ceremony that followed it failed. */
  unspend(nonce: string): void;
}

/**
 * The identity/enrollment seam the gateway depends on (a subset of the Identity service). `app` injects the real
 * `IdentityService` (wired with the WebAuthn provider). The gateway forwards the ceremony here — it does not run
 * `@simplewebauthn` itself.
 */
export interface IdentityEnrollPort {
  /** Registration options (a challenge) for a recipient's enrollment, bound to their identity. */
  enrollmentOptions(recipient: RecipientRef, discharge: OpaqueToken): Promise<unknown>;
  /**
   * Verify the registration attestation + ATOMICALLY store the credential + set auth_strength. Throws a typed
   * error if the attestation does not verify (nothing stored — the no-half-bound property).
   */
  enrollComplete(recipient: RecipientRef, attestation: unknown): Promise<unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Slice 4b — handoff at the edge: verify the recipient-bound grant + require the bound identity, then proxy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The result of verifying a handoff (session) grant (a {@link CapabilityService.verifySessionGrant}-shaped fact).
 * On success the verified `session`-class capability + the recipient it is bound to; on failure a stable code.
 */
export type SessionGrantVerifyResult =
  | { ok: true; capability: Capability; recipient: RecipientRef }
  | { ok: false; reason: ErrorCode };

/**
 * The handoff-grant verification seam the gateway depends on (a subset of the Capability service). The gateway
 * VERIFIES (never `mint`s): a stateless verify of the recipient-bound `session` grant on every handoff request and
 * every WS upgrade (signature, recipient caveat, TTL, scope, revocation snapshot). `app` injects the real
 * `CapabilityService`; a test injects a stub. ONLY the bound recipient passes (GLA-035 AC#2/#3).
 */
export interface SessionGrantPort {
  /**
   * Verify a presented handoff grant by the TOKEN ALONE (the handoff link / WS upgrade carry only the token). Reads
   * the bound recipient out of the signature-authenticated grant (a tampered recipient breaks the HMAC first), and
   * checks signature/TTL/scope/revocation + class=`session`. Returns the verified capability + the bound recipient
   * on success, or a stable error (`auth.expired` | `auth.revoked` | `auth.malformed` | `auth.insufficient`). The
   * recipient binding is then enforced at step-up (the assertion is checked against the bound recipient's credential)
   * — so a grant for a DIFFERENT recipient than the one who authenticates cannot pass.
   */
  verifySessionGrantToken(
    token: OpaqueToken,
    args: { scopePath: string; now?: string },
  ): SessionGrantVerifyResult;
}

/**
 * The identity/step-up seam the gateway depends on for a handoff (a subset of the Identity service). The gateway
 * TRIGGERS step-up; it does not run the ceremony (the AuthProvider, behind Identity+Auth, does). `app` injects the
 * real `IdentityService` wired with the WebAuthn provider; swapping the IdP changes no gateway code (GLA-035 AC#5).
 */
export interface IdentityStepUpPort {
  /** Is this recipient enrolled? (An un-enrolled recipient → a catchable refusal, not a crash — GLA-035 AC#4.) */
  isEnrolled(recipient: RecipientRef): boolean;
  /**
   * Produce a WebAuthn authentication challenge (step-up options) for an ENROLLED recipient, scoped to their
   * registered credential. Throws if the recipient is not enrolled (a recipient is verifiable only if enrolled).
   */
  authenticationOptions(recipient: RecipientRef): Promise<unknown>;
  /**
   * Verify a recipient's WebAuthn assertion against the enrolled credential. Returns FACTS — `{ ok, authStrength }`
   * — never an allow/deny (the gateway decides whether the strength is sufficient).
   */
  verifyAuthentication(
    recipient: RecipientRef,
    assertion: unknown,
  ): Promise<{ ok: boolean; authStrength: AuthStrength; userId: string }>;
}

/** The auth strength the gateway requires of the bound recipient before forwarding to the capsule. */
export type RequiredAuthStrength = Exclude<AuthStrength, "none">;

/**
 * A route programmed on the gateway by the Route controller (Slice 4b). The gateway is the {@link RouteGatewayPort}
 * the controller programs: it exposes `path` publicly, verifies the bound grant statelessly on every request + WS
 * upgrade, and proxies an AUTHORIZED WS upgrade to `internalEndpoint` (the capsule's noVNC human entrypoint) — and
 * nothing else (GLA-038/039 AC#1). A route is reachable ONLY within an open authorized window (GLA-039 AC#2).
 */
interface ProgrammedRoute {
  routeId: RouteId;
  path: string;
  internalEndpoint: string;
  boundGrantId: CapabilityId;
  sessionId: SessionId;
}

/** What a `mount` request from the Route controller carries (mirrors `@gla/route`'s RouteMount — kept structural). */
export interface RouteMountRequest {
  routeId: RouteId;
  path: string;
  internalEndpoint: string;
  boundGrantId: CapabilityId;
  sessionId: SessionId;
}

/** Construction options for the Access Gateway. */
export interface GatewayOptions {
  /** The enrollment-grant verification seam (the Capability service; Phase E). Optional in a handoff-only gateway. */
  grants?: EnrollmentGrantPort;
  /** The identity/enrollment seam (the Identity service, wired with the auth provider; Phase E). Optional. */
  identity?: IdentityEnrollPort;
  /**
   * The handoff-grant verification seam (the Capability service; Slice 4b / Phase 6). The gateway verifies the
   * recipient-bound `session` grant statelessly on every handoff request + WS upgrade. Optional in an
   * enrollment-only gateway.
   */
  sessionGrants?: SessionGrantPort;
  /**
   * The identity step-up seam (the Identity service; Slice 4b / Phase 6). The gateway triggers WebAuthn step-up
   * when the bound recipient's `auth_strength` is insufficient. Optional in an enrollment-only gateway.
   */
  stepUp?: IdentityStepUpPort;
  /**
   * The auth strength a handoff requires of the bound recipient (default `webauthn`). When the recipient's
   * step-up reaches this strength, the WS upgrade is authorized; below it, step-up is triggered.
   */
  requiredAuthStrength?: RequiredAuthStrength;
  /**
   * The bind host. Default `0.0.0.0` (the hermes-1 deployment target, behind host Caddy). Tests pass `127.0.0.1`
   * with an ephemeral port.
   */
  host?: string;
  /** The bind port. Default `3000` (the deploy target); tests pass `0` for an ephemeral port. */
  port?: number;
  /**
   * The TCP **connect** timeout (ms) for the WS proxy's upstream dial. A capsule endpoint that does not complete the
   * connection within this window is abandoned and the client upgrade refused (502) — so a stalled/unreachable
   * upstream cannot pin a gateway fd waiting on `connect`. Default 10_000 (10s).
   */
  proxyConnectTimeoutMs?: number;
  /**
   * The **idle** timeout (ms) applied to BOTH proxied sockets (client + upstream) once piping. If neither side sends
   * a byte within this window the socket pair is force-closed and untracked — so a connection that stalls mid-stream
   * cannot pin gateway fds indefinitely (only `forceCloseGrant`/peer-close otherwise reaps it). A normally-active
   * proxy resets this on every byte, so a live stream is never killed. Default 120_000 (120s). Set 0 to disable.
   */
  proxyIdleTimeoutMs?: number;
}

/** A parsed enrollment/handoff request body. `attestation` is enrollment; `assertion`/`path` are the handoff step-up. */
interface EnrollBody {
  grant?: string;
  attestation?: unknown;
  /** The handoff step-up WebAuthn assertion (POST /handoff/auth/verify). */
  assertion?: unknown;
  /** The mounted route path the handoff request is for (POST /handoff/auth/*), so the gateway resolves the scope. */
  path?: string;
}

/** Map a kernel {@link ErrorCode} to the HTTP status the enrollment refusal returns (stable). */
function statusForReason(reason: ErrorCode): number {
  switch (reason) {
    case "usage.bad_argument":
      return 400; // absent/malformed grant param
    case "auth.expired":
    case "auth.recipient_mismatch":
    case "auth.revoked": // reused/spent grant
    case "auth.insufficient": // wrong class/purpose
    case "auth.malformed": // forged/tampered grant
      return 403;
    default:
      return 403;
  }
}

/**
 * The Access Gateway HTTP server. The SOLE public entry; for Phase E it serves the grant-verified enrollment
 * flow. Construct with the grant + identity seams (and an optional host/port), then `listen()`.
 */
export class AccessGateway {
  private readonly grants: EnrollmentGrantPort | undefined;
  private readonly identity: IdentityEnrollPort | undefined;
  private readonly sessionGrants: SessionGrantPort | undefined;
  private readonly stepUp: IdentityStepUpPort | undefined;
  private readonly requiredAuthStrength: RequiredAuthStrength;
  private readonly host: string;
  private readonly port: number;
  private server: Server | undefined;
  /** The route table programmed by the Route controller, keyed by public path. A route binds to one grant. */
  private readonly routes = new Map<string, ProgrammedRoute>();
  /**
   * The per-grant step-up marker: a grant id whose bound recipient has authenticated to the required strength
   * (so the next WS upgrade for that grant is authorized). It is the small mutable edge state the step-up needs —
   * the WS upgrade still verifies the grant STATELESSLY (signature/recipient/TTL/scope/revocation) AND checks this
   * marker. Cleared on the grant's revoke/force-close so a revoked grant cannot reach the capsule.
   */
  private readonly authorizedGrants = new Set<CapabilityId>();
  /** Live proxied sockets per grant id, so a revoke/force-close can sever them (GLA-039 AC#3). */
  private readonly liveSockets = new Map<CapabilityId, Set<Socket>>();
  /** The WS-proxy upstream connect timeout (ms) — a stalled dial cannot pin an fd waiting on `connect`. */
  private readonly proxyConnectTimeoutMs: number;
  /** The WS-proxy idle timeout (ms) applied to both proxied sockets — a stalled stream cannot pin fds. 0 disables. */
  private readonly proxyIdleTimeoutMs: number;

  constructor(opts: GatewayOptions) {
    this.grants = opts.grants;
    this.identity = opts.identity;
    this.sessionGrants = opts.sessionGrants;
    this.stepUp = opts.stepUp;
    this.requiredAuthStrength = opts.requiredAuthStrength ?? "webauthn";
    this.host = opts.host ?? "0.0.0.0";
    this.port = opts.port ?? 3000;
    this.proxyConnectTimeoutMs = opts.proxyConnectTimeoutMs ?? 10_000;
    this.proxyIdleTimeoutMs = opts.proxyIdleTimeoutMs ?? 120_000;
  }

  /** Start listening. Returns the actual bound `{ host, port }` (port is the ephemeral one when 0 was requested). */
  async listen(): Promise<{ host: string; port: number }> {
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    // The WS upgrade is the human side of the two-actor capsule: verify the grant + require the bound identity,
    // then proxy the AUTHORIZED upgrade to the capsule's noVNC endpoint and nothing else (GLA-038/039 AC#1).
    server.on("upgrade", (req, socket, head) => {
      this.handleUpgrade(req, socket as Socket, head);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, this.host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const addr = server.address() as AddressInfo;
    return { host: this.host, port: addr.port };
  }

  /** Stop listening (idempotent). Also severs any live proxied sockets so nothing dangles. */
  async close(): Promise<void> {
    // Sever every live proxied socket first (so a close cannot leave a capsule reachable).
    for (const grantId of [...this.liveSockets.keys()]) {
      this.forceCloseGrant(grantId);
    }
    const server = this.server;
    if (server === undefined) {
      return;
    }
    // Force-terminate any lingering connections (an upgraded WS socket is detached from the server's keep-alive
    // tracking, so `server.close()` alone can hang waiting for it). `closeAllConnections` (Node 18.2+) severs them.
    const closeAll = (server as { closeAllConnections?: () => void }).closeAllConnections;
    if (typeof closeAll === "function") {
      closeAll.call(server);
    }
    // Resolve as soon as the server reports closed; the listening handle is released regardless of stray sockets
    // (which were already destroyed above) — a short race guards against a never-firing callback.
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

  /** Build an enrollment invite link for a recipient's grant token, given the public base URL. */
  static enrollLink(baseUrl: string, grant: OpaqueToken): string {
    const u = new URL("/enroll", baseUrl);
    u.searchParams.set("grant", grant);
    return u.toString();
  }

  /** Build a recipient-bound handoff link for a grant token + the route path, given the public base URL. */
  static handoffLink(baseUrl: string, path: string, grant: OpaqueToken): string {
    const u = new URL(path, baseUrl);
    u.searchParams.set("grant", grant);
    return u.toString();
  }

  // ── RouteGatewayPort — the Route controller programs the gateway (Slice 4b, GLA-033) ──────────────────────

  /**
   * Mount a grant-bound route (the gateway is the Route controller's abstract edge). After this, `path` is publicly
   * reachable but ONLY within an open authorized window — every request + WS upgrade still verifies the bound grant
   * statelessly and requires the bound identity. Replacing an existing route on the same path re-binds it.
   */
  async mount(route: RouteMountRequest): Promise<void> {
    this.routes.set(route.path, { ...route });
  }

  /**
   * Unmount a route by id — remove it from the table AND force-close any live WS bound to its grant (GLA-039 AC#3:
   * the surface is no longer reachable). Idempotent: a no-op if no route with that id is mounted.
   */
  async unmount(routeId: RouteId): Promise<void> {
    for (const [path, route] of [...this.routes.entries()]) {
      if (route.routeId === routeId) {
        this.routes.delete(path);
        // Force-close the live WS + drop the auth marker so the capsule is no longer reachable via this grant.
        this.forceCloseGrant(route.boundGrantId);
        this.authorizedGrants.delete(route.boundGrantId);
      }
    }
  }

  /** The set of route ids currently programmed (the Route controller's reconciler reads this — edge truth). */
  mountedRouteIds(): Set<RouteId> {
    return new Set([...this.routes.values()].map((r) => r.routeId));
  }

  /**
   * Force-close every live proxied socket bound to a grant id, and drop the grant's auth marker (GLA-039 AC#3) —
   * called by the Session/Route controller on grant revoke/expiry so the live WS is severed and the surface
   * becomes unreachable. Idempotent.
   */
  forceCloseGrant(grantId: CapabilityId): void {
    const sockets = this.liveSockets.get(grantId);
    if (sockets !== undefined) {
      for (const s of sockets) {
        s.destroy();
      }
      this.liveSockets.delete(grantId);
    }
    this.authorizedGrants.delete(grantId);
  }

  /** The single request router. Every enrollment + handoff route verifies the grant FIRST — no bypass. */
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;
      const method = (req.method ?? "GET").toUpperCase();

      // ── Phase E — enrollment (Slice 4a). Only wired when the enrollment seams are present. ──
      if (this.grants !== undefined && this.identity !== undefined) {
        if (method === "GET" && path === "/enroll") {
          this.handleEnrollPage(url, res);
          return;
        }
        if (method === "POST" && path === "/enroll/options") {
          await this.handleEnrollOptions(req, res);
          return;
        }
        if (method === "POST" && path === "/enroll/verify") {
          await this.handleEnrollVerify(req, res);
          return;
        }
      }

      // ── Phase 6/12 — handoff (Slice 4b). Verify the recipient-bound grant + require the bound identity. ──
      // The step-up auth POST is grant-verified and recipient-bound (no bypass — only the bound recipient).
      if (method === "POST" && path === "/handoff/auth/options") {
        await this.handleHandoffAuthOptions(req, res);
        return;
      }
      if (method === "POST" && path === "/handoff/auth/verify") {
        await this.handleHandoffAuthVerify(req, res);
        return;
      }
      // A mounted handoff route's GET serves the step-up page (verify grant → require identity).
      const route = this.routes.get(path);
      if (method === "GET" && route !== undefined) {
        await this.handleHandoffPage(url, route, res);
        return;
      }

      // Nothing else is publicly reachable on the gateway (the agent has NO path through it).
      this.sendJson(res, 404, { error: { code: "catalog.unknown", message: "not found" } });
    } catch {
      // Defensive: any unexpected error is a generic refusal, never a crash that leaks a stack to the public.
      this.sendJson(res, 500, { error: { code: "internal", message: "internal error" } });
    }
  }

  /**
   * `GET /enroll?grant=<token>` — verify the grant, then serve the enrollment page. The recipient is read from the
   * VERIFIED grant (never a query param), so a forwarded link is bound to its recipient. An absent grant → 400; an
   * invalid/expired/wrong-recipient/reused grant → 403, the refusal page.
   */
  private handleEnrollPage(url: URL, res: ServerResponse): void {
    const grants = this.grants;
    if (grants === undefined) {
      this.sendJson(res, 404, { error: { code: "catalog.unknown", message: "not found" } });
      return;
    }
    const grant = url.searchParams.get("grant");
    if (grant === null || grant.length === 0) {
      this.sendHtml(res, 400, refusalPageHtml("missing grant"));
      return;
    }
    const verified = grants.verifyEnrollmentGrantToken(grant as OpaqueToken);
    if (!verified.ok) {
      this.sendHtml(res, statusForReason(verified.reason), refusalPageHtml(verified.reason));
      return;
    }
    // The recipient label is display-only; the binding is the verified grant's recipient caveat.
    this.sendHtml(res, 200, enrollPageHtml(grant, String(verified.recipient)));
  }

  /**
   * `POST /enroll/options` — re-verify the grant (every request), then return registration options for the bound
   * recipient. No bypass: a request without a valid grant is refused before any options are produced.
   */
  private async handleEnrollOptions(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const grants = this.grants;
    const identity = this.identity;
    if (grants === undefined || identity === undefined) {
      this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
      return;
    }
    const body = await this.readJson(req);
    const grant = body.grant;
    if (typeof grant !== "string" || grant.length === 0) {
      this.sendJson(res, 400, this.errBody("usage.bad_argument", "missing grant"));
      return;
    }
    const verified = grants.verifyEnrollmentGrantToken(grant as OpaqueToken);
    if (!verified.ok) {
      this.sendJson(
        res,
        statusForReason(verified.reason),
        this.errBody(verified.reason, "enrollment grant rejected"),
      );
      return;
    }
    const options = await identity.enrollmentOptions(verified.recipient, grant as OpaqueToken);
    this.sendJson(res, 200, options as Record<string, unknown>);
  }

  /**
   * `POST /enroll/verify` — **atomically verify-and-consume** the grant, then verify the attestation + store the
   * credential. No bypass: a direct POST with no/invalid grant is refused and stores nothing (GLA-012 AC#2).
   *
   * The grant is consumed (its single-use nonce marked spent) **before** the WebAuthn ceremony, atomically, so two
   * concurrent verifies of the same grant cannot both proceed — exactly one consumes it; the loser is refused
   * `auth.revoked` (closes the single-use TOCTOU window, GLA-013 AC#2's "one grant = one ceremony"). If the
   * ceremony then fails (no half-bound — GLA-013 AC#4), the consume is **rolled back** (`unspend`) so the same
   * still-valid grant stays retryable.
   */
  private async handleEnrollVerify(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const grants = this.grants;
    const identity = this.identity;
    if (grants === undefined || identity === undefined) {
      this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
      return;
    }
    const body = await this.readJson(req);
    const grant = body.grant;
    if (typeof grant !== "string" || grant.length === 0) {
      // NO BYPASS: a verify with no grant is refused before any credential work.
      this.sendJson(res, 401, this.errBody("auth.insufficient", "missing enrollment grant"));
      return;
    }
    // Validate the request BEFORE consuming the grant, so a malformed body (no attestation) never burns it.
    if (body.attestation === undefined) {
      // The grant must still verify (no-bypass) — read-only check, no consume.
      const check = grants.verifyEnrollmentGrantToken(grant as OpaqueToken);
      if (!check.ok) {
        this.sendJson(
          res,
          statusForReason(check.reason),
          this.errBody(check.reason, "enrollment grant rejected"),
        );
        return;
      }
      this.sendJson(res, 400, this.errBody("usage.bad_argument", "missing attestation"));
      return;
    }
    // ATOMIC verify-and-consume: marks the single-use nonce spent in the same synchronous step as the verify, so
    // a concurrent second verify of the same grant observes it already spent and is refused.
    const verified = grants.tryConsumeEnrollmentGrantToken(grant as OpaqueToken);
    if (!verified.ok) {
      this.sendJson(
        res,
        statusForReason(verified.reason),
        this.errBody(verified.reason, "enrollment grant rejected"),
      );
      return;
    }
    try {
      await identity.enrollComplete(verified.recipient, body.attestation);
    } catch (e) {
      // A failed/abandoned ceremony: refuse, store NOTHING, and ROLL BACK the consume so the still-valid grant is
      // retryable (no half-bound — GLA-013 AC#4). The error code is the typed one identity threw when present.
      grants.unspend(verified.nonce);
      const code = isCoded(e) ? e.code : "auth.insufficient";
      this.sendJson(res, 403, this.errBody(code, "enrollment attestation did not verify"));
      return;
    }
    // Success: the credential is stored bound to the recipient with auth_strength=webauthn; the grant is already
    // consumed (single-use) so it can never be reused (GLA-013 AC#2).
    this.sendJson(res, 200, { enrolled: true, auth_strength: "webauthn" });
  }

  // ── Handoff at the edge (Slice 4b, scenario-01 Phases 6/12) ───────────────────────────────────────────

  /**
   * `GET /handoff/<sessionId>?grant=<token>` — the human opens the handoff link. Verify the recipient-bound grant
   * statelessly (signature, recipient caveat, TTL, scope, revocation) — ONLY the bound recipient passes — then
   * require the bound identity: serve a step-up page that runs `navigator.credentials.get`. An un-enrolled bound
   * recipient gets a catchable refusal page (not a crash — GLA-035 AC#4); an absent/invalid/expired/revoked/
   * wrong-recipient grant is refused. The recipient is read from the *signed* grant (a tampered recipient fails the
   * HMAC first), so a forwarded link is useless in another's hands.
   */
  private async handleHandoffPage(
    url: URL,
    route: ProgrammedRoute,
    res: ServerResponse,
  ): Promise<void> {
    const sessionGrants = this.sessionGrants;
    const stepUp = this.stepUp;
    if (sessionGrants === undefined || stepUp === undefined) {
      this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
      return;
    }
    const grant = url.searchParams.get("grant");
    if (grant === null || grant.length === 0) {
      this.sendHtml(res, 400, handoffRefusalHtml("missing grant"));
      return;
    }
    const verified = this.verifyHandoffGrant(grant as OpaqueToken, route);
    if (!verified.ok) {
      this.sendHtml(res, statusForReason(verified.reason), handoffRefusalHtml(verified.reason));
      return;
    }
    // Require the bound identity: an UN-ENROLLED recipient gets a catchable refusal page, never a crash.
    if (!stepUp.isEnrolled(verified.recipient)) {
      this.sendHtml(
        res,
        403,
        handoffRefusalHtml(
          "not-enrolled",
          "This recipient is not enrolled. Ask the operator to enroll first.",
        ),
      );
      return;
    }
    // Serve the step-up page (runs navigator.credentials.get against the recipient's registered credential).
    this.sendHtml(res, 200, handoffPageHtml(grant, route.path, String(verified.recipient)));
  }

  /**
   * `POST /handoff/auth/options` — re-verify the grant (every request, no bypass), then return WebAuthn step-up
   * options for the bound recipient. The route the grant is scoped to is resolved by the grant's scope path; an
   * un-enrolled recipient is refused (a recipient is verifiable only if enrolled — GLA-035 AC#4).
   */
  private async handleHandoffAuthOptions(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionGrants = this.sessionGrants;
    const stepUp = this.stepUp;
    if (sessionGrants === undefined || stepUp === undefined) {
      this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
      return;
    }
    const body = await this.readJson(req);
    const grant = body.grant;
    const route = this.routeForBody(body);
    if (typeof grant !== "string" || grant.length === 0 || route === undefined) {
      this.sendJson(res, 400, this.errBody("usage.bad_argument", "missing grant or unknown route"));
      return;
    }
    const verified = this.verifyHandoffGrant(grant as OpaqueToken, route);
    if (!verified.ok) {
      this.sendJson(
        res,
        statusForReason(verified.reason),
        this.errBody(verified.reason, "grant rejected"),
      );
      return;
    }
    if (!stepUp.isEnrolled(verified.recipient)) {
      // Un-enrolled → a catchable refusal (auth.insufficient), NOT a crash (GLA-035 AC#4).
      this.sendJson(res, 403, this.errBody("auth.insufficient", "recipient is not enrolled"));
      return;
    }
    try {
      const options = await stepUp.authenticationOptions(verified.recipient);
      this.sendJson(res, 200, options as Record<string, unknown>);
    } catch {
      // Defensive: a provider failure is a catchable refusal, not a crash.
      this.sendJson(res, 403, this.errBody("auth.insufficient", "cannot begin step-up"));
    }
  }

  /**
   * `POST /handoff/auth/verify` — re-verify the grant (no bypass), then verify the recipient's WebAuthn assertion
   * against the enrolled credential. On a verified assertion that reaches the required `auth_strength`, MARK the
   * grant authorized (so the next WS upgrade for it is proxied). A failed assertion → refused, NOT authorized. An
   * un-enrolled recipient → a catchable refusal (GLA-035 AC#4). Auth is DELEGATED to the provider (GLA-035 AC#5).
   */
  private async handleHandoffAuthVerify(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionGrants = this.sessionGrants;
    const stepUp = this.stepUp;
    if (sessionGrants === undefined || stepUp === undefined) {
      this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
      return;
    }
    const body = await this.readJson(req);
    const grant = body.grant;
    const route = this.routeForBody(body);
    if (typeof grant !== "string" || grant.length === 0 || route === undefined) {
      this.sendJson(res, 400, this.errBody("usage.bad_argument", "missing grant or unknown route"));
      return;
    }
    const verified = this.verifyHandoffGrant(grant as OpaqueToken, route);
    if (!verified.ok) {
      this.sendJson(
        res,
        statusForReason(verified.reason),
        this.errBody(verified.reason, "grant rejected"),
      );
      return;
    }
    if (body.assertion === undefined) {
      this.sendJson(res, 400, this.errBody("usage.bad_argument", "missing assertion"));
      return;
    }
    if (!stepUp.isEnrolled(verified.recipient)) {
      this.sendJson(res, 403, this.errBody("auth.insufficient", "recipient is not enrolled"));
      return;
    }
    let factResult: { ok: boolean; authStrength: AuthStrength };
    try {
      factResult = await stepUp.verifyAuthentication(verified.recipient, body.assertion);
    } catch {
      this.sendJson(res, 403, this.errBody("auth.insufficient", "step-up verification failed"));
      return;
    }
    if (!factResult.ok || !this.strengthSufficient(factResult.authStrength)) {
      // A failed assertion or an insufficient strength → refused, the grant is NOT authorized (GLA-035 AC#…).
      this.sendJson(
        res,
        403,
        this.errBody("auth.insufficient", "step-up did not satisfy the required strength"),
      );
      return;
    }
    // The bound recipient authenticated to the required strength: authorize the grant so its WS upgrade proxies.
    this.authorizedGrants.add(verified.capability.id as CapabilityId);
    this.sendJson(res, 200, { authorized: true, auth_strength: factResult.authStrength });
  }

  /**
   * Handle a WebSocket upgrade on a handoff route (the human reaching the capsule surface — GLA-038/039). VERIFY the
   * recipient-bound grant statelessly AND require that the bound recipient already authenticated to the required
   * strength (the grant is in the authorized set). Only an AUTHORIZED, in-window upgrade is proxied to the capsule's
   * noVNC endpoint — and NOTHING else (GLA-038 AC#1). An unverified/expired/revoked grant, an unknown route, or an
   * un-authorized grant is refused (the connection resolves onward to nothing — GLA-035 AC#2/#3, GLA-039 AC#2).
   */
  private handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const route = this.routes.get(url.pathname);
      const sessionGrants = this.sessionGrants;
      if (route === undefined || sessionGrants === undefined) {
        // No such route is publicly reachable (the route exists only while its window is open — GLA-039 AC#2).
        this.refuseUpgrade(socket, 404);
        return;
      }
      const grant = url.searchParams.get("grant");
      if (grant === null || grant.length === 0) {
        this.refuseUpgrade(socket, 400);
        return;
      }
      const verified = this.verifyHandoffGrant(grant as OpaqueToken, route);
      if (!verified.ok) {
        // Absent/wrong-recipient/expired/revoked grant → refused; resolves onward to nothing (GLA-035 AC#2/#3).
        this.refuseUpgrade(socket, statusForReason(verified.reason));
        return;
      }
      // Require the bound identity: the grant must have been authorized by a successful step-up (GLA-035 AC#4).
      if (!this.authorizedGrants.has(verified.capability.id as CapabilityId)) {
        this.refuseUpgrade(socket, 401);
        return;
      }
      // AUTHORIZED, in-window: proxy the WS upgrade to the capsule's noVNC endpoint and NOTHING else.
      this.proxyUpgrade(req, socket, head, route, verified.capability.id as CapabilityId);
    } catch {
      this.refuseUpgrade(socket, 500);
    }
  }

  // ── http helpers ────────────────────────────────────────────────────────────────────────────────────

  /** Read + JSON-parse a request body (small, bounded); a malformed body parses to `{}`. */
  private async readJson(req: IncomingMessage): Promise<EnrollBody> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size > 256 * 1024) {
        // Bound the body — an oversized enrollment POST is rejected (the attestation is small).
        return {};
      }
      chunks.push(buf);
    }
    if (chunks.length === 0) {
      return {};
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as EnrollBody;
    } catch {
      return {};
    }
  }

  private errBody(code: ErrorCode, message: string): Record<string, unknown> {
    return { error: { code, message } };
  }

  private sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  private sendHtml(res: ServerResponse, status: number, html: string): void {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(html),
    });
    res.end(html);
  }

  // ── handoff helpers ───────────────────────────────────────────────────────────────────────────────────

  /**
   * Verify a presented handoff grant against a route — the stateless edge check (GLA-035). Delegates to the injected
   * {@link SessionGrantPort.verifySessionGrantToken} with the route's path as the scope; the bound recipient is read
   * from the *signed* grant (so the gateway never trusts an unsigned recipient — a tampered recipient breaks the
   * HMAC first). Returns the verified capability + bound recipient, or a stable error. Only a live (un-expired,
   * un-revoked, in-scope) `session`-class grant passes; the recipient binding is enforced at step-up (the assertion
   * is checked against the bound recipient's credential), so a grant for a different recipient cannot reach the WS.
   */
  private verifyHandoffGrant(token: OpaqueToken, route: ProgrammedRoute): SessionGrantVerifyResult {
    const sessionGrants = this.sessionGrants;
    if (sessionGrants === undefined) {
      return { ok: false, reason: "catalog.unavailable" };
    }
    return sessionGrants.verifySessionGrantToken(token, { scopePath: route.path });
  }

  /** Resolve the mounted route a handoff POST is for, from its `path` field, or undefined if no such route. */
  private routeForBody(body: EnrollBody): ProgrammedRoute | undefined {
    if (typeof body.path !== "string" || body.path.length === 0) {
      return undefined;
    }
    return this.routes.get(body.path);
  }

  /** Is a step-up's reported strength at least the required strength? (`webauthn` ⊇ `password` ⊇ `none`.) */
  private strengthSufficient(strength: AuthStrength): boolean {
    const rank: Record<AuthStrength, number> = { none: 0, password: 1, webauthn: 2 };
    return rank[strength] >= rank[this.requiredAuthStrength];
  }

  /** Refuse a WS upgrade with a minimal HTTP status line, then destroy the socket (resolves onward to nothing). */
  private refuseUpgrade(socket: Socket, status: number): void {
    const text =
      status === 404
        ? "Not Found"
        : status === 401
          ? "Unauthorized"
          : status === 400
            ? "Bad Request"
            : status === 403
              ? "Forbidden"
              : "Error";
    try {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
    } catch {
      // The socket may already be gone; nothing to do.
    }
    socket.destroy();
  }

  /**
   * Proxy an AUTHORIZED WS upgrade to the capsule's internal noVNC endpoint — and nothing else (GLA-038/039 AC#1).
   * Opens a raw TCP connection to the noVNC host:port, replays the WebSocket handshake (the upgrade request line +
   * headers) verbatim, then pipes bytes bidirectionally. The live socket is tracked per grant so a revoke/expiry can
   * force-close it (GLA-039 AC#3). If the upstream cannot be reached, the client upgrade is refused (502).
   */
  private proxyUpgrade(
    req: IncomingMessage,
    clientSocket: Socket,
    head: Buffer,
    route: ProgrammedRoute,
    grantId: CapabilityId,
  ): void {
    const target = parseWsEndpoint(route.internalEndpoint);
    if (target === undefined) {
      this.refuseUpgrade(clientSocket, 502);
      return;
    }
    const upstream = netConnect({ host: target.host, port: target.port });
    // Track this live socket pair under the grant so a force-close severs it (GLA-039 AC#3).
    this.trackSocket(grantId, clientSocket);
    this.trackSocket(grantId, upstream);

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      // Drop the per-socket idle 'timeout' listeners so a later timeout tick can't re-enter (setTimeout(0) =
      // no idle timer, and we clear any remaining handlers by destroying below).
      this.untrackSocket(grantId, clientSocket);
      this.untrackSocket(grantId, upstream);
      clientSocket.destroy();
      upstream.destroy();
    };

    // ── Connect timeout: a capsule endpoint that does not complete the TCP connection within the window is
    //    abandoned (the client upgrade refused 502) — so a stalled dial cannot pin a gateway fd. Node's
    //    `socket.setTimeout` before 'connect' arms the CONNECT timeout; we clear it on 'connect' and re-arm the
    //    IDLE timeout for the piping phase.
    if (this.proxyConnectTimeoutMs > 0) {
      upstream.setTimeout(this.proxyConnectTimeoutMs);
    }
    upstream.once("timeout", () => {
      // Fired before 'connect' ⇒ the dial stalled. Refuse the client and reap both sockets (no fd leak).
      this.refuseUpgrade(clientSocket, 502);
      cleanup();
    });

    upstream.on("connect", () => {
      // Connected: clear the connect timeout and re-arm an IDLE timeout on BOTH sockets for the piping phase.
      upstream.removeAllListeners("timeout");
      this.armIdleTimeout(clientSocket, upstream, cleanup);

      // Replay ONLY the WS-handshake-relevant headers to the upstream (the capsule-internal noVNC server completes
      // the handshake). Defense-in-depth (#2): client `Cookie`/`Authorization`/`X-Forwarded-*`/other hop-by-hop
      // headers are DROPPED so the internal endpoint never sees untrusted client headers; `Host` is set to the
      // upstream, not the client's. There is no request-controlled target and node:http already blocks CRLF, so
      // this is hardening, not a fix.
      const headerLines = this.handshakeHeaderLines(req, target);
      const requestLine = `${req.method ?? "GET"} ${target.path} HTTP/1.1\r\n`;
      upstream.write(`${requestLine}${headerLines}\r\n\r\n`);
      if (head !== undefined && head.length > 0) {
        upstream.write(head);
      }
      // Pipe bytes both ways — the gateway is a transparent conduit to the noVNC stream and NOTHING else. Every
      // byte resets the idle timeout (Node refreshes `setTimeout` on activity), so a LIVE stream is never killed.
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

  /**
   * Arm an IDLE timeout on both proxied sockets (the piping phase). Node's `socket.setTimeout(ms)` fires `'timeout'`
   * after `ms` of inactivity AND is refreshed on every read/write — so an active stream never trips it, but a stream
   * that stalls mid-flight does. On either side's timeout we force-close + untrack the pair (no fd leak). A 0/absent
   * idle timeout disables this (the connect timeout + revoke/peer-close still reap).
   */
  private armIdleTimeout(clientSocket: Socket, upstream: Socket, cleanup: () => void): void {
    if (this.proxyIdleTimeoutMs <= 0) {
      return;
    }
    clientSocket.setTimeout(this.proxyIdleTimeoutMs);
    upstream.setTimeout(this.proxyIdleTimeoutMs);
    clientSocket.once("timeout", cleanup);
    upstream.once("timeout", cleanup);
  }

  /**
   * Build the upstream handshake header block from ONLY the WebSocket-handshake-relevant request headers (#2). It
   * forwards `Host` (set to the upstream authority, not the client's), `Upgrade`, `Connection`, and every
   * `Sec-WebSocket-*` header, and DROPS everything else (Cookie / Authorization / X-Forwarded-* / Origin / other
   * hop-by-hop), so the capsule-internal endpoint never receives untrusted client headers. Header values are taken
   * from node:http's already-parsed `req.headers` (CRLF-free by construction).
   */
  private handshakeHeaderLines(
    req: IncomingMessage,
    target: { host: string; port: number },
  ): string {
    const out: string[] = [`Host: ${target.host}:${target.port}`];
    for (const [k, v] of Object.entries(req.headers)) {
      const name = k.toLowerCase();
      // Only the handshake-relevant headers are replayed; `host` is overridden above.
      const allowed =
        name === "upgrade" || name === "connection" || name.startsWith("sec-websocket-");
      if (!allowed) {
        continue;
      }
      const value = Array.isArray(v) ? v.join(", ") : (v ?? "");
      out.push(`${k}: ${value}`);
    }
    return out.join("\r\n");
  }

  /** Track a live proxied socket under a grant id (so a force-close can sever it). */
  private trackSocket(grantId: CapabilityId, socket: Socket): void {
    let set = this.liveSockets.get(grantId);
    if (set === undefined) {
      set = new Set<Socket>();
      this.liveSockets.set(grantId, set);
    }
    set.add(socket);
  }

  /** Stop tracking a proxied socket under a grant id (on close). */
  private untrackSocket(grantId: CapabilityId, socket: Socket): void {
    const set = this.liveSockets.get(grantId);
    if (set !== undefined) {
      set.delete(socket);
      if (set.size === 0) {
        this.liveSockets.delete(grantId);
      }
    }
  }

  /** Is a grant currently authorized (its bound recipient stepped up) AND a route still mounted? (For tests/probes.) */
  isGrantAuthorized(grantId: CapabilityId): boolean {
    return this.authorizedGrants.has(grantId);
  }

  /**
   * The number of live proxied sockets currently tracked under a grant id (0 once both the client + upstream sockets
   * of a connection are reaped). A probe for fd-leak observability: after a connect/idle timeout reaps a stalled
   * proxy, this returns 0 (the sockets are destroyed AND untracked).
   */
  liveSocketCount(grantId: CapabilityId): number {
    return this.liveSockets.get(grantId)?.size ?? 0;
  }
}

/** Parse a `ws://host:port/path` (or `http://…`) endpoint into `{ host, port, path }`, or undefined if malformed. */
function parseWsEndpoint(
  endpoint: string,
): { host: string; port: number; path: string } | undefined {
  try {
    // Normalize ws/wss to http/https so the URL parser accepts it.
    const normalized = endpoint.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
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

/** Narrow an unknown thrown value to one carrying a kernel error `code` (a `GlaErrorException`). */
function isCoded(e: unknown): e is { code: ErrorCode } {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    typeof (e as { code: unknown }).code === "string"
  );
}
