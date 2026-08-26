// UNIT tests for the SessionService TERMINAL teardown (packages/session) — Slice 7, GLA-064/065.
// teardownSession is the closing guarantee that STOPS the capsule — DISTINCT from close-window (Slice 5,
// which deliberately leaves the capsule RUNNING). The ordered contract (session-service.md): (1) cancel any
// OPEN handoff window (force-close WS, revoke grant, unmount route — reverse-of-open), (2) STOP + reap the
// capsule + revoke the connector via the worker's Cleanup Reconciler (the injected `reconcile` seam), (3)
// transition the session terminal (`completed` | `revoked`) and CLEAR the runtime handle (no live capsule).
// Idempotent + restart-safe (GLA-065 AC#5). All over STUB seams — no real worker/gateway.

import type {
  CapabilityId,
  HandoffId,
  HumanEntrypointBinding,
  OpaqueToken,
  RecipientRef,
  ResolvedAssemblySpec,
  Route,
  RuntimeHandle,
  SessionId,
  TaskId,
} from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  type HandoffCapabilityPort,
  type HandoffChannelPort,
  type HandoffDeps,
  type HandoffEntrypointPort,
  type HandoffRoutePort,
  type MintedSessionGrantRef,
  SessionService,
  type SessionTeardownDeps,
} from "../../src/index.js";

const TASK = "task_1" as TaskId;
const recipient = "tg:user:123" as RecipientRef;
const ENDPOINT = "ws://127.0.0.1:6080/";
const ENTRYPOINT: HumanEntrypointBinding = {
  resourceId: "entrypoint:fake-view:teardown",
  provider: "fake-view",
  client: { kind: "provider-asset", ref: "fake-viewer" },
  transport: { kind: "reverse-proxy", protocol: "websocket", upstream: ENDPOINT },
};

function resolved(): ResolvedAssemblySpec {
  return {
    apiVersion: "gla.dev/v1",
    kind: "Assembly",
    metadata: { intent: "register on acme", task: "task_1" },
    spec: {
      template: "browser-handoff",
      // biome-ignore lint/suspicious/noExplicitAny: recipient brand cast in test
      recipient: recipient as any,
    },
    __resolved: true,
  };
}

class StubCap implements HandoffCapabilityPort {
  revoked: CapabilityId[] = [];
  forceClosed: CapabilityId[] = [];
  nextId = 1;
  async mintSessionGrant(req: { sessionId: string }): Promise<MintedSessionGrantRef> {
    return {
      grantId: `cap_g${this.nextId++}` as CapabilityId,
      token: `tok-${req.sessionId}` as OpaqueToken,
      scopePath: `/handoff/${req.sessionId}`,
    };
  }
  async revoke(id: CapabilityId): Promise<void> {
    this.revoked.push(id);
  }
  forceCloseGrant(grantId: CapabilityId): void {
    this.forceClosed.push(grantId);
  }
}

class StubRoute implements HandoffRoutePort {
  unmounted: HandoffId[] = [];
  nextId = 1;
  async program(
    window: { id: HandoffId; sessionId: SessionId },
    grantId: CapabilityId,
    entrypoint: HumanEntrypointBinding,
    path?: string,
  ): Promise<Route> {
    return {
      id: `route_${this.nextId++}` as Route["id"],
      path: path ?? `/handoff/${window.sessionId}`,
      entrypointResourceId: entrypoint.resourceId,
      client: entrypoint.client,
      transport: entrypoint.transport,
      boundGrantId: grantId,
    };
  }
  async unmount(windowId: HandoffId): Promise<void> {
    this.unmounted.push(windowId);
  }
}

class StubEntry implements HandoffEntrypointPort {
  async open(_r: RuntimeHandle): Promise<HumanEntrypointBinding> {
    return ENTRYPOINT;
  }
}
class StubChannel implements HandoffChannelPort {
  async deliver(_r: RecipientRef, _l: string, _d: OpaqueToken): Promise<void> {}
}

/** A spy teardown seam: records each reconcile(sessionId) (the STOP+reap+revoke-connector step). */
class StubTeardown implements SessionTeardownDeps {
  reconciled: SessionId[] = [];
  throwOnce = false;
  async reconcile(sessionId: SessionId): Promise<void> {
    this.reconciled.push(sessionId);
    if (this.throwOnce) {
      this.throwOnce = false;
      throw new Error("reconcile hiccup");
    }
  }
}

interface Built {
  svc: SessionService;
  sessionId: SessionId;
  cap: StubCap;
  route: StubRoute;
  teardown: StubTeardown;
}

/** Build a SessionService with handoff + teardown wired and a LIVE (active, runtime-pinned) session. */
function build(): Built {
  const cap = new StubCap();
  const route = new StubRoute();
  const teardown = new StubTeardown();
  const handoff: HandoffDeps = {
    capability: cap,
    route,
    entrypoint: new StubEntry(),
    channel: new StubChannel(),
    buildLink: (path, token) => `http://gw.local${path}?grant=${token}`,
  };
  const svc = new SessionService({ handoff, teardown });
  const s = svc.createFromAdmitted(TASK, resolved());
  const session = svc.get(s.id);
  (session as { runtime: RuntimeHandle }).runtime = "rt-1" as RuntimeHandle;
  (session as { state: string }).state = "active";
  return { svc, sessionId: s.id, cap, route, teardown };
}

