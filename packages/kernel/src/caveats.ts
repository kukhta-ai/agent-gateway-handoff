// K2 — caveat algebra + attenuation predicate (kernel-contracts.md §2.2/§2.3).
// The heart of the capability primitive, fully signing-independent and IO-free: a caveat is
// pure data, and "child ⊆ parent" is a pure predicate. Tested in isolation; no token bytes,
// no clock, no store touched here.

import type { Iso8601, RecipientRef } from "./brands.js";

/**
 * A caveat — an attenuating constraint carried by a capability (§2.2). Each variant is
 * discriminated by `kind`, so unions over caveats are exhaustively checkable. Caveats only ever
 * *narrow* authority; a capability's effective grant is the conjunction (AND) of its caveats.
 */
export type Caveat =
  | { kind: "recipient"; recipient: RecipientRef }
  | { kind: "ttl"; notAfter: Iso8601 }
  | { kind: "scope"; path: string }
  | { kind: "net-confine"; cidrs: string[] }
  | { kind: "single-use"; nonce: string }
  | { kind: "authority-profile"; profile: string }
  | { kind: "allowed-ops"; ops: string[] }
  | { kind: "audience"; id: string }
  | { kind: "channel"; channel: string }
  | { kind: "purpose"; value: "enroll" | string };

/** The discriminant strings of {@link Caveat}. */
export type CaveatKind = Caveat["kind"];

/**
 * Is `child` a scope-path at-or-under `parent`? Path-prefix containment on `/`-separated
 * segments: `/a/b` is within `/a` and within `/a/b`, but `/ab` is NOT within `/a` (segment
 * boundary respected), and nothing is broader than `/`. Used for the `scope` caveat's ⊆ check.
 */
export function isPathWithin(child: string, parent: string): boolean {
  if (parent === child) {
    return true;
  }
  // Normalize a single trailing slash so "/a/" and "/a" behave identically.
  const p = parent.endsWith("/") && parent.length > 1 ? parent.slice(0, -1) : parent;
  if (p === "/" || p === "") {
    return true; // root contains everything
  }
  return child === p || child.startsWith(`${p}/`);
}

/**
 * Parse `"a.b.c/n"` CIDR into `[address-as-bits, prefixLen]`, or `undefined` if malformed.
 * IPv4 only (the kernel's CIDR caveats are IPv4); kept tiny and dependency-free.
 */
function parseCidr(cidr: string): { bits: number; prefix: number } | undefined {
  const [addr, lenRaw] = cidr.split("/");
  if (addr === undefined || lenRaw === undefined) {
    return undefined;
  }
  const prefix = Number(lenRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return undefined;
  }
  const octets = addr.split(".");
  if (octets.length !== 4) {
    return undefined;
  }
  let bits = 0;
  for (const o of octets) {
    const n = Number(o);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      return undefined;
    }
    bits = (bits << 8) | n;
  }
  return { bits: bits >>> 0, prefix };
}

/** Is `child` CIDR fully contained within `parent` CIDR (IPv4)? Malformed input ⇒ not contained. */
export function isCidrWithin(child: string, parent: string): boolean {
  const c = parseCidr(child);
  const p = parseCidr(parent);
  if (!c || !p) {
    return false;
  }
  // A narrower (or equal) range has a LONGER-or-equal prefix and shares the parent's network bits.
  if (c.prefix < p.prefix) {
    return false;
  }
  if (p.prefix === 0) {
    return true; // 0.0.0.0/0 contains everything
  }
  const mask = p.prefix === 32 ? 0xffffffff : (~((1 << (32 - p.prefix)) - 1) & 0xffffffff) >>> 0;
  return (c.bits & mask) >>> 0 === (p.bits & mask) >>> 0;
}

/**
 * Is the single child caveat `c` no broader than the single parent caveat `p` (same kind)?
 * Per-kind tightening semantics (§2.2):
 * - `ttl`: child `notAfter` ≤ parent `notAfter` (a child may expire sooner, never later).
 * - `scope`: child path within parent path.
 * - `recipient` / `authority-profile` / `audience` / `channel` / `purpose`: must be IDENTICAL
 *   (you cannot re-target; you may only re-assert the same binding).
 * - `allowed-ops`: child ops ⊆ parent ops (a subset; never an added op).
 * - `net-confine`: every child CIDR is within some parent CIDR (no widening the network).
 * - `single-use`: identical nonce (re-asserting the same single-use marker).
 */
