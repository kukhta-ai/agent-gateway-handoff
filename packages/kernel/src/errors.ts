// K1 — error & exit-code taxonomy (kernel-contracts.md §5, docs/05 §4–§5).
// A contract other programs branch on: the coarse branch is the EXIT CODE, the rich signal is
// the namespaced `code`. Both are DATA (a frozen table + a pure `exitCodeFor`), so no caller
// ever parses prose to recover (invariant 7). Errors here are signing/IO-free pure values.

/**
 * The stable, namespaced error codes the system emits. Each is `"<namespace>.<symbol>"`; the
 * namespace selects the coarse exit-code branch (§5.2) and the whole string is the precise fact
 * a recovery skill reasons over. This union is the closed catalogue — adding a code is a
 * deliberate, reviewed surface change, never an ad-hoc string.
 */
export type ErrorCode =
  // usage.* — malformed invocation (exit 2)
  | "usage.invalid_flag"
  | "usage.bad_argument"
  | "usage.unknown_command"
  | "usage.bad_flag"
  // policy.* — Cedar/admission rejection (exit 3)
  | "policy.denied"
  | "policy.detector_missing"
  // auth.* — authN/authZ, insufficient/invalid capability (exit 4; auth.expired→6 at a wait)
  | "auth.insufficient"
  | "auth.expired"
  | "auth.revoked"
  | "auth.recipient_mismatch"
  | "auth.malformed"
  | "auth.not_yet_valid"
  | "auth.attenuation_widened"
  | "auth.scope_required"
  // catalog.* — unknown / unavailable catalog entity (unknown→5, unavailable→8)
  | "catalog.unknown"
  | "catalog.unavailable"
  // state.* — invalid state transition / conflict (conflict→7, not-found→5)
  | "state.conflict"
  | "state.no_live_capsule"
  | "state.not_found"
  // dependency.* — a dependency/provider cannot provision (exit 8)
  | "dependency.unavailable"
  | "dependency.probe_failed"
  // mount.* — host-mount rejection (the load-bearing per-code mapping, §5.2)
  | "mount.denied" //      → 3
  | "mount.not_found" //   → 5
  | "mount.conflict" //    → 7
  | "mount.unsupported"; // → 8

/**
 * The stable CLI exit codes / MCP coarse branch (§5.2, docs/05 §5). Numeric on purpose: an exit
 * code IS a number, and callers compare against these names rather than magic literals.
 */
export enum ExitCode {
  /** success */
  OK = 0,
  /** unexpected / internal (uncaught) */
  INTERNAL = 1,
  /** usage — invalid flags/args (`usage.*`) */
  USAGE = 2,
  /** admission / policy rejection (`policy.*`, `mount.denied`) */
  POLICY = 3,
  /** authN/authZ failure — insufficient capability (`auth.*`) */
  AUTH = 4,
  /** not found (`catalog.unknown`, `state.not_found`, `mount.not_found`) */
  NOT_FOUND = 5,
  /** timeout / window expired (handoff wait timeout, `auth.expired` at a wait) */
  TIMEOUT = 6,
  /** conflict / invalid state transition (`state.conflict`, `mount.conflict`) */
  CONFLICT = 7,
  /** dependency / provider unavailable (`dependency.*`, `catalog.unavailable`, `mount.unsupported`) */
  DEPENDENCY = 8,
}

/**
 * The exhaustive `ErrorCode → ExitCode` map — the contract callers branch on as data (§5.2).
 * The mount.* rows are load-bearing and called out by AC#5: `denied→3, not_found→5,
 * conflict→7, unsupported→8`. Frozen so no caller can mutate the contract at runtime.
 *
 * NB: `auth.expired` maps to {@link ExitCode.AUTH} (4) by default; the *timeout* (6) reading is
 * a context the wait surface applies (a window that expired *while waiting*), not a property of
 * the code itself — so the data stays unambiguous and the surface owns that one re-label.
 */
