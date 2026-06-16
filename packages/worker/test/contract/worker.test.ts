// UNIT tests for the worker plane (packages/worker, GLA-022/023).
// All over kernel PORTS with STUB launchers/workspaces (no real browser) — fast and deterministic.
// Proves: the Spawner Registry resolves launchers by name; PLUGGABILITY (a 2nd stub launcher needs no
// session/capsule change, GLA-023 AC#4); the lifecycle spawn→health→stop tears a partial capsule down
// on a spawn/health failure (NO orphan, GLA-023 AC#3); and the Cleanup Reconciler is idempotent +
// restart-safe and leaves no orphan.

import type {
  LauncherPort,
  MountCapability,
  MountSpec,
  PartRef,
  ResolvedAssemblySpec,
  ResolvedCapsulePlan,
  RuntimeHandle,
  WorkspaceHandle,
  WorkspacePort,
} from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  CapsuleLifecycleManager,
  type CapsuleRecord,
  CleanupReconciler,
  SpawnerRegistry,
  WorkspaceManager,
} from "../../src/index.js";

// ── Test doubles ────────────────────────────────────────────────────────────

function resolved(launcher = "launcher-process"): ResolvedAssemblySpec {
  return {
    apiVersion: "gla.dev/v1",
    kind: "Assembly",
    metadata: { intent: "t", task: "task_1" },
    spec: {
      template: "browser-handoff",
      // biome-ignore lint/suspicious/noExplicitAny: recipient brand cast in test
      recipient: "tg:user:1" as any,
      launcher: { use: launcher },
      workspace: { use: "browser-profile-temp" },
    },
    __resolved: true,
  };
}

function capsulePlan(opts: {
  launcher?: string;
  launcherConfig?: Record<string, unknown>;
  workspace?: string;
  workspaceConfig?: Record<string, unknown>;
}): ResolvedCapsulePlan {
  return {
    template: "browser-handoff",
    providers: [
      {
        role: "launcher",
        providerId: opts.launcher ?? "launcher-process",
        config: opts.launcherConfig ?? {},
        available: true,
        evidenceRequirements: [],
        diagnostics: [],
      },
      {
        role: "workspace",
        providerId: opts.workspace ?? "browser-profile-temp",
        config: opts.workspaceConfig ?? {},
        available: true,
        evidenceRequirements: [],
        diagnostics: [],
      },
    ],
  };
}

/** A stub launcher that records spawn/stop and can be made to fail/health-down on demand. */
class StubLauncher implements LauncherPort {
  readonly tier = "local-process" as const;
  readonly mountCapability: MountCapability = { file: true, directory: true, modes: ["ro", "rw"] };
  spawned = 0;
  stopped: RuntimeHandle[] = [];
  constructor(
    private readonly opts: {
      failSpawn?: boolean;
      healthDown?: boolean;
      tag?: string;
    } = {},
  ) {}
  async spawn(_spec: ResolvedAssemblySpec, _uid: number): Promise<RuntimeHandle> {
    this.spawned += 1;
    if (this.opts.failSpawn) {
      throw new Error("stub spawn failed");
    }
    return JSON.stringify({
      cdpWebSocketUrl: "ws://127.0.0.1:1/x",
      cdpPort: 1,
      tag: this.opts.tag,
    }) as unknown as RuntimeHandle;
  }
  async health(_h: RuntimeHandle): Promise<"up" | "down"> {
    return this.opts.healthDown ? "down" : "up";
  }
  async stop(h: RuntimeHandle): Promise<void> {
    this.stopped.push(h);
  }
}

/** A stub workspace that records realize/reap and tracks live handles. */
class StubWorkspace implements WorkspacePort {
  realized = 0;
  reaped: WorkspaceHandle[] = [];
  failRealize = false;
  async realize(_s: PartRef, _m: MountSpec[], _uid: number): Promise<WorkspaceHandle> {
    if (this.failRealize) {
      throw new Error("stub realize failed");
    }
    this.realized += 1;
    return JSON.stringify({ profileDir: `/tmp/ws-${this.realized}` }) as unknown as WorkspaceHandle;
  }
  async reap(h: WorkspaceHandle): Promise<void> {
    this.reaped.push(h);
  }
}

