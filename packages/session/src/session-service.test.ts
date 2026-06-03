// UNIT tests for the SessionService (packages/session, GLA-021).
// The admission dispatch target: createFromAdmitted creates a Session under a task in `issued` (no
// spawn), pinning the IMMUTABLE resolved spec; provision() is a clear Slice-3 seam. Pure.

import type { ResolvedAssemblySpec, TaskId } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { SessionService } from "./index.js";

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

describe("SessionService.provision — Slice-3 seam (no spawn in Slice 2)", () => {
  it("provision() rejects with a typed state.conflict (the seam is explicit, never a silent spawn)", async () => {
    const svc = new SessionService();
    const s = svc.createFromAdmitted(TASK, resolved());
    await expect(svc.provision(s.id)).rejects.toMatchObject({ code: "state.conflict" });
  });
});
