// @gla/capability — core ring (baseline §1).
// A thin CapabilityService over the kernel's signing-independent CapabilityPort. It does NOT
// reimplement signing, the caveat algebra, or verification — those are the kernel (GLA-004,
// kernel-contracts.md §2). This package adds the *service-level* operations the Agent Bridge needs
// for scenario-01 Phases 0–1:
//   - mintAgentAuthority(profile) — the root `agent-authority` anchor carrying an `allowed-ops`
//     caveat from a local single-operator AuthorityProfile (baseline §5: agent auth deferred, the
//     Bridge still anchors the authority).
//   - whoami(token) — resolve identity + authority profile + allowed ops by VERIFYING the token
//     (never trusting unsigned fields); a tampered/forged token is rejected (GLA-014 AC#3).
//   - revoke(id) — revoke a capability (cascades to descendants by lineage in the kernel).
// The service holds the revocation snapshot and is constructed with any CapabilityPort, so the
// HMAC reference signer or a later macaroon adapter both work unchanged.

import { randomBytes } from "node:crypto";
import {
  type Capability,
  type CapabilityId,
  type CapabilityPort,
  type Caveat,
  type ErrorCode,
  HmacCapabilitySigner,
  type Iso8601,
  type OpaqueToken,
  type RecipientRef,
  type Ref,
  type RevocationSnapshot,
  type VerifyContext,
  glaError,
} from "@gla/kernel";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const CAPABILITY_MODULE = "@gla/capability" as const;
/** Ring classification from the architecture baseline (informational). */
export const CAPABILITY_RING = "core" as const;

/**
 * A local single-operator AuthorityProfile (baseline §5). It names the matched profile and the
 * exact operation set the agent-authority anchor allows. In the reference profile the operator,
 * the agent-owner, and the recipient may be one person; the profile is the trusted declaration of
 * what the one agent may do — carried into the anchor as the signed `allowed-ops` caveat.
 */
export interface AuthorityProfile {
  /** The profile name, surfaced via the anchor's `authority-profile` caveat and `whoami`. */
  profile: string;
  /** A stable identity for the agent principal (local profile: a fixed local id). */
  identity: string;
  /** The operation set this authority allows — the `allowed-ops` caveat (docs/05 §2 `whoami`). */
  allowedOps: string[];
}

/** The result of `whoami` (docs/05 §2; GLA-017 AC#1): identity + matched profile + allowed ops. */
export interface WhoamiResult {
  /** The agent's stable identity (resolved from the verified anchor's caveats). */
  identity: string;
  /** The matched AuthorityProfile name. */
  authority_profile: string;
  /** The operations this authority allows. */
  allowed_ops: string[];
}

/** What `mintAgentAuthority` hands back: the kernel capability + its bearer token. */
export interface MintedAuthority {
  capability: Capability;
  /** The opaque bearer token — the agent receives this reference, never raw signing material. */
  token: OpaqueToken;
}

/**
 * What `mintConnector` hands back (GLA-024/025): the minted agent-connector capability + the
 * **agent-blind `secret_ref`** the connector JSON carries. The `secretRef` is the capability's id as
 * an opaque {@link Ref}<"secret-ref"> — a capability REFERENCE the agent passes around but cannot
 * inspect or forge; it is **never** the bearer token bytes and **never** raw signing material
 * (kernel-contracts.md §2.3, baseline §4). The bearer `token` stays GLA-side (the agent never receives
 * it); only the `secretRef` is surfaced to the agent.
 */
export interface MintedConnector {
  capability: Capability;
  /** GLA-side bearer token (NOT handed to the agent) — held to revoke/cascade on teardown. */
  token: OpaqueToken;
  /** The agent-blind capability reference the connector JSON's `secret_ref` carries. */
  secretRef: Ref<"secret-ref">;
}

/**
 * What `mintEnrollmentGrant` hands back (GLA-012 AC#3, GLA-013): the minted single-use `operator-discharge`
 * enrollment grant + its bearer token (the invite link carries this) + the single-use `nonce` (the spent-set
 * key). The grant is **distinct from a handoff grant**: it is class `operator-discharge` carrying
 * `recipient` + `purpose=enroll` + `single-use(nonce)` + `ttl` — never a `session`-class grant.
 */
