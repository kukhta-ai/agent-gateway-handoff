// UNIT tests for the SessionService (packages/session, GLA-021/022/023/024/025).
// createFromAdmitted creates a Session under a task in `issued` (no spawn), pinning the IMMUTABLE
// resolved spec. provision() is the REVERSIBLE create-saga (mint connector → spawn → attach →
// issued→active; compensate on failure → failed, no orphan). connector() re-emits for a live capsule;
// no live capsule → state.conflict (exit 7). All over STUB provision seams — no real browser. Pure.

import type {
  AgentConnector,
  CapabilityId,
  Ref,
  ResolvedAssemblySpec,
  RuntimeHandle,
  TaskId,
} from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  type CapsuleWorkerPort,
  type ConnectorCapabilityPort,
  type MintedConnectorRef,
  type SessionConnectorPort,
  SessionService,
  type SpawnedCapsuleHandles,
} from "../../src/index.js";

function resolved(): ResolvedAssemblySpec {
  return {
    apiVersion: "gla.dev/v1",
    kind: "Assembly",
    metadata: { intent: "register on acme", task: "task_1" },
    spec: {
      template: "browser-handoff",
      // biome-ignore lint/suspicious/noExplicitAny: recipient brand cast in test
      recipient: "tg:user:123" as any,
      launcher: { use: "launcher-process" },
      detectors: [{ use: "user-done" }],
    },
    __resolved: true,
  };
}

const TASK = "task_1" as TaskId;

describe("SessionService.createFromAdmitted — dispatch target (GLA-021)", () => {
  it("creates a Session under the task in `issued` (admitted, NOT spawned)", () => {
    const svc = new SessionService();
    const s = svc.createFromAdmitted(TASK, resolved());
    expect(s.state).toBe("issued");
    expect(s.taskId).toBe(TASK);
    expect(s.id).toMatch(/^sess_/);
    expect(s.spec.spec.template).toBe("browser-handoff");
    // No runtime/grant/route yet — nothing was provisioned.
    expect(s.runtime).toBeUndefined();
    expect(s.grantTokenRef).toBeUndefined();
    expect(s.route).toBeUndefined();
    // The recipient is carried for later handoff binding.
    expect(s.recipient).toBe("tg:user:123");
  });

  it("the pinned resolved spec is IMMUTABLE after admission (frozen; a mutation throws) — S-9", () => {
    const svc = new SessionService();
    const s = svc.createFromAdmitted(TASK, resolved());
    expect(Object.isFrozen(s.spec)).toBe(true);
    expect(Object.isFrozen(s.spec.spec)).toBe(true);
    expect(() => {
      // Runtime mutation attempt on a deep-frozen object throws in strict mode (the spec is
      // immutable after admission — invariant 9). The cast bypasses the structural writability of the
      // type to exercise the runtime guard.
      (s.spec.spec as { template: string }).template = "tampered";
    }).toThrow();
    expect(s.spec.spec.template).toBe("browser-handoff");
  });

  it("freezing the session's spec does NOT freeze the caller's original spec (a clone is pinned)", () => {
    const svc = new SessionService();
    const original = resolved();
    svc.createFromAdmitted(TASK, original);
    // The caller's object stays mutable (we froze a clone, not their input).
    expect(Object.isFrozen(original)).toBe(false);
  });
});

describe("SessionService — get / list", () => {
  it("get returns the aggregate; an unknown id throws state.not_found (→ exit 5)", () => {
    const svc = new SessionService();
    const s = svc.createFromAdmitted(TASK, resolved());
    expect(svc.get(s.id).id).toBe(s.id);
    expect(() => svc.get("sess_missing")).toThrowError(/unknown session/);
  });

  it("list filters by task and state", () => {
    const svc = new SessionService();
    svc.createFromAdmitted(TASK, resolved());
    svc.createFromAdmitted("task_2" as TaskId, resolved());
    expect(svc.list().length).toBe(2);
    expect(svc.list({ task: TASK }).length).toBe(1);
    expect(svc.list({ state: "issued" }).length).toBe(2);
  });

  it("toView projects the public JSON shape", () => {
    const svc = new SessionService();
    const s = svc.createFromAdmitted(TASK, resolved());
    expect(SessionService.toView(s)).toEqual({
      session_id: s.id,
      task_id: TASK,
      state: "issued",
      template: "browser-handoff",
    });
  });
});

