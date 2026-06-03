// @gla/session — core ring (baseline §1, components/session-service.md, GLA-021).
// The Session aggregate's source of truth — the per-handoff unit / one capsule's lifecycle. Slice 2
// implements only the **dispatch target of admission**: `createFromAdmitted(task, resolvedSpec)`
// creates a Session under a task in the `issued` state — it MINTS the grant later and SPAWNS NOTHING
// (provisioning is Slice 3). The session pins the IMMUTABLE `ResolvedAssemblySpec` (frozen here, so a
// later mutation throws — kernel-contracts.md §3, invariant 9). A clear `provision()` SEAM is left for
// Slice 3 (the issue→mount→spawn saga). Lifecycle is the kernel Session reducer (`sessionTransition`).
//
// Boundary (core ring): depends ONLY on @gla/kernel.

import {
  type GlaErrorException,
  type Iso8601,
  type ResolvedAssemblySpec,
  type Session,
  type SessionId,
  type SessionState,
  type TaskId,
  glaError,
  sessionTransition,
} from "@gla/kernel";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const SESSION_MODULE = "@gla/session" as const;
/** Ring classification from the architecture baseline (informational). */
export const SESSION_RING = "core" as const;

/** Clock seam so the service stays pure/testable. */
export interface SessionClock {
  now(): Iso8601;
}
/** The default wall-clock. */
export const SYSTEM_CLOCK: SessionClock = { now: () => new Date().toISOString() as Iso8601 };

/** The public Session view the Bridge/CLI emit on a real-run create (docs/05 §4 shape). */
export interface SessionView {
  session_id: SessionId;
  task_id: TaskId;
  state: SessionState;
  template: string;
}

/** What a (future) provision step would return — declared now so the seam shape is stable. */
export interface ProvisionResult {
  /** The live capsule handle (Slice 3). */
  runtime: unknown;
  /** The agent-connector (Slice 3 — `{type, cdp_url|path, secret_ref}`). */
  connector: unknown;
}

/** Options for {@link SessionService}. */
export interface SessionServiceOptions {
  clock?: SessionClock;
  newSessionId?: () => SessionId;
}

let sessionCounter = 0;
function defaultSessionId(): SessionId {
  sessionCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `sess_${rand}${sessionCounter.toString(36)}`;
}

/**
 * The Session service (components/session-service.md). Slice 2 owns the aggregate + the
 * admission-dispatch entry. It is the CONDUCTOR; the instruments (Capability/Route/Worker) are wired
 * in Slice 3 via {@link SessionService.provision}.
 */
export class SessionService {
  private readonly clock: SessionClock;
  private readonly newSessionId: () => SessionId;
  private readonly sessions = new Map<SessionId, Session>();

  constructor(opts: SessionServiceOptions = {}) {
    this.clock = opts.clock ?? SYSTEM_CLOCK;
    this.newSessionId = opts.newSessionId ?? defaultSessionId;
  }

  /**
   * Create a Session from an admitted (accepted) proposal — the dispatch target of admission
   * (GLA-021: on a real-run accept, "dispatch to the task: create the Session aggregate under the task
   * in `issued` state — do NOT spawn the capsule"). The session is created `proposed` then advanced
   * to `issued` via the kernel reducer (the admitted-but-not-yet-provisioned state). The
   * `ResolvedAssemblySpec` is FROZEN (deep) so it is immutable after admission.
   *
   * @param taskId        the task this session belongs to (its goal/revocation root)
   * @param resolvedSpec  the immutable resolved spec admission produced
   * @param recipient     the bound recipient (carried onto the session for later handoff binding)
   */
  createFromAdmitted(taskId: TaskId, resolvedSpec: ResolvedAssemblySpec): Session {
    const id = this.newSessionId();
    const at = this.clock.now();
    // Deep-freeze the spec so a later mutation throws (immutable after admission — invariant 9).
    const spec = deepFreeze(structuredClone(resolvedSpec)) as ResolvedAssemblySpec;

    // proposed → issued: admitted, grant/route/spawn NOT yet done (that is provision(), Slice 3).
    const state: SessionState = sessionTransition("proposed", "issued");
    const session: Session = {
      id,
      taskId,
      spec,
      state,
      createdAt: at,
      updatedAt: at,
    };
    const recipient = resolvedSpec.spec.recipient;
    if (recipient !== undefined) {
      session.recipient = recipient;
    }
    this.sessions.set(id, session);
    return session;
  }

  /** Read one Session aggregate (docs/05 `session get`). Throws `state.not_found` (→ exit 5) if unknown. */
  get(id: SessionId): Session {
    const s = this.sessions.get(id);
    if (s === undefined) {
      throw glaError("state.not_found", `unknown session: "${id}"`, { detail: { id } });
    }
    return s;
  }

  /** List sessions, optionally filtered by task and/or state (docs/05 `session list`). Read-only. */
  list(filter?: { task?: TaskId; state?: SessionState }): Session[] {
    let rows = [...this.sessions.values()];
    if (filter?.task !== undefined) {
      rows = rows.filter((s) => s.taskId === filter.task);
    }
    if (filter?.state !== undefined) {
      rows = rows.filter((s) => s.state === filter.state);
    }
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /**
   * The PROVISION seam (Slice 3): issue→mount→spawn. Intentionally NOT implemented in Slice 2 —
   * provisioning a capsule (mint grant, mount route, spawn via the Worker) is the next slice. It is a
   * named method so the seam is explicit and stable; calling it now is a typed `state.conflict` (the
   * capability is not yet wired) rather than a silent no-op or an accidental spawn.
   *
   * @throws GlaErrorException — provisioning is not available in this slice.
   */
  provision(_id: SessionId): Promise<ProvisionResult> {
    return Promise.reject(this.notProvisionable());
  }

  private notProvisionable(): GlaErrorException {
    return glaError(
      "state.conflict",
      "session provisioning (spawn) is not available in this slice — it lands in Slice 3",
      { retryable: false },
    );
  }

  /** Project a Session to the public CLI/Bridge view (docs/05 §4 shape). */
  static toView(s: Session): SessionView {
    return {
      session_id: s.id,
      task_id: s.taskId,
      state: s.state,
      template: s.spec.spec.template,
    };
  }
}

/** Recursively `Object.freeze` a value (so a mutation attempt on the resolved spec throws). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
