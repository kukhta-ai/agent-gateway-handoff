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
  type HandoffId,
  type HandoffState,
  type HandoffWindow,
  type Iso8601,
  type OpaqueToken,
  type RecipientRef,
  type Ref,
  type ResolvedAssemblySpec,
  type Route,
  type RuntimeHandle,
  type Session,
  type SessionId,
  type SessionState,
  type TaskId,
  glaError,
  handoffTransition,
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

// ─────────────────────────────────────────────────────────────────────────────
// The handoff-open seams — the minimal shapes the open-window saga depends on (Slice 4b, no adapter named)
// ─────────────────────────────────────────────────────────────────────────────

/** What a minted handoff grant hands back (the recipient-bound `session` grant + its token + scope path). */
export interface MintedSessionGrantRef {
  /** The minted grant capability id (so the saga can revoke it on close/compensation). */
  grantId: CapabilityId;
  /** The bearer token the handoff link carries / the gateway verifies. */
  token: OpaqueToken;
  /** The scope path the grant authorizes (the route's public path). */
  scopePath: string;
}

/**
 * The capability seam the open-window saga needs (a subset of CapabilityService): mint the recipient-bound
 * `session` grant (attenuated from the session/task capability, never widened) and revoke it. Injected so the
 * session never imports the capability service concretely.
 */
export interface HandoffCapabilityPort {
  /** Mint a recipient-bound handoff grant (short TTL, single-recipient, scoped to the session/capsule). */
  mintSessionGrant(req: {
    sessionId: string;
    recipient: RecipientRef;
    parentToken?: OpaqueToken;
    notAfter?: Iso8601;
  }): Promise<MintedSessionGrantRef>;
  /** Revoke a capability by id (close/compensation: revoke the grant, cascading to nothing further). */
  revoke(id: CapabilityId): Promise<void>;
  /** Force-close every live WS bound to a grant id at the edge (so a revoked grant's surface is unreachable). */
  forceCloseGrant(grantId: CapabilityId): void;
}

/**
 * The route seam the saga needs (a subset of the Route controller): program a grant-bound route for an opening
 * window, and unmount it on close. A programming failure is a typed error with NO partial route. Injected — the
 * session imports no concrete gateway/route-controller.
 */
export interface HandoffRoutePort {
  /** Program a grant-bound route for an opening window -> the programmed Route (a programming failure throws). */
  program(
    window: Pick<HandoffWindow, "id" | "sessionId">,
    grantId: CapabilityId,
    capsuleEntrypoint: string,
    path?: string,
  ): Promise<Route>;
  /** Unmount a window's route (force-closing any live WS bound to it). Idempotent. */
  unmount(windowId: HandoffId): Promise<void>;
}

/**
 * The human-entrypoint seam the saga needs (a subset of the kernel HumanEntrypointPort): resolve the capsule's
 * internal human-entrypoint address (the noVNC endpoint) the route proxies to. Injected.
 */
export interface HandoffEntrypointPort {
  /** Resolve the capsule's internal human-entrypoint address for a live runtime (the gateway proxies to it). */
  open(runtime: RuntimeHandle): Promise<{ internalEndpoint: string }>;
}

/**
 * The channel seam the saga needs (a subset of the kernel ChannelPort): deliver the recipient-bound handoff link to
 * EXACTLY the bound recipient. Injected.
 */
export interface HandoffChannelPort {
  /** Deliver the recipient-bound handoff link to the bound recipient (the channel never widens the binding). */
  deliver(recipient: RecipientRef, link: string, delegation: OpaqueToken): Promise<void>;
}