export interface MintedEnrollmentGrant {
  capability: Capability;
  /** The bearer token the enrollment invite link carries (`/enroll?grant=<token>`). */
  token: OpaqueToken;
  /** The single-use nonce — the spent-set key; consumed (marked spent) after one successful enrollment. */
  nonce: string;
}

/**
 * The result of {@link CapabilityService.verifyEnrollmentGrant} — a `VerifyResult`-shaped fact the gateway
 * branches on. On success the verified {@link Capability} + the recipient it is bound to + its single-use nonce
 * (so the caller can mark it spent after a successful enrollment). On failure a stable {@link ErrorCode}
 * (`auth.expired` | `auth.recipient_mismatch` | `auth.revoked` (reused/spent) | `auth.malformed` |
 * `auth.insufficient` (wrong class/purpose)).
 */
export type EnrollmentGrantVerifyResult =
  | { ok: true; capability: Capability; recipient: RecipientRef; nonce: string }
  | { ok: false; reason: ErrorCode };

/**
 * The request to mint a **recipient-bound handoff (session) grant** (GLA-032/033) — a short-TTL,
 * single-recipient `session`-class capability scoped to one session/capsule, **attenuated from the
 * session/task capability** (child ⊆ parent — never widened by the request). The parent token is the
 * authority the grant descends from (its `recipient`/scope/ttl can only be tightened); the gateway
 * verifies the minted grant statelessly on every request and WS upgrade.
 */
export interface MintSessionGrantRequest {
  /** The session this grant exposes a window onto (the `scope`/`audience` are derived from it). */
  sessionId: string;
  /** The recipient the grant is bound to — the single-recipient caveat (a forwarded link is useless). */
  recipient: RecipientRef;
  /**
   * The parent capability token the grant attenuates FROM (the session's task/session capability). The
   * resulting grant is reject-or-narrowed against it — its recipient/scope/ttl can only be tightened,
   * never widened by the request (GLA-032 AC#…, kernel invariant 3). When omitted, the grant is minted
   * as a fresh `session` root (the degraded path when no parent capability is threaded) — still
   * recipient-bound + short-TTL, but with no lineage cascade.
   */
  parentToken?: OpaqueToken;
  /** The grant's expiry as an ISO-8601 instant. Defaults to now + the short default TTL (15m). */
  notAfter?: Iso8601;
  /**
   * The public path the grant authorizes (the `scope` caveat). Defaults to `/handoff/<sessionId>` — the
   * route the gateway mounts. The grant cannot widen its parent's scope (if the parent is scope-bound).
   */
  scopePath?: string;
}

/** What {@link CapabilityService.mintSessionGrant} hands back: the minted grant + its bearer token + its path. */
export interface MintedSessionGrant {
  /** The minted `session`-class capability (recipient-bound, short-TTL, scoped). */
  capability: Capability;
  /** The bearer token the handoff link carries / the gateway verifies (never raw signing material). */
  token: OpaqueToken;
  /** The scope path the grant authorizes (the route's public path). */
  scopePath: string;
}

/**
 * The result of {@link CapabilityService.verifySessionGrant} — a `VerifyResult`-shaped fact the **gateway**
 * branches on at the edge (GLA-035). On success the verified `session`-class {@link Capability} + the recipient
 * it is bound to (read from the signed grant). On failure a stable {@link ErrorCode}
 * (`auth.recipient_mismatch` | `auth.expired` | `auth.revoked` | `auth.malformed` | `auth.insufficient`
 * (wrong class) | `auth.scope_required`). Only the **bound recipient** passes; absent/wrong-recipient/
 * expired/revoked all refuse.
 */
export type SessionGrantVerifyResult =
  | { ok: true; capability: Capability; recipient: RecipientRef }
  | { ok: false; reason: ErrorCode };

/** The short default TTL for a handoff grant (kernel-contracts §2.1: a recipient-bound window is short-lived). */
const DEFAULT_HANDOFF_GRANT_TTL_MS = 15 * 60 * 1000;

