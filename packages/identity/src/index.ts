// @gla/identity — core-adjacent ring (baseline §1).
// The recipient-identity surface for scenario-01 Phase 0 (kernel-contracts.md §7,
// identity-and-auth.md). This slice (Slice 1) implements ONLY binding: map a channel-specific
// recipient ref (e.g. "tg:user:123" / "cli:user:1") to a stable UserIdentity and return a
// RecipientBinding. Enrollment + edge verification are Slice 4 (deferred here) — `bind` is the
// narrow-only mapping the Channel adapter attaches to an inbound message.
//
// Frozen invariants honored (identity-and-auth.md): recipient-binding originates from the channel
// and is ONLY EVER narrowed, never widened; a recipient is verifiable only if enrolled (so binding
// alone yields authStrength "none" — no proof yet). The agent never enrolls recipients and never
// sees credentials. This file holds the *binding* half of IdentityPort and a no-enrollment stub for
// the rest, so it satisfies the kernel IdentityPort shape without implementing Slice-4 behaviour.

import {
  type IdentityPort,
  type RecipientBinding,
  type RecipientRef,
  type UserIdentity,
  glaError,
} from "@gla/kernel";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const IDENTITY_MODULE = "@gla/identity" as const;
/** Ring classification from the architecture baseline (informational). */
export const IDENTITY_RING = "core-adjacent" as const;

/**
 * Derive a stable `UserIdentity.id` from a channel-specific recipient ref. The ref already encodes
 * the channel + the channel-local user (`<channel>:user:<n>`); the derived id is stable across
 * channels for the *same* ref and never invents information the channel did not supply. (A richer
 * deployment would consult an enrollment record to merge refs across channels onto one identity;
 * Slice 1 keeps the mapping 1:1 and deterministic — narrow-only.)
 */
function deriveUserId(recipient: RecipientRef): UserIdentity["id"] {
  return `user:${recipient}`;
}

/**
 * Parse the channel out of a recipient ref of the form `<channel>:user:<id>` (e.g. `tg`, `cli`).
 * Used to record binding provenance. Falls back to the literal ref when it is not in that shape.
 */
function channelOf(recipient: RecipientRef): string {
  const [channel] = recipient.split(":");
  return channel && channel.length > 0 ? channel : String(recipient);
}

/**
 * The recipient-binding service (identity-and-auth.md). Maps inbound channel refs to stable
 * identities and tracks the binding. Slice 1: binding only — no enrollment, no verification yet.
 * Implements the kernel {@link IdentityPort} so the composition root can inject it wherever the
 * port is expected; the unimplemented halves throw the kernel's typed error rather than pretending.
 */
export class IdentityService implements IdentityPort {
  /**
   * Bind a channel-specific recipient ref to a stable {@link UserIdentity} (kernel-contracts.md §7).
   * **Narrow-only:** the binding carries exactly the channel's provenance and `authStrength: "none"`
   * (no proof until enrollment — Slice 4). It writes no task/session state. The Channel adapter
   * attaches the returned binding to each inbound message (GLA-015 AC#1).
   */
  async bind(recipient: RecipientRef, ctx: { channel: string }): Promise<RecipientBinding> {
    return {
      recipient,
      userId: deriveUserId(recipient),
      provenance: ctx.channel,
      // Binding establishes WHO via the channel, not how strongly — proof is enrollment's job.
      authStrength: "none",
    };
  }

  /**
   * Synchronous convenience for the inbound path: derive the {@link RecipientBinding} for a
   * recipient ref, taking the channel from the ref's prefix. Equivalent to {@link bind} with the
   * channel parsed from the ref — used by the channel adapter so `receive()` can attach the binding
   * without awaiting a port round-trip.
   */
  bindFromInbound(recipient: RecipientRef): RecipientBinding {
    return {
      recipient,
      userId: deriveUserId(recipient),
      provenance: channelOf(recipient),
      authStrength: "none",
    };
  }

  /**
   * Enrollment is Slice 4 (one-time, operator-initiated, operator-discharge-gated —
   * identity-and-auth.md). Not implemented here; throws the kernel's typed error rather than a bare
   * Error so callers branch on a stable code.
   */
  async enroll(): Promise<never> {
    throw glaError("dependency.unavailable", "recipient enrollment is not implemented in Slice 1", {
      detail: { slice: 1, deferredTo: "slice-4" },
    });
  }

  /**
   * Edge verification is Slice 4 (a recipient is verifiable only if previously enrolled). Not
   * implemented here; throws the kernel's typed error.
   */
  async verify(): Promise<never> {
    throw glaError(
      "dependency.unavailable",
      "recipient verification is not implemented in Slice 1",
      {
        detail: { slice: 1, deferredTo: "slice-4" },
      },
    );
  }
}