describe("SessionService.provision — not wired (bare service)", () => {
  it("provision() on a bare service (no worker/connector injected) rejects with state.conflict", async () => {
    const svc = new SessionService();
    const s = svc.createFromAdmitted(TASK, resolved());
    await expect(svc.provision(s.id)).rejects.toMatchObject({ code: "state.conflict" });
  });
});

// ── A STUB provision harness (no real browser): records the saga + injectable failures ──────────────

const FAKE_RUNTIME = JSON.stringify({
  launchMode: "headless",
  endpoints: [
    {
      resourceId: "connector:fake-pipe:abc",
      family: "agent-connector",
      provider: "fake-pipe",
      transport: "stdio",
      address: "pipe://capsule/abc",
    },
  ],
}) as unknown as RuntimeHandle;
const CONNECTOR_RESOURCE_ID = "connector:fake-pipe:abc";

class StubWorker implements CapsuleWorkerPort {
  spawned = 0;
  toreDown: string[] = [];
  live = new Map<string, RuntimeHandle>();
  failSpawn = false;
  async spawn(sessionId: string): Promise<SpawnedCapsuleHandles> {
    this.spawned += 1;
    if (this.failSpawn) {
      throw Object.assign(new Error("spawn boom"), {
        name: "GlaErrorException",
        code: "dependency.probe_failed",
      });
    }
    this.live.set(sessionId, FAKE_RUNTIME);
    return { runtime: FAKE_RUNTIME, launcherName: "launcher-process" };
  }
  async teardown(sessionId: string): Promise<void> {
    this.toreDown.push(sessionId);
    this.live.delete(sessionId);
  }
  hasLive(sessionId: string): boolean {
    return this.live.has(sessionId);
  }
  runtimeOf(sessionId: string): RuntimeHandle | undefined {
    return this.live.get(sessionId);
  }
}

class StubCapability implements ConnectorCapabilityPort {
  minted = 0;
  revoked: CapabilityId[] = [];
  lastParentRef: CapabilityId | undefined;
  async mintConnector(_sessionId: string, parentRef?: CapabilityId): Promise<MintedConnectorRef> {
    this.minted += 1;
    this.lastParentRef = parentRef;
    const id = `cap_conn${this.minted}` as CapabilityId;
    // Thread the parent through (Finding #1) so the session records the connector's lineage parent.
    return parentRef !== undefined
      ? { capabilityId: id, secretRef: id as unknown as Ref<"secret-ref">, parentRef }
      : { capabilityId: id, secretRef: id as unknown as Ref<"secret-ref"> };
  }
  async revoke(id: CapabilityId): Promise<void> {
    this.revoked.push(id);
  }
}

class StubConnector implements SessionConnectorPort {
  bound = new Map<string, Ref<"secret-ref">>();
  unbound: string[] = [];
  async attach(_runtime: RuntimeHandle): Promise<AgentConnector> {
    const c: AgentConnector = {
      type: "fake-pipe",
      provider: "fake-pipe",
      resourceId: CONNECTOR_RESOURCE_ID,
      pipe_ref: "pipe://capsule/abc",
    };
    const ref = this.bound.get(CONNECTOR_RESOURCE_ID);
    if (ref !== undefined) {
      c.secret_ref = ref;
    }
    return c;
  }
  bindSecretRef(resourceId: string, secretRef: Ref<"secret-ref">): void {
    this.bound.set(resourceId, secretRef);
  }
  unbindSecretRef(resourceId: string): void {
    this.unbound.push(resourceId);
    this.bound.delete(resourceId);
  }
}

