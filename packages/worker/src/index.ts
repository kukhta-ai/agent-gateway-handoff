// @gla/worker — core-adjacent ring (baseline §1, components/worker-plane.md, GLA-022/023).
// The runtime substrate that starts, watches, and reaps capsules — the worker plane. It hides the
// choice of isolation tier behind ONE abstract spawner interface (the JupyterHub Spawner pattern), so
// the session/capsule code depends only on the SEAM: a new launcher tier needs no session/capsule
// change (GLA-023 AC#7/#4). Four owned pieces, all over kernel PORTS (never a concrete adapter):
//
//   - SpawnerRegistry        — register launchers by name + tier over the kernel LauncherPort; each
//                              declares its mount capability (file/dir, ro/rw, or none). Resolve a
//                              launcher BY NAME — registering a 2nd launcher needs no session change.
//   - CapsuleLifecycleManager — spawn → health-probe → stop per session; tracks the live runtime
//                              handle; on a spawn/health failure tears the partial capsule down (no
//                              orphan) and rethrows.
//   - WorkspaceManager        — realize the workspace strategy + the agent's requested mounts AS THE
//                              AGENT'S OWN UID (priv-esc off, DAC fails closed — docs/04 §6); reap the
//                              capsule's OWN ephemeral materials (host mounts survive).
//   - CleanupReconciler       — idempotent, restart-safe teardown of a terminal session (stop +
//                              reap + revoke-connector). Safe to call repeatedly; a saga failure
//                              midway leaves NO orphan capsule/workspace (GLA-023 AC#3). It is also
//                              the create-saga's compensation routine.
//
// Boundary (core-adjacent ring): depends ONLY on @gla/kernel — it holds the LauncherPort /
// WorkspacePort / AgentConnectorPort / HumanEntrypointPort SHAPES and a concrete adapter is injected at
// `app`. It NEVER imports an adapter (the import-boundary lint proves it).

import {
  type AgentConnector,
  type AgentConnectorPort,
  type HumanEntrypointBinding,
  type HumanEntrypointPort,
  type LauncherPort,
  type MountCapability,
  type MountSpec,
  type ResolvedAssemblySpec,
  type ResolvedCapsulePlan,
  type RuntimeHandle,
  type WorkspaceHandle,
  type WorkspacePort,
  glaError,
  setSpawnContext,
} from "@gla/kernel";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const WORKER_MODULE = "@gla/worker" as const;
/** Ring classification from the architecture baseline (informational). */
export const WORKER_RING = "core-adjacent" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Spawner Registry — the abstract spawner over the kernel LauncherPort
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A launcher's tier, as the kernel `LauncherPort` declares it. The registry indexes by NAME, but the
 * tier is carried so a caller can pick "the default process tier" without naming a concrete adapter.
 */
export type LauncherTier = LauncherPort["tier"];

/**
 * The Spawner Registry (worker-plane.md): the abstract spawner interface and its concrete launchers.
 * Launchers register BY NAME (e.g. "launcher-process", "launcher-docker"); each is a kernel
 * `LauncherPort` that declares its `tier` and its `mountCapability`. The session/capsule layer resolves
 * a launcher by name and never names a concrete adapter — so **registering a second launcher needs no
 * session/capsule change** (GLA-023 AC#4, the pluggability proof). The registry is pure bookkeeping
 * (a `Map`); the launchers it holds are injected at `app`.
 */
export class SpawnerRegistry {
  private readonly launchers = new Map<string, LauncherPort>();
  private defaultName: string | undefined;

  /**
   * Register a launcher under a name. The FIRST registered launcher becomes the default (overridable
   * via {@link setDefault}). A name collision is a `state.conflict` (a launcher name is unique).
   */
  register(name: string, launcher: LauncherPort, opts: { default?: boolean } = {}): this {
    if (this.launchers.has(name)) {
      throw glaError("state.conflict", `launcher "${name}" is already registered`, {
        detail: { name },
      });
    }
    this.launchers.set(name, launcher);
    if (this.defaultName === undefined || opts.default === true) {
      this.defaultName = name;
    }
    return this;
  }

