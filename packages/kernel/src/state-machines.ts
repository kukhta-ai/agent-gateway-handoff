// K8 — state-transition functions (pure reducers per lifecycle) — kernel-contracts.md §1, §10.9.
// Provable without any adapter: each machine is a frozen legal-transitions table + a pure
// `transition()` that returns the next state or THROWS a typed, machine-distinguishable
// `state.conflict` (a discriminated taxonomy error with a stable `code`), NEVER a bare Error
// (task AC#1). No I/O, no clock, no signing.

import type { HandoffState, SessionState, TaskState } from "./entities.js";
import { type ErrorCode, type GlaErrorException, glaError } from "./errors.js";

/** A reusable, typed transition rejection: `state.conflict`, naming the from/to/machine. */
export function invalidTransition(machine: string, from: string, to: string): GlaErrorException {
  return glaError("state.conflict", `invalid ${machine} transition: ${from} → ${to}`, {
    detail: { machine, from, to },
    retryable: false,
  });
}

/** Generic transition over a legal-set table: returns `to` if legal, else throws `state.conflict`. */
function step<S extends string>(
  machine: string,
  table: Readonly<Record<S, ReadonlySet<S>>>,
  from: S,
  to: S,
): S {
  const allowed = table[from];
  if (allowed === undefined) {
    // `from` is not a known state of this machine.
    throw invalidTransition(machine, String(from), String(to));
  }
  if (!allowed.has(to)) {
    throw invalidTransition(machine, String(from), String(to));
  }
  return to;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task machine (§1.1): active → completed | revoked | failed.
//   `completed`/`revoked` are terminal; `failed` keeps the goal alive for repair-resume — but
//   modeled as a terminal aggregate state here (the task stays `active` while a *step* fails; a
//   task only transitions to `failed` as a deliberate terminal disposition).
// ─────────────────────────────────────────────────────────────────────────────

const TASK_TRANSITIONS: Readonly<Record<TaskState, ReadonlySet<TaskState>>> = Object.freeze({
  active: new Set<TaskState>(["completed", "revoked", "failed"]),
  completed: new Set<TaskState>(), // terminal
  revoked: new Set<TaskState>(), //   terminal
  failed: new Set<TaskState>(), //    terminal
});

/** The terminal Task states (no transition out). */
export const TASK_TERMINAL: ReadonlySet<TaskState> = new Set<TaskState>([
  "completed",
  "revoked",
  "failed",
]);

/** Reduce a Task state by one transition, or throw `state.conflict` (§1.1). Pure. */
export function taskTransition(from: TaskState, to: TaskState): TaskState {
  return step("task", TASK_TRANSITIONS, from, to);
}

/** Is a Task transition legal without throwing? (For pre-checks / read models.) */
export function canTaskTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from]?.has(to) ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session machine (§1.2): proposed → issued → opened → active → completed|revoked|expired|failed.
//   A window CLOSING returns `opened → active` (it does not kill the capsule). `active` can
//   re-open (`active → opened`) — scenario-01's second handoff is a re-opened window on the same
//   capsule, not a new session. Terminal: completed | revoked | expired | failed. revoke/expire/
//   fail may occur from any live (non-terminal) state.
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_TERMINAL_TARGETS: ReadonlySet<SessionState> = new Set<SessionState>([
  "completed",
  "revoked",
  "expired",
  "failed",
]);

function liveTo(...extra: SessionState[]): ReadonlySet<SessionState> {
  // Any live state may go to a terminal disposition (revoked/expired/failed) plus its own
  // forward edges. (Not `completed` — completion is reached only along the happy path.)
  return new Set<SessionState>([...extra, "revoked", "expired", "failed"]);
}

const SESSION_TRANSITIONS: Readonly<Record<SessionState, ReadonlySet<SessionState>>> =
  Object.freeze({
    proposed: liveTo("issued"),
    issued: liveTo("opened", "active"),
    // a window is live; it may complete, or close back to `active`
    opened: liveTo("active", "completed"),
    // no window open but the capsule lives; the agent may re-open a window, or complete the session
    active: liveTo("opened", "completed"),
    completed: new Set<SessionState>(), // terminal
    revoked: new Set<SessionState>(), //   terminal
    expired: new Set<SessionState>(), //   terminal
    failed: new Set<SessionState>(), //    terminal
  });

/** The terminal Session states. */
export const SESSION_TERMINAL: ReadonlySet<SessionState> = SESSION_TERMINAL_TARGETS;

/** Reduce a Session state by one transition, or throw `state.conflict` (§1.2). Pure. */
export function sessionTransition(from: SessionState, to: SessionState): SessionState {
  return step("session", SESSION_TRANSITIONS, from, to);
}

/** Is a Session transition legal without throwing? */
export function canSessionTransition(from: SessionState, to: SessionState): boolean {
  return SESSION_TRANSITIONS[from]?.has(to) ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handoff window machine (§1.3): open → completed | expired | cancelled.
// ─────────────────────────────────────────────────────────────────────────────

const HANDOFF_TRANSITIONS: Readonly<Record<HandoffState, ReadonlySet<HandoffState>>> =
  Object.freeze({
    open: new Set<HandoffState>(["completed", "expired", "cancelled"]),
    completed: new Set<HandoffState>(), // terminal
    expired: new Set<HandoffState>(), //  terminal
    cancelled: new Set<HandoffState>(), // terminal
  });

/** The terminal Handoff states. */
export const HANDOFF_TERMINAL: ReadonlySet<HandoffState> = new Set<HandoffState>([
  "completed",
  "expired",
  "cancelled",
]);

/** Reduce a Handoff-window state by one transition, or throw `state.conflict` (§1.3). Pure. */
export function handoffTransition(from: HandoffState, to: HandoffState): HandoffState {
  return step("handoff", HANDOFF_TRANSITIONS, from, to);
}

/** Is a Handoff transition legal without throwing? */
export function canHandoffTransition(from: HandoffState, to: HandoffState): boolean {
  return HANDOFF_TRANSITIONS[from]?.has(to) ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Completion-signal admission (§1.6 invariant): an out-of-contract signal is REJECTED, not
// trusted — a spoofed "done" cannot advance the flow. The kernel exposes the predicate; the
// completion service supplies the contract's allowed statuses.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is a raw done-signal `status` in the detector's declared contract (§1.6)? An empty/missing
 * contract admits nothing (fail-closed). Used so a spoofed status is rejected before it can
 * advance a session/handoff.
 */
export function isCompletionInContract(
  status: string,
  contractStatuses: readonly string[],
): boolean {
  return contractStatuses.includes(status);
}

/**
 * Assert a done-signal is in-contract, else throw a typed rejection. Reuses the policy namespace
 * (`policy.detector_missing` would be for a *missing* detector; an out-of-contract *signal* is a
 * `state.conflict` — it cannot legally advance the flow).
 */
export function assertCompletionInContract(
  status: string,
  contractStatuses: readonly string[],
): void {
  if (!isCompletionInContract(status, contractStatuses)) {
    const code: ErrorCode = "state.conflict";
    throw glaError(code, `completion signal "${status}" is not in the detector contract`, {
      detail: { status, contractStatuses },
    });
  }
}