/**
 * Pull the single caveat of a kind out of a verified capability's caveat set, or undefined.
 * Used to read identity/profile/ops back from the *signed* chain — never from unsigned token bytes.
 */
function caveatOfKind<K extends Caveat["kind"]>(
  caveats: readonly Caveat[],
  kind: K,
): Extract<Caveat, { kind: K }> | undefined {
  return caveats.find((c): c is Extract<Caveat, { kind: K }> => c.kind === kind);
}

/**
 * The Capability service (component: capability-service.md). Constructed over a kernel
 * {@link CapabilityPort} (default: the reference {@link HmacCapabilitySigner}), so signing stays an
 * adapter concern. The service is the factory/registrar the Bridge calls to anchor the agent and
 * to resolve `whoami`; it mints what it is asked to and verifies — it makes no policy decision
 * (that is Admission/Cedar) and authenticates no principal (that is Identity+Auth).
 */
export class CapabilityService {
  private readonly port: CapabilityPort;
  /**
   * The single-use SPENT-SET for `operator-discharge` enrollment grants (GLA-013 AC#2 — a reused grant is
   * refused). The kernel's HMAC `verify()` deliberately carries `single-use`/`purpose` in the signed chain but
   * does NOT interpret them at the edge ("the services that care enforce them" — capability.ts); this service is
   * that service. A consumed nonce lands here after a successful enrollment; `verifyEnrollmentGrant` rejects any
   * grant whose nonce is already present. In-memory (process-local), mirroring the revocation cache's shape.
   */
  private readonly spentNonces = new Set<string>();

  /** @param port The kernel capability port; defaults to the reference HMAC signer. */
  constructor(port: CapabilityPort = new HmacCapabilitySigner()) {
    this.port = port;
  }

  /**
   * Mint the root `agent-authority` anchor for a local AuthorityProfile (GLA-014 AC#2). The anchor
   * carries two defining caveats (kernel-contracts.md §2.1): `authority-profile` (the matched
   * profile) and **`allowed-ops`** (the operation set the agent may invoke), plus the agent's
   * identity as an `audience` caveat so it too is signed. It is a ROOT (no parent); every later
   * `task`/`session` capability attenuates from it (child ⊆ parent). The returned `token` is the
   * anchor the agent holds; its authority is the signed caveat chain, so it cannot be forged or
   * widened (GLA-014 AC#3).
   */
  async mintAgentAuthority(profile: AuthorityProfile): Promise<MintedAuthority> {
    const caveats: Caveat[] = [
      { kind: "authority-profile", profile: profile.profile },
      { kind: "allowed-ops", ops: [...profile.allowedOps] },
      // The identity rides as an `audience` caveat so it is part of the signed, tamper-evident
      // chain — `whoami` reads it back via verify(), never from unsigned token bytes.
      { kind: "audience", id: profile.identity },
    ];
    return this.port.mint({ cls: "agent-authority", caveats });
  }

  /**
   * Mint the **agent-connector capability** for a session (GLA-024/025). The connector is an
   * **agent-blind `secret-ref`-class** capability **derived from the session/task capability**: it is
   * minted as a child (`parentRef` = the session/task capability id) so it descends by lineage —
   * revoking the parent (or the connector itself) cascades at the next `verify()`
   * (kernel-contracts.md §2.4). It carries an `audience` caveat naming the session (the connector is
   * bound to exactly that capsule) and a `scope` caveat `"/session/<id>/connector"` (a narrow
   * dimension). The class is `secret-ref` per the kernel taxonomy (§2.1: agent-blind), distinguishing
   * it from the session grant.
   *
   * **Agent-blind (the load-bearing GLA-024/025 AC#1/#2):** the method returns the capability's id as
   * an opaque {@link Ref}<"secret-ref"> (`secretRef`) — a capability REFERENCE — and keeps the bearer
   * `token` GLA-side. The agent receives only the `secretRef`; it never receives the token bytes or any
   * raw signing material. The connector JSON's `secret_ref` is this reference.
   *
   * @param sessionId  the session this connector is bound to (the `audience`)
   * @param parentRef  the session/task capability id the connector descends from (for lineage cascade);
   *                   omit only in a degraded path where no parent capability is available.
   */
  async mintConnector(sessionId: string, parentRef?: CapabilityId): Promise<MintedConnector> {
    const caveats: Caveat[] = [
      // Bound to exactly this session's capsule (the connector is per-capsule, agent-blind).
      { kind: "audience", id: sessionId },
      // A narrow scope dimension — the connector authorizes only the session's connector path.
      { kind: "scope", path: `/session/${sessionId}/connector` },
    ];
    const req: { cls: "secret-ref"; parentRef?: CapabilityId; caveats: Caveat[] } = {
      cls: "secret-ref",
      caveats,
    };
    if (parentRef !== undefined) {
      // Descend from the session/task capability so a lineage revocation cascades to the connector.
      req.parentRef = parentRef;
    }
    const minted = await this.port.mint(req);
    return {
      capability: minted.capability,
      token: minted.token,
      // The agent-blind reference: the capability id as an opaque secret-ref handle. NEVER the token.
      secretRef: minted.capability.id as unknown as Ref<"secret-ref">,
    };
  }