// ── Spawner Registry + pluggability ─────────────────────────────────────────

describe("SpawnerRegistry — resolve by name + pluggability (GLA-023 AC#4)", () => {
  it("registers and resolves a launcher by name; the first is the default", () => {
    const reg = new SpawnerRegistry();
    const a = new StubLauncher({ tag: "a" });
    reg.register("launcher-process", a);
    expect(reg.has("launcher-process")).toBe(true);
    expect(reg.resolve("launcher-process")).toBe(a);
    expect(reg.resolveDefault()).toBe(a);
    expect(reg.defaultLauncherName).toBe("launcher-process");
  });

  it("a second launcher registers with NO change to the session/capsule layer (pluggability proof)", async () => {
    // Register two launchers; the lifecycle manager (the session/capsule-facing seam) is constructed
    // once and resolves EITHER by name from the resolved spec — no session/capsule code changes.
    const reg = new SpawnerRegistry();
    const proc = new StubLauncher({ tag: "process" });
    const docker = new StubLauncher({ tag: "docker" });
    reg.register("launcher-process", proc, { default: true });
    reg.register("launcher-docker", docker); // a SECOND launcher — no other change needed
    expect(reg.names()).toEqual(["launcher-process", "launcher-docker"]);

    const ws = new StubWorkspace();
    const life = new CapsuleLifecycleManager({
      registry: reg,
      workspace: new WorkspaceManager(ws),
    });
    // The SAME lifecycle manager spawns via whichever launcher the spec names — no code branch per tier.
    await life.spawn("sess_a", resolved("launcher-process"));
    await life.spawn("sess_b", resolved("launcher-docker"));
    expect(proc.spawned).toBe(1);
    expect(docker.spawned).toBe(1);
    expect(life.hasLive("sess_a")).toBe(true);
    expect(life.hasLive("sess_b")).toBe(true);
    await life.teardown("sess_a");
    await life.teardown("sess_b");
  });

  it("a duplicate name is a state.conflict; an unknown name is catalog.unknown", () => {
    const reg = new SpawnerRegistry();
    reg.register("x", new StubLauncher());
    expect(() => reg.register("x", new StubLauncher())).toThrowError(/already registered/);
    expect(() => reg.resolve("nope")).toThrowError(/unknown launcher/);
  });

  it("exposes a launcher's declared mount capability (file+dir, ro+rw for the process tier)", () => {
    const reg = new SpawnerRegistry();
    reg.register("launcher-process", new StubLauncher());
    expect(reg.mountCapability("launcher-process")).toEqual({
      file: true,
      directory: true,
      modes: ["ro", "rw"],
    });
  });
});

// ── Lifecycle: spawn → health → stop, no-orphan teardown ─────────────────────