/** The handoff-open wiring the SessionService needs to run the saga (all injected; no adapter named). */
export interface HandoffDeps {
  capability: HandoffCapabilityPort;
  route: HandoffRoutePort;
  entrypoint: HandoffEntrypointPort;
  channel: HandoffChannelPort;
  /**
   * Build the public handoff link from the route path + the grant token (the gateway's `handoffLink`). Injected so
   * the session never imports the gateway; `app` supplies `AccessGateway.handoffLink(baseUrl, path, token)`.
   */
  buildLink: (path: string, token: OpaqueToken) => string;
  /**
   * Resolve the **session/task capability token** the handoff grant attenuates FROM (so the grant is a child that
   * cannot widen the recipient/scope/ttl and cascades on the parent's revoke). Called with the session + its task
   * id. Returning `undefined` mints a fresh `session` root (no cascade) — the explicit fallback.
   */
  parentTokenFor?: (sessionId: SessionId, taskId: TaskId) => OpaqueToken | undefined;
  /** New handoff-window id generator (injectable for deterministic tests). */
  newHandoffId?: () => HandoffId;
  /** A timer seam so the TTL wheel is testable (defaults to real setTimeout). */
  setTimer?: (ms: number, fn: () => void) => { clear: () => void };
}

/** Options for {@link SessionService}. */
export interface SessionServiceOptions {
  clock?: SessionClock;
  newSessionId?: () => SessionId;
  /** The provision wiring (Slice 3). When omitted, `provision`/`connector` reject with a clear error. */
  provision?: ProvisionDeps;
  /** The handoff-open wiring (Slice 4b). When omitted, `openHandoff`/`cancelHandoff` reject with a clear error. */
  handoff?: HandoffDeps;
}

/** The public handoff view the Bridge/CLI emit on `handoff open` (docs/05 §4 shape). */
export interface HandoffView {
  handoff_id: HandoffId;
  /** The recipient-bound link delivered to the bound recipient. */
  link: string;
  recipient: RecipientRef;
  /** ISO-8601 expiry of the window/grant. */
  expires_at: Iso8601;
  /** The window state (open / completed / expired / cancelled). */
  state: HandoffState;
  session_id: SessionId;
}

/** The default TTL for a handoff window when none is given (matches the grant default; ~15m). */
const DEFAULT_HANDOFF_TTL_MS = 15 * 60 * 1000;