describe("SessionService.teardownSession — terminal: stops the capsule + reaps + session→completed (GLA-065 AC#1)", () => {
  it("STOPS the capsule (reconcile), transitions the session completed, and CLEARS the runtime handle", async () => {
    const { svc, sessionId, teardown } = build();
    expect(svc.hasRuntime(sessionId)).toBe(true); // a live capsule before teardown

    const state = await svc.teardownSession(sessionId, "completed");
    expect(state).toBe("completed");
    expect(svc.get(sessionId).state).toBe("completed"); // terminal
    // The capsule was STOPPED + reaped via the Cleanup Reconciler (the STOP-the-capsule step).
    expect(teardown.reconciled).toEqual([sessionId]);
    // No live capsule remains on the session aggregate (the runtime handle is cleared).
    expect(svc.hasRuntime(sessionId)).toBe(false);
    expect(svc.get(sessionId).runtime).toBeUndefined();
  });

  it("CANCELS an open handoff window first: force-close WS, revoke grant, unmount route (no live route/grant — AC#3)", async () => {
    const { svc, sessionId, cap, route } = build();
    const view = await svc.openHandoff(sessionId, { reason: "complete form" });
    expect(svc.get(sessionId).state).toBe("opened");
    const grantId = cap.revoked.length; // none revoked yet
    expect(grantId).toBe(0);

    await svc.teardownSession(sessionId, "completed");

    // The OPEN window was closed (reverse-of-open): grant force-closed + revoked, route unmounted.
    expect(cap.forceClosed.length).toBeGreaterThan(0);
    expect(cap.revoked.length).toBeGreaterThan(0);
    expect(route.unmounted).toContain(view.handoff_id);
    // The window is terminal (cancelled), the session is `completed`, no grant/route remains on the session.
    expect(svc.handoffGet(view.handoff_id).state).toBe("cancelled");
    expect(svc.get(sessionId).state).toBe("completed");
    expect(svc.get(sessionId).grantTokenRef).toBeUndefined();
    expect(svc.get(sessionId).route).toBeUndefined();
  });

  it("ABORT (disposition `revoked`) drives the session to a non-success terminal state (GLA-065 AC#6)", async () => {
    const { svc, sessionId, teardown } = build();
    const state = await svc.teardownSession(sessionId, "revoked");
    expect(state).toBe("revoked");
    expect(svc.get(sessionId).state).toBe("revoked");
    expect(teardown.reconciled).toEqual([sessionId]);
  });
});

describe("SessionService.teardownSession — IDEMPOTENT + restart-safe (GLA-065 AC#5)", () => {
  it("re-running teardown is a clean no-op: no throw, no double-transition, no double-reap error", async () => {
    const { svc, sessionId, teardown } = build();
    await svc.teardownSession(sessionId, "completed");
    expect(svc.get(sessionId).state).toBe("completed");

    // A SECOND teardown does not throw and leaves the session completed. The reconcile seam is itself
    // idempotent (the real Cleanup Reconciler is), so re-running it is safe; the session is not re-transitioned.
    const again = await svc.teardownSession(sessionId, "completed");
    expect(again).toBe("completed");
    expect(svc.get(sessionId).state).toBe("completed");
    // reconcile was called on each pass (idempotent — the worker converges), but the state stayed terminal.
    expect(teardown.reconciled).toEqual([sessionId, sessionId]);
  });

  it("a reconcile (capsule reap) failure does NOT strand the terminal transition (best-effort convergence)", async () => {
    const { svc, sessionId, teardown } = build();
    teardown.throwOnce = true; // the first reconcile throws (a transient reap hiccup)
    const state = await svc.teardownSession(sessionId, "completed");
    // The session STILL reaches its terminal state despite the reconcile throw (the reconciler converges later).
    expect(state).toBe("completed");
    expect(svc.get(sessionId).state).toBe("completed");
    expect(svc.hasRuntime(sessionId)).toBe(false);
  });

  it("tearing down an UNKNOWN session is a safe no-op (a task may list a session already cleaned)", async () => {
    const { svc } = build();
    await expect(svc.teardownSession("sess_missing" as SessionId, "completed")).resolves.toBe(
      "completed",
    );
  });

  it("a bare SessionService (teardown NOT wired) still closes the window + transitions terminal (degrade)", async () => {
    // No teardown dep, no handoff dep — a session with a pinned runtime can still be driven terminal.
    const svc = new SessionService({});
    const s = svc.createFromAdmitted(TASK, resolved());
    const session = svc.get(s.id);
    (session as { runtime: RuntimeHandle }).runtime = "rt-1" as RuntimeHandle;
    (session as { state: string }).state = "active";
    const state = await svc.teardownSession(s.id, "completed");
    expect(state).toBe("completed");
    expect(svc.get(s.id).state).toBe("completed");
    expect(svc.hasRuntime(s.id)).toBe(false);
  });
});