describe("CapsuleLifecycleManager — spawn/health/stop + no-orphan on failure (GLA-023 AC#3)", () => {
  it("spawn realizes the workspace, spawns the launcher, and tracks the capsule live", async () => {
    const reg = new SpawnerRegistry();
    const l = new StubLauncher();
    reg.register("launcher-process", l);
    const ws = new StubWorkspace();
    const life = new CapsuleLifecycleManager({
      registry: reg,
      workspace: new WorkspaceManager(ws),
    });
    const cap = await life.spawn("sess_1", resolved());
    expect(ws.realized).toBe(1);
    expect(l.spawned).toBe(1);
    expect(cap.launcherName).toBe("launcher-process");
    expect(life.hasLive("sess_1")).toBe(true);
    expect(life.runtimeOf("sess_1")).toBe(cap.runtime);
  });

  it("a SPAWN failure reaps the workspace and tracks NO capsule (no orphan)", async () => {
    const reg = new SpawnerRegistry();
    const l = new StubLauncher({ failSpawn: true });
    reg.register("launcher-process", l);
    const ws = new StubWorkspace();
    const life = new CapsuleLifecycleManager({
      registry: reg,
      workspace: new WorkspaceManager(ws),
    });
    await expect(life.spawn("sess_1", resolved())).rejects.toMatchObject({
      code: "dependency.unavailable",
    });
    // The workspace was realized then reaped (no orphan); nothing is tracked live.
    expect(ws.realized).toBe(1);
    expect(ws.reaped.length).toBe(1);
    expect(life.hasLive("sess_1")).toBe(false);
  });

  it("a HEALTH-probe failure stops the process AND reaps the workspace (no orphan)", async () => {
    const reg = new SpawnerRegistry();
    const l = new StubLauncher({ healthDown: true });
    reg.register("launcher-process", l);
    const ws = new StubWorkspace();
    const life = new CapsuleLifecycleManager({
      registry: reg,
      workspace: new WorkspaceManager(ws),
    });
    await expect(life.spawn("sess_1", resolved())).rejects.toMatchObject({
      code: "dependency.probe_failed",
    });
    expect(l.stopped.length).toBe(1); // the partial capsule's process was stopped
    expect(ws.reaped.length).toBe(1); // and its workspace reaped
    expect(life.hasLive("sess_1")).toBe(false);
  });

  it("teardown is idempotent: a second teardown (or one for an unknown session) is a no-op", async () => {
    const reg = new SpawnerRegistry();
    const l = new StubLauncher();
    reg.register("launcher-process", l);
    const ws = new StubWorkspace();
    const life = new CapsuleLifecycleManager({
      registry: reg,
      workspace: new WorkspaceManager(ws),
    });
    await life.spawn("sess_1", resolved());
    await life.teardown("sess_1");
    expect(l.stopped.length).toBe(1);
    expect(ws.reaped.length).toBe(1);
    expect(life.hasLive("sess_1")).toBe(false);
    // Second teardown: idempotent no-op (no extra stop/reap).
    await life.teardown("sess_1");
    await life.teardown("sess_never"); // unknown session — also a no-op
    expect(l.stopped.length).toBe(1);
    expect(ws.reaped.length).toBe(1);
  });

  it("tears down a launcher that was created from the resolved capsule plan but not registered", async () => {
    const reg = new SpawnerRegistry();
    const ws = new StubWorkspace();
    const created: StubLauncher[] = [];
    const life = new CapsuleLifecycleManager({
      registry: reg,
      workspace: new WorkspaceManager(ws),
      launcherFor(providerId, config) {
        const launcher = new StubLauncher({ tag: `${providerId}:${String(config.mode)}` });
        created.push(launcher);
        return launcher;
      },
    });

    await life.spawn(
      "sess_plan",
      resolved("launcher-plan"),
      capsulePlan({
        launcher: "launcher-plan",
        launcherConfig: { mode: "plan-scoped" },
      }),
    );
    expect(created).toHaveLength(1);
    expect(reg.has("launcher-plan")).toBe(false);

    await life.teardown("sess_plan");

    expect(created[0]?.stopped).toHaveLength(1);
    expect(ws.reaped).toHaveLength(1);
    expect(life.hasLive("sess_plan")).toBe(false);
  });

  it("rehydrates plan-scoped launcher and workspace providers for teardown after restart", async () => {
    let records: CapsuleRecord[] = [];
    const store = {
      load: () => records,
      save(next: CapsuleRecord[]) {
        records = structuredClone(next);
      },
    };
    const firstWorkspace = new StubWorkspace();
    const firstLifecycle = new CapsuleLifecycleManager({
      registry: new SpawnerRegistry(),
      workspaceFor: () => new WorkspaceManager(firstWorkspace),
      launcherFor(providerId, config) {
        return new StubLauncher({ tag: `${providerId}:${String(config.mode)}` });
      },
      store,
    });
    await firstLifecycle.spawn(
      "sess_restart",
      resolved("launcher-plan"),
      capsulePlan({
        launcher: "launcher-plan",
        launcherConfig: { mode: "restart" },
        workspace: "workspace-plan",
        workspaceConfig: { root: "/tmp/restart-workspace" },
      }),
    );

    const rehydratedLaunchers: StubLauncher[] = [];
    const rehydratedWorkspace = new StubWorkspace();
    const restartedLifecycle = new CapsuleLifecycleManager({
      registry: new SpawnerRegistry(),
      launcherFor(providerId, config) {
        const launcher = new StubLauncher({ tag: `${providerId}:${String(config.mode)}` });
        rehydratedLaunchers.push(launcher);
        return launcher;
      },
      workspaceByProviderId(providerId, config) {
        expect(providerId).toBe("workspace-plan");
        expect(config).toEqual({ root: "/tmp/restart-workspace" });
        return new WorkspaceManager(rehydratedWorkspace);
      },
      store,
    });

    await restartedLifecycle.teardown("sess_restart");

    expect(rehydratedLaunchers[0]?.stopped).toHaveLength(1);
    expect(rehydratedWorkspace.reaped).toHaveLength(1);
    expect(restartedLifecycle.hasLive("sess_restart")).toBe(false);
  });
});