/** Parse a coarse duration like "15m"/"30s"/"1h"/"2d" into milliseconds, or undefined if malformed. */
function parseDurationMs(d: string): number | undefined {
  const m = /^(\d+)\s*(s|m|h|d)$/.exec(d.trim());
  if (m === null) {
    return undefined;
  }
  const n = Number(m[1]);
  const unit = m[2];
  const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mult;
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

let handoffCounter = 0;
function defaultHandoffId(): HandoffId {
  handoffCounter += 1;
  return `hand_${handoffCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
  private readonly handoffDeps: HandoffDeps | undefined;
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
  /** The handoff windows, by id (the recipient-bound views onto sessions). The session aggregate stays the truth. */
  private readonly handoffs = new Map<HandoffId, HandoffWindow>();
  /** Per-window TTL timer + bound grant id (so close/cancel/expiry can clear the timer + revoke the grant). */
  private readonly handoffTimers = new Map<
    HandoffId,
    { clear: () => void; grantId: CapabilityId }
  >();

  constructor(opts: SessionServiceOptions = {}) {
    this.clock = opts.clock ?? SYSTEM_CLOCK;
    this.newSessionId = opts.newSessionId ?? defaultSessionId;
    this.provisionDeps = opts.provision;
    this.handoffDeps = opts.handoff;
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

  // ── Handoff windows (Slice 4b, scenario-01 Phases 5/11) ───────────────────────────────────────────────

  /**
   * Open a recipient-bound handoff window onto a live session (GLA-032/033, scenario-01 Phase 5/11) — the
   * **ordered, reversible open-window saga**: **mint the recipient-bound grant → program the grant-bound route →
   * deliver the link** to exactly the bound recipient. It creates the {@link HandoffWindow} (`open`), advances the
   * session `active → opened` (the window exposes the capsule's human entrypoint ONLY while open — GLA-033 AC#2),
   * and arms the TTL timer (on expiry: revoke the grant, force-close the WS, unmount the route, mark `expired`).
   *
   * **Reversible (GLA-033 AC#4):** every forward step has a compensation run in reverse on a later failure — a
   * grant minted but a route that fails to program → the grant is revoked and NO partial route survives; a route
   * mounted but delivery that fails → the route is unmounted and the grant revoked. A failure leaves the session
   * back at `active` with no window, no grant, no route, no link (clean — a retry starts fresh).
   *
   * **Re-open onto the SAME capsule (GLA-032 AC#8):** the saga reads the session's existing live runtime; the
   * second handoff in scenario-01 is a re-opened window on the same capsule, not a new session (the session must be
   * `active` with a live capsule — it does not re-spawn).
   *
   * @param sessionId  the live session to open a window onto (must be `active` with a live capsule)
   * @param opts       `recipient` (defaults to the session's bound recipient), `reason`, `ttl` (a coarse duration)
   * @returns the {@link HandoffView}: `{ handoff_id, link, recipient, expires_at, state, session_id }`
   * @throws GlaErrorException — not wired (no HandoffDeps), no live capsule (`state.conflict`), or a typed saga step
   *         failure (the saga compensates and the session returns to `active` before the error is rethrown).
   */
  async openHandoff(
    sessionId: SessionId,
    opts: { recipient?: RecipientRef; reason?: string; ttl?: string } = {},
  ): Promise<HandoffView> {
    const deps = this.handoffDeps;
    if (deps === undefined) {
      throw glaError(
        "state.conflict",
        "handoff is not wired (no capability/route/channel injected)",
        {
          retryable: false,
        },
      );
    }
    const session = this.get(sessionId); // throws state.not_found (-> exit 5) if unknown
    // A window can only be opened on a LIVE capsule (`active`). A re-open is `active -> opened` on the SAME capsule.
    if (
      session.runtime === undefined ||
      (session.state !== "active" && session.state !== "opened")
    ) {
      throw glaError(
        "state.conflict",
        `session "${sessionId}" has no live capsule to open a handoff window`,
        { detail: { id: sessionId, state: session.state }, retryable: false },
      );
    }
    const recipient = opts.recipient ?? session.recipient;
    if (recipient === undefined) {
      throw glaError(
        "state.conflict",
        `session "${sessionId}" has no recipient to bind a handoff to`,
        {
          detail: { id: sessionId },
          retryable: false,
        },
      );
    }
    const ttlMs =
      opts.ttl !== undefined
        ? (parseDurationMs(opts.ttl) ?? DEFAULT_HANDOFF_TTL_MS)
        : DEFAULT_HANDOFF_TTL_MS;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString() as Iso8601;
    const handoffId = (deps.newHandoffId ?? defaultHandoffId)();
    const newTimer =
      deps.setTimer ??
      ((ms: number, fn: () => void) => {
        const t = setTimeout(fn, ms);
        if (typeof t.unref === "function") {
          t.unref();
        }
        return { clear: () => clearTimeout(t) };
      });

    // Track which compensations are owed as each forward step succeeds.
    let grant: MintedSessionGrantRef | undefined;
    let routeProgrammed = false;
    try {
      // ── Step 1 — MINT the recipient-bound grant (attenuated from the session/task cap; never widened).
      const parentToken = deps.parentTokenFor?.(sessionId, session.taskId);
      const mintReq: {
        sessionId: string;
        recipient: RecipientRef;
        parentToken?: OpaqueToken;
        notAfter?: Iso8601;
      } = { sessionId, recipient, notAfter: expiresAt };
      if (parentToken !== undefined) {
        mintReq.parentToken = parentToken;
      }
      grant = await deps.capability.mintSessionGrant(mintReq);

      // ── Step 2 — resolve the capsule's human entrypoint + PROGRAM the grant-bound route (no partial route).
      const entry = await deps.entrypoint.open(session.runtime);
      const route = await deps.route.program(
        { id: handoffId, sessionId },
        grant.grantId,
        entry.internalEndpoint,
        grant.scopePath,
      );
      routeProgrammed = true;

      // ── Step 3 — build + DELIVER the recipient-bound link to EXACTLY the bound recipient.
      const link = deps.buildLink(route.path, grant.token);
      await deps.channel.deliver(recipient, link, grant.token);

      // ── Step 4 — create the window (`open`), pin the grant/route on the session, advance `active -> opened`.
      const window: HandoffWindow = {
        id: handoffId,
        sessionId,
        recipient,
        grantRef: grant.grantId as unknown as Ref<"session">,
        routeId: route.id,
        link,
        expiresAt,
        state: "open",
      };
      if (opts.reason !== undefined) {
        window.reason = opts.reason;
      }
      this.handoffs.set(handoffId, window);
      session.grantTokenRef = grant.grantId as unknown as Ref<"session">;
      session.route = route;
      session.state = sessionTransition(session.state, "opened");
      session.updatedAt = this.clock.now();

      // ── Arm the TTL timer: on expiry, expire the window (revoke grant, force-close WS, unmount route).
      const timer = newTimer(ttlMs, () => {
        void this.expireHandoff(handoffId);
      });
      this.handoffTimers.set(handoffId, { clear: timer.clear, grantId: grant.grantId });

      return {
        handoff_id: handoffId,
        link,
        recipient,
        expires_at: expiresAt,
        state: "open",
        session_id: sessionId,
      };
    } catch (e) {
      // ── COMPENSATE (reverse order of what succeeded) — leave NO partial window/route/grant (GLA-033 AC#4).
      if (routeProgrammed) {
        await safe(() => deps.route.unmount(handoffId));
      }
      if (grant !== undefined) {
        const g = grant;
        safeSync(() => deps.capability.forceCloseGrant(g.grantId));
        await safe(() => deps.capability.revoke(g.grantId));
      }
      // The session stays `active` (the window never opened); the error is contained to this step.
      throw asHandoffError(e);
    }
  }

  /**
   * Cancel a handoff window early (docs/05 `handoff cancel`, scenario-01 Phase 8/13 close) — the REVERSE of the
   * open saga: revoke the grant, force-close the live WS, unmount the route, then mark the window `cancelled` and
   * return the session to `active` (closing a window does NOT kill the capsule — session-service.md invariant). The
   * grant's surface becomes unreachable immediately (GLA-039 AC#3). Idempotent on an already-terminal window.
   *
   * @throws GlaErrorException `state.not_found` (unknown window) or `state.conflict` (not wired).
   */
  async cancelHandoff(windowId: HandoffId): Promise<HandoffView> {
    return this.closeHandoff(windowId, "cancelled");
  }

  /** Read one handoff window's state (docs/05 `handoff get`). Throws `state.not_found` (-> exit 5) if unknown. */
  handoffGet(windowId: HandoffId): HandoffView {
    const w = this.handoffs.get(windowId);
    if (w === undefined) {
      throw glaError("state.not_found", `unknown handoff window: "${windowId}"`, {
        detail: { id: windowId },
      });
    }
    return SessionService.handoffToView(w);
  }

  /** List handoff windows, optionally filtered by session (docs/05 `handoff list`). Read-only. */
  handoffList(filter?: { session?: SessionId }): HandoffView[] {
    let rows = [...this.handoffs.values()];
    if (filter?.session !== undefined) {
      rows = rows.filter((w) => w.sessionId === filter.session);
    }
    return rows.sort((a, b) => a.id.localeCompare(b.id)).map(SessionService.handoffToView);
  }

  /** The set of window ids currently OPEN (the Route controller's reconciler reads this — the intended set). */
  openHandoffIds(): Set<HandoffId> {
    const open = new Set<HandoffId>();
    for (const w of this.handoffs.values()) {
      if (w.state === "open") {
        open.add(w.id);
      }
    }
    return open;
  }

  /**
   * Mark a handoff window `completed` (driven by the Completion service in Slice 5; exposed now so the close path
   * is symmetric). Closes the window exactly like cancel (revoke grant, force-close WS, unmount route) but with a
   * `completed` disposition; the session returns to `active`. Used by the completion-driven close in scenario-01.
   */
  async completeHandoff(windowId: HandoffId): Promise<HandoffView> {
    return this.closeHandoff(windowId, "completed");
  }

  /** Expire a window on TTL elapse (revoke grant, force-close WS, unmount route, mark `expired`). Internal. */
  private async expireHandoff(windowId: HandoffId): Promise<void> {
    const w = this.handoffs.get(windowId);
    if (w === undefined || w.state !== "open") {
      return; // already closed — the timer fired after a cancel/complete (idempotent).
    }
    await this.closeHandoff(windowId, "expired");
  }

  /**
   * The shared close path for a window (cancel/complete/expire). Drops the timer, force-closes the live WS at the
   * edge, revokes the grant, unmounts the route, transitions the window to the terminal state, and returns the
   * session to `active`. Each step is best-effort (a compensation must converge). Idempotent on a terminal window.
   */
  private async closeHandoff(windowId: HandoffId, to: HandoffState): Promise<HandoffView> {
    const deps = this.handoffDeps;
    const w = this.handoffs.get(windowId);
    if (w === undefined) {
      throw glaError("state.not_found", `unknown handoff window: "${windowId}"`, {
        detail: { id: windowId },
      });
    }
    if (w.state !== "open") {
      // Already terminal — idempotent: return the current view unchanged.
      return SessionService.handoffToView(w);
    }
    if (deps === undefined) {
      throw glaError("state.conflict", "handoff is not wired (no capability/route injected)", {
        retryable: false,
      });
    }
    const grantId = w.grantRef as unknown as CapabilityId;
    // Drop the TTL timer (so it can't fire after close).
    const timer = this.handoffTimers.get(windowId);
    if (timer !== undefined) {
      safeSync(timer.clear);
      this.handoffTimers.delete(windowId);
    }
    // Force-close the live WS at the edge FIRST so the surface is unreachable immediately (GLA-039 AC#3)...
    safeSync(() => deps.capability.forceCloseGrant(grantId));
    // ...then revoke the grant (a revoked grant fails the next stateless verify)...
    await safe(() => deps.capability.revoke(grantId));
    // ...then unmount the route (force-closing any residual WS bound to it; idempotent).
    await safe(() => deps.route.unmount(windowId));
    // Transition the window to its terminal state and return the SESSION to `active` (the capsule lives on).
    w.state = handoffTransition(w.state, to);
    const session = this.sessions.get(w.sessionId);
    if (session !== undefined && session.state === "opened") {
      session.state = sessionTransition(session.state, "active");
      // Clear the window's grant/route off the session (the window closed; only teardown stops the capsule). `delete`
      // is the one way to remove an optional field under exactOptionalPropertyTypes (assigning `undefined` is a type
      // error); the perf cost is irrelevant on this rare close path.
      // biome-ignore lint/performance/noDelete: clearing an optional field under exactOptionalPropertyTypes
      delete session.grantTokenRef;
      // biome-ignore lint/performance/noDelete: clearing an optional field under exactOptionalPropertyTypes
      delete session.route;
      session.updatedAt = this.clock.now();
    }
    return SessionService.handoffToView(w);
  }

  /** Project a {@link HandoffWindow} to the public CLI/Bridge view (docs/05 §4 shape). */
  static handoffToView(w: HandoffWindow): HandoffView {
    return {
      handoff_id: w.id,
      link: w.link,
      recipient: w.recipient,
      expires_at: w.expiresAt,
      state: w.state,
      session_id: w.sessionId,
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

/** Coerce an unknown thrown value from the open-window saga to a GlaErrorException (preserving a taxonomy error). */
function asHandoffError(e: unknown): GlaErrorException {
  if (e instanceof Error && e.name === "GlaErrorException") {
    return e as GlaErrorException;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return glaError("dependency.unavailable", `handoff open failed: ${msg}`, {
    detail: { cause: msg },
  });
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