  /** Set (or change) the default launcher name. Throws `catalog.unknown` if the name is unregistered. */
  setDefault(name: string): this {
    if (!this.launchers.has(name)) {
      throw glaError("catalog.unknown", `unknown launcher: "${name}"`, { detail: { name } });
    }
    this.defaultName = name;
    return this;
  }

  /** Is a launcher registered under this name? */
  has(name: string): boolean {
    return this.launchers.has(name);
  }

  /** Resolve a launcher BY NAME (the session/capsule layer's only entry). Throws `catalog.unknown`. */
  resolve(name: string): LauncherPort {
    const l = this.launchers.get(name);
    if (l === undefined) {
      throw glaError("catalog.unknown", `unknown launcher: "${name}"`, { detail: { name } });
    }
    return l;
  }

  /** Resolve the default launcher (the reference T2 process tier in the MVP). Throws if none registered. */
  resolveDefault(): LauncherPort {
    if (this.defaultName === undefined) {
      throw glaError("dependency.unavailable", "no launcher is registered", {});
    }
    return this.resolve(this.defaultName);
  }

  /** The default launcher's name, or undefined when none is registered. */
  get defaultLauncherName(): string | undefined {
    return this.defaultName;
  }

  /** The declared mount capability of a launcher by name (kernel `MountCapability`). */
  mountCapability(name: string): MountCapability {
    return this.resolve(name).mountCapability;
  }

  /** The registered launcher names (stable order of registration). */
  names(): string[] {
    return [...this.launchers.keys()];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace Manager — realize + reap the capsule's workspace (agent-uid mounts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Workspace Manager (worker-plane.md). Realizes the declared workspace strategy (e.g.
 * `browser-profile-temp`) and the agent's requested host mounts **with the agent's OWN authority** —
 * the capsule process runs as the agent's uid with privilege-escalation off, so the kernel's DAC
 * enforces exactly the agent's file access (a path the agent can't read fails closed; docs/04 §6).
 * The allowed-set / denylist / launcher-capability gate already ran OFFLINE at admission (Slice 2); the
 * manager only *realizes*. `reap` destroys the capsule's OWN ephemeral materials only — host mounts and
 * persisted outputs live on the host and survive (capsule.md invariant).
 */
export class WorkspaceManager {
  private readonly port: WorkspacePort;

  constructor(port: WorkspacePort) {
    this.port = port;
  }

  /**
   * Realize the workspace for a session: the strategy (the resolved `workspace` part) + the agent's
   * mounts, as the agent's uid. Returns the workspace handle (adapter-owned). A missing strategy fails
   * closed here; defaulting belongs in catalog/admission before host-touching realization.
   */
  realize(spec: ResolvedAssemblySpec, asUid: number): Promise<WorkspaceHandle> {
    const strategy = spec.spec.workspace;
    if (strategy === undefined) {
      throw glaError(
        "dependency.unavailable",
        "resolved assembly is missing workspace strategy before realization",
        {
          detail: {
            template: spec.spec.template,
            expected: "catalog/admission resolved spec.spec.workspace",
          },
        },
      );
    }
    const mounts: MountSpec[] = spec.spec.mounts ?? [];
    return this.port.realize(strategy, mounts, asUid);
  }

