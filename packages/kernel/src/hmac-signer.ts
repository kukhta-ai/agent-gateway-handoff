// K3 (reference adapter) — an HMAC-chained reference signer for CapabilityPort.
// Signing-INDEPENDENT proof: the kernel models the port; THIS is one concrete realization using
// ONLY `node:crypto` (no third-party, no host I/O, no network, no DB) — swapping it for a
// macaroon library later touches no core code (invariant 2). It implements the macaroon-style
// HMAC caveat chain described in baseline §4: each caveat extends an HMAC keyed by the previous
// tag, so a holder can attenuate (extend the chain) but cannot forge or widen.
//
// `verify()` is PURE given its ctx (invariant 4): it decodes the token, recomputes the HMAC
// chain, checks each caveat against the request, checks the revocation SNAPSHOT (no live lookup),
// and returns a typed result. No async, no I/O.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CapabilityId, Iso8601, OpaqueToken, RecipientRef } from "./brands.js";
import {
  type Capability,
  type CapabilityClass,
  type CapabilityPort,
  InMemoryRevocations,
  type RevocationSnapshot,
  type VerifyContext,
  type VerifyResult,
} from "./capability.js";
import { type Caveat, caveatsSubsetOf, isPathWithin } from "./caveats.js";
import { type ErrorCode, glaError } from "./errors.js";

/** The wire form encoded inside an {@link OpaqueToken} (then base64url'd). Opaque to the kernel. */
interface TokenPayload {
  id: CapabilityId;
  cls: CapabilityClass;
  parentRef?: CapabilityId;
  /** Ordered ancestor chain, root first, excluding `id`. Signed into the tag (lineage is tamper-evident). */
  lineage: CapabilityId[];
  caveats: Caveat[];
  /** HMAC-chain tag over (root-key → cls:id:lineage → each caveat), hex. The unforgeable signature. */
  tag: string;
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

/** Constant-time hex-tag comparison (avoids leaking equality timing). */
function tagsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Recursively canonicalize a JSON value into a deterministic string with **keys sorted at every
 * depth** (#4). Unlike `JSON.stringify(value, replacerArray)` — whose array form is a recursive
 * key *allow-list* that silently drops a nested object's inner fields from the output — this is
 * injective regardless of value shape: any nested field is always serialized, so the signed bytes
 * never omit part of a future, nested caveat. Arrays preserve order; objects emit keys in sorted
 * order. (Caveat values are plain JSON — string/number/bool/array/object — so this is total.)
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const parts = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
  return `{${parts.join(",")}}`;
}

/**
 * Recompute the macaroon-style HMAC chain for a capability. Root tag = HMAC(key,
 * `cls:id` + canonical(lineage)); then each caveat folds in: tag = HMAC(prevTag, canonical(caveat)).
 * Folding the **lineage** into the root seed makes the ancestor chain tamper-evident (#1): editing
 * or stripping any `parentRef`/ancestor changes the seed and breaks verification. Deterministic in
 * caveat order — the same order `attenuate` appends in — so verify and mint agree.
 */
function computeTag(
  key: Buffer,
  cls: CapabilityClass,
  id: CapabilityId,
  lineage: readonly CapabilityId[],
  caveats: readonly Caveat[],
): string {
  // The root seed binds identity AND the full ancestor chain, so lineage cannot be forged.
  const seed = `${cls}:${id}:${canonicalize([...lineage])}`;
  let tag = createHmac("sha256", key).update(seed).digest("hex");
  for (const cav of caveats) {
    // Canonical, depth-sorted JSON so equal caveats hash equally regardless of key order/shape.
    tag = createHmac("sha256", Buffer.from(tag, "hex")).update(canonicalize(cav)).digest("hex");
  }
  return tag;
}

let mintCounter = 0;
function freshCapabilityId(): CapabilityId {
  mintCounter += 1;
  // A short random suffix keeps ids unique without any external dependency.
  return `cap_${randomBytes(4).toString("hex")}${mintCounter.toString(36)}`;
}

/**
 * The reference HMAC-chained {@link CapabilityPort}. Construct with a root signing key (32+
 * random bytes recommended) and an optional shared {@link InMemoryRevocations}. This is the
 * MVP's default capability adapter; later a macaroon/Biscuit signer can replace it behind the
 * same port with no core edit.
 */
export class HmacCapabilitySigner implements CapabilityPort {
  private readonly key: Buffer;
  private readonly revocations: InMemoryRevocations;