// ── Cleanup Reconciler: idempotent, restart-safe, orphan scan ────────────────

describe("CleanupReconciler — idempotent terminal teardown + orphan scan (GLA-023 AC#3)", () => {
  it("reconcile tears down a session's capsule and revokes its connector (best-effort)", async () => {
    const reg = new SpawnerRegistry();
    const l = new StubLauncher();
    reg.register("launcher-process", l);
    const ws = new StubWorkspace();
    const life = new CapsuleLifecycleManager({
      registry: reg,
      workspace: new WorkspaceManager(ws),
    });
    let revoked = 0;
    const rec = new CleanupReconciler({ lifecycle: life, revokeConnector: () => void revoked++ });
    await life.spawn("sess_1", resolved());
    await rec.reconcile("sess_1");
    expect(life.hasLive("sess_1")).toBe(false);
    expect(l.stopped.length).toBe(1);
    expect(revoked).toBe(1);
    // Idempotent: a second reconcile is safe (the capsule is already gone).
    await rec.reconcile("sess_1");
    expect(l.stopped.length).toBe(1);
  });

  it("a connector-revoke failure does NOT leave the capsule un-reaped (restart-safe)", async () => {
    const reg = new SpawnerRegistry();
    const l = new StubLauncher();
    reg.register("launcher-process", l);
    const ws = new StubWorkspace();
    const life = new CapsuleLifecycleManager({
      registry: reg,
      workspace: new WorkspaceManager(ws),
    });
    const rec = new CleanupReconciler({
      lifecycle: life,
      revokeConnector: () => {
        throw new Error("revoke transiently failed");
      },
    });
    await life.spawn("sess_1", resolved());
    await rec.reconcile("sess_1"); // must NOT throw; the capsule is still reaped.
    expect(life.hasLive("sess_1")).toBe(false);
    expect(l.stopped.length).toBe(1);
  });

  it("reconciles a capsule launched by a NEW launcher TIER by STATE — same reconciler, no per-tier code (GLA-064 AC#9)", async () => {
    // A brand-new launcher tier (a `remote-worker`-tier stub the worker has never seen) — the cleanup
    // path must tear it down identically, routing by the TRACKED RECORD's launcher name, never by a
    // per-tier branch. This is the "reconcile by state regardless of launcher" guarantee (Slice 7).
    class NewTierLauncher implements LauncherPort {
      readonly tier = "remote-worker" as const;
      readonly mountCapability: MountCapability = { file: false, directory: false, modes: [] };
      stopped: RuntimeHandle[] = [];
      async spawn(): Promise<RuntimeHandle> {
        return JSON.stringify({ cdpWebSocketUrl: "ws://127.0.0.1:9/x", tier: "new" }) as never;
      }
      async health(): Promise<"up" | "down"> {
        return "up";
      }
      async stop(h: RuntimeHandle): Promise<void> {
        this.stopped.push(h);
      }
    }
    const reg = new SpawnerRegistry();
    const newTier = new NewTierLauncher();
    reg.register("launcher-remote", newTier, { default: true });
    const ws = new StubWorkspace();
    const life = new CapsuleLifecycleManager({
      registry: reg,
      workspace: new WorkspaceManager(ws),
    });
    const rec = new CleanupReconciler({ lifecycle: life });

    // The SAME reconciler tears down a capsule on the NEW tier — by state, via the tracked launcher name.
    await life.spawn("sess_new", resolved("launcher-remote"));
    expect(life.hasLive("sess_new")).toBe(true);
    await rec.reconcile("sess_new");
    expect(newTier.stopped.length).toBe(1); // the new-tier launcher's stop ran (routed by record state)
    expect(ws.reaped.length).toBe(1); // and the workspace was reaped
    expect(life.hasLive("sess_new")).toBe(false); // no orphan remains
    // Idempotent on the new tier too.
    await rec.reconcile("sess_new");
    expect(newTier.stopped.length).toBe(1);
  });

  it("reconcileOrphans tears down a live capsule whose session is NOT in the live set", async () => {
    const reg = new SpawnerRegistry();
    const l = new StubLauncher();
    reg.register("launcher-process", l);
    const ws = new StubWorkspace();
    const life = new CapsuleLifecycleManager({
      registry: reg,
      workspace: new WorkspaceManager(ws),
    });
    const rec = new CleanupReconciler({ lifecycle: life });
    await life.spawn("sess_keep", resolved());
    await life.spawn("sess_orphan", resolved());
    // sess_orphan's session has gone terminal (not in the live set) → it is reconciled away; keep stays.
    const reconciled = await rec.reconcileOrphans(["sess_keep"]);
    expect(reconciled).toEqual(["sess_orphan"]);
    expect(life.hasLive("sess_keep")).toBe(true);
    expect(life.hasLive("sess_orphan")).toBe(false);
    await life.teardown("sess_keep");
  });
});

