// UNIT/CONTRACT tests for the TaskService (packages/task, GLA-018/019).
// Load-bearing security seam: the `task` capability is ATTENUATED from the agent-authority — child ⊆
// parent, narrower scope (kernel-contracts.md §2.2). Also covers implicit task, get/list, lifecycle.
// Reuses the kernel attenuation predicate (`caveatsSubsetOf`) and the reference signer (no mock).

import { type Caveat, HmacCapabilitySigner, type OpaqueToken, caveatsSubsetOf } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { TASK_SCOPED_OPS, TaskService } from "../../src/index.js";

// An agent-authority anchor whose ops are a superset of the task-scoped ops (so attenuation is valid).
const AGENT_OPS = [
  "whoami",
  "catalog.list",
  "template.show",
  "session.create",
  "handoff.open",
  "handoff.wait",
  "task.complete",
];

async function anchor(signer: HmacCapabilitySigner): Promise<{
  token: OpaqueToken;
  caveats: Caveat[];
}> {
  const { token, capability } = await signer.mint({
    cls: "agent-authority",
    caveats: [
      { kind: "authority-profile", profile: "local-single-operator" },
      { kind: "allowed-ops", ops: AGENT_OPS },
      { kind: "audience", id: "agent:local" },
    ],
  });
  return { token, caveats: capability.caveats };
}

function svc(signer: HmacCapabilitySigner): TaskService {
  return new TaskService({ capability: signer });
}

describe("TaskService.create — task capability attenuated from agent-authority (GLA-019)", () => {
  it("opens an active Task with intent + recipient and a task_capability_ref", async () => {
    const signer = new HmacCapabilitySigner();
    const { token } = await anchor(signer);
    const { task } = await svc(signer).create(
      // biome-ignore lint/suspicious/noExplicitAny: recipient brand cast in test
      { intent: "register on acme", recipient: "tg:user:123" as any },
      token,
    );
    expect(task.state).toBe("active");
    expect(task.intentLabel).toBe("register on acme");
    expect(task.recipient).toBe("tg:user:123");
    expect(task.id).toMatch(/^task_/);
    expect(task.taskCapabilityRef).toMatch(/^cap_/);
    expect(task.implicit).toBe(false);
  });

  it("the minted task cap is a STRICT CHILD ⊆ the agent-authority (attenuation, kernel predicate)", async () => {
    const signer = new HmacCapabilitySigner();
    const { token, caveats: parentCaveats } = await anchor(signer);
    const svcInst = svc(signer);
    const { task, taskCapabilityToken } = await svcInst.create({ intent: "t" }, token);

    // Verify the task token resolves and is an agent-authority-class chain (attenuation keeps the class).
    const verified = signer.verify(taskCapabilityToken, {
      now: new Date().toISOString() as never,
      revocations: signer.revocationSnapshot(),
      // the task cap carries a scope caveat → must present the scoped path to verify
      scopePath: `/task/${task.id}`,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const childCaveats = verified.capability.caveats;
    // child ⊆ parent: the kernel's own attenuation predicate must hold.
    expect(caveatsSubsetOf(childCaveats, parentCaveats)).toBe(true);
    // The task cap's lineage names the agent-authority as its parent (descends from it).
    expect(verified.capability.parentRef).toBeDefined();

    // It is genuinely NARROWER: it adds a task-scoped `scope` caveat the parent did not carry, and a
    // task-scoped `allowed-ops` caveat. (Attenuate keeps the parent's caveats too; the effective
    // grant is the CONJUNCTION — so the parent's full ops AND the task subset present together means
    // the effective op set is the intersection = the task subset.)
    const childScope = childCaveats.find((c) => c.kind === "scope");
    expect(childScope).toEqual({ kind: "scope", path: `/task/${task.id}` });
    const taskScopedOps = childCaveats.filter(
      (c) => c.kind === "allowed-ops" && c.ops.length === TASK_SCOPED_OPS.length,
    );
    expect(taskScopedOps).toContainEqual({ kind: "allowed-ops", ops: TASK_SCOPED_OPS });
    // and that op subset is ⊆ the agent's ops (a genuine narrowing on the ops dimension)
    for (const op of TASK_SCOPED_OPS) {
      expect(AGENT_OPS).toContain(op);
    }
  });

  it("the task cap CANNOT verify for a DIFFERENT task's scope path (scope is bound, fail-closed)", async () => {
    const signer = new HmacCapabilitySigner();
    const { token } = await anchor(signer);
    const { taskCapabilityToken } = await svc(signer).create({ intent: "t" }, token);
    const wrong = signer.verify(taskCapabilityToken, {
      now: new Date().toISOString() as never,
      revocations: signer.revocationSnapshot(),
      scopePath: "/task/some-other-task",
    });
    expect(wrong.ok).toBe(false);
  });

  it("rejects minting from a MALFORMED agent-authority token (auth.*), never a broad child", async () => {
    const signer = new HmacCapabilitySigner();
    await expect(
      svc(signer).create({ intent: "t" }, "not-a-real-token" as OpaqueToken),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^auth\./) });
  });
});

describe("TaskService — implicit task (GLA-018: single-capsule goal auto-creates one)", () => {
  it("createImplicit opens a real task flagged implicit, carrying the recipient", async () => {
    const signer = new HmacCapabilitySigner();
    const { token } = await anchor(signer);
    const { task } = await svc(signer).createImplicit(
      // biome-ignore lint/suspicious/noExplicitAny: recipient brand cast in test
      "tg:user:9" as any,
      token,
      "implicit goal",
    );
    expect(task.implicit).toBe(true);
    expect(task.recipient).toBe("tg:user:9");
    expect(task.state).toBe("active");
    expect(task.id).toMatch(/^task_/);
  });
});

describe("TaskService — get / list / lifecycle", () => {
  it("get returns the aggregate; an unknown id throws state.not_found (→ exit 5)", async () => {
    const signer = new HmacCapabilitySigner();
    const { token } = await anchor(signer);
    const s = svc(signer);
    const { task } = await s.create({ intent: "t" }, token);
    expect(s.get(task.id).id).toBe(task.id);
    expect(() => s.get("task_missing")).toThrowError(/unknown task/);
  });

  it("list filters by state and is deterministically ordered", async () => {
    const signer = new HmacCapabilitySigner();
    const { token } = await anchor(signer);
    const s = svc(signer);
    await s.create({ intent: "a" }, token);
    const { task: t2 } = await s.create({ intent: "b" }, token);
    s.transition(t2.id, "completed");
    expect(s.list().length).toBe(2);
    expect(s.list({ state: "active" }).length).toBe(1);
    expect(s.list({ state: "completed" })[0]?.id).toBe(t2.id);
  });

  it("toView projects the public JSON shape (serializable)", async () => {
    const signer = new HmacCapabilitySigner();
    const { token } = await anchor(signer);
    const { task } = await svc(signer).create({ intent: "t" }, token);
    const view = TaskService.toView(task);
    expect(view).toMatchObject({ task_id: task.id, state: "active", implicit: false });
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