  /**
   * @param key       The root HMAC signing key. Defaults to 32 fresh random bytes (process-local).
   * @param revocations A shared revocation cache; defaults to a fresh in-memory one.
   */
  constructor(
    key: Buffer = randomBytes(32),
    revocations: InMemoryRevocations = new InMemoryRevocations(),
  ) {
    this.key = key;
    this.revocations = revocations;
  }

  private encode(p: TokenPayload): OpaqueToken {
    return b64urlEncode(JSON.stringify(p)) as OpaqueToken;
  }

  /** Decode-and-authenticate: parse the token, recompute the chain, reject a bad/forged tag. */
  private decode(token: OpaqueToken): { payload: TokenPayload } | { error: ErrorCode } {
    let payload: TokenPayload;
    try {
      payload = JSON.parse(b64urlDecode(token)) as TokenPayload;
    } catch {
      return { error: "auth.malformed" };
    }
    if (
      typeof payload?.id !== "string" ||
      typeof payload?.cls !== "string" ||
      !Array.isArray(payload?.lineage) ||
      !payload.lineage.every((a) => typeof a === "string") ||
      !Array.isArray(payload?.caveats) ||
      typeof payload?.tag !== "string"
    ) {
      return { error: "auth.malformed" };
    }
    // Lineage is folded into the seed, so a tampered/stripped ancestor changes `expected` and
    // fails this check — lineage is tamper-evident (#1).
    const expected = computeTag(
      this.key,
      payload.cls,
      payload.id,
      payload.lineage,
      payload.caveats,
    );
    if (!tagsEqual(expected, payload.tag)) {
      return { error: "auth.malformed" }; // forged / tampered chain
    }
    return { payload };
  }

  async mint(req: {
    cls: CapabilityClass;
    parentRef?: CapabilityId;
    caveats: Caveat[];
  }): Promise<{ capability: Capability; token: OpaqueToken }> {
    const id = freshCapabilityId();
    const caveats = [...req.caveats];
    // A directly-minted capability's lineage is just its parent (if any); `attenuate` extends a
    // full chain. A root agent-authority has an empty lineage.
    const lineage: CapabilityId[] = req.parentRef !== undefined ? [req.parentRef] : [];
    const tag = computeTag(this.key, req.cls, id, lineage, caveats);
    const capability: Capability = { id, cls: req.cls, caveats, lineage };
    if (req.parentRef !== undefined) {
      capability.parentRef = req.parentRef;
    }
    const payload: TokenPayload = { id, cls: req.cls, lineage, caveats, tag };
    if (req.parentRef !== undefined) {
      payload.parentRef = req.parentRef;
    }
    return { capability, token: this.encode(payload) };
  }

  async attenuate(
    parentToken: OpaqueToken,
    addedCaveats: Caveat[],
  ): Promise<{ capability: Capability; token: OpaqueToken }> {
    const decoded = this.decode(parentToken);
    if ("error" in decoded) {
      throw glaError(decoded.error, "cannot attenuate a malformed or forged capability token");
    }
    const parent = decoded.payload;
    const childCaveats = [...parent.caveats, ...addedCaveats];
    // REJECT-OR-NARROW (invariant 3): the resulting set must be ⊆ the parent's. Adding caveats
    // only narrows, so the guard catches a malformed `added` that would *widen* (e.g. a longer
    // TTL, a different recipient, a wider scope) — those throw, never silently widen.
    if (!caveatsSubsetOf(childCaveats, parent.caveats)) {
      throw glaError(
        "auth.attenuation_widened",
        "attenuation would widen authority beyond the parent capability",
        { detail: { addedCaveats } },
      );
    }
    const id = freshCapabilityId();
    // The child's lineage is the parent's full chain plus the parent itself (root first).
    const lineage: CapabilityId[] = [...parent.lineage, parent.id];
    const tag = computeTag(this.key, parent.cls, id, lineage, childCaveats);
    const capability: Capability = {
      id,
      cls: parent.cls,
      caveats: childCaveats,
      parentRef: parent.id,
      lineage,
    };
    const payload: TokenPayload = {
      id,
      cls: parent.cls,
      parentRef: parent.id,
      lineage,
      caveats: childCaveats,
      tag,
    };
    return { capability, token: this.encode(payload) };
  }

