// UNIT/CONTRACT tests for the TaskService TERMINAL teardown (packages/task, Slice 7, GLA-064/065).
// The complete-or-revoke contract (kernel-contracts.md §1.1, task-service.md, docs/05 `task complete`/`task
// revoke`): a terminal transition that (1) tears down every session under the task, (2) revokes the task
// capability so — by LINEAGE — every descendant capability stops verifying (kernel cascade), and (3) drives
// the Task to its terminal state (`completed` | `revoked`). Uses the REFERENCE kernel signer (no mock) so the
// cascade is the REAL one, and a tiny in-test session-teardown spy for the delegated session step.

import { HmacCapabilitySigner, type OpaqueToken, type SessionId } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { TaskService, type TaskTeardownDeps } from "./index.js";

const AGENT_OPS = ["session.create", "handoff.open", "handoff.wait", "task.complete"];

async function anchor(signer: HmacCapabilitySigner): Promise<OpaqueToken> {
  const { token } = await signer.mint({
    cls: "agent-authority",
    caveats: [
      { kind: "authority-profile", profile: "local-single-operator" },
      { kind: "allowed-ops", ops: AGENT_OPS },
      { kind: "audience", id: "agent:local" },
    ],
  });
  return token;
}

/** A spy session-teardown dep: records each (sessionId, disposition) torn down. */
function teardownSpy(): {
  deps: TaskTeardownDeps;
  calls: Array<{ sessionId: string; disposition: string }>;
} {
  const calls: Array<{ sessionId: string; disposition: string }> = [];
  return {
    calls,
    deps: {
      teardownSession: async (sessionId, disposition) => {
        calls.push({ sessionId, disposition });
        return "completed";
      },
    },
  };
}

describe("TaskService.complete — terminal transition + cascade revoke (GLA-065 AC#1/#2)", () => {
  it("tears down every session under the task, revokes the task cap, drives the task to completed", async () => {
    const signer = new HmacCapabilitySigner();
    const token = await anchor(signer);
    const spy = teardownSpy();
    const svc = new TaskService({ capability: signer, teardown: spy.deps });
    const { task, taskCapabilityToken } = await svc.create({ intent: "register on acme" }, token);
    // Attach two sessions to the task chain (as session.create would).
    svc.attachSession(task.id, "sess_a");
    svc.attachSession(task.id, "sess_b");

    // The task cap verifies BEFORE completion (it is live).
    const before = signer.verify(taskCapabilityToken, {
      now: new Date().toISOString() as never,
      revocations: signer.revocationSnapshot(),
      scopePath: `/task/${task.id}`,
    });
    expect(before.ok).toBe(true);

    const completed = await svc.complete(task.id);
    expect(completed.state).toBe("completed");

    // (1) Every session under the task was torn down to the `completed` disposition.
    expect(spy.calls).toEqual([
      { sessionId: "sess_a", disposition: "completed" },
      { sessionId: "sess_b", disposition: "completed" },
    ]);

    // (2) The task capability NO LONGER verifies after completion (GLA-065 AC#2 — the cascade root).
    const after = signer.verify(taskCapabilityToken, {
      now: new Date().toISOString() as never,
      revocations: signer.revocationSnapshot(),
      scopePath: `/task/${task.id}`,
    });
    expect(after.ok).toBe(false);
    if (!after.ok) {
      expect(after.reason).toBe("auth.revoked");
    }
  });

  it("CASCADE: a capability DESCENDED from the task cap also stops verifying after complete (GLA-065 AC#2)", async () => {
    const signer = new HmacCapabilitySigner();
    const token = await anchor(signer);
    const svc = new TaskService({ capability: signer, teardown: teardownSpy().deps });
    const { task, taskCapabilityToken } = await svc.create({ intent: "t" }, token);

    // Mint a CHILD of the task cap (a stand-in for a session grant / the agent-connector — both descend
    // from the task cap by lineage). It verifies while the task is live.
    const child = await signer.attenuate(taskCapabilityToken, [
      { kind: "scope", path: `/task/${task.id}/handoff/sess_x` },
    ]);
    const ctx = () => ({
      now: new Date().toISOString() as never,
      revocations: signer.revocationSnapshot(),
      scopePath: `/task/${task.id}/handoff/sess_x`,
    });
    expect(signer.verify(child.token, ctx()).ok).toBe(true);

    await svc.complete(task.id);

    // Revoking the TASK cap cascades to its descendant: the child now fails verify with auth.revoked.
    const after = signer.verify(child.token, ctx());
    expect(after.ok).toBe(false);
    if (!after.ok) {
      expect(after.reason).toBe("auth.revoked");
    }
  });

  it("is IDEMPOTENT: re-running complete is safe (no throw, no double-teardown error) — GLA-065 AC#5", async () => {
    const signer = new HmacCapabilitySigner();
    const token = await anchor(signer);
    const spy = teardownSpy();
    const svc = new TaskService({ capability: signer, teardown: spy.deps });
    const { task } = await svc.create({ intent: "t" }, token);
    svc.attachSession(task.id, "sess_a");

    const first = await svc.complete(task.id);
    expect(first.state).toBe("completed");
    // A second complete does not throw and leaves the task completed (the session-teardown dep is itself
    // idempotent, so re-calling it is safe; the task stays terminal).
    const second = await svc.complete(task.id);
    expect(second.state).toBe("completed");
    // The terminal state is unchanged (no illegal re-transition).
    expect(svc.get(task.id).state).toBe("completed");
  });
});

