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
import type { AddressInfo } from "node:net";
import type { Capability, ErrorCode, OpaqueToken, RecipientRef } from "@gla/kernel";
import { enrollPageHtml, refusalPageHtml } from "./enroll-page.js";

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

/** Construction options for the Access Gateway. */
export interface GatewayOptions {
  /** The grant-verification seam (the Capability service). */
  grants: EnrollmentGrantPort;
  /** The identity/enrollment seam (the Identity service, wired with the auth provider). */
  identity: IdentityEnrollPort;
  /**
   * The bind host. Default `0.0.0.0` (the hermes-1 deployment target, behind host Caddy). Tests pass `127.0.0.1`
   * with an ephemeral port.
   */
  host?: string;
  /** The bind port. Default `3000` (the deploy target); tests pass `0` for an ephemeral port. */
  port?: number;
}

/** A parsed enrollment request body (`{ grant, attestation? }`). */
interface EnrollBody {
  grant?: string;
  attestation?: unknown;
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
  private readonly grants: EnrollmentGrantPort;
  private readonly identity: IdentityEnrollPort;
  private readonly host: string;
  private readonly port: number;
  private server: Server | undefined;

  constructor(opts: GatewayOptions) {
    this.grants = opts.grants;
    this.identity = opts.identity;
    this.host = opts.host ?? "0.0.0.0";
    this.port = opts.port ?? 3000;
  }

  /** Start listening. Returns the actual bound `{ host, port }` (port is the ephemeral one when 0 was requested). */
  async listen(): Promise<{ host: string; port: number }> {
    const server = createServer((req, res) => {
      void this.handle(req, res);
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

  /** Stop listening (idempotent). */
  async close(): Promise<void> {
    const server = this.server;
    if (server === undefined) {
      return;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.server = undefined;
  }

  /** Build an enrollment invite link for a recipient's grant token, given the public base URL. */
  static enrollLink(baseUrl: string, grant: OpaqueToken): string {
    const u = new URL("/enroll", baseUrl);
    u.searchParams.set("grant", grant);
    return u.toString();
  }

  /** The single request router. Every enrollment route verifies the grant FIRST — no bypass. */
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;
      const method = (req.method ?? "GET").toUpperCase();

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
      // Nothing else is publicly reachable on the gateway in Phase E.
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
    const grant = url.searchParams.get("grant");
    if (grant === null || grant.length === 0) {
      this.sendHtml(res, 400, refusalPageHtml("missing grant"));
      return;
    }
    const verified = this.grants.verifyEnrollmentGrantToken(grant as OpaqueToken);
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
    const body = await this.readJson(req);
    const grant = body.grant;
    if (typeof grant !== "string" || grant.length === 0) {
      this.sendJson(res, 400, this.errBody("usage.bad_argument", "missing grant"));
      return;
    }
    const verified = this.grants.verifyEnrollmentGrantToken(grant as OpaqueToken);
    if (!verified.ok) {
      this.sendJson(
        res,
        statusForReason(verified.reason),
        this.errBody(verified.reason, "enrollment grant rejected"),
      );
      return;
    }
    const options = await this.identity.enrollmentOptions(verified.recipient, grant as OpaqueToken);
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
      const check = this.grants.verifyEnrollmentGrantToken(grant as OpaqueToken);
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
    const verified = this.grants.tryConsumeEnrollmentGrantToken(grant as OpaqueToken);
    if (!verified.ok) {
      this.sendJson(
        res,
        statusForReason(verified.reason),
        this.errBody(verified.reason, "enrollment grant rejected"),
      );
      return;
    }
    try {
      await this.identity.enrollComplete(verified.recipient, body.attestation);
    } catch (e) {
      // A failed/abandoned ceremony: refuse, store NOTHING, and ROLL BACK the consume so the still-valid grant is
      // retryable (no half-bound — GLA-013 AC#4). The error code is the typed one identity threw when present.
      this.grants.unspend(verified.nonce);
      const code = isCoded(e) ? e.code : "auth.insufficient";
      this.sendJson(res, 403, this.errBody(code, "enrollment attestation did not verify"));
      return;
    }
    // Success: the credential is stored bound to the recipient with auth_strength=webauthn; the grant is already
    // consumed (single-use) so it can never be reused (GLA-013 AC#2).
    this.sendJson(res, 200, { enrolled: true, auth_strength: "webauthn" });
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
