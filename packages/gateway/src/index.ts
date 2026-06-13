// @gla/gateway — edge ring (baseline §1).
// The Access Gateway: the SOLE public entry (access-gateway.md, baseline §3). For scenario-01 Phase E it FRONTS
// recipient enrollment — admitting the flow ONLY on a verified single-use `operator-discharge` grant (no public
// path bypasses grant verification: GLA-012 AC#2 / GLA-013 AC#2). It VERIFIES; it does not MINT (Capability) and
// does not run the WebAuthn ceremony itself (the AuthProvider, behind Identity+Auth).
//
// Routes (Phase E):
//   GET  /enroll?grant=<token>  → verify the grant (sig, recipient caveat, TTL, single-use NOT-spent, class +
//                                 purpose) → serve the enrollment web page and issue an HttpOnly bootstrap ticket.
//   POST /enroll/options        → resolve the bootstrap ticket or legacy body grant → registration options from
//                                 Identity+Auth. Redirect-shaped delegated ceremonies consume the GLA grant before
//                                 the browser leaves this origin.
//   POST /enroll/verify         → verify the attestation + ATOMICALLY store the credential bound to the recipient;
//                                 in-page ceremonies consume here, delegated callbacks must match a pending consumed
//                                 grant from /enroll/options.
// On an absent/invalid/expired/wrong-recipient/REUSED grant → refuse (400/401/403) with a stable reason; NO
// credential is stored. The grant is re-checked on EVERY enrollment request (a stale page cannot complete).
//
// Boundary: `gateway` is edge — it depends on `@gla/kernel` + node builtins + INJECTED seams (a grant verifier,
// an identity-enroll surface). It imports NO adapter and NO concrete auth provider — `app` injects the WebAuthn
// provider (behind Identity+Auth) and the capability service; swapping the IdP changes no code here (GLA-013
// AC#5; the import-boundary lint proves it). The seams below are structural interfaces the capability/identity
// services satisfy.

import { randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import {
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";
import { type AddressInfo, type Socket, connect as netConnect } from "node:net";
import { extname, isAbsolute, relative, resolve as resolvePath } from "node:path";
import {
  type AuthAssuranceEvidence,
  type AuthAssurancePolicy,
  type AuthStrength,
  type Capability,
  type CapabilityId,
  type ErrorCode,
  type OpaqueToken,
  type RecipientRef,
  type RouteId,
  type SessionId,
  authAssurancePolicyFromProfile,
  authAssurancePolicyFromRequiredAuthStrength,
  authAssuranceSufficient,
} from "@gla/kernel";
import { authCallbackPageHtml } from "./callback-page.js";
import { enrollPageHtml, refusalPageHtml } from "./enroll-page.js";
import { handoffPageHtml, handoffRefusalHtml, handoffReusedPageHtml } from "./handoff-page.js";
import {
  type PublicBase,
  internalPathForPublicRequest,
  parsePublicBaseUrl,
  publicPath,
  publicUrl,
} from "./public-base.js";

const STREAM_TICKET_COOKIE = "gla_handoff";
const HANDOFF_BOOTSTRAP_COOKIE = "gla_handoff_boot";
const ENROLL_BOOTSTRAP_COOKIE = "gla_enroll_boot";
const STREAM_TICKET_TTL_MS = 5 * 60 * 1000;
const GRANT_BOOTSTRAP_TTL_MS = 15 * 60 * 1000;
const NO_STORE_SECURITY_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export {
  PublicBaseUrlError,
  internalPathForPublicRequest,
  parsePublicBaseUrl,
  publicPath,
  publicUrl,
} from "./public-base.js";
export type { PublicBase } from "./public-base.js";

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
  /**
   * Verify a signed grant whose nonce is already consumed. Used only for delegated callback completion after
   * `/enroll/options` consumed the grant and the gateway recorded the nonce as pending.
   */
  verifyConsumedEnrollmentGrantToken(token: OpaqueToken, now?: string): EnrollmentGrantVerifyResult;
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
  /**
   * Non-authorizing stale-link classifier: proves a refused token is signature-valid, session-class, and route-scoped
   * while ignoring TTL/revocation. The gateway uses this only after normal verification already refused the token, so
   * expired/revoked tokens from other routes cannot reveal recently retired route history.
   */
  proveStaleSessionGrantRoute?(
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
  ): Promise<{
    ok: boolean;
    authStrength: AuthStrength;
    assurance?: AuthAssuranceEvidence;
    userId: string;
  }>;
}

/** Deprecated compatibility input for deployments that still pass the pre-policy strength floor. */
export type RequiredAuthStrength = Exclude<AuthStrength, "none">;

/**
 * A route programmed on the gateway by the Route controller (Slice 4b). Authorization state (path, grant,
 * recipient/session) is separate from the reverse-proxy transport binding. The gateway verifies the bound grant
 * statelessly on every request + upgrade; only after authorization does the transport binding get used.
 */
interface ProgrammedRoute {
  routeId: RouteId;
  path: string;
  entrypointResourceId: string;
  client: HumanEntrypointClientBinding;
  transport: ReverseProxyTransportBinding;
  boundGrantId: CapabilityId;
  sessionId: SessionId;
}

interface RetiredRoute extends ProgrammedRoute {
  retiredAt: number;
}

interface HumanEntrypointClientBinding {
  kind: string;
  ref?: string;
  bootstrap?: Record<string, unknown>;
}

interface ReverseProxyTransportBinding {
  kind: "reverse-proxy";
  protocol: string;
  upstream: string;
}

/** Provider-owned browser-client assets the gateway serves read-only under `/handoff/client-assets/<ref>/...`. */
export interface EntrypointClientAssetMount {
  /** Provider-owned reference from `HumanEntrypointClientBinding.ref`. */
  ref: string;
  /** Local read-only directory containing browser assets for that ref. */
  root: string;
  /** Cache policy for served assets. Defaults to `no-cache` so module trees revalidate across upgrades. */
  cacheControl?: string;
}

interface RouteAuthorizationMount {
  routeId: RouteId;
  path: string;
  boundGrantId: CapabilityId;
  sessionId: SessionId;
  entrypointResourceId: string;
}

/** What a `mount` request from the Route controller carries (mirrors `@gla/route`'s RouteMount — kept structural). */
export interface RouteMountRequest {
  authorization: RouteAuthorizationMount;
  transport: ReverseProxyTransportBinding;
  client: HumanEntrypointClientBinding;
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
   * The identity step-up seam (the Identity service; Slice 4b / Phase 6). The gateway triggers provider-backed
   * step-up when the bound recipient's assurance is insufficient. Optional in an enrollment-only gateway.
   */
  stepUp?: IdentityStepUpPort;
  /**
   * The provider-neutral assurance policy a handoff requires of the bound recipient. Defaults to the secure
   * phishing-resistant profile. Gateway decisions consult this common contract, not provider method names.
   */
  authAssurancePolicy?: AuthAssurancePolicy;
  /**
   * Deprecated compatibility input. Prefer {@link authAssurancePolicy}. `"webauthn"` maps to the default
   * phishing-resistant profile; `"password"` maps to the explicit password-permitted profile.
   */
  requiredAuthStrength?: RequiredAuthStrength;
  /**
   * The **auth-reuse TTL** (ms) — how long a successful recipient step-up stays valid for REUSE across a LATER
   * handoff window for the SAME recipient (scenario-01 Phase 12: "auth still valid, no re-prompt"). On a successful
   * step-up the gateway records a short-lived `{recipient, auth_strength, expiresAt}` validity; a SECOND window's
   * grant for the SAME recipient, while that validity is unexpired AND satisfies the selected policy, is authorized
   * WITHOUT a fresh WebAuthn ceremony (no re-prompt). An expired/absent validity, or a DIFFERENT recipient, falls
   * back to a full step-up (Phase 6 behaviour). The grant is STILL verified cryptographically on every request +
   * upgrade — reuse only skips the interactive ceremony, never the grant check (recipient-specific, TTL-bounded,
   * not bypassable). Default 15 minutes (≈ the handoff window TTL). Set 0 to DISABLE reuse (always re-prompt).
   */
  authReuseTtlMs?: number;
  /**
   * The externally reachable public base URL. When it contains a non-root path, generated links and browser
   * same-origin calls use that public prefix while internal route scope paths remain root-shaped.
   */
  publicBaseUrl?: string;
  /**
   * Trust `X-Forwarded-Prefix` as proof that a stripping reverse proxy received the configured public prefix.
   *
   * Default false: prefix-preserving proxying works without trusting client-supplied headers, and a direct client
   * cannot publish unprefixed aliases by spoofing the header. Enable only behind an edge that overwrites or strips
   * incoming `X-Forwarded-Prefix` before forwarding to GLA.
   */
  trustForwardedPrefix?: boolean;
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
  /**
   * Provider-owned browser-client asset trees. This is static client hosting only; every capsule connection still
   * goes through grant-verified route upgrades.
   */
  entrypointClientAssets?: EntrypointClientAssetMount[];
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

function staleGrantReasonProvesIssuedLink(reason: ErrorCode): boolean {
  return reason === "auth.expired" || reason === "auth.revoked" || reason === "auth.not_yet_valid";
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
  private readonly authAssurancePolicy: AuthAssurancePolicy;
  private readonly host: string;
  private readonly port: number;
  private server: Server | undefined;
  /** The route table programmed by the Route controller, keyed by public path. A route binds to one grant. */
  private readonly routes = new Map<string, ProgrammedRoute>();
  /** Recently-unmounted handoff paths, retained only to classify stale links as typed auth refusals. */
  private readonly retiredRoutes = new Map<string, RetiredRoute>();
  /**
   * The per-grant step-up marker: a grant id whose bound recipient has authenticated to the selected policy
   * (so the next WS upgrade for that grant is authorized). It is the small mutable edge state the step-up needs —
   * the WS upgrade still verifies the grant STATELESSLY (signature/recipient/TTL/scope/revocation) AND checks this
   * marker. Cleared on the grant's revoke/force-close so a revoked grant cannot reach the capsule.
   */
  private readonly authorizedGrants = new Set<CapabilityId>();
  /**
   * The RECIPIENT-level auth-reuse record (scenario-01 Phase 12, GLA-050/051): a successful step-up records the
   * recipient's `{auth_strength, expiresAt}`, keyed by the recipient READ FROM THE SIGNED GRANT (never client-
   * supplied). A LATER window's grant for the SAME recipient, while this is unexpired AND meets the required
   * strength, is authorized WITHOUT a fresh ceremony (no re-prompt). It is the small mutable edge state the reuse
   * needs; the grant is STILL verified cryptographically every request/upgrade (reuse skips only the interactive
   * WebAuthn ceremony, never the grant check) — so reuse is recipient-specific, TTL-bounded, and not bypassable.
   */
  private readonly recipientAuth = new Map<
    RecipientRef,
    { assurance: AuthAssuranceEvidence | AuthStrength; expiresAt: number }
  >();
  /** The auth-reuse TTL (ms) — how long a step-up stays valid for reuse on a later window. 0 disables reuse. */
  private readonly authReuseTtlMs: number;
  /** The public URL/path contract used for links, page calls, and inbound prefix normalization. */
  private readonly publicBase: PublicBase;
  /** Whether to trust `X-Forwarded-Prefix` for strip-prefix proxy mode. */
  private readonly trustForwardedPrefix: boolean;
  /** Live proxied sockets per grant id, so a revoke/force-close can sever them (GLA-039 AC#3). */
  private readonly liveSockets = new Map<CapabilityId, Set<Socket>>();
  /** The WS-proxy upstream connect timeout (ms) — a stalled dial cannot pin an fd waiting on `connect`. */
  private readonly proxyConnectTimeoutMs: number;
  /** The WS-proxy idle timeout (ms) applied to both proxied sockets — a stalled stream cannot pin fds. 0 disables. */
  private readonly proxyIdleTimeoutMs: number;
  /** Provider browser-client assets served from local read-only roots, grouped by provider ref. */
  private readonly entrypointClientAssets = new Map<string, EntrypointClientAssetMount[]>();
  /** Short-lived same-origin stream tickets that let browser WebSockets avoid grant-bearing URLs. */
  private readonly streamTickets = new Map<
    string,
    { grant: OpaqueToken; grantId: CapabilityId; routePath: string; expiresAt: number }
  >();
  /** Server-side bootstrap tickets: public pages hold only opaque cookie ids, never raw grant values. */
  private readonly grantBootstrapTickets = new Map<
    string,
    { grant: OpaqueToken; purpose: "enroll" | "handoff"; routePath?: string; expiresAt: number }
  >();
  /**
   * Delegated enrollment redirects consume the GLA grant before leaving this origin. The callback may finish only
   * once for a nonce recorded here; abandonment leaves the grant spent and the pending attempt harmlessly unusable.
   */
  private readonly pendingDelegatedEnrollmentNonces = new Set<string>();

  constructor(opts: GatewayOptions) {
    this.grants = opts.grants;
    this.identity = opts.identity;
    this.sessionGrants = opts.sessionGrants;
    this.stepUp = opts.stepUp;
    this.authAssurancePolicy =
      opts.authAssurancePolicy ??
      (opts.requiredAuthStrength !== undefined
        ? authAssurancePolicyFromRequiredAuthStrength(opts.requiredAuthStrength)
        : authAssurancePolicyFromProfile());
    this.authReuseTtlMs = opts.authReuseTtlMs ?? 15 * 60 * 1000;
    this.publicBase = parsePublicBaseUrl(opts.publicBaseUrl ?? "http://localhost/");
    this.host = opts.host ?? "0.0.0.0";
    this.port = opts.port ?? 3000;
    this.proxyConnectTimeoutMs = opts.proxyConnectTimeoutMs ?? 10_000;
    this.proxyIdleTimeoutMs = opts.proxyIdleTimeoutMs ?? 120_000;
    this.trustForwardedPrefix = opts.trustForwardedPrefix ?? false;
    for (const mount of opts.entrypointClientAssets ?? []) {
      const normalized = normalizeClientAssetMount(mount);
      if (normalized === undefined) {
        continue;
      }
      const existing = this.entrypointClientAssets.get(normalized.ref) ?? [];
      existing.push(normalized);
      this.entrypointClientAssets.set(normalized.ref, existing);
    }
  }

  /** Start listening. Returns the actual bound `{ host, port }` (port is the ephemeral one when 0 was requested). */
  async listen(): Promise<{ host: string; port: number }> {
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    // The upgrade is the human side of the two-actor capsule: verify the grant + require the bound identity,
    // then proxy the AUTHORIZED upgrade to the mounted entrypoint transport and nothing else (GLA-038/039 AC#1).
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
    return publicUrl(baseUrl, "/enroll", { grant });
  }

  /** Build a recipient-bound handoff link for a grant token + the route path, given the public base URL. */
  static handoffLink(baseUrl: string, path: string, grant: OpaqueToken): string {
    return publicUrl(baseUrl, path, { grant });
  }

  // ── RouteGatewayPort — the Route controller programs the gateway (Slice 4b, GLA-033) ──────────────────────

  /**
   * Mount a grant-bound route (the gateway is the Route controller's abstract edge). After this, `path` is publicly
   * reachable but ONLY within an open authorized window — every request + WS upgrade still verifies the bound grant
   * statelessly and requires the bound identity. Replacing an existing route on the same path re-binds it.
   */
  async mount(route: RouteMountRequest): Promise<void> {
    validateTransportBinding(route.transport);
    this.retiredRoutes.delete(route.authorization.path);
    this.routes.set(route.authorization.path, {
      ...route.authorization,
      transport: route.transport,
      client: route.client,
    });
  }

  /**
   * Unmount a route by id — remove it from the table AND force-close any live WS bound to its grant (GLA-039 AC#3:
   * the surface is no longer reachable). Idempotent: a no-op if no route with that id is mounted.
   */
  async unmount(routeId: RouteId): Promise<void> {
    for (const [path, route] of [...this.routes.entries()]) {
      if (route.routeId === routeId) {
        this.routes.delete(path);
        this.rememberRetiredRoute(route);
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
    this.deleteStreamTicketsForGrant(grantId);
  }

  /** The single request router. Every enrollment + handoff route verifies the grant FIRST — no bypass. */
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = this.internalRequestPath(url.pathname, req);
      if (path === undefined) {
        this.sendJson(res, 404, { error: { code: "catalog.unknown", message: "not found" } });
        return;
      }
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

      // ── Delegated-auth callback landing. Provider-neutral: it restores same-origin GLA state and re-POSTs
      // `{code,state}` to the unchanged verify routes. The IdP never receives the GLA grant.
      if (method === "GET" && path === "/auth/callback") {
        this.sendHtml(
          res,
          200,
          authCallbackPageHtml({
            enrollVerify: this.publicPath("/enroll/verify"),
            handoffVerify: this.publicPath("/handoff/auth/verify"),
            clientAssets: this.publicPath("/handoff/client-assets"),
          }),
        );
        return;
      }

      if (method === "GET" && path.startsWith("/handoff/client-assets/")) {
        await this.handleClientAsset(path, res);
        return;
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
      const retiredRoute = this.retiredRouteForPath(path);
      if (method === "GET" && retiredRoute !== undefined) {
        this.handleStaleHandoffPage(url, retiredRoute, res);
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
   * `GET /enroll?grant=<token>` — verify the grant, set an HttpOnly bootstrap ticket, then serve the enrollment
   * page without embedding the raw grant. The recipient is read from the VERIFIED grant (never a query param), so a
   * forwarded link is bound to its recipient. An absent grant → 400; an invalid/expired/wrong-recipient/reused grant
   * → 403, the refusal page.
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
    this.sendHtml(
      res,
      200,
      enrollPageHtml(String(verified.recipient), {
        options: this.publicPath("/enroll/options"),
        verify: this.publicPath("/enroll/verify"),
      }),
      {
        "set-cookie": this.createGrantBootstrapCookie(
          ENROLL_BOOTSTRAP_COOKIE,
          "enroll",
          grant as OpaqueToken,
        ),
      },
    );
  }

  /**
   * `POST /enroll/options` — re-verify the grant (every request), then return registration options for the bound
   * recipient. Redirect-shaped delegated options spend the GLA grant before the browser leaves this origin; abandoning
   * the provider flow then requires a fresh invite. In-page WebAuthn options stay retryable until verify consumes.
   */
  private async handleEnrollOptions(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const grants = this.grants;
    const identity = this.identity;
    if (grants === undefined || identity === undefined) {
      this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
      return;
    }
    const body = await this.readJson(req);
    const grant = this.enrollmentGrantFromRequest(body, req);
    if (grant === undefined) {
      this.sendJson(res, 400, this.errBody("usage.bad_argument", "missing grant"));
      return;
    }
    const verified = grants.verifyEnrollmentGrantToken(grant);
    if (!verified.ok) {
      this.sendJson(
        res,
        statusForReason(verified.reason),
        this.errBody(verified.reason, "enrollment grant rejected"),
      );
      return;
    }
    const options = await identity.enrollmentOptions(verified.recipient, grant);
    if (isDelegatedEnrollmentOptions(options)) {
      const consumed = grants.tryConsumeEnrollmentGrantToken(grant);
      if (!consumed.ok) {
        this.sendJson(
          res,
          statusForReason(consumed.reason),
          this.errBody(consumed.reason, "enrollment grant rejected"),
        );
        return;
      }
      this.pendingDelegatedEnrollmentNonces.add(consumed.nonce);
    }
    this.sendJson(res, 200, options as Record<string, unknown>);
  }

  /**
   * `POST /enroll/verify` — verify the attestation + store the credential. No bypass: a direct POST with no/invalid
   * grant is refused and stores nothing (GLA-012 AC#2).
   *
   * In-page WebAuthn consumes here, before the ceremony, atomically: two concurrent verifies cannot both proceed. If
   * the local ceremony fails, the consume is rolled back so the same still-valid grant stays retryable. Delegated
   * callbacks are different: the grant was already consumed by redirect-shaped `/enroll/options`; callback completion
   * must match that pending nonce once, and failure/abandonment leaves the grant spent so recovery uses a fresh invite.
   */
  private async handleEnrollVerify(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const grants = this.grants;
    const identity = this.identity;
    if (grants === undefined || identity === undefined) {
      this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
      return;
    }
    const body = await this.readJson(req);
    const grant = this.enrollmentGrantFromRequest(body, req);
    if (grant === undefined) {
      // NO BYPASS: a verify with no grant is refused before any credential work.
      this.sendJson(res, 401, this.errBody("auth.insufficient", "missing enrollment grant"));
      return;
    }
    // Validate the request BEFORE consuming the grant, so a malformed body (no attestation) never burns it.
    if (body.attestation === undefined) {
      // The grant must still verify (no-bypass) — read-only check, no consume.
      const check = grants.verifyEnrollmentGrantToken(grant);
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
    if (isDelegatedRedirectAttestation(body.attestation)) {
      const verified = grants.verifyConsumedEnrollmentGrantToken(grant);
      if (!verified.ok) {
        this.sendJson(
          res,
          statusForReason(verified.reason),
          this.errBody(verified.reason, "enrollment grant rejected"),
        );
        return;
      }
      if (!this.pendingDelegatedEnrollmentNonces.delete(verified.nonce)) {
        this.sendJson(res, 403, this.errBody("auth.revoked", "enrollment grant rejected"));
        return;
      }
      try {
        const record = await identity.enrollComplete(verified.recipient, body.attestation);
        this.deleteGrantBootstrapTicketFromRequest(req, ENROLL_BOOTSTRAP_COOKIE);
        this.sendJson(
          res,
          200,
          {
            enrolled: true,
            auth_strength: this.readEnrolledStrength(record),
          },
          { "set-cookie": this.clearCookie(ENROLL_BOOTSTRAP_COOKIE) },
        );
      } catch (e) {
        const code = isCoded(e) ? e.code : "auth.insufficient";
        this.sendJson(res, 403, this.errBody(code, "enrollment attestation did not verify"));
      }
      return;
    }
    // ATOMIC verify-and-consume: marks the single-use nonce spent in the same synchronous step as the verify, so
    // a concurrent second verify of the same grant observes it already spent and is refused.
    const verified = grants.tryConsumeEnrollmentGrantToken(grant);
    if (!verified.ok) {
      this.sendJson(
        res,
        statusForReason(verified.reason),
        this.errBody(verified.reason, "enrollment grant rejected"),
      );
      return;
    }
    let record: unknown;
    try {
      record = await identity.enrollComplete(verified.recipient, body.attestation);
    } catch (e) {
      // A failed ceremony stores NOTHING. WebAuthn's in-page attestation stays retryable with the same live grant;
      // delegated redirect callbacks stay spent once they return, so a failed delegated enrollment cannot reuse
      // the same GLA invite. In both cases, recovery is a fresh operator invite.
      if (!isDelegatedRedirectAttestation(body.attestation)) {
        grants.unspend(verified.nonce);
      }
      const code = isCoded(e) ? e.code : "auth.insufficient";
      this.sendJson(res, 403, this.errBody(code, "enrollment attestation did not verify"));
      return;
    }
    // Success: the credential is stored bound to the recipient; the grant is already consumed (single-use) so it can
    // never be reused (GLA-013 AC#2). ECHO the strength the identity service actually recorded (provider-agnostic —
    // `"webauthn"` for a passkey enrollment, `"password"` for a password-grade delegated one), matching the handoff
    // verify response's `auth_strength: factResult.authStrength` echo (no hardcoded strength, no provider special-case).
    this.deleteGrantBootstrapTicketFromRequest(req, ENROLL_BOOTSTRAP_COOKIE);
    this.sendJson(
      res,
      200,
      { enrolled: true, auth_strength: this.readEnrolledStrength(record) },
      { "set-cookie": this.clearCookie(ENROLL_BOOTSTRAP_COOKIE) },
    );
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
      this.sendJson(
        res,
        statusForReason(verified.reason),
        this.errBody(verified.reason, "handoff grant rejected"),
      );
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
    // ── AUTH REUSE (scenario-01 Phase 12, GLA-050/051): if THIS recipient's prior step-up is still VALID (unexpired
    //    + sufficient strength), authorize THIS grant WITHOUT a fresh ceremony and serve a page that opens the stream
    //    DIRECTLY (no re-prompt). The recipient is the SIGNED grant's caveat (recipient-specific); the grant was just
    //    verified above (not bypassable). An expired/absent validity falls through to the full step-up page (Phase 6).
    if (this.recipientAuthValid(verified.recipient)) {
      this.authorizedGrants.add(verified.capability.id as CapabilityId);
      const streamCookie = this.createStreamTicketCookie(
        grant as OpaqueToken,
        verified.capability.id as CapabilityId,
        route,
      );
      this.sendHtml(
        res,
        200,
        handoffReusedPageHtml(
          grant,
          route.path,
          String(verified.recipient),
          this.publicPath(route.path),
          route.client,
          this.publicPath("/handoff/client-assets"),
        ),
        { "set-cookie": streamCookie },
      );
      return;
    }
    // Serve the step-up page (runs navigator.credentials.get against the recipient's registered credential).
    this.sendHtml(
      res,
      200,
      handoffPageHtml(grant, route.path, String(verified.recipient), {
        authOptions: this.publicPath("/handoff/auth/options"),
        authVerify: this.publicPath("/handoff/auth/verify"),
        stream: this.publicPath(route.path),
        clientAssets: this.publicPath("/handoff/client-assets"),
        entrypointClient: route.client,
      }),
      {
        "set-cookie": this.createGrantBootstrapCookie(
          HANDOFF_BOOTSTRAP_COOKIE,
          "handoff",
          grant as OpaqueToken,
          route.path,
        ),
      },
    );
  }

  /**
   * `POST /handoff/auth/options` — re-verify the grant (every request, no bypass), then return step-up
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
    const route = this.routeForBody(body);
    if (route === undefined) {
      const grant = this.handoffGrantFromBody(body, req);
      const retiredRoute = this.retiredRouteForBody(body);
      if (
        grant !== undefined &&
        retiredRoute !== undefined &&
        this.sendStaleHandoffJson(res, grant, retiredRoute)
      ) {
        return;
      }
      this.sendJson(res, 400, this.errBody("usage.bad_argument", "missing grant or unknown route"));
      return;
    }
    const grant = this.handoffGrantFromBody(body, req, route.path);
    if (grant === undefined) {
      this.sendJson(res, 400, this.errBody("usage.bad_argument", "missing grant or unknown route"));
      return;
    }
    const verified = this.verifyHandoffGrant(grant, route);
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
   * `POST /handoff/auth/verify` — resolve the bootstrap ticket or legacy body grant (no bypass), then verify the
   * recipient's opaque assertion against the selected auth provider. On a verified assertion that reaches the
   * required assurance, MARK the grant authorized and issue a short-lived HttpOnly stream ticket for the next WS
   * upgrade. A failed assertion → refused, NOT authorized. An un-enrolled recipient → a catchable refusal.
   */
  private async handleHandoffAuthVerify(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionGrants = this.sessionGrants;
    const stepUp = this.stepUp;
    if (sessionGrants === undefined || stepUp === undefined) {
      this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
      return;
    }
    const body = await this.readJson(req);
    const route = this.routeForBody(body);
    if (route === undefined) {
      const grant = this.handoffGrantFromBody(body, req);
      const retiredRoute = this.retiredRouteForBody(body);
      if (
        grant !== undefined &&
        retiredRoute !== undefined &&
        this.sendStaleHandoffJson(res, grant, retiredRoute)
      ) {
        return;
      }
      this.sendJson(res, 400, this.errBody("usage.bad_argument", "missing grant or unknown route"));
      return;
    }
    const grant = this.handoffGrantFromBody(body, req, route.path);
    if (grant === undefined) {
      this.sendJson(res, 400, this.errBody("usage.bad_argument", "missing grant or unknown route"));
      return;
    }
    const verified = this.verifyHandoffGrant(grant, route);
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
    let factResult: { ok: boolean; authStrength: AuthStrength; assurance?: AuthAssuranceEvidence };
    try {
      factResult = await stepUp.verifyAuthentication(verified.recipient, body.assertion);
    } catch {
      this.sendJson(res, 403, this.errBody("auth.insufficient", "step-up verification failed"));
      return;
    }
    const assurance = factResult.assurance ?? factResult.authStrength;
    if (!factResult.ok || !this.strengthSufficient(assurance)) {
      // A failed assertion or an insufficient strength → refused, the grant is NOT authorized (GLA-035 AC#…).
      this.sendJson(
        res,
        403,
        this.errBody(
          "auth.insufficient",
          "step-up did not satisfy the selected auth assurance policy",
        ),
      );
      return;
    }
    // The bound recipient satisfied the selected policy: authorize the grant so its WS upgrade proxies.
    this.authorizedGrants.add(verified.capability.id as CapabilityId);
    // Record the RECIPIENT-level auth validity for REUSE on a later window (scenario-01 Phase 12, GLA-050/051) —
    // keyed by the recipient from the SIGNED grant, TTL-bounded. A second window's grant for THIS recipient, while
    // unexpired + sufficient, skips the ceremony. Disabled when the reuse TTL is 0.
    this.recordRecipientAuth(verified.recipient, assurance);
    this.deleteGrantBootstrapTicketFromRequest(req, HANDOFF_BOOTSTRAP_COOKIE);
    this.sendJson(
      res,
      200,
      { authorized: true, auth_strength: factResult.authStrength },
      {
        "set-cookie": [
          this.clearCookie(HANDOFF_BOOTSTRAP_COOKIE),
          this.createStreamTicketCookie(grant, verified.capability.id as CapabilityId, route),
        ],
      },
    );
  }

  /**
   * Handle a WebSocket upgrade on a handoff route (the human reaching the capsule surface — GLA-038/039). VERIFY the
   * recipient-bound grant statelessly AND require that the bound recipient already authenticated to the required
   * strength (the grant is in the authorized set). Browser upgrades normally present a one-use HttpOnly stream
   * ticket instead of a raw grant in the URL; legacy query grants are still accepted for compatibility. Only an
   * AUTHORIZED, in-window upgrade is proxied to the mounted transport binding — and NOTHING else (GLA-038 AC#1).
   */
  private handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = this.internalRequestPath(url.pathname, req);
      const route = path !== undefined ? this.routes.get(path) : undefined;
      const retiredRoute = path !== undefined ? this.retiredRouteForPath(path) : undefined;
      const sessionGrants = this.sessionGrants;
      if (route === undefined || sessionGrants === undefined) {
        if (retiredRoute !== undefined && sessionGrants !== undefined) {
          const grant = this.handoffGrantFromRequest(url, req, retiredRoute.path);
          if (grant === undefined) {
            this.refuseUpgrade(socket, 404);
            return;
          }
          const refusal = this.staleHandoffRefusal(grant as OpaqueToken, retiredRoute);
          if (refusal === undefined) {
            this.refuseUpgrade(socket, 404);
            return;
          }
          this.refuseUpgrade(socket, statusForReason(refusal.code));
          return;
        }
        // No such route is publicly reachable (the route exists only while its window is open — GLA-039 AC#2).
        this.refuseUpgrade(socket, 404);
        return;
      }
      const grant = this.handoffGrantFromRequest(url, req, route.path);
      if (grant === undefined) {
        this.refuseUpgrade(socket, 400);
        return;
      }
      const verified = this.verifyHandoffGrant(grant as OpaqueToken, route);
      if (!verified.ok) {
        // Absent/wrong-recipient/expired/revoked grant → refused; resolves onward to nothing (GLA-035 AC#2/#3).
        this.refuseUpgrade(socket, statusForReason(verified.reason));
        return;
      }
      // Require the bound identity: the grant must have been authorized by a successful step-up (GLA-035 AC#4) —
      // OR, on a SECOND window, by a still-VALID reused auth for the bound recipient (GLA-050/051: no re-prompt).
      // Reuse authorizes THIS grant only when the recipient's prior step-up is unexpired + sufficient; an
      // expired/absent validity (or a different recipient) is NOT authorized → refused. The grant was already
      // verified statelessly above, so reuse never bypasses the grant check.
      const grantId = verified.capability.id as CapabilityId;
      if (!this.authorizedGrants.has(grantId)) {
        if (this.recipientAuthValid(verified.recipient)) {
          this.authorizedGrants.add(grantId);
        } else {
          this.refuseUpgrade(socket, 401);
          return;
        }
      }
      // AUTHORIZED, in-window: proxy the upgrade to the mounted transport binding and NOTHING else.
      this.proxyUpgrade(req, socket, head, route, grantId);
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

  private sendJson(
    res: ServerResponse,
    status: number,
    body: Record<string, unknown>,
    headers: OutgoingHttpHeaders = {},
  ): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload),
      ...NO_STORE_SECURITY_HEADERS,
      ...headers,
    });
    res.end(payload);
  }

  private sendHtml(
    res: ServerResponse,
    status: number,
    html: string,
    headers: OutgoingHttpHeaders = {},
  ): void {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(html),
      ...NO_STORE_SECURITY_HEADERS,
      ...headers,
    });
    res.end(html);
  }

  private async handleClientAsset(path: string, res: ServerResponse): Promise<void> {
    const asset = resolveClientAssetRequest(path, this.entrypointClientAssets);
    if (asset === undefined) {
      this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
      return;
    }
    try {
      const root = await realpath(asset.root);
      const file = await realpath(asset.path);
      const rel = relative(root, file);
      if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
        this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
        return;
      }
      const fileStat = await stat(file);
      if (!fileStat.isFile()) {
        this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": contentTypeForPath(file),
        "content-length": body.byteLength,
        "cache-control": asset.cacheControl ?? "no-cache",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      });
      res.end(body);
    } catch {
      this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
    }
  }

  // ── handoff helpers ───────────────────────────────────────────────────────────────────────────────────

  /** Public same-origin path for an internal gateway route path. */
  private publicPath(routePath: string): string {
    return publicPath(this.publicBase, routePath);
  }

  /** Map an inbound request path to the internal route table path, or undefined if outside the public base. */
  private internalRequestPath(pathname: string, req: IncomingMessage): string | undefined {
    const forwardedPrefix = firstHeader(req.headers["x-forwarded-prefix"]);
    return internalPathForPublicRequest(
      this.publicBase,
      pathname,
      forwardedPrefix,
      this.trustForwardedPrefix,
    );
  }

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

  private retiredRouteForBody(body: EnrollBody): RetiredRoute | undefined {
    if (typeof body.path !== "string" || body.path.length === 0) {
      return undefined;
    }
    return this.retiredRouteForPath(body.path);
  }

  private retiredRouteForPath(path: string): RetiredRoute | undefined {
    const route = this.retiredRoutes.get(path);
    if (route === undefined) {
      return undefined;
    }
    const maxAgeMs = 15 * 60 * 1000;
    if (Date.now() - route.retiredAt > maxAgeMs) {
      this.retiredRoutes.delete(path);
      return undefined;
    }
    return route;
  }

  private rememberRetiredRoute(route: ProgrammedRoute): void {
    const maxRetiredRoutes = 128;
    this.retiredRoutes.set(route.path, { ...route, retiredAt: Date.now() });
    while (this.retiredRoutes.size > maxRetiredRoutes) {
      const oldest = this.retiredRoutes.keys().next().value as string | undefined;
      if (oldest === undefined) {
        return;
      }
      this.retiredRoutes.delete(oldest);
    }
  }

  private handleStaleHandoffPage(url: URL, route: RetiredRoute, res: ServerResponse): void {
    const grant = url.searchParams.get("grant");
    if (grant === null || grant.length === 0) {
      this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
      return;
    }
    if (!this.sendStaleHandoffJson(res, grant as OpaqueToken, route)) {
      this.sendJson(res, 404, this.errBody("catalog.unknown", "not found"));
    }
  }

  private sendStaleHandoffJson(
    res: ServerResponse,
    grant: OpaqueToken,
    route: RetiredRoute,
  ): boolean {
    const refusal = this.staleHandoffRefusal(grant, route);
    if (refusal === undefined) {
      return false;
    }
    this.sendJson(res, statusForReason(refusal.code), this.errBody(refusal.code, refusal.message));
    return true;
  }

  private staleHandoffRefusal(
    grant: OpaqueToken,
    route: RetiredRoute,
  ): { code: ErrorCode; message: string } | undefined {
    const verified = this.verifyHandoffGrant(grant, route);
    if (!verified.ok) {
      if (!staleGrantReasonProvesIssuedLink(verified.reason)) {
        return undefined;
      }
      if (!this.staleGrantMatchesRoute(grant, route)) {
        return undefined;
      }
      return { code: verified.reason, message: "handoff grant rejected" };
    }
    return { code: "auth.revoked", message: "handoff window is no longer open" };
  }

  private staleGrantMatchesRoute(grant: OpaqueToken, route: RetiredRoute): boolean {
    const sessionGrants = this.sessionGrants;
    const prove = sessionGrants?.proveStaleSessionGrantRoute;
    if (sessionGrants === undefined || prove === undefined) {
      return false;
    }
    return prove.call(sessionGrants, grant, { scopePath: route.path }).ok;
  }

  /** Is a step-up's reported fact sufficient for the selected provider-neutral assurance policy? */
  private strengthSufficient(assurance: AuthAssuranceEvidence | AuthStrength): boolean {
    return authAssuranceSufficient(assurance, this.authAssurancePolicy);
  }

  /**
   * Read the recorded `auth_strength` off whatever the identity service returned from `enrollComplete` (an opaque
   * `unknown` at this seam — the gateway is provider-agnostic and never names a provider). The identity service
   * returns its `EnrollmentRecord` (`{ authStrength, … }`); we echo that recorded fact so the enroll-verify response
   * is TRUTHFUL under either provider (`"webauthn"` for a passkey enrollment, `"password"` for a password-grade
   * delegated one). If the value is missing/out-of-shape (a custom seam that returns nothing), fail to the WEAKEST
   * strength `"none"` — an auth-fact default must never OVER-report (a defensive default on an auth surface fails
   * closed, not open). NO provider knowledge — just the fact. (In the real composition the identity service always
   * returns a well-formed record, so this fallback is unreachable; it is belt-and-suspenders for a custom seam.)
   */
  private readEnrolledStrength(record: unknown): AuthStrength {
    if (typeof record === "object" && record !== null) {
      const s = (record as { authStrength?: unknown }).authStrength;
      if (s === "none" || s === "password" || s === "webauthn") {
        return s;
      }
    }
    return "none";
  }

  /**
   * Record a recipient's successful step-up for REUSE on a later window (GLA-050/051), TTL-bounded by `authReuseTtlMs`
   * from now. Keyed by the recipient READ FROM THE SIGNED GRANT (recipient-specific). A 0 TTL disables reuse (records
   * nothing → every window re-prompts).
   */
  private recordRecipientAuth(
    recipient: RecipientRef,
    assurance: AuthAssuranceEvidence | AuthStrength,
  ): void {
    if (this.authReuseTtlMs <= 0) {
      return; // reuse disabled — never re-prompt-free.
    }
    this.recipientAuth.set(recipient, {
      assurance,
      expiresAt: Date.now() + this.authReuseTtlMs,
    });
  }

  /**
   * Is this recipient's prior step-up still VALID for reuse — an unexpired record whose strength meets the required
   * strength (GLA-050/051)? An EXPIRED record is pruned and treated as absent (so a later check re-prompts). A
   * different recipient (no record) is not valid. The check is the only thing reuse consults beyond the (already
   * performed) cryptographic grant verify — so reuse stays recipient-specific + TTL-bounded + non-bypassable.
   */
  private recipientAuthValid(recipient: RecipientRef): boolean {
    if (this.authReuseTtlMs <= 0) {
      return false;
    }
    const rec = this.recipientAuth.get(recipient);
    if (rec === undefined) {
      return false;
    }
    if (Date.now() >= rec.expiresAt) {
      // Expired: prune it so a stale record can never authorize, and the next window re-prompts (Phase 6).
      this.recipientAuth.delete(recipient);
      return false;
    }
    return this.strengthSufficient(rec.assurance);
  }

  /**
   * Is this recipient's auth currently valid for reuse? (A probe for tests/observability — GLA-050/051: a returning
   * recipient within the TTL reuses; an expired one re-prompts.) Read-only.
   */
  isRecipientAuthValid(recipient: RecipientRef): boolean {
    return this.recipientAuthValid(recipient);
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
      socket.write(
        `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\n\r\n`,
      );
    } catch {
      // The socket may already be gone; nothing to do.
    }
    socket.destroy();
  }

  /**
   * Proxy an AUTHORIZED upgrade to the route's reverse-proxy transport binding — and nothing else (GLA-038/039
   * AC#1). Opens a raw TCP connection to the upstream host:port, replays the WebSocket handshake (the upgrade request
   * line + headers) verbatim, then pipes bytes bidirectionally. The live socket is tracked per grant so a revoke/
   * expiry can force-close it (GLA-039 AC#3). If the upstream cannot be reached, the client upgrade is refused (502).
   */
  private proxyUpgrade(
    req: IncomingMessage,
    clientSocket: Socket,
    head: Buffer,
    route: ProgrammedRoute,
    grantId: CapabilityId,
  ): void {
    if (route.transport.kind !== "reverse-proxy" || route.transport.protocol !== "websocket") {
      this.refuseUpgrade(clientSocket, 502);
      return;
    }
    const target = parseWsEndpoint(route.transport.upstream);
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

      // Replay ONLY the WS-handshake-relevant headers to the upstream (the capsule-internal server completes
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
      // Pipe bytes both ways — the gateway is a transparent conduit to the mounted stream and NOTHING else. Every
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
      if (value.length === 0) {
        continue;
      }
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

  private handoffGrantFromRequest(
    url: URL,
    req: IncomingMessage,
    routePath: string,
  ): OpaqueToken | undefined {
    const queryGrant = url.searchParams.get("grant");
    if (queryGrant !== null && queryGrant.length > 0) {
      return queryGrant as OpaqueToken;
    }
    return this.takeStreamTicket(req, routePath);
  }

  private enrollmentGrantFromRequest(
    body: EnrollBody,
    req: IncomingMessage,
  ): OpaqueToken | undefined {
    if (typeof body.grant === "string" && body.grant.length > 0) {
      return body.grant as OpaqueToken;
    }
    return this.grantBootstrapFromRequest(req, ENROLL_BOOTSTRAP_COOKIE, "enroll");
  }

  private handoffGrantFromBody(
    body: EnrollBody,
    req: IncomingMessage,
    routePath?: string,
  ): OpaqueToken | undefined {
    if (typeof body.grant === "string" && body.grant.length > 0) {
      return body.grant as OpaqueToken;
    }
    return this.grantBootstrapFromRequest(req, HANDOFF_BOOTSTRAP_COOKIE, "handoff", routePath);
  }

  private createGrantBootstrapCookie(
    cookieName: string,
    purpose: "enroll" | "handoff",
    grant: OpaqueToken,
    routePath?: string,
  ): string {
    this.pruneExpiredGrantBootstrapTickets();
    const ticket = randomBytes(24).toString("base64url");
    this.grantBootstrapTickets.set(ticket, {
      grant,
      purpose,
      ...(routePath !== undefined ? { routePath } : {}),
      expiresAt: Date.now() + GRANT_BOOTSTRAP_TTL_MS,
    });
    return this.cookieHeader(
      cookieName,
      ticket,
      this.gatewayStateCookiePath(),
      GRANT_BOOTSTRAP_TTL_MS,
    );
  }

  private grantBootstrapFromRequest(
    req: IncomingMessage,
    cookieName: string,
    purpose: "enroll" | "handoff",
    routePath?: string,
  ): OpaqueToken | undefined {
    const ticket = parseCookieHeader(firstHeader(req.headers.cookie))[cookieName];
    if (ticket === undefined) {
      return undefined;
    }
    const record = this.grantBootstrapTickets.get(ticket);
    if (
      record === undefined ||
      record.purpose !== purpose ||
      Date.now() >= record.expiresAt ||
      (routePath !== undefined && record.routePath !== routePath)
    ) {
      this.grantBootstrapTickets.delete(ticket);
      return undefined;
    }
    return record.grant;
  }

  private deleteGrantBootstrapTicketFromRequest(req: IncomingMessage, cookieName: string): void {
    const ticket = parseCookieHeader(firstHeader(req.headers.cookie))[cookieName];
    if (ticket !== undefined) {
      this.grantBootstrapTickets.delete(ticket);
    }
  }

  private createStreamTicketCookie(
    grant: OpaqueToken,
    grantId: CapabilityId,
    route: ProgrammedRoute,
  ): string {
    this.pruneExpiredStreamTickets();
    const ticket = randomBytes(24).toString("base64url");
    this.streamTickets.set(ticket, {
      grant,
      grantId,
      routePath: route.path,
      expiresAt: Date.now() + STREAM_TICKET_TTL_MS,
    });
    return this.cookieHeader(
      STREAM_TICKET_COOKIE,
      ticket,
      this.publicPath(route.path),
      STREAM_TICKET_TTL_MS,
    );
  }

  private takeStreamTicket(req: IncomingMessage, routePath: string): OpaqueToken | undefined {
    const ticket = parseCookieHeader(firstHeader(req.headers.cookie))[STREAM_TICKET_COOKIE];
    if (ticket === undefined) {
      return undefined;
    }
    const record = this.streamTickets.get(ticket);
    this.streamTickets.delete(ticket);
    if (record === undefined || record.routePath !== routePath || Date.now() >= record.expiresAt) {
      return undefined;
    }
    return record.grant;
  }

  private deleteStreamTicketsForGrant(grantId: CapabilityId): void {
    for (const [ticket, record] of [...this.streamTickets.entries()]) {
      if (record.grantId === grantId) {
        this.streamTickets.delete(ticket);
      }
    }
  }

  private pruneExpiredStreamTickets(): void {
    const now = Date.now();
    for (const [ticket, record] of [...this.streamTickets.entries()]) {
      if (now >= record.expiresAt) {
        this.streamTickets.delete(ticket);
      }
    }
  }

  private pruneExpiredGrantBootstrapTickets(): void {
    const now = Date.now();
    for (const [ticket, record] of [...this.grantBootstrapTickets.entries()]) {
      if (now >= record.expiresAt) {
        this.grantBootstrapTickets.delete(ticket);
      }
    }
  }

  private clearCookie(cookieName: string): string {
    return this.cookieHeader(cookieName, "", this.gatewayStateCookiePath(), 0);
  }

  private cookieHeader(cookieName: string, value: string, path: string, ttlMs: number): string {
    const attrs = [
      `${cookieName}=${value}`,
      "HttpOnly",
      "SameSite=Strict",
      `Path=${path}`,
      `Max-Age=${Math.ceil(ttlMs / 1000)}`,
    ];
    if (this.publicBase.href.startsWith("https://")) {
      attrs.push("Secure");
    }
    return attrs.join("; ");
  }

  private gatewayStateCookiePath(): string {
    return this.publicBase.pathPrefix.length > 0 ? this.publicBase.pathPrefix : "/";
  }
}

