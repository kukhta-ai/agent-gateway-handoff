// @gla/session — core ring (baseline §1, components/session-service.md, GLA-021/022/023/024/025).
// The Session aggregate's source of truth — the per-handoff unit / one capsule's lifecycle. The Session
// service is the CONDUCTOR of the issue → spawn saga; the instruments (Capability, Worker, Connector)
// are injected.
//   - createFromAdmitted(task, resolvedSpec) — the dispatch target of admission (Slice 2): create a
//     Session under a task in `issued`, pinning the IMMUTABLE (frozen) ResolvedAssemblySpec. No spawn.
//   - provision(sessionId) — the REVERSIBLE create-saga (Slice 3, GLA-022/023/024/025):
//       mint the agent-connector capability → spawn the capsule via the worker → attach the connector →
//       `issued → active`, returning {session_id, state, capsule, connector}. On ANY step failure it
//       COMPENSATES in reverse (stop capsule, reap workspace, revoke connector — the worker's idempotent
//       teardown) and sets the session `failed` — leaving NO orphan capsule/workspace (GLA-023 AC#3).
//   - connector(sessionId) — re-emit the connector for a LIVE capsule (GLA-025); a session with no live
//     capsule is a catchable `state.conflict` (exit 7), never a crash (GLA-025 AC#4).
// The spec stays IMMUTABLE throughout (frozen at admission — invariant 9); provision only reads it.
//
// Boundary (core ring): depends ONLY on @gla/kernel. The Worker, Capability, and Connector seams are
// injected as kernel-port-shaped interfaces (defined here as the minimal shapes the saga needs), so the
// session never names a concrete adapter — `app` wires the real worker/connector.