function provisioningService(over?: {
  worker?: StubWorker;
  capability?: StubCapability;
  connector?: StubConnector;
  parentCapabilityRefFor?: (sessionId: string, taskId: string) => CapabilityId | undefined;
}): {
  svc: SessionService;
  worker: StubWorker;
  capability: StubCapability;
  connector: StubConnector;
} {
  const worker = over?.worker ?? new StubWorker();
  const capability = over?.capability ?? new StubCapability();
  const connector = over?.connector ?? new StubConnector();
  const provision: {
    worker: StubWorker;
    capability: StubCapability;
    connector: StubConnector;
    parentCapabilityRefFor?: (sessionId: string, taskId: string) => CapabilityId | undefined;
  } = { worker, capability, connector };
  if (over?.parentCapabilityRefFor !== undefined) {
    provision.parentCapabilityRefFor = over.parentCapabilityRefFor as never;
  }
  const svc = new SessionService({ provision: provision as never });
  return { svc, worker, capability, connector };
}

describe("SessionService.provision — the reversible create-saga (GLA-022/023/024/025)", () => {
  it("provisions: mint connector → spawn → attach → issued→active; returns the agent-blind connector", async () => {
    const { svc, worker, capability } = provisioningService();
    const s = svc.createFromAdmitted(TASK, resolved());
    const out = await svc.provision(s.id);
    // The session moved issued → active and pinned the runtime.
    expect(out.state).toBe("active");
    expect(svc.get(s.id).state).toBe("active");
    expect(svc.get(s.id).runtime).toBeDefined();
    // The capsule view + the agent-blind connector (a secret_ref, never a raw secret).
    expect(out.capsule.template).toBe("browser-handoff");
    expect(out.connector.type).toBe("fake-pipe");
    expect(out.connector.resourceId).toBe(CONNECTOR_RESOURCE_ID);
    expect(out.connector.pipe_ref).toBe("pipe://capsule/abc");
    expect(out.connector.secret_ref).toBeDefined();
    expect(String(out.connector.secret_ref)).toMatch(/^cap_/);
    // The saga ran each instrument once; nothing was torn down (success).
    expect(capability.minted).toBe(1);
    expect(worker.spawned).toBe(1);
    expect(worker.toreDown.length).toBe(0);
  });

  it("AGENT-BLIND: the returned connector carries a secret_ref and NO raw secret/signing key (scan)", async () => {
    const { svc } = provisioningService();
    const s = svc.createFromAdmitted(TASK, resolved());
    const out = await svc.provision(s.id);
    const json = JSON.stringify(out);
    // The connector JSON has a secret_ref (a capability ref).
    expect(out.connector.secret_ref).toBeDefined();
    // It carries no obvious raw-secret / signing material markers.
    expect(json).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    expect(json.toLowerCase()).not.toContain("signing_key");
    expect(json.toLowerCase()).not.toContain("hmac");
  });

  it("SAGA COMPENSATION: a spawn failure → session `failed`, connector revoked, NO orphan (GLA-023 AC#3)", async () => {
    const worker = new StubWorker();
    worker.failSpawn = true;
    const { svc, capability } = provisioningService({ worker });
    const s = svc.createFromAdmitted(TASK, resolved());
    await expect(svc.provision(s.id)).rejects.toMatchObject({ code: "dependency.probe_failed" });
    // The session is `failed` (contained), the connector capability was revoked (compensated), and
    // there is NO live capsule (no orphan).
    expect(svc.get(s.id).state).toBe("failed");
    expect(capability.revoked.length).toBe(1); // the minted connector cap was revoked
    expect(worker.hasLive(s.id)).toBe(false);
  });

  it("provision twice is a conflict (a live/failed session is not re-provisionable)", async () => {
    const { svc } = provisioningService();
    const s = svc.createFromAdmitted(TASK, resolved());
    await svc.provision(s.id);
    await expect(svc.provision(s.id)).rejects.toMatchObject({ code: "state.conflict" });
  });

  it("#1: threads the TASK cap id as the connector's parentRef (so it descends, not a root)", async () => {
    const TASK_CAP = "cap_task_parent" as CapabilityId;
    const { svc, capability } = provisioningService({
      // The wiring maps the session's task → its cap id (here a fixed stand-in).
      parentCapabilityRefFor: (_sid, taskId) => (taskId === TASK ? TASK_CAP : undefined),
    });
    const s = svc.createFromAdmitted(TASK, resolved());
    await svc.provision(s.id);
    // mintConnector was called WITH the task cap as parentRef (the connector is a CHILD, not a root).
    expect(capability.lastParentRef).toBe(TASK_CAP);
    // The session records the connector's lineage parent = the task cap (observable for cascade proof).
    expect(svc.connectorLineage(s.id)?.parentRef).toBe(TASK_CAP);
  });

  it("#1: with NO parent resolver, the connector is minted as a root (parentRef undefined) — fallback", async () => {
    const { svc, capability } = provisioningService(); // no parentCapabilityRefFor
    const s = svc.createFromAdmitted(TASK, resolved());
    await svc.provision(s.id);
    expect(capability.lastParentRef).toBeUndefined();
    expect(svc.connectorLineage(s.id)?.parentRef).toBeUndefined();
  });
});