  /**
   * Mint a **recipient-bound handoff (session) grant** (GLA-032/033) — the short-TTL, single-recipient
   * `session`-class capability the gateway verifies on every request and WS upgrade to admit exactly one
   * recipient onto one capsule's window. It is **attenuated from the session/task capability** (kernel
   * `attenuate`, reject-or-narrow): the added caveats (`recipient`, `ttl`, `scope`) can only TIGHTEN the
   * parent — a request can never widen the recipient, extend the TTL past the parent, or widen the scope
   * (kernel invariant 3; `attenuate` throws `auth.attenuation_widened` if it would). The grant descends by
   * lineage, so revoking the parent (the session/task cap) CASCADES to the grant at the next `verify()`.
   *
   * The grant carries:
   *   - `recipient`  — bound to EXACTLY this recipient (a forwarded link is useless in another's hands);
   *   - `ttl`        — a short window (default 15m), never past the parent's expiry;
   *   - `scope`      — narrowed to the session/capsule path (`/handoff/<sessionId>` by default).
   *
   * When `parentToken` is omitted (the degraded path where no parent cap is threaded), the grant is minted
   * as a fresh `session` root — still recipient-bound + short-TTL + scoped, but without the lineage cascade.
   *
   * @throws GlaErrorException (`auth.attenuation_widened`) if the requested caveats would widen the parent.
   */
  async mintSessionGrant(req: MintSessionGrantRequest): Promise<MintedSessionGrant> {
    const scopePath = req.scopePath ?? `/handoff/${req.sessionId}`;
    const expiry =
      req.notAfter ??
      (new Date(Date.now() + DEFAULT_HANDOFF_GRANT_TTL_MS).toISOString() as Iso8601);
    const caveats: Caveat[] = [
      { kind: "recipient", recipient: req.recipient },
      { kind: "ttl", notAfter: expiry },
      // The grant is bound to exactly this session's capsule via the `scope` path (the route the gateway exposes,
      // nested under the task scope when attenuated — `/task/<taskId>/handoff/<sessionId>`). The scope alone binds
      // the session; we deliberately do NOT add a separate `audience: sessionId` caveat — when the grant ATTENUATES
      // from the task cap (which inherits the agent-authority's identity `audience`), a second, different `audience`
      // would WIDEN that exact-match dimension (a child cannot carry an audience the parent does not). The scope
      // nesting is the session bind; the gateway verifies the grant by recipient + scope + class, never `audience`.
      { kind: "scope", path: scopePath },
    ];
    if (req.parentToken !== undefined) {
      // ATTENUATE from the session/task capability — child ⊆ parent. `attenuate` REJECTS (throws
      // auth.attenuation_widened) if the request would widen the recipient/scope/ttl beyond the parent,
      // so the request can never widen the grant. The grant descends by lineage (revoke-parent cascade).
      const minted = await this.port.attenuate(req.parentToken, caveats);
      return { capability: minted.capability, token: minted.token, scopePath };
    }
    // Degraded path: no parent threaded → mint a fresh session-class root (still recipient-bound + short TTL).
    const minted = await this.port.mint({ cls: "session", caveats });
    return { capability: minted.capability, token: minted.token, scopePath };
  }