function caveatNarrowsOrEqual(c: Caveat, p: Caveat): boolean {
  if (c.kind !== p.kind) {
    return false;
  }
  switch (c.kind) {
    case "ttl":
      // ISO-8601 UTC sorts lexically; child must not outlive parent.
      return c.notAfter <= (p as Extract<Caveat, { kind: "ttl" }>).notAfter;
    case "scope":
      return isPathWithin(c.path, (p as Extract<Caveat, { kind: "scope" }>).path);
    case "recipient":
      return c.recipient === (p as Extract<Caveat, { kind: "recipient" }>).recipient;
    case "authority-profile":
      return c.profile === (p as Extract<Caveat, { kind: "authority-profile" }>).profile;
    case "audience":
      return c.id === (p as Extract<Caveat, { kind: "audience" }>).id;
    case "channel":
      return c.channel === (p as Extract<Caveat, { kind: "channel" }>).channel;
    case "purpose":
      return c.value === (p as Extract<Caveat, { kind: "purpose" }>).value;
    case "single-use":
      return c.nonce === (p as Extract<Caveat, { kind: "single-use" }>).nonce;
    case "allowed-ops": {
      const parentOps = new Set((p as Extract<Caveat, { kind: "allowed-ops" }>).ops);
      return c.ops.every((op) => parentOps.has(op));
    }
    case "net-confine": {
      const parentCidrs = (p as Extract<Caveat, { kind: "net-confine" }>).cidrs;
      return c.cidrs.every((cc) => parentCidrs.some((pc) => isCidrWithin(cc, pc)));
    }
    default: {
      // Exhaustiveness guard: a new caveat kind must be handled above.
      const _never: never = c;
      return _never;
    }
  }
}

/**
 * The attenuation invariant (§2.2, invariant 3): is `child`'s caveat set **only ever a
 * tightening** of `parent`'s? Both directions must hold:
 *
 * 1. **No dropped/loosened parent constraint.** For each parent caveat there must be a child
 *    caveat of the same kind that {@link caveatNarrowsOrEqual} it — so the child cannot drop a
 *    dimension the parent constrained, nor re-state it more loosely.
 * 2. **No widened child constraint of a constrained kind.** For every child caveat **whose kind
 *    the parent also constrains**, that child caveat must itself narrow-or-equal *some* parent
 *    caveat of that kind — so the child cannot smuggle in a *wider* caveat of an
 *    already-constrained dimension (e.g. parent `ops:[read]`, child additionally `ops:[read,
 *    write]`). A child MAY freely add caveats of kinds the parent never constrained (that only
 *    narrows further).
 *
 * Pure and total — no I/O, no signing. This is what lets the edge verify a whole chain by
 * checking each link is ⊆ its predecessor.
 */
export function caveatsSubsetOf(child: readonly Caveat[], parent: readonly Caveat[]): boolean {
  const parentKinds = new Set(parent.map((p) => p.kind));

  // (1) every parent constraint is matched at-least-as-tightly by the child
  for (const pc of parent) {
    const sameKind = child.filter((cc) => cc.kind === pc.kind);
    if (sameKind.length === 0) {
      return false; // parent constrains this dimension; child dropped it → widened
    }
    if (!sameKind.some((cc) => caveatNarrowsOrEqual(cc, pc))) {
      return false;
    }
  }

  // (2) no child caveat of an already-constrained kind may be broader than every parent caveat
  for (const cc of child) {
    if (!parentKinds.has(cc.kind)) {
      continue; // a new dimension the parent never constrained — only narrows further; allowed
    }
    const parentSameKind = parent.filter((pc) => pc.kind === cc.kind);
    if (!parentSameKind.some((pc) => caveatNarrowsOrEqual(cc, pc))) {
      return false; // this child caveat widens an already-constrained dimension
    }
  }

  return true;
}