describe("SessionService — terminal-teardown connector facts (Finding #2 seam)", () => {
  it("#2: connectorTeardownInfo exposes the connector cap id + resource id for the reconciler to revoke/unbind", async () => {
    const { svc } = provisioningService();
    const s = svc.createFromAdmitted(TASK, resolved());
    const out = await svc.provision(s.id);
    const info = svc.connectorTeardownInfo(s.id);
    expect(info).toBeDefined();
    // The cap id matches the returned connector's secret_ref (= the connector cap id), and the resource id
    // matches — exactly what the terminal cleanup path revokes + unbinds.
    expect(info?.connectorCapId).toBe(String(out.connector.secret_ref));
    expect(info?.connectorResourceId).toBe(out.connector.resourceId);
  });

  it("#2: clearProvisioned makes the teardown info GONE (idempotent second teardown is a no-op)", async () => {
    const { svc } = provisioningService();
    const s = svc.createFromAdmitted(TASK, resolved());
    await svc.provision(s.id);
    expect(svc.connectorTeardownInfo(s.id)).toBeDefined();
    svc.clearProvisioned(s.id);
    // After clearing, the terminal path sees nothing → a second teardown does nothing (no double-revoke).
    expect(svc.connectorTeardownInfo(s.id)).toBeUndefined();
    expect(svc.connectorLineage(s.id)).toBeUndefined();
    // Safe to clear again (unknown / already-cleared).
    expect(() => svc.clearProvisioned(s.id)).not.toThrow();
    expect(() => svc.clearProvisioned("sess_never")).not.toThrow();
  });
});

describe("SessionService.connector — re-emit / conflict (GLA-025)", () => {
  it("re-emits the connector for a LIVE capsule (so a crashed agent re-attaches)", async () => {
    const { svc } = provisioningService();
    const s = svc.createFromAdmitted(TASK, resolved());
    await svc.provision(s.id);
    const re = await svc.connector(s.id);
    expect(re.connector.type).toBe("fake-pipe");
    expect(re.connector.resourceId).toBe(CONNECTOR_RESOURCE_ID);
    expect(re.connector.pipe_ref).toBe("pipe://capsule/abc");
    expect(re.connector.secret_ref).toBeDefined();
    expect(re.capsule.template).toBe("browser-handoff");
  });

  it("CONFLICT: connector on a session with NO live capsule → state.conflict (exit 7), not a crash (GLA-025 AC#4)", async () => {
    const { svc } = provisioningService();
    // Created but NOT provisioned → no live capsule.
    const s = svc.createFromAdmitted(TASK, resolved());
    await expect(svc.connector(s.id)).rejects.toMatchObject({ code: "state.conflict" });
  });

  it("CONFLICT after teardown: a provisioned-then-torn-down session re-emits a clean state.conflict", async () => {
    const { svc, worker } = provisioningService();
    const s = svc.createFromAdmitted(TASK, resolved());
    await svc.provision(s.id);
    await worker.teardown(s.id); // the capsule is reaped → no live capsule
    await expect(svc.connector(s.id)).rejects.toMatchObject({ code: "state.conflict" });
  });

  it("connector on an UNKNOWN session id → state.not_found (exit 5)", async () => {
    const { svc } = provisioningService();
    await expect(svc.connector("sess_missing")).rejects.toMatchObject({ code: "state.not_found" });
  });
});