function validateTransportBinding(transport: ReverseProxyTransportBinding): void {
  if (transport.kind !== "reverse-proxy") {
    throw layerError("reverse-proxy-transport", `unsupported transport kind: ${transport.kind}`);
  }
  if (typeof transport.upstream !== "string" || transport.upstream.length === 0) {
    throw layerError("reverse-proxy-transport", "missing reverse-proxy upstream");
  }
  if (transport.protocol === "websocket" && parseWsEndpoint(transport.upstream) === undefined) {
    throw layerError("reverse-proxy-transport", "invalid websocket upstream");
  }
}

function layerError(layer: string, message: string): Error {
  const err = new Error(message) as Error & { layer: string; detail: { layer: string } };
  err.layer = layer;
  err.detail = { layer };
  return err;
}

function normalizeClientAssetMount(
  mount: EntrypointClientAssetMount,
): EntrypointClientAssetMount | undefined {
  if (!/^[a-zA-Z0-9._-]+$/.test(mount.ref)) {
    return undefined;
  }
  const root = resolvePath(mount.root);
  if (root.length === 0) {
    return undefined;
  }
  return {
    ref: mount.ref,
    root,
    ...(mount.cacheControl !== undefined ? { cacheControl: mount.cacheControl } : {}),
  };
}

function resolveClientAssetRequest(
  path: string,
  mountsByRef: ReadonlyMap<string, readonly EntrypointClientAssetMount[]>,
): { path: string; root: string; cacheControl?: string } | undefined {
  const prefix = "/handoff/client-assets/";
  if (!path.startsWith(prefix)) {
    return undefined;
  }
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) {
    return undefined;
  }
  const ref = rest.slice(0, slash);
  if (!/^[a-zA-Z0-9._-]+$/.test(ref)) {
    return undefined;
  }
  const rawAssetPath = rest.slice(slash + 1);
  const segments = rawAssetPath.split("/").flatMap((segment) => {
    try {
      const decoded = decodeURIComponent(segment);
      return decoded.length === 0 ? [] : [decoded];
    } catch {
      return [".."];
    }
  });
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))
  ) {
    return undefined;
  }
  for (const mount of mountsByRef.get(ref) ?? []) {
    const root = resolvePath(mount.root);
    const candidate = resolvePath(root, ...segments);
    const rel = relative(root, candidate);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      continue;
    }
    return {
      path: candidate,
      root,
      ...(mount.cacheControl !== undefined ? { cacheControl: mount.cacheControl } : {}),
    };
  }
  return undefined;
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

/** Parse a websocket-compatible endpoint into `{ host, port, path }`, or undefined if malformed. */
function parseWsEndpoint(
  endpoint: string,
): { host: string; port: number; path: string } | undefined {
  try {
    if (!/^wss?:/i.test(endpoint)) {
      return undefined;
    }
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

function isDelegatedRedirectAttestation(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.code === "string" && typeof record.state === "string";
}

function isDelegatedEnrollmentOptions(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.kind === "redirect" && typeof record.authorizeUrl === "string";
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === undefined || rawName.length === 0 || rawValue.length === 0) {
      continue;
    }
    out[rawName] = rawValue.join("=");
  }
  return out;
}