export const EXIT_CODE_BY_ERROR: Readonly<Record<ErrorCode, ExitCode>> = Object.freeze({
  "usage.invalid_flag": ExitCode.USAGE,
  "usage.bad_argument": ExitCode.USAGE,
  "usage.unknown_command": ExitCode.USAGE,
  "usage.bad_flag": ExitCode.USAGE,

  "policy.denied": ExitCode.POLICY,
  "policy.detector_missing": ExitCode.POLICY,

  "auth.insufficient": ExitCode.AUTH,
  "auth.expired": ExitCode.AUTH,
  "auth.revoked": ExitCode.AUTH,
  "auth.recipient_mismatch": ExitCode.AUTH,
  "auth.malformed": ExitCode.AUTH,
  "auth.not_yet_valid": ExitCode.AUTH,
  "auth.attenuation_widened": ExitCode.AUTH,
  "auth.scope_required": ExitCode.AUTH,

  "catalog.unknown": ExitCode.NOT_FOUND,
  "catalog.unavailable": ExitCode.DEPENDENCY,

  "state.conflict": ExitCode.CONFLICT,
  "state.no_live_capsule": ExitCode.CONFLICT,
  "state.not_found": ExitCode.NOT_FOUND,

  "dependency.unavailable": ExitCode.DEPENDENCY,
  "dependency.probe_failed": ExitCode.DEPENDENCY,

  "mount.denied": ExitCode.POLICY, //      3
  "mount.not_found": ExitCode.NOT_FOUND, // 5
  "mount.conflict": ExitCode.CONFLICT, //   7
  "mount.unsupported": ExitCode.DEPENDENCY, // 8
});

/**
 * Map a stable error `code` to its CLI exit code / MCP coarse branch — the documented contract
 * (§5.2) as a pure function, so callers never parse prose. Total over {@link ErrorCode}; an
 * unrecognized string (only reachable if a caller bypasses the type) falls back to
 * {@link ExitCode.INTERNAL}, matching "unexpected / internal".
 */
export function exitCodeFor(code: ErrorCode): ExitCode {
  return EXIT_CODE_BY_ERROR[code] ?? ExitCode.INTERNAL;
}

/**
 * The wire/structured shape of an error (§5, docs/05 §4): a machine-stable `code`, a human
 * `message`, optional structured `detail`, the `skill` to load for recovery (a pointer, never
 * prose advice), and whether a retry could succeed. This is what crosses both the CLI (stderr
 * JSON) and the MCP error payload identically (surface parity, invariant 10).
 */
export interface GlaError {
  code: ErrorCode;
  message: string;
  detail?: Record<string, unknown>;
  /** The skill the agent loads to reason about recovery — a fact, not advice. */
  skill: string;
  retryable: boolean;
}

/** The default recovery skill an agent loads to interpret any taxonomy rejection. */
export const DEFAULT_RECOVERY_SKILL = "interpret-gla-rejections" as const;

/**
 * A throwable carrier for a {@link GlaError}. The kernel's own failures (e.g. an invalid state
 * transition, an attenuation that widened) throw this — a typed, machine-distinguishable error
 * with a stable `code`, **never a bare `Error`** (AC#1). Catch it and branch on `.code` /
 * `exitCodeFor(.code)`; the discriminant is the `code`, not the message.
 */
export class GlaErrorException extends Error implements GlaError {
  readonly code: ErrorCode;
  readonly detail?: Record<string, unknown>;
  readonly skill: string;
  readonly retryable: boolean;

  constructor(err: GlaError) {
    super(err.message);
    this.name = "GlaErrorException";
    this.code = err.code;
    if (err.detail !== undefined) {
      this.detail = err.detail;
    }
    this.skill = err.skill;
    this.retryable = err.retryable;
    // Restore the prototype chain so `instanceof GlaErrorException` holds after transpilation.
    Object.setPrototypeOf(this, GlaErrorException.prototype);
  }

  /** The exit code this error maps to (§5.2) — a convenience over {@link exitCodeFor}. */
  get exitCode(): ExitCode {
    return exitCodeFor(this.code);
  }

  /** The plain {@link GlaError} value (e.g. to serialize to the wire). */
  toGlaError(): GlaError {
    const out: GlaError = {
      code: this.code,
      message: this.message,
      skill: this.skill,
      retryable: this.retryable,
    };
    if (this.detail !== undefined) {
      out.detail = this.detail;
    }
    return out;
  }
}

/**
 * Build a {@link GlaErrorException} with sensible defaults (the {@link DEFAULT_RECOVERY_SKILL}
 * and `retryable: false`), so call sites stay terse while still producing a fully-formed,
 * typed taxonomy error rather than a bare `Error`.
 */
export function glaError(
  code: ErrorCode,
  message: string,
  opts: { detail?: Record<string, unknown>; skill?: string; retryable?: boolean } = {},
): GlaErrorException {
  const err: GlaError = {
    code,
    message,
    skill: opts.skill ?? DEFAULT_RECOVERY_SKILL,
    retryable: opts.retryable ?? false,
  };
  if (opts.detail !== undefined) {
    err.detail = opts.detail;
  }
  return new GlaErrorException(err);
}

/** Narrow an unknown thrown value to a {@link GlaErrorException}. */
export function isGlaError(e: unknown): e is GlaErrorException {
  return e instanceof GlaErrorException;
}