import {
  type AgentConnector,
  type CapabilityId,
  type GlaErrorException,
  type Iso8601,
  type Ref,
  type ResolvedAssemblySpec,
  type RuntimeHandle,
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

// ─────────────────────────────────────────────────────────────────────────────
// The provision seams — the minimal shapes the create-saga depends on (no adapter named)
// ─────────────────────────────────────────────────────────────────────────────

/** What `CapabilityService.mintConnector` hands back (the agent-blind ref + the GLA-side bearer). */
export interface MintedConnectorRef {
  /** The minted capability id (so the saga can revoke it on compensation). */
  capabilityId: CapabilityId;
  /** The agent-blind `secret_ref` the connector JSON carries (a capability reference, never a secret). */
  secretRef: Ref<"secret-ref">;
  /**
   * The connector cap's lineage PARENT (the session's task cap id), when minted as a child (Finding #1).
   * Recorded so a caller/test can observe the connector genuinely DESCENDS from the task cap (and the
   * revoke-the-parent cascade applies); `undefined` only when minted as a root (no parent threaded).
   */
  parentRef?: CapabilityId;
}

/**
 * The capability seam the saga needs (a subset of CapabilityService): mint the agent-connector cap and
 * revoke it. Injected so the session never imports the capability service concretely.
 */
export interface ConnectorCapabilityPort {
  /** Mint the agent-connector capability for a session (agent-blind `secret-ref` ref; GLA-024/025). */
  mintConnector(sessionId: string, parentRef?: CapabilityId): Promise<MintedConnectorRef>;
  /** Revoke a capability by id (compensation: revoke the connector on saga failure / teardown). */
  revoke(id: CapabilityId): Promise<void>;
}

/** The live-capsule handles a spawn yields (from the worker's lifecycle manager). */
export interface SpawnedCapsuleHandles {
  runtime: RuntimeHandle;
  /** Which launcher (by name) spawned it — surfaced in the capsule view. */
  launcherName: string;
}

/**
 * The worker seam the saga needs (a subset of the worker's CapsuleLifecycleManager): spawn a capsule
 * for a session, tear it down (idempotent — the compensation/cleanup path), and ask if a live capsule
 * exists (for `connector`'s conflict check). Injected — the session imports no adapter.
 */
export interface CapsuleWorkerPort {
  spawn(sessionId: string, spec: ResolvedAssemblySpec): Promise<SpawnedCapsuleHandles>;
  teardown(sessionId: string): Promise<void>;
  hasLive(sessionId: string): boolean;
  /** The live runtime handle for a session (so `connector` can re-attach), or undefined. */
  runtimeOf(sessionId: string): RuntimeHandle | undefined;
}

/**
 * The agent-connector seam (a subset of the kernel `AgentConnectorPort`): attach the connector to a
 * live capsule, and bind/unbind the agent-blind `secret_ref` the saga minted (so the returned connector
 * JSON carries the ref). Injected.
 */
export interface SessionConnectorPort {
  attach(runtime: RuntimeHandle): Promise<AgentConnector>;
  /** Bind a freshly-minted `secret_ref` to a capsule (by its CDP url) so `attach` stamps it. */
  bindSecretRef(cdpUrl: string, secretRef: Ref<"secret-ref">): void;
  /** Drop a capsule's bound `secret_ref` (on teardown). Idempotent. */
  unbindSecretRef(cdpUrl: string): void;
}

/** The capsule descriptor in the provision view (docs/05 §4: `capsule:{id, template}`). */
export interface CapsuleView {
  id: string;
  template: string;
}

/** What `provision`/`connector` return — the live session + capsule + the agent-blind connector. */
export interface ProvisionResult {
  session_id: SessionId;
  state: SessionState;
  capsule: CapsuleView;
  /** The agent's connector: `{type, cdp_url|path, secret_ref}` (agent-blind; GLA-024/025). */
  connector: AgentConnector;
}

/** The provision wiring the SessionService needs to run the saga (all injected; no adapter named). */
export interface ProvisionDeps {
  worker: CapsuleWorkerPort;
  capability: ConnectorCapabilityPort;
  connector: SessionConnectorPort;
  /**
   * Resolve the **task/session capability id** the connector descends from (for the lineage-revocation
   * cascade — revoking the task cap revokes the connector). Called with the session id AND its task id
   * (the session knows its task), so the wiring can map the task → its `taskCapabilityRef`. Returning
   * `undefined` mints a root connector (no cascade) — the explicit fallback when no parent is available.
   */
  parentCapabilityRefFor?: (sessionId: SessionId, taskId: TaskId) => CapabilityId | undefined;
}

/** Options for {@link SessionService}. */
export interface SessionServiceOptions {
  clock?: SessionClock;
  newSessionId?: () => SessionId;
  /** The provision wiring (Slice 3). When omitted, `provision`/`connector` reject with a clear error. */
  provision?: ProvisionDeps;
}

let sessionCounter = 0;
function defaultSessionId(): SessionId {
  sessionCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `sess_${rand}${sessionCounter.toString(36)}`;
}

let capsuleCounter = 0;
function defaultCapsuleId(): string {
  capsuleCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `cap_${rand}${capsuleCounter.toString(36)}`;
}

/**
 * The Session service (components/session-service.md). Owns the aggregate + the admission-dispatch entry
 * AND the issue→spawn create-saga (Slice 3). It is the CONDUCTOR; the instruments (Capability/Worker/
 * Connector) are injected via {@link ProvisionDeps}.
 */
export class SessionService {
  private readonly clock: SessionClock;
  private readonly newSessionId: () => SessionId;
  private readonly sessions = new Map<SessionId, Session>();
  private readonly provisionDeps: ProvisionDeps | undefined;
  /** Per-session provision bookkeeping the saga + re-emit + teardown need (capsule id, connector cap, cdp url). */
  private readonly provisioned = new Map<
    SessionId,
    {
      capsuleId: string;
      connectorCapId: CapabilityId;
      cdpUrl: string;
      /** The connector cap's lineage parent (the task cap id), if minted as a child (Finding #1). */
      connectorParentRef?: CapabilityId;
    }
  >();

  constructor(opts: SessionServiceOptions = {}) {
    this.clock = opts.clock ?? SYSTEM_CLOCK;
    this.newSessionId = opts.newSessionId ?? defaultSessionId;
    this.provisionDeps = opts.provision;
  }

  /**
   * Create a Session from an admitted (accepted) proposal — the dispatch target of admission
   * (GLA-021). The session is created `proposed` then advanced to `issued` via the kernel reducer. The
   * `ResolvedAssemblySpec` is FROZEN (deep) so it is immutable after admission (invariant 9).
   */
  createFromAdmitted(taskId: TaskId, resolvedSpec: ResolvedAssemblySpec): Session {
    const id = this.newSessionId();
    const at = this.clock.now();
    const spec = deepFreeze(structuredClone(resolvedSpec)) as ResolvedAssemblySpec;

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
   * The PROVISION create-saga (Slice 3, GLA-022/023/024/025). Turns an `issued` session into a live
   * capsule + the agent's agent-blind connector, moving the session `issued → active` on success. The
   * saga is REVERSIBLE — on ANY step failure it compensates (stop capsule + reap workspace + revoke
   * connector via the worker's idempotent teardown) and sets the session `failed`, leaving NO orphan
   * capsule/workspace (GLA-023 AC#3).
   *
   * Steps (each with its compensation, run in reverse of what succeeded):
   *   1. mint the agent-connector capability      → revoke it
   *   2. spawn the capsule via the worker          → teardown (stop + reap)
   *   3. attach the connector (read CDP + stamp ref)→ (no external effect)
   *   4. advance `issued → active`, pin the runtime → (terminal-on-success)
   *
   * @throws GlaErrorException — provisioning not wired (no ProvisionDeps), or a typed step failure
   *         (the session is set `failed` and compensated before the error is rethrown).
   */
  async provision(id: SessionId): Promise<ProvisionResult> {
    const deps = this.provisionDeps;
    if (deps === undefined) {
      throw glaError(
        "state.conflict",
        "session provisioning is not wired (no worker/connector injected)",
        { retryable: false },
      );
    }
    const session = this.get(id); // throws state.not_found (→ exit 5) if unknown
    if (session.state !== "issued") {
      // Provision is only legal from `issued`; a re-provision or a live session is a conflict (exit 7).
      throw glaError(
        "state.conflict",
        `session "${id}" is ${session.state}, not provisionable (expected issued)`,
        { detail: { id, state: session.state }, retryable: false },
      );
    }

    // Track which compensations are owed as each forward step succeeds.
    let connectorCapId: CapabilityId | undefined;
    let spawned: SpawnedCapsuleHandles | undefined;
    let boundCdpUrl: string | undefined;
    try {
      // ── Step 1 — mint the agent-connector capability (agent-blind secret-ref ref; GLA-024/025).
      //    It DESCENDS from the session's task capability (parentRef) so revoking the task cascades to
      //    the connector by lineage (capability-service.md, scenario-01 Phase 3/15). The session knows
      //    its task id; the wiring maps it to the task's capability id.
      const parentRef = deps.parentCapabilityRefFor?.(id, session.taskId);
      const minted = await deps.capability.mintConnector(id, parentRef);
      connectorCapId = minted.capabilityId;

      // ── Step 2 — spawn the capsule via the worker (realize workspace + launcher + health probe).
      //    A spawn failure here is already no-orphan inside the lifecycle manager (it tears its own
      //    partial capsule down); we still compensate the connector cap below.
      spawned = await deps.worker.spawn(id, session.spec);

      // ── Step 3 — attach the connector: read the CDP url, bind the agent-blind secret_ref, attach.
      const probe = await deps.connector.attach(spawned.runtime);
      const cdpUrl = probe.cdp_url ?? "";
      if (cdpUrl.length > 0) {
        deps.connector.bindSecretRef(cdpUrl, minted.secretRef);
        boundCdpUrl = cdpUrl;
      }
      // Re-attach now that the secret_ref is bound, so the returned connector carries it (agent-blind).
      const connector = await deps.connector.attach(spawned.runtime);

      // ── Step 4 — advance issued → active and pin the runtime handle on the session.
      session.state = sessionTransition(session.state, "active");
      session.runtime = spawned.runtime;
      session.updatedAt = this.clock.now();

      const capsuleId = defaultCapsuleId();
      const rec: {
        capsuleId: string;
        connectorCapId: CapabilityId;
        cdpUrl: string;
        connectorParentRef?: CapabilityId;
      } = { capsuleId, connectorCapId, cdpUrl };
      if (minted.parentRef !== undefined) {
        rec.connectorParentRef = minted.parentRef;
      }
      this.provisioned.set(id, rec);

      return {
        session_id: id,
        state: session.state,
        capsule: { id: capsuleId, template: session.spec.spec.template },
        connector,
      };
    } catch (e) {
      // ── COMPENSATE (reverse order of what succeeded) — leave NO orphan (GLA-023 AC#3).
      // (a) tear the capsule down if it spawned (stop the process + reap the workspace — idempotent).
      if (spawned !== undefined) {
        await safe(() => deps.worker.teardown(id));
      }
      // (b) unbind + revoke the connector capability if it was minted. (Capture into locals so the
      // narrowing survives into the compensation closures.)
      const cdpToUnbind = boundCdpUrl;
      if (cdpToUnbind !== undefined) {
        safeSync(() => deps.connector.unbindSecretRef(cdpToUnbind));
      }
      const capToRevoke = connectorCapId;
      if (capToRevoke !== undefined) {
        await safe(() => deps.capability.revoke(capToRevoke));
      }
      // (c) set the session `failed` (the saga is contained to this step — session-service.md).
      session.state = sessionTransition(session.state, "failed");
      session.updatedAt = this.clock.now();
      throw asGlaError(e);
    }
  }

  /**
   * Re-emit the agent-connector for a LIVE capsule (docs/05 `session connector`, GLA-025) — so a crashed
   * agent re-attaches its CDP client. Prints a `secret_ref`, never a raw secret. A session with **no
   * live capsule** is a catchable **`state.conflict` (exit 7)**, NOT a crash (GLA-025 AC#4).
   *
   * @throws GlaErrorException `state.not_found` (unknown id → exit 5) or `state.conflict` (no live
   *         capsule → exit 7).
   */
  async connector(id: SessionId): Promise<ProvisionResult> {
    const deps = this.provisionDeps;
    const session = this.get(id); // throws state.not_found (→ exit 5)
    const rec = this.provisioned.get(id);
    const runtime = deps?.worker.runtimeOf(id);
    // No live capsule (never provisioned, or torn down) → a catchable conflict, never a crash.
    if (
      deps === undefined ||
      rec === undefined ||
      runtime === undefined ||
      !deps.worker.hasLive(id)
    ) {
      throw glaError(
        "state.conflict",
        `session "${id}" has no live capsule to re-emit a connector`,
        {
          detail: { id, state: session.state },
          retryable: false,
        },
      );
    }
    const connector = await deps.connector.attach(runtime);
    return {
      session_id: id,
      state: session.state,
      capsule: { id: rec.capsuleId, template: session.spec.spec.template },
      connector,
    };
  }

  /**
   * The connector-teardown facts for a provisioned session — the connector capability id (to revoke)
   * and the capsule's CDP url (to unbind its agent-blind `secret_ref`) — or `undefined` if the session
   * was never provisioned (or is already torn down). The terminal cleanup path (the Cleanup Reconciler,
   * wired at `app`) reads this so a normally-reaped session revokes its connector cap AND drops its
   * `secret_ref→cdpUrl` binding (no residual) — symmetric with the saga's failure compensation.
   */
  connectorTeardownInfo(
    id: SessionId,
  ): { connectorCapId: CapabilityId; cdpUrl: string } | undefined {
    const rec = this.provisioned.get(id);
    if (rec === undefined) {
      return undefined;
    }
    return { connectorCapId: rec.connectorCapId, cdpUrl: rec.cdpUrl };
  }

  /**
   * Forget a session's provision bookkeeping (called by the terminal cleanup path AFTER it has revoked
   * the connector cap + unbound the secret_ref), so a second teardown is an idempotent no-op (the info
   * is gone) and no stale connector record lingers. Safe to call for an unknown/never-provisioned id.
   */
  clearProvisioned(id: SessionId): void {
    this.provisioned.delete(id);
  }

  /**
   * The connector capability's lineage for a provisioned session — its own id + its parent (the task
   * cap id, when minted as a child; Finding #1) — or `undefined` if not provisioned. Lets a caller/test
   * observe that the connector genuinely DESCENDS from the task cap (so revoking the task cascades).
   */
  connectorLineage(
    id: SessionId,
  ): { connectorCapId: CapabilityId; parentRef?: CapabilityId } | undefined {
    const rec = this.provisioned.get(id);
    if (rec === undefined) {
      return undefined;
    }
    return rec.connectorParentRef !== undefined
      ? { connectorCapId: rec.connectorCapId, parentRef: rec.connectorParentRef }
      : { connectorCapId: rec.connectorCapId };
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

/** Run an async compensation step, swallowing errors (compensation must converge — GLA-023 AC#3). */
async function safe(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // A compensation failure must not mask the original error nor block the rest of the rollback.
  }
}

/** Run a sync compensation step, swallowing errors. */
function safeSync(fn: () => void): void {
  try {
    fn();
  } catch {
    // see safe()
  }
}

/** Coerce an unknown thrown value to a GlaErrorException (preserving a kernel taxonomy error). */
function asGlaError(e: unknown): GlaErrorException {
  if (e instanceof Error && e.name === "GlaErrorException") {
    return e as GlaErrorException;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return glaError("dependency.unavailable", `provision failed: ${msg}`, { detail: { cause: msg } });
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