  /**
   * Verify a presented **handoff (session) grant** at the gateway edge (GLA-035) — the stateless check the
   * Access Gateway runs on every request and WS upgrade. One call, one fact: it runs the kernel's pure
   * `verify()` (signature, `recipient` caveat vs the presenter, `ttl`, `scope` vs the path, and the
   * revocation SNAPSHOT for self AND every ancestor — no DB round-trip) AND asserts the capability class is
   * `session` (a `task`/`agent-authority`/`operator-discharge` token presented as a handoff grant is
   * refused). Only the **bound recipient** passes; an absent/wrong recipient → `auth.recipient_mismatch`,
   * an expired grant → `auth.expired`, a revoked grant (or a revoked ancestor) → `auth.revoked`. The bound
   * recipient is read from the *signed* grant on success (a tampered recipient breaks the HMAC first).
   *
   * @param token       the presented grant bearer token (from the handoff link / the WS upgrade)
   * @param recipient   the recipient the presenter authenticated as; compared to the `recipient` caveat
   * @param scopePath   the public path being accessed, checked against the grant's `scope` caveat
   * @param now         the wall-clock instant to evaluate the `ttl` caveat against (defaults to current)
   */
  verifySessionGrant(
    token: OpaqueToken,
    args: { recipient: RecipientRef; scopePath: string; now?: string },
  ): SessionGrantVerifyResult {
    const ctx: VerifyContext = {
      now: (args.now ?? new Date().toISOString()) as Iso8601,
      recipient: args.recipient,
      scopePath: args.scopePath,
      revocations: this.port.revocationSnapshot(),
    };
    return this.verifySessionGrantWith(token, ctx);
  }

  /**
   * Verify a presented **handoff (session) grant when the caller has only the token** (the gateway's
   * `GET /handoff/<id>?grant=…` and the WS upgrade carry just the token — there is no separate presenter to
   * compare against). It reads the bound recipient **out of the verified, signature-authenticated grant** (via
   * `bindRecipientFromCapability` — a tampered recipient breaks the HMAC and fails verification first), so the
   * gateway never trusts an unsigned recipient. Otherwise identical to {@link verifySessionGrant}: ONE `port.verify`
   * checks signature/TTL/scope/revocation, asserts class=`session`, and returns the bound recipient on success.
   *
   * The recipient binding is then enforced at STEP-UP: the WebAuthn assertion is verified against the credential of
   * the recipient READ FROM THE GRANT — so a grant minted for recipient A can only be satisfied by A's passkey (a
   * grant for a different recipient than the one who authenticates cannot pass).
   *
   * @param token      the presented grant bearer token
   * @param scopePath  the path being accessed (checked against the grant's `scope` caveat)
   * @param now        the wall-clock instant to evaluate the `ttl` caveat against (defaults to current)
   */
  verifySessionGrantToken(
    token: OpaqueToken,
    args: { scopePath: string; now?: string },
  ): SessionGrantVerifyResult {
    const ctx: VerifyContext = {
      now: (args.now ?? new Date().toISOString()) as Iso8601,
      scopePath: args.scopePath,
      // Authenticate the recipient caveat by signature, then READ it from the grant (no presenter to compare).
      bindRecipientFromCapability: true,
      revocations: this.port.revocationSnapshot(),
    };
    return this.verifySessionGrantWith(token, ctx);
  }

  /** The single verify-and-assert core for a handoff grant: ONE `port.verify`, then the class + recipient read. */
  private verifySessionGrantWith(token: OpaqueToken, ctx: VerifyContext): SessionGrantVerifyResult {
    const result = this.port.verify(token, ctx);
    if (!result.ok) {
      // signature/recipient/ttl/scope/revocation failures come back already-typed.
      return { ok: false, reason: result.reason };
    }
    const cap = result.capability;
    if (cap.cls !== "session") {
      // Not a handoff grant (e.g. a task or operator-discharge token presented at the edge) — refuse.
      return { ok: false, reason: "auth.insufficient" };
    }
    const bound = caveatOfKind(cap.caveats, "recipient")?.recipient;
    if (bound === undefined) {
      // A well-formed handoff grant is always recipient-bound; its absence is a malformed grant.
      return { ok: false, reason: "auth.malformed" };
    }
    return { ok: true, capability: cap, recipient: bound };
  }

