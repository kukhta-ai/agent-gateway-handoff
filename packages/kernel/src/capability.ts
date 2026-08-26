// K3 — Capability entity + CapabilityPort (signing-independent) — kernel-contracts.md §1.4, §2.
// The kernel models identity + caveats + lineage + the PORT; the bytes are an adapter concern.
// This file holds: the entity, the six classes, the port interface, the revocation-snapshot
// shape, and the VerifyResult — all signing-agnostic. The reference HMAC signer (one concrete
// implementation of the port, using only node:crypto) lives in `hmac-signer.ts`.

import type { CapabilityId, OpaqueToken, RecipientRef } from "./brands.js";
import type { Caveat } from "./caveats.js";

/**
 * The six capability classes — the one authorization primitive in six shapes (§2.1, baseline §4).
 * Every authorization in GLA is one of these; they differ only by their parent and defining
 * caveats, not by mechanism.
 */
export type CapabilityClass =
  | "agent-authority"
  | "task"
  | "session"
  | "secret-ref"
  | "channel-delegation"
  | "operator-discharge";

/**
 * A capability — identity + caveats + lineage (§1.4). Deliberately **carries no signature**:
 * signing is an adapter concern (§2.4), so the kernel can model authority while the signer owns
 * the bytes.
 *
 * Lineage is carried in full so that stateless verification can fail-closed on a revoked
 * *ancestor* without any lookup (§2.4, §1.1): `lineage` is the ordered ancestor chain, **root
 * first**, excluding this capability's own `id`; `parentRef` is a convenience alias for its last
 * element (the immediate parent). Both are absent/empty only for a root `agent-authority`. A
 * conforming signer (the reference HMAC adapter) MUST bind the whole lineage into its signature,
 * so altering or stripping any ancestor reference breaks verification.
 */
export interface Capability {
  id: CapabilityId;
  cls: CapabilityClass;
  /** Attenuation-only constraints (§2.2). The effective grant is their conjunction. */
  caveats: Caveat[];
  /** The immediate parent in the attenuation chain; absent only for a root `agent-authority`. */
  parentRef?: CapabilityId;
  /**
   * The full ordered ancestor chain, **root first**, excluding `id`. Empty for a root. Carried
   * (and signed) so `verify()` can reject a capability whose *any* ancestor is revoked, statelessly.
   */
  lineage?: CapabilityId[];
}

/**
 * The pushed revocation cache the edge consults — a small replicated snapshot, NOT a live store
 * (§2.3/§2.4). `has(id)` answers "is this capability (or an ancestor) revoked?" synchronously,
 * so `verify()` never makes a round-trip. `version` lets verifiers detect staleness.
 */
export interface RevocationSnapshot {
  has(id: CapabilityId): boolean;
  version: string;
}

/**
 * Mutable revocation cache seam used by signer adapters. The snapshot shape remains the edge-facing contract;
 * this mutable shape lets the app composition root supply a restart-safe cache without making `verify()` do I/O.
 */
export interface MutableRevocations extends RevocationSnapshot {
  /** Mark a capability id revoked and advance the cache version. */
  add(id: CapabilityId): void;
  /** A frozen, point-in-time copy safe to hand to an edge verifier. */
  snapshot(): RevocationSnapshot;
}

/** The context an edge verifier supplies to {@link CapabilityPort.verify} — all pure inputs. */
export interface VerifyContext {
  /** The wall-clock instant to evaluate `ttl` caveats against (supplied, never read from a clock here). */
  now: import("./brands.js").Iso8601;
  /** The presenter, for the `recipient` caveat. Absent presenter + a recipient-bound cap ⇒ fail closed. */
  recipient?: RecipientRef;
  /** The pushed revocation cache (§2.3) — not a live store. */
  revocations: RevocationSnapshot;
  /** The path/scope being accessed, checked against any `scope` caveat (optional). */
  scopePath?: string;
  /**
   * When `true`, the `recipient` caveat's **presenter-equality check is skipped** — but the caveat is still
   * authenticated by the signature (it is part of the signed payload, so a tampered/forged recipient breaks the
   * HMAC tag and verification still fails). The caller then reads the bound recipient out of the returned
   * {@link VerifyResult.capability}'s caveats. This is the **enrollment** path: an `operator-discharge` grant is
   * presented at `GET /enroll?grant=…` carrying only the token — the gateway has no separate presenter to compare
   * against, so it reads the recipient FROM the verified (signature-authenticated) grant rather than trusting an
   * unsigned query param. It is a no-op when no `recipient` caveat is present. Defaults to `false` (the strict,
   * fail-closed handoff path is unchanged).
   */
  bindRecipientFromCapability?: boolean;
}