  /** Reap the workspace's OWN ephemeral materials (host mounts survive). Idempotent at the port. */
  reap(h: WorkspaceHandle): Promise<void> {
    return this.port.reap(h);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Capsule Lifecycle Manager — spawn → health-probe → stop, with no-orphan teardown
// ─────────────────────────────────────────────────────────────────────────────

/** A live capsule's tracked record: its runtime handle, workspace handle, and the launcher that owns it. */
export interface CapsuleRecord {
  /** The session this capsule belongs to (the worker tracks per-session). */
  sessionId: string;
  /** The launcher (by name) that spawned it — so teardown routes to the right launcher. */
  launcherName: string;
  /** Provider-owned launcher config from the resolved capsule plan. */
  launcherConfig?: Record<string, unknown>;
  /** The resolved capsule plan used to create plan-scoped providers. */
  capsulePlan?: ResolvedCapsulePlan;
  /** The live runtime handle from the launcher. */
  runtime: RuntimeHandle;
  /** The realized workspace handle (reaped at teardown). */
  workspace: WorkspaceHandle;
  /** The workspace provider that realized the handle, so teardown reaps through the same provider. */
  workspaceProviderId?: string;
  /** Provider-owned workspace config from the resolved capsule plan. */
  workspaceConfig?: Record<string, unknown>;
}

/** Restart-safe live-capsule record store. Concrete storage is wired by `app`. */
export interface CapsuleLifecycleStore {
  load(): CapsuleRecord[];
  save(records: CapsuleRecord[]): void;
}

/** What {@link CapsuleLifecycleManager.spawn} hands back: the live capsule's handles. */
export interface SpawnedCapsule {
  runtime: RuntimeHandle;
  workspace: WorkspaceHandle;
  launcherName: string;
}

/** Construction dependencies for the lifecycle manager (all injected — no concrete adapter named). */
export interface CapsuleLifecycleOptions {
  registry: SpawnerRegistry;
  workspace?: WorkspaceManager;
  /** Optional per-plan launcher resolver for horizontally added launcher providers. */
  launcherFor?: (
    providerId: string,
    config: Record<string, unknown>,
    plan: ResolvedCapsulePlan,
  ) => LauncherPort | Promise<LauncherPort>;
  /** Optional per-plan workspace resolver for horizontally added workspace providers. */
  workspaceFor?: (
    plan: ResolvedCapsulePlan,
    spec: ResolvedAssemblySpec,
  ) => WorkspaceManager | Promise<WorkspaceManager>;
  /** Resolve a workspace manager by provider id for restart-safe teardown of non-default workspaces. */
  workspaceByProviderId?: (
    providerId: string,
    config?: Record<string, unknown>,
  ) => WorkspaceManager | Promise<WorkspaceManager | undefined> | undefined;
  /** The uid the capsule runs as (the agent's own uid; default = the current process uid). */
  agentUid?: number;
  /** Restart-safe live-capsule record store. Defaults to process-local memory. */
  store?: CapsuleLifecycleStore;
}

/**
 * The Capsule Lifecycle Manager (worker-plane.md): drives spawn → health-probe → stop, tracks the live
 * runtime per session, and detects orphans. It does the HOSTING; *what* to host is the session
 * assembly's decision (it only reads the resolved spec). Crucially: on a spawn or health-probe failure
 * it **tears the partial capsule down** (stop + reap) and rethrows — so a failed spawn leaves **no
 * orphan capsule or workspace** (GLA-023 AC#3). Teardown is idempotent (safe to call again).
 */
export class CapsuleLifecycleManager {
  private readonly registry: SpawnerRegistry;
  private readonly workspace: WorkspaceManager | undefined;
  private readonly launcherFor: CapsuleLifecycleOptions["launcherFor"];
  private readonly workspaceFor: CapsuleLifecycleOptions["workspaceFor"];
  private readonly workspaceByProviderId: CapsuleLifecycleOptions["workspaceByProviderId"];
  private readonly agentUid: number;
  /** Live capsules, by session id (orphan detection compares this to session truth). */
  private readonly live = new Map<string, CapsuleRecord>();
  /** Non-registry launchers created for a specific resolved plan, by session id. */
  private readonly launchersBySession = new Map<string, LauncherPort>();
  private readonly store: CapsuleLifecycleStore | undefined;

  constructor(opts: CapsuleLifecycleOptions) {
    this.registry = opts.registry;
    this.workspace = opts.workspace;
    this.launcherFor = opts.launcherFor;
    this.workspaceFor = opts.workspaceFor;
    this.workspaceByProviderId = opts.workspaceByProviderId;
    this.agentUid = opts.agentUid ?? defaultAgentUid();
    this.store = opts.store;
    const records = opts.store?.load();
    if (records !== undefined) {
      for (const record of records) {
        this.live.set(record.sessionId, structuredClone(record));
      }
    }
  }

  /** The agent uid capsules run as (the agent's own authority; docs/04 §6). */
  get uid(): number {
    return this.agentUid;
  }

  /**
   * Spawn a capsule for a session: realize the workspace (agent uid), spawn the launcher, then
   * health-probe. The launcher is resolved BY NAME — the template-fixed launcher (`spec.spec.launcher`)
   * or the registry default. On ANY failure during realize/spawn/health, tear down whatever partially
   * came up (stop the process if it started, reap the workspace if it was realized) and rethrow — **no
   * orphan** (GLA-023 AC#3). On success the capsule is tracked live and the handles returned.
   *
   * @param sessionId  the session this capsule belongs to (tracked for orphan detection)
   * @param spec       the immutable resolved spec (read-only; never mutated — invariant 9)
   */
  async spawn(
    sessionId: string,
    spec: ResolvedAssemblySpec,
    capsulePlan?: ResolvedCapsulePlan,
  ): Promise<SpawnedCapsule> {
    const planForResolution = capsulePlan ?? capsulePlanFromSpec(spec);
    const launcherName =
      providerIdForRole(planForResolution, "launcher") ??
      spec.spec.launcher?.use ??
      this.registry.defaultLauncherName;
    if (launcherName === undefined) {
      throw glaError("dependency.unavailable", "no launcher available to spawn the capsule", {
        detail: { sessionId },
      });
    }
    const launcherConfig = providerConfigForRole(planForResolution, "launcher", launcherName);
    let launcher: LauncherPort | undefined;
    if (capsulePlan !== undefined && this.launcherFor !== undefined) {
      launcher = await this.launcherFor(launcherName, launcherConfig, planForResolution);
      this.launchersBySession.set(sessionId, launcher);
    } else if (!this.registry.has(launcherName) && this.launcherFor !== undefined) {
      launcher = await this.launcherFor(launcherName, launcherConfig, planForResolution);
      this.registry.register(launcherName, launcher);
    }
    launcher ??= this.registry.resolve(launcherName);
    const workspaceProviderId =
      providerIdForRole(planForResolution, "workspace") ?? spec.spec.workspace?.use;
    const workspaceConfig = providerConfigForRole(
      planForResolution,
      "workspace",
      workspaceProviderId,
    );
    const workspaceManager = (await this.workspaceFor?.(planForResolution, spec)) ?? this.workspace;
    if (workspaceManager === undefined) {
      throw glaError("dependency.unavailable", "no workspace available to spawn the capsule", {
        detail: { sessionId },
      });
    }

    // Step A — realize the workspace (agent uid). If THIS fails there is nothing to reap.
    let workspace: WorkspaceHandle;
    try {
      workspace = await workspaceManager.realize(spec, this.agentUid);
    } catch (e) {
      this.launchersBySession.delete(sessionId);
      throw asDependencyError(e, "workspace realization failed");
    }

    // Associate the realized workspace with this spec instance so the launcher can read it (e.g. the
    // profile dir for --user-data-dir) without changing the frozen LauncherPort.spawn signature or
    // importing the workspace adapter (the kernel's neutral spawn-context side-channel).
    setSpawnContext(spec, { workspace: workspace as never });

    // Step B — spawn the launcher. If this fails, reap the workspace (no orphan) and rethrow.
    let runtime: RuntimeHandle;
    try {
      runtime = await launcher.spawn(spec, this.agentUid);
    } catch (e) {
      await safeReap(workspaceManager, workspace);
      this.launchersBySession.delete(sessionId);
      throw asDependencyError(e, "capsule spawn failed");
    }

    // Step C — health-probe. If unhealthy (or the probe throws), tear the partial capsule down.
    try {
      const health = await launcher.health(runtime);
      if (health !== "up") {
        throw glaError("dependency.probe_failed", "capsule failed its health probe after spawn", {
          detail: { sessionId, launcher: launcherName, health },
        });
      }
    } catch (e) {
      await safeStop(launcher, runtime);
      await safeReap(workspaceManager, workspace);
      this.launchersBySession.delete(sessionId);
      throw asDependencyError(e, "capsule health probe failed");
    }

    const record: CapsuleRecord = {
      sessionId,
      launcherName,
      launcherConfig,
      capsulePlan: structuredClone(planForResolution),
      runtime,
      workspace,
    };
    if (workspaceProviderId !== undefined) {
      record.workspaceProviderId = workspaceProviderId;
      record.workspaceConfig = workspaceConfig;
    }
    this.live.set(sessionId, record);
    this.persist();
    return { runtime, workspace, launcherName };
  }

  /** Is there a live capsule tracked for this session? (Drives `session connector`'s conflict check.) */
  hasLive(sessionId: string): boolean {
    return this.live.has(sessionId);
  }

  /** The live capsule record for a session, or undefined. */
  get(sessionId: string): CapsuleRecord | undefined {
    return this.live.get(sessionId);
  }

  /** The live runtime handle for a session (so the session can re-attach a connector), or undefined. */
  runtimeOf(sessionId: string): RuntimeHandle | undefined {
    return this.live.get(sessionId)?.runtime;
  }

  /** A health check on a session's live capsule (`down` if there is no live capsule). */
  async health(sessionId: string): Promise<"up" | "down"> {
    const rec = this.live.get(sessionId);
    if (rec === undefined) {
      return "down";
    }
    const launcher = await this.launcherForRecord(rec);
    if (launcher === undefined) {
      return "down";
    }
    return launcher.health(rec.runtime);
  }

  /**
   * Tear down a session's capsule: stop the launcher process (kill the group + reap) and reap the
   * workspace, then drop the tracking record. **Idempotent + restart-safe** (GLA-023 AC#3): calling it
   * for a session with no live capsule is a no-op; a partial failure keeps the durable record so the
   * next reconcile pass can retry stop/reap instead of forgetting a possible orphan. Used by the
   * Cleanup Reconciler AND as the create-saga's compensation.
   */
  async teardown(sessionId: string): Promise<void> {
    const rec = this.live.get(sessionId);
    if (rec === undefined) {
      return; // already torn down / never spawned — idempotent no-op.
    }
    const launcher = await this.launcherForRecord(rec);
    const stopped = launcher !== undefined ? await safeStop(launcher, rec.runtime) : false;
    const workspaceManager =
      rec.workspaceProviderId !== undefined
        ? ((await this.workspaceByProviderId?.(rec.workspaceProviderId, rec.workspaceConfig)) ??
          this.workspace)
        : this.workspace;
    if (workspaceManager === undefined) {
      return;
    }
    const reaped = await safeReap(workspaceManager, rec.workspace);
    if (stopped && reaped) {
      this.live.delete(sessionId);
      this.launchersBySession.delete(sessionId);
      this.persist();
    }
  }

  /** The session ids of all currently-live capsules (for orphan reconciliation against session truth). */
  liveSessions(): string[] {
    return [...this.live.keys()];
  }

  private persist(): void {
    this.store?.save([...this.live.values()].map((record) => structuredClone(record)));
  }

  private async launcherForRecord(rec: CapsuleRecord): Promise<LauncherPort | undefined> {
    const sessionLauncher = this.launchersBySession.get(rec.sessionId);
    if (sessionLauncher !== undefined) {
      return sessionLauncher;
    }
    if (this.registry.has(rec.launcherName)) {
      return this.registry.resolve(rec.launcherName);
    }
    if (this.launcherFor !== undefined && rec.capsulePlan !== undefined) {
      const launcher = await this.launcherFor(
        rec.launcherName,
        rec.launcherConfig ?? {},
        rec.capsulePlan,
      );
      this.launchersBySession.set(rec.sessionId, launcher);
      return launcher;
    }
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup Reconciler — idempotent, restart-safe teardown of terminal sessions
// ─────────────────────────────────────────────────────────────────────────────

/** A hook the reconciler calls to revoke a session's agent-connector capability (agent-blind ref). */
export type ConnectorRevoker = (sessionId: string) => Promise<void> | void;

/** Construction dependencies for the Cleanup Reconciler. */
export interface CleanupReconcilerOptions {
  lifecycle: CapsuleLifecycleManager;
  /** Revoke the session's connector capability on teardown (optional; default no-op). */
  revokeConnector?: ConnectorRevoker;
}

/**
 * The Cleanup Reconciler (worker-plane.md): idempotent, restart-safe teardown of a terminal session.
 * One routine — stop the capsule, reap the workspace, revoke the connector — that is **safe to call
 * repeatedly** and **converges from a crash mid-teardown**. It is BOTH the terminal-session cleanup AND
 * the create-saga's compensation step (the same idempotent routine, so a half-failed saga leaves no
 * orphan — GLA-023 AC#3). It also reconciles a set of live capsules against the set of sessions that
 * should still be live (orphan detection): any live capsule whose session is terminal is torn down.
 */
export class CleanupReconciler {
  private readonly lifecycle: CapsuleLifecycleManager;
  private readonly revokeConnector: ConnectorRevoker;

  constructor(opts: CleanupReconcilerOptions) {
    this.lifecycle = opts.lifecycle;
    this.revokeConnector = opts.revokeConnector ?? (() => undefined);
  }

  /**
   * Reconcile ONE session to torn-down: stop + reap (via the lifecycle manager's idempotent teardown)
   * and revoke the connector. Idempotent — calling it twice, or on a session with no live capsule, is
   * safe (the second call is a clean no-op). The connector revoke is best-effort (a revoke failure
   * does not block the capsule teardown — both are attempted, errors swallowed for restart-safety).
   */
  async reconcile(sessionId: string): Promise<void> {
    await this.lifecycle.teardown(sessionId);
    try {
      await this.revokeConnector(sessionId);
    } catch {
      // Best-effort: a connector-revoke failure must not leave the capsule un-reaped. The capsule is
      // already torn down above; the revoke is retried by the next reconcile pass.
    }
  }

  /**
   * Orphan scan: tear down every live capsule whose session is NOT in `liveSessionIds` (the set of
   * sessions that should still have a capsule). Restart-safe: a crash that leaves a capsule whose
   * session has since gone terminal is converged on the next scan. Returns the session ids reconciled.
   */
  async reconcileOrphans(liveSessionIds: Iterable<string>): Promise<string[]> {
    const live = new Set(liveSessionIds);
    const reconciled: string[] = [];
    for (const sessionId of this.lifecycle.liveSessions()) {
      if (!live.has(sessionId)) {
        await this.reconcile(sessionId);
        reconciled.push(sessionId);
      }
    }
    return reconciled;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent connector — the worker's view of attaching the agent's handle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attach the agent connector to a live capsule via the kernel `AgentConnectorPort`. A thin pass-through
 * the session saga calls after a successful spawn. Adapter-owned DTO fields describe how that connector
 * is driven; agent-blind `secret_ref` remains a capability reference, never raw signing material.
 */
export async function attachConnector(
  port: AgentConnectorPort,
  runtime: RuntimeHandle,
): Promise<AgentConnector> {
  return port.attach(runtime);
}

/**
 * Open the human entrypoint on a live capsule via the kernel `HumanEntrypointPort`. Returns `undefined`
 * when the entrypoint is unavailable, surfacing the degrade honestly rather than throwing. Provision still
 * succeeds with an agent-connector-only capsule.
 */
export async function openHumanEntrypoint(
  port: HumanEntrypointPort,
  runtime: RuntimeHandle,
): Promise<HumanEntrypointBinding | undefined> {
  try {
    return await port.open(runtime);
  } catch {
    // The entrypoint reports unavailable (e.g. headless: no human-view stack). Provision proceeds without a
    // human surface; concrete human-view providers are supplied by installed bundles.
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** The default agent uid capsules run as: the current process uid (the single-operator profile). */
function defaultAgentUid(): number {
  // On non-POSIX platforms `process.getuid` is undefined; fall back to 0 (the test never relies on the
  // numeric value — it asserts the uid is THREADED through to the workspace/launcher, docs/04 §6).
  return typeof process.getuid === "function" ? process.getuid() : 0;
}

function providerIdForRole(
  plan: ResolvedCapsulePlan | undefined,
  role: string,
): string | undefined {
  return plan?.providers.find((provider) => provider.role === role)?.providerId;
}

function providerConfigForRole(
  plan: ResolvedCapsulePlan,
  role: string,
  providerId: string | undefined,
): Record<string, unknown> {
  const entry =
    providerId !== undefined
      ? (plan.providers.find(
          (provider) => provider.role === role && provider.providerId === providerId,
        ) ?? plan.providers.find((provider) => provider.role === role))
      : plan.providers.find((provider) => provider.role === role);
  return structuredClone(entry?.config ?? {});
}

function capsulePlanFromSpec(spec: ResolvedAssemblySpec): ResolvedCapsulePlan {
  const providers: ResolvedCapsulePlan["providers"] = [];
  const add = (
    role: string,
    ref: { use: string; params?: Record<string, unknown> } | undefined,
  ): void => {
    if (ref === undefined) {
      return;
    }
    providers.push({
      role,
      providerId: ref.use,
      config: structuredClone(ref.params ?? {}),
      available: true,
      evidenceRequirements: [],
      diagnostics: [],
    });
  };
  add("launcher", spec.spec.launcher);
  add("workspace", spec.spec.workspace);
  add("connector", spec.spec.connector);
  for (const entrypoint of spec.spec.entrypoints ?? []) {
    add("entrypoint", entrypoint);
  }
  for (const detector of spec.spec.detectors ?? []) {
    add("detector", detector);
  }
  return { template: spec.spec.template, providers };
}

/** Coerce an unknown error into a typed dependency error (so a launcher throw maps to exit 8), preserving a GlaError. */
function asDependencyError(e: unknown, context: string): Error {
  if (e instanceof Error) {
    // A kernel taxonomy error (GlaErrorException) is re-thrown as-is so its stable code/exit survive.
    if (e.name === "GlaErrorException") {
      return e;
    }
    return glaError("dependency.unavailable", `${context}: ${e.message}`, {
      detail: { cause: e.message },
    });
  }
  return glaError("dependency.unavailable", `${context}: ${String(e)}`);
}

/** Stop a launcher's runtime, returning whether the cleanup step converged. */
async function safeStop(launcher: LauncherPort, runtime: RuntimeHandle): Promise<boolean> {
  try {
    await launcher.stop(runtime);
    return true;
  } catch {
    return false;
  }
}

/** Reap a workspace, returning whether the cleanup step converged. */
async function safeReap(manager: WorkspaceManager, h: WorkspaceHandle): Promise<boolean> {
  try {
    await manager.reap(h);
    return true;
  } catch {
    return false;
  }
}

export type {
  AgentConnector,
  AgentConnectorPort,
  HumanEntrypointPort,
  LauncherPort,
  MountCapability,
  WorkspaceHandle,
  WorkspacePort,
};
