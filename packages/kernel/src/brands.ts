// K0 — nominal aliases + branded types (kernel-contracts.md §0/§8).
// Everything else in the kernel references these. They are pure compile-time shapes:
// at runtime a branded string is just a string; the brand exists only so the type-checker
// keeps an `OpaqueToken` from being confused with a plain `string`, a `task_…` id from a
// `sess_…` id, and so on. No runtime cost, no dependency.

/**
 * An ISO-8601 timestamp (e.g. `"2026-06-03T12:00:00.000Z"`).
 * A nominal alias over `string`; the kernel does not parse it, only orders/compares it
 * lexically (ISO-8601 in UTC sorts chronologically as plain strings).
 */
export type Iso8601 = string & { readonly __brand: "Iso8601" };

/**
 * A coarse human-authored duration such as `"1h"`, `"30m"`, `"15s"`, `"2d"`.
 * A nominal alias over `string`; the concrete parser lives wherever a wall-clock is available
 * (an adapter), never in the pure kernel.
 */
export type Duration = string & { readonly __brand: "Duration" };

/**
 * An opaque reference/handle to a capability or capability-derived resource, parameterized by
 * the kind it points at (`"task"`, `"session"`, `"secret-ref"`, `"channel"`). The holder may
 * pass it around but cannot inspect or forge what it denotes — the issuing service resolves it.
 */
export type Ref<K extends string = string> = string & {
  readonly __brand: "Ref";
  readonly __kind: K;
};

/**
 * The encoded bearer credential for a capability — the bytes a presenter sends to the edge.
 * It is **opaque to the kernel**: only the signing adapter (`CapabilityPort`) mints or parses
 * it. This brand is the seam that keeps the kernel signing-independent (§2.4, invariant 2).
 */
export type OpaqueToken = string & { readonly __brand: "cap-token" };

/** A prefixed `Task` id, e.g. `"task_8fd2"`. */
export type TaskId = `task_${string}`;
/** A prefixed `Session` id, e.g. `"sess_8fd2"`. */
export type SessionId = `sess_${string}`;
/** A prefixed `HandoffWindow` id, e.g. `"hand_1"`. */
export type HandoffId = `hand_${string}`;
/** A prefixed `Capability` id, e.g. `"cap_77a1"`. */
export type CapabilityId = `cap_${string}`;
/** A prefixed `Route` id, e.g. `"route_3"`. */
export type RouteId = `route_${string}`;

/**
 * An opaque, channel-specific recipient reference, e.g. `"tg:user:123"`. The system never
 * parses its meaning; it is bound from the channel and only ever narrowed, never invented
 * (`docs/04`, kernel-contracts §1.1).
 */
export type RecipientRef = string & { readonly __brand: "RecipientRef" };