  /**
   * Resolve the agent's identity + authority profile + allowed ops from its anchor token
   * (GLA-017 AC#1). **Verification-first (GLA-014 AC#3):** the token is run through the kernel's
   * stateless `verify()` against the held revocation snapshot; a tampered, forged, or revoked token
   * is rejected with the kernel's typed error (`auth.malformed` / `auth.revoked` / …) — the service
   * NEVER trusts unsigned token fields. On success it reads identity/profile/ops back out of the
   * *verified* capability's caveat set.
   *
   * @param token  the agent-authority anchor (the bearer the agent holds)
   * @param now    the wall-clock instant to evaluate any `ttl` caveat against (defaults to current)
   * @throws GlaErrorException with the kernel's stable code on a rejected token.
   */
  whoami(token: OpaqueToken, now: string = new Date().toISOString()): WhoamiResult {
    const result = this.port.verify(token, {
      now: now as Iso8601,
      revocations: this.port.revocationSnapshot(),
    });
    if (!result.ok) {
      // A forged/tampered/revoked anchor cannot be used to learn identity or ops.
      throw glaError(result.reason, `agent-authority token rejected: ${result.reason}`);
    }
    const cap = result.capability;
    if (cap.cls !== "agent-authority") {
      throw glaError("auth.insufficient", "token is not an agent-authority anchor", {
        detail: { cls: cap.cls },
      });
    }
    const profile = caveatOfKind(cap.caveats, "authority-profile")?.profile;
    const ops = caveatOfKind(cap.caveats, "allowed-ops")?.ops ?? [];
    const identity = caveatOfKind(cap.caveats, "audience")?.id;
    if (profile === undefined || identity === undefined) {
      // A well-formed agent-authority anchor always carries these (mintAgentAuthority adds them);
      // their absence means a malformed authority, not a usable identity.
      throw glaError(
        "auth.insufficient",
        "agent-authority anchor missing identity/profile caveats",
      );
    }
    return { identity, authority_profile: profile, allowed_ops: [...ops] };
  }

  /**
   * Mint the **single-use `operator-discharge` enrollment grant** (GLA-012 AC#3, GLA-013) — the one-time
   * authorization for a recipient enrollment, minted **out-of-band by the operator** (`enrollInvite`). It is
   * **distinct from a handoff grant** (`kernel-contracts.md §2.1`): class `operator-discharge`, carrying four
   * caveats —
   *   - `recipient`   — bound to EXACTLY this recipient (a forwarded invite is useless in another's hands);
   *   - `purpose=enroll` — the discharge authorizes enrollment, nothing else;
   *   - `single-use(nonce)` — a fresh random nonce; consumed (spent) after one successful enrollment;
   *   - `ttl`         — a short window (default 1h) after which the grant is dead.
   * The returned `token` is what the enrollment invite link carries (`/enroll?grant=<token>`). The gateway
   * verifies it via {@link verifyEnrollmentGrant} on every enrollment request; a successful enrollment calls
   * {@link markSpent} so the grant cannot be reused.
   *
   * @param recipient  the recipient the grant is bound to (the `recipient` caveat)
   * @param notAfter   the grant's expiry as an ISO-8601 instant; defaults to now + 1h
   */
  async mintEnrollmentGrant(
    recipient: RecipientRef,
    notAfter?: Iso8601,
  ): Promise<MintedEnrollmentGrant> {
    const nonce = randomBytes(16).toString("hex");
    const expiry = notAfter ?? (new Date(Date.now() + 60 * 60 * 1000).toISOString() as Iso8601);
    const caveats: Caveat[] = [
      { kind: "recipient", recipient },
      { kind: "purpose", value: "enroll" },
      { kind: "single-use", nonce },
      { kind: "ttl", notAfter: expiry },
    ];
    const minted = await this.port.mint({ cls: "operator-discharge", caveats });
    return { capability: minted.capability, token: minted.token, nonce };
  }