  /**
   * Stateless verify (§2.4, invariant 4): decode+authenticate, then check every caveat against
   * the supplied `ctx` — `ttl` vs `ctx.now`, `recipient` vs `ctx.recipient` (FAIL CLOSED if the
   * presenter is absent or differs), `scope` vs `ctx.scopePath` (FAIL CLOSED if a `scope` caveat
   * is present but no path was supplied) — and the revocation SNAPSHOT for **self and every
   * ancestor** (no live lookup). Pure and synchronous.
   */
  verify(token: OpaqueToken, ctx: VerifyContext): VerifyResult {
    const decoded = this.decode(token);
    if ("error" in decoded) {
      return { ok: false, reason: decoded.error };
    }
    const p = decoded.payload;

    // Revocation (#2): self id AND every ancestor in the signed lineage, against the PUSHED
    // snapshot (not a live store). Revoking the root invalidates a grant two levels down.
    for (const id of [p.id, ...p.lineage]) {
      if (ctx.revocations.has(id)) {
        return { ok: false, reason: "auth.revoked" };
      }
    }

    for (const cav of p.caveats) {
      switch (cav.kind) {
        case "ttl": {
          // ISO-8601 UTC compares lexically.
          if (ctx.now > cav.notAfter) {
            return { ok: false, reason: "auth.expired" };
          }
          break;
        }
        case "recipient": {
          // RECIPIENT-BINDING, FAIL-CLOSED: a recipient-bound cap verifies ONLY for its bound
          // recipient. No presenter, or a different presenter ⇒ reject.
          if (ctx.recipient === undefined || ctx.recipient !== cav.recipient) {
            return { ok: false, reason: "auth.recipient_mismatch" };
          }
          break;
        }
        case "scope": {
          // SCOPE, FAIL-CLOSED (#3): a path-confined grant must be presented WITH the path it is
          // exercising. If the caller omits `ctx.scopePath`, reject rather than pass open —
          // symmetric with recipient. When present, the path must be within the caveat's scope.
          if (ctx.scopePath === undefined) {
            return { ok: false, reason: "auth.scope_required" };
          }
          if (!isPathWithin(ctx.scopePath, cav.path)) {
            return { ok: false, reason: "auth.insufficient" };
          }
          break;
        }
        // Caveats the kernel does not interpret at the edge (audience, channel, net-confine,
        // single-use, authority-profile, allowed-ops, purpose) are carried and chain-bound; the
        // services that care enforce them. They do not fail a generic edge verify here.
        default:
          break;
      }
    }

    const capability: Capability = { id: p.id, cls: p.cls, caveats: p.caveats, lineage: p.lineage };
    if (p.parentRef !== undefined) {
      capability.parentRef = p.parentRef;
    }
    return { ok: true, capability };
  }

  async revoke(id: CapabilityId): Promise<void> {
    this.revocations.add(id);
  }

  revocationSnapshot(): RevocationSnapshot {
    return this.revocations.snapshot();
  }

  /** Helper to make a fresh ISO-8601 from an epoch-ms (so callers can build `ttl` caveats). */
  static iso(epochMs: number): Iso8601 {
    return new Date(epochMs).toISOString() as Iso8601;
  }

  /** Helper to build a `recipient` caveat tersely. */
  static recipientCaveat(recipient: RecipientRef): Caveat {
    return { kind: "recipient", recipient };
  }
}