describe("TaskService.revoke — abort = same teardown to a non-success terminal state (GLA-065 AC#6)", () => {
  it("tears down sessions to the `revoked` disposition, revokes the task cap, drives the task to revoked", async () => {
    const signer = new HmacCapabilitySigner();
    const token = await anchor(signer);
    const spy = teardownSpy();
    const svc = new TaskService({ capability: signer, teardown: spy.deps });
    const { task, taskCapabilityToken } = await svc.create({ intent: "t" }, token);
    svc.attachSession(task.id, "sess_a");

    const revoked = await svc.revoke(task.id);
    expect(revoked.state).toBe("revoked"); // a NON-success terminal state

    // The same teardown ran, but to the `revoked` disposition (the abort path).
    expect(spy.calls).toEqual([{ sessionId: "sess_a", disposition: "revoked" }]);

    // The task cap still no longer verifies (the abort revokes everything too).
    const after = signer.verify(taskCapabilityToken, {
      now: new Date().toISOString() as never,
      revocations: signer.revocationSnapshot(),
      scopePath: `/task/${task.id}`,
    });
    expect(after.ok).toBe(false);
  });
});

describe("TaskService.complete/revoke — error contract", () => {
  it("an unknown task throws state.not_found (→ exit 5)", async () => {
    const signer = new HmacCapabilitySigner();
    const svc = new TaskService({ capability: signer, teardown: teardownSpy().deps });
    await expect(svc.complete("task_missing" as never)).rejects.toMatchObject({
      code: "state.not_found",
    });
  });

  it("a bare task service (teardown NOT wired) rejects complete with state.conflict", async () => {
    const signer = new HmacCapabilitySigner();
    const token = await anchor(signer);
    const svc = new TaskService({ capability: signer }); // no teardown dep
    const { task } = await svc.create({ intent: "t" }, token);
    await expect(svc.complete(task.id)).rejects.toMatchObject({ code: "state.conflict" });
  });

  it("a teardown step throwing does NOT strand the cap-revoke or the transition (best-effort convergence)", async () => {
    const signer = new HmacCapabilitySigner();
    const token = await anchor(signer);
    // A session-teardown dep that THROWS — the closing guarantee must still revoke the cap + transition.
    const failing: TaskTeardownDeps = {
      teardownSession: async (_s: SessionId) => {
        throw new Error("capsule reap hiccup");
      },
    };
    const svc = new TaskService({ capability: signer, teardown: failing });
    const { task, taskCapabilityToken } = await svc.create({ intent: "t" }, token);
    svc.attachSession(task.id, "sess_a");

    const completed = await svc.complete(task.id);
    expect(completed.state).toBe("completed"); // the transition ran despite the teardown throw
    // …and the cap was still revoked (the closing guarantee).
    const after = signer.verify(taskCapabilityToken, {
      now: new Date().toISOString() as never,
      revocations: signer.revocationSnapshot(),
      scopePath: `/task/${task.id}`,
    });
    expect(after.ok).toBe(false);
  });
});