  /**
   * Verify a presented **enrollment grant** at the gateway (GLA-012 AC#2, GLA-013 AC#2). One call, one fact:
   * it runs the kernel's stateless `verify()` (signature, `recipient` caveat vs the presenter, `ttl`) AND the
   * three enrollment-specific checks the kernel leaves to this service —
   *   - the capability class is `operator-discharge` (not some other class presented as an enrollment grant);
   *   - it carries `purpose=enroll`;
   *   - its single-use `nonce` is **not already spent** (a reused grant ⇒ `auth.revoked`).
   * Returns the verified capability + the bound recipient + the nonce on success (so the caller marks it spent
   * after a successful enrollment), or a stable {@link ErrorCode} on any failure. The verification is otherwise
   * **stateless** (no DB round-trip) — the only mutable edge state is the spent-set, consulted like the
   * revocation cache.
   *
   * @param token      the presented grant bearer token (from `/enroll?grant=…` or the POST body)
   * @param recipient  the recipient the presenter claims to be (the gateway supplies it for the recipient caveat)
   * @param now        the wall-clock instant to evaluate the `ttl` caveat against (defaults to current)
   */
  verifyEnrollmentGrant(
    token: OpaqueToken,
    recipient: RecipientRef,
    now: string = new Date().toISOString(),
  ): EnrollmentGrantVerifyResult {
    return this.verifyEnrollmentGrantInner(token, recipient, now);
  }

  /**
   * Verify a presented **enrollment grant when the caller has only the token** (the gateway's `GET /enroll?grant=…`
   * and the enrollment POSTs carry just the token). It reads the bound recipient **out of the verified, signature-
   * authenticated grant** (via `bindRecipientFromCapability` — a tampered recipient breaks the HMAC and fails
   * verification first), so the gateway never trusts an unsigned recipient. Otherwise identical to
   * {@link verifyEnrollmentGrant}: ONE `port.verify` checks signature/TTL/revocation + class=`operator-discharge`
   * + `purpose=enroll` + single-use-not-spent, and returns the bound recipient + nonce on success.
   *
   * @param token  the presented grant bearer token
   * @param now    the wall-clock instant to evaluate the `ttl` caveat against (defaults to current)
   */
  verifyEnrollmentGrantToken(
    token: OpaqueToken,
    now: string = new Date().toISOString(),
  ): EnrollmentGrantVerifyResult {
    // `undefined` presenter ⇒ read the recipient FROM the signature-authenticated grant (a single verify).
    return this.verifyEnrollmentGrantInner(token, undefined, now);
  }

  /**
   * **Atomically verify-and-consume** an enrollment grant (the gateway's `POST /enroll/verify` path). Verifies the
   * grant (token-only, recipient read from the signed grant) AND — in the **same synchronous step**, with NO
   * `await` between the not-spent check and the consume — marks its single-use nonce spent. This closes the
   * single-use TOCTOU window (GLA-013 AC#2's "one grant = one ceremony"): two concurrent verifies of the same
   * still-valid grant cannot both pass, because the second observes the nonce already in the spent-set.
   *
   * The grant is consumed **optimistically** (before the WebAuthn ceremony) so the consume is atomic; if the
   * subsequent ceremony then fails, the caller MUST call {@link unspend} to roll the nonce back so a genuine
   * failure stays retryable (a no-op for the success path). On any verification failure the spent-set is left
   * untouched.
   *
   * @param token  the presented grant bearer token
   * @param now    the wall-clock instant to evaluate the `ttl` caveat against (defaults to current)
   */
  tryConsumeEnrollmentGrantToken(
    token: OpaqueToken,
    now: string = new Date().toISOString(),
  ): EnrollmentGrantVerifyResult {
    const verified = this.verifyEnrollmentGrantInner(token, undefined, now);
    if (!verified.ok) {
      return verified;
    }
    // ATOMIC consume: this synchronous block runs to completion before any other turn (JS is single-threaded
    // and there is no `await` here), so the check-and-add cannot interleave with a concurrent consume. A losing
    // racer finds the nonce already present and is refused — exactly one ceremony per grant.
    if (this.spentNonces.has(verified.nonce)) {
      return { ok: false, reason: "auth.revoked" };
    }
    this.spentNonces.add(verified.nonce);
    return verified;
  }