/**
 * The result of a stateless verify (§2.4). A discriminated union so callers branch on `ok`:
 * on success the decoded {@link Capability}; on failure a stable {@link ErrorCode}
 * (`auth.expired` | `auth.recipient_mismatch` | `auth.revoked` | …) — a fact, not prose.
 */
export type VerifyResult =
  | { ok: true; capability: Capability }
  | { ok: false; reason: import("./errors.js").ErrorCode };

/**
 * The capability seam (§2.4): `mint / attenuate / verify / revoke` plus snapshot access. Signing
 * is **internal to the adapter** — the kernel names this interface, an adapter (the reference
 * HMAC signer, or a macaroon library later) implements it. The `app` composition root injects
 * the implementation; no core code names a concrete signer (invariant 2).
 *
 * Guarantees the contract-test enforces:
 * - `verify` is **pure** given its `ctx` (no I/O) — the edge stays stateless (invariant 4).
 * - `attenuate` is **reject-or-narrow** on the ⊆-parent rule (invariant 3).
 * - `mint`/`attenuate` hand back an {@link OpaqueToken}; the agent never sees raw signing material.
 */
export interface CapabilityPort {
  /** Mint a root or child capability of a class, with caveats. Signing is internal to the adapter. */
  mint(req: {
    cls: CapabilityClass;
    parentRef?: CapabilityId;
    caveats: Caveat[];
  }): Promise<{ capability: Capability; token: OpaqueToken }>;

  /**
   * Derive a strictly-narrower child. MUST reject (throw a typed `auth.attenuation_widened`) if the result is not ⊆
   * parent. `childClass` optionally RE-CLASSES the child to a NARROWER capability class (e.g. a `session` handoff
   * grant that descends by lineage from a `task` cap) — the caveats still only narrow and the full ancestor lineage
   * (for the revoke-the-parent cascade) is preserved; only the class label changes. When omitted, the child inherits
   * the parent's class (the default macaroon attenuation).
   */
  attenuate(
    parentToken: OpaqueToken,
    addedCaveats: Caveat[],
    childClass?: CapabilityClass,
  ): Promise<{ capability: Capability; token: OpaqueToken }>;

  /** Stateless verify against a pushed revocation snapshot — NO database round-trip in the common case. */
  verify(token: OpaqueToken, ctx: VerifyContext): VerifyResult;

  /** Revoke a capability (and, by lineage, its descendants); push to verifiers. */
  revoke(id: CapabilityId): Promise<void>;

  /** The current revocation snapshot to hand to edge verifiers. */
  revocationSnapshot(): RevocationSnapshot;
}

/**
 * A mutable, in-memory {@link RevocationSnapshot} — a tiny reference implementation usable by
 * any signer/port for the revocation cache. Pure data structure (a `Set`), no I/O; the real
 * distributed cache is an adapter concern, but the *shape* and a working default live in core so
 * tests (and the reference signer) need nothing external.
 */
export class InMemoryRevocations implements MutableRevocations {
  private readonly revoked = new Set<CapabilityId>();
  /** A monotonic version stamp bumped on every change, so verifiers can detect staleness. */
  version = "0";
  private counter = 0;

  constructor(initial?: Iterable<CapabilityId>) {
    if (initial !== undefined) {
      for (const id of initial) {
        this.revoked.add(id);
      }
      this.counter = this.revoked.size;
      this.version = String(this.counter);
    }
  }

  has(id: CapabilityId): boolean {
    return this.revoked.has(id);
  }

  /** Mark a capability id revoked and bump {@link version}. */
  add(id: CapabilityId): void {
    const before = this.revoked.size;
    this.revoked.add(id);
    if (this.revoked.size !== before) {
      this.counter += 1;
      this.version = String(this.counter);
    }
  }

  /** The revoked ids in stable order. Intended for persistence adapters, not edge verification. */
  values(): CapabilityId[] {
    return [...this.revoked].sort();
  }

  /** A frozen, point-in-time copy safe to hand to an edge verifier. */
  snapshot(): RevocationSnapshot {
    const copy = new Set(this.revoked);
    const v = this.version;
    return { has: (id) => copy.has(id), version: v };
  }
}