// ── Workspace Manager — realize/reap threading ───────────────────────────────

describe("WorkspaceManager — realize/reap over the WorkspacePort", () => {
  it("realize passes the workspace strategy + mounts + the agent uid to the port", async () => {
    let seenUid = -1;
    let seenMounts: MountSpec[] = [];
    const port: WorkspacePort = {
      async realize(_s, m, uid) {
        seenUid = uid;
        seenMounts = m;
        return "wh" as unknown as WorkspaceHandle;
      },
      async reap() {},
    };
    const mgr = new WorkspaceManager(port);
    const spec = resolved();
    (spec.spec as { mounts?: MountSpec[] }).mounts = [
      { host: "/h", target: "/work/h", mode: "ro" },
    ];
    await mgr.realize(spec, 1000);
    expect(seenUid).toBe(1000); // the agent uid is threaded (docs/04 §6)
    expect(seenMounts).toEqual([{ host: "/h", target: "/work/h", mode: "ro" }]);
  });

  it("missing resolved workspace fails closed before provider realization or host mutation", async () => {
    let called = false;
    const port: WorkspacePort = {
      async realize() {
        called = true;
        return "wh" as unknown as WorkspaceHandle;
      },
      async reap() {},
    };
    const mgr = new WorkspaceManager(port);
    const spec = resolved();
    // biome-ignore lint/performance/noDelete: test intentionally removes the resolved provider state.
    delete spec.spec.workspace;

    let thrown: unknown;
    try {
      mgr.realize(spec, 1000);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({
      code: "dependency.unavailable",
      detail: { expected: "catalog/admission resolved spec.spec.workspace" },
    });
    expect(called).toBe(false);
  });
});