  /**
   * Roll back an optimistic consume (un-spend a nonce) when the WebAuthn ceremony that followed
   * {@link tryConsumeEnrollmentGrantToken} failed — so a genuine ceremony failure leaves the grant retryable.
   * Idempotent; a no-op if the nonce was never spent.
   */
  unspend(nonce: string): void {
    this.spentNonces.delete(nonce);
  }

  /** Mark an enrollment grant's single-use nonce as **spent** (consumed after one successful enrollment). */
  markSpent(nonce: string): void {
    this.spentNonces.add(nonce);
  }

  /** Is this enrollment grant's nonce already spent? (A reused grant fails {@link verifyEnrollmentGrant}.) */
  isSpent(nonce: string): boolean {
    return this.spentNonces.has(nonce);
  }

  /**
   * The single verify-and-assert core for an enrollment grant (no double-verify). ONE `port.verify` — with a
   * presenter (the explicit-recipient path) or with `bindRecipientFromCapability` (the token-only path, where the
   * recipient is read from the signature-authenticated grant) — then the class/purpose/single-use-not-spent
   * assertions. Returns the bound recipient + nonce on success.
   *
   * @param token     the presented grant bearer token
   * @param presenter the recipient to compare against the `recipient` caveat, or `undefined` to READ it from the
   *                  verified grant (a tampered recipient breaks the HMAC, so this read is safe)
   * @param now       the `ttl` evaluation instant
   */
  private verifyEnrollmentGrantInner(
    token: OpaqueToken,
    presenter: RecipientRef | undefined,
    now: string,
  ): EnrollmentGrantVerifyResult {
    const ctx: VerifyContext = {
      now: now as Iso8601,
      revocations: this.port.revocationSnapshot(),
    };
    if (presenter !== undefined) {
      ctx.recipient = presenter;
    } else {
      // Authenticate the recipient caveat by signature, then READ it from the grant (no presenter to compare).
      ctx.bindRecipientFromCapability = true;
    }
    const result = this.port.verify(token, ctx);
    if (!result.ok) {
      // signature/recipient/ttl/revocation failures come back already-typed.
      return { ok: false, reason: result.reason };
    }
    const cap = result.capability;
    if (cap.cls !== "operator-discharge") {
      return { ok: false, reason: "auth.insufficient" };
    }
    if (caveatOfKind(cap.caveats, "purpose")?.value !== "enroll") {
      return { ok: false, reason: "auth.insufficient" };
    }
    const recipient = presenter ?? caveatOfKind(cap.caveats, "recipient")?.recipient;
    if (recipient === undefined) {
      // A well-formed enrollment grant is always recipient-bound; its absence is a malformed grant.
      return { ok: false, reason: "auth.malformed" };
    }
    const nonce = caveatOfKind(cap.caveats, "single-use")?.nonce;
    if (nonce === undefined) {
      // A well-formed enrollment grant always carries a single-use nonce; its absence is a malformed grant.
      return { ok: false, reason: "auth.malformed" };
    }
    if (this.spentNonces.has(nonce)) {
      // SINGLE-USE: this grant was already consumed by a prior successful enrollment — refuse the reuse.
      return { ok: false, reason: "auth.revoked" };
    }
    return { ok: true, capability: cap, recipient, nonce };
  }

  /**
   * Revoke a capability by id (capability-service.md). Delegates to the kernel port, which records
   * the id in the revocation snapshot; by lineage this invalidates the capability AND its
   * descendants at the next `verify()` (kernel-contracts.md §2.4). After this, `whoami` on a
   * revoked anchor throws `auth.revoked`.
   */
  async revoke(id: CapabilityId): Promise<void> {
    await this.port.revoke(id);
  }

  /** The current revocation snapshot to hand to edge verifiers (kernel-contracts.md §2.4). */
  revocationSnapshot(): RevocationSnapshot {
    return this.port.revocationSnapshot();
  }
}
