// UNIT tests for the open-window saga (packages/session) — GLA-032/033.
// openHandoff is the ORDERED, REVERSIBLE saga: mint grant -> program route -> deliver link; it creates the
// HandoffWindow (`open`), advances the session `active -> opened` (the window exposes the entrypoint ONLY while
// open), and arms the TTL timer. On ANY step failure it compensates in reverse (revoke grant + force-close +
// unmount) and leaves the session back at `active` with no window/grant/route (NO partial — GLA-033 AC#4). cancel
// closes early (revoke + force-close + unmount); re-open onto the SAME capsule is supported (GLA-032 AC#8). All over
// STUB seams — no real gateway/capability. Pure (an injected timer seam makes the TTL deterministic).

import type {
  CapabilityId,
  HandoffId,
  HumanEntrypointBinding,
  Iso8601,
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
} from "../../src/index.js";

const TASK = "task_1" as TaskId;
const recipient = "tg:user:123" as RecipientRef;
const ENDPOINT = "ws://127.0.0.1:6080/";
const ENTRYPOINT: HumanEntrypointBinding = {
  resourceId: "entrypoint:fake-view:1",
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
      detectors: [{ use: "user-done" }],
    },
    __resolved: true,
  };
}

/** A stub capability seam recording mints/revokes/force-closes. */
class StubCap implements HandoffCapabilityPort {
  minted: MintedSessionGrantRef[] = [];
  revoked: CapabilityId[] = [];
  forceClosed: CapabilityId[] = [];
  failMint = false;
  nextId = 1;
  async mintSessionGrant(req: {
    sessionId: string;
    recipient: RecipientRef;
    parentToken?: OpaqueToken;
    notAfter?: Iso8601;
  }): Promise<MintedSessionGrantRef> {
    if (this.failMint) {
      throw Object.assign(new Error("mint failed"), {
        name: "GlaErrorException",
        code: "auth.attenuation_widened",
      });
    }
    const g: MintedSessionGrantRef = {
      grantId: `cap_g${this.nextId++}` as CapabilityId,
      token: `tok-${req.sessionId}` as OpaqueToken,
      scopePath: `/handoff/${req.sessionId}`,
    };
    this.minted.push(g);
    return g;
  }
  async revoke(id: CapabilityId): Promise<void> {
    this.revoked.push(id);
  }
  forceCloseGrant(grantId: CapabilityId): void {
    this.forceClosed.push(grantId);
  }
}

/** A stub route seam recording program/unmount, with a configurable programming failure. */
class StubRoute implements HandoffRoutePort {
  programmed: Array<{ windowId: HandoffId; grantId: CapabilityId; endpoint: string }> = [];
  unmounted: HandoffId[] = [];
  failProgram = false;
  nextId = 1;
  async program(
    window: { id: HandoffId; sessionId: SessionId },
    grantId: CapabilityId,
    entrypoint: HumanEntrypointBinding,
    path?: string,
  ): Promise<Route> {
    if (this.failProgram) {
      throw Object.assign(new Error("program failed"), {
        name: "GlaErrorException",
        code: "dependency.unavailable",
      });
    }
    this.programmed.push({ windowId: window.id, grantId, endpoint: entrypoint.transport.upstream });
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

/** A stub entrypoint seam returning a fake provider-neutral entrypoint binding. */
class StubEntry implements HandoffEntrypointPort {
  async open(_runtime: RuntimeHandle): Promise<HumanEntrypointBinding> {
    return ENTRYPOINT;
  }
}

/** A stub channel recording delivery, with a configurable delivery failure. */
class StubChannel implements HandoffChannelPort {
  delivered: Array<{ recipient: RecipientRef; link: string }> = [];
  failDeliver = false;
  async deliver(r: RecipientRef, link: string, _delegation: OpaqueToken): Promise<void> {
    if (this.failDeliver) {
      throw new Error("delivery failed");
    }
    this.delivered.push({ recipient: r, link });
  }
}

/** A manual timer seam so TTL expiry is deterministic (fire() triggers the armed callback). */
class ManualTimer {
  private fns: Array<() => void> = [];
  readonly setTimer = (_ms: number, fn: () => void): { clear: () => void } => {
    this.fns.push(fn);
    return {
      clear: () => {
        this.fns = this.fns.filter((f) => f !== fn);
      },
    };
  };
  fireAll(): void {
    const toFire = [...this.fns];
    this.fns = [];
    for (const f of toFire) {
      f();
    }
  }
  get armed(): number {
    return this.fns.length;
  }
}

/** Build a SessionService with handoff wired + a LIVE (active, runtime-pinned) session ready for a handoff. */
function liveSession(deps: Partial<HandoffDeps> & { timer?: ManualTimer } = {}): {
  svc: SessionService;
  sessionId: SessionId;
  cap: StubCap;
  route: StubRoute;
  channel: StubChannel;
  timer: ManualTimer;
} {
  const cap = (deps.capability as StubCap) ?? new StubCap();
  const route = (deps.route as StubRoute) ?? new StubRoute();
  const entrypoint = (deps.entrypoint as StubEntry) ?? new StubEntry();
  const channel = (deps.channel as StubChannel) ?? new StubChannel();
  const timer = deps.timer ?? new ManualTimer();
  const handoff: HandoffDeps = {
    capability: cap,
    route,
    entrypoint,
    channel,
    buildLink: (path, token) => `http://gw.local${path}?grant=${token}`,
    setTimer: timer.setTimer,
    ...(deps.parentTokenFor !== undefined ? { parentTokenFor: deps.parentTokenFor } : {}),
  };
  const svc = new SessionService({ handoff });
  const s = svc.createFromAdmitted(TASK, resolved());
  // Make it LIVE: pin a runtime + advance issued -> active (as provision would).
  const session = svc.get(s.id);
  (session as { runtime: RuntimeHandle }).runtime = "rt-1" as RuntimeHandle;
  (session as { state: string }).state = "active";
  return { svc, sessionId: s.id, cap, route, channel, timer };
}

describe("SessionService.openHandoff — the ordered, reversible open-window saga (GLA-032/033)", () => {
  it("mint grant -> program route -> deliver link, creates an `open` window, session `active -> opened`", async () => {
    const { svc, sessionId, cap, route, channel } = liveSession();
    const view = await svc.openHandoff(sessionId, { reason: "complete registration form" });

    // The view shape (docs/05 §4): handoff_id + link + recipient + expires_at + state.
    expect(view.handoff_id).toMatch(/^hand_/);
    expect(view.recipient).toBe(recipient);
    expect(view.state).toBe("open");
    expect(view.link).toContain("/handoff/");
    expect(view.link).toContain("grant=");

    // The saga ran in order: a grant was minted, the route programmed to the capsule endpoint, the link delivered.
    expect(cap.minted).toHaveLength(1);
    expect(route.programmed).toHaveLength(1);
    expect(route.programmed[0]?.endpoint).toBe(ENDPOINT);
    expect(route.programmed[0]?.grantId).toBe(cap.minted[0]?.grantId);
    expect(channel.delivered).toHaveLength(1);
    expect(channel.delivered[0]?.recipient).toBe(recipient); // delivered to EXACTLY the bound recipient

    // The session moved `active -> opened` (the window exposes the entrypoint ONLY while open — GLA-033 AC#2).
    expect(svc.get(sessionId).state).toBe("opened");
    expect(svc.get(sessionId).route?.boundGrantId).toBe(cap.minted[0]?.grantId);
  });

  it("attenuates the grant FROM the session/task capability when a parent token is threaded", async () => {
    const cap = new StubCap();
    const parentToken = "parent-tok" as OpaqueToken;
    let sawParent: OpaqueToken | undefined;
    const origMint = cap.mintSessionGrant.bind(cap);
    cap.mintSessionGrant = async (req) => {
      sawParent = req.parentToken;
      return origMint(req);
    };
    const { svc, sessionId } = liveSession({
      capability: cap,
      parentTokenFor: () => parentToken,
    });
    await svc.openHandoff(sessionId);
    expect(sawParent).toBe(parentToken); // the grant descends from the session/task cap (never widened)
  });

  it("exposes the entrypoint ONLY while open — handoffGet reports open, then cancel closes it", async () => {
    const { svc, sessionId } = liveSession();
    const view = await svc.openHandoff(sessionId);
    expect(svc.handoffGet(view.handoff_id).state).toBe("open");
    await svc.cancelHandoff(view.handoff_id);
    expect(svc.handoffGet(view.handoff_id).state).toBe("cancelled");
    // The session returned to `active` (closing a window does not kill the capsule).
    expect(svc.get(sessionId).state).toBe("active");
  });
});

describe("SessionService.openHandoff — REVERSIBLE: a step failure leaves NO partial window/route/grant (GLA-033 AC#4)", () => {
  it("a ROUTE programming failure -> the grant is revoked + force-closed, NO window, session back to `active`", async () => {
    const cap = new StubCap();
    const route = new StubRoute();
    route.failProgram = true;
    const { svc, sessionId } = liveSession({ capability: cap, route });

    await expect(svc.openHandoff(sessionId)).rejects.toMatchObject({
      code: "dependency.unavailable",
    });

    // The grant minted in step 1 was COMPENSATED (revoked + force-closed); no window persists.
    expect(cap.minted).toHaveLength(1);
    expect(cap.revoked).toContain(cap.minted[0]?.grantId);
    expect(cap.forceClosed).toContain(cap.minted[0]?.grantId);
    expect(svc.handoffList()).toHaveLength(0);
    // The session is back at `active` (the window never opened) — a retry starts clean.
    expect(svc.get(sessionId).state).toBe("active");
  });

  it("a DELIVERY failure -> the route is unmounted + the grant revoked, NO open window, session `active`", async () => {
    const cap = new StubCap();
    const route = new StubRoute();
    const channel = new StubChannel();
    channel.failDeliver = true;
    const { svc, sessionId } = liveSession({ capability: cap, route, channel });

    await expect(svc.openHandoff(sessionId)).rejects.toBeDefined();
    expect(route.programmed).toHaveLength(1); // the route was programmed...
    expect(route.unmounted).toHaveLength(1); // ...then unmounted (compensation)
    expect(cap.revoked).toContain(cap.minted[0]?.grantId);
    expect(svc.handoffList()).toHaveLength(0);
    expect(svc.get(sessionId).state).toBe("active");
  });

  it("a MINT failure -> nothing programmed/delivered, session stays `active`", async () => {
    const cap = new StubCap();
    cap.failMint = true;
    const route = new StubRoute();
    const { svc, sessionId } = liveSession({ capability: cap, route });
    await expect(svc.openHandoff(sessionId)).rejects.toBeDefined();
    expect(route.programmed).toHaveLength(0);
    expect(svc.get(sessionId).state).toBe("active");
  });
});

describe("SessionService.openHandoff — re-open onto the SAME capsule (GLA-032 AC#8)", () => {
  it("a second handoff opens a NEW window on the SAME session/capsule (no re-spawn)", async () => {
    const { svc, sessionId, cap, route } = liveSession();
    const h1 = await svc.openHandoff(sessionId, { reason: "complete registration form" });
    await svc.completeHandoff(h1.handoff_id); // close the first window -> session `active`
    expect(svc.get(sessionId).state).toBe("active");

    // The SECOND handoff (scenario-01 Phase 11) reuses the SAME capsule — same runtime, new grant + window.
    const h2 = await svc.openHandoff(sessionId, { reason: "enter verification code" });
    expect(h2.handoff_id).not.toBe(h1.handoff_id);
    expect(h2.session_id).toBe(sessionId);
    expect(svc.get(sessionId).state).toBe("opened");
    // Two distinct grants minted (one per window), both for the same session.
    expect(cap.minted).toHaveLength(2);
    expect(route.programmed).toHaveLength(2);
    // Both windows are listed for the session.
    expect(svc.handoffList({ session: sessionId })).toHaveLength(2);
  });
});

describe("SessionService — handoff TTL expiry + cancel close-out (revoke + force-close + unmount)", () => {
  it("TTL elapse expires the window: revoke grant, force-close WS, unmount route, mark `expired`", async () => {
    const timer = new ManualTimer();
    const { svc, sessionId, cap, route } = liveSession({ timer });
    const view = await svc.openHandoff(sessionId, { ttl: "15m" });
    expect(timer.armed).toBe(1);

    // Fire the TTL timer (deterministic): the window expires and is closed-out.
    timer.fireAll();
    // Allow the async expire to settle.
    await new Promise((r) => setImmediate(r));

    expect(svc.handoffGet(view.handoff_id).state).toBe("expired");
    expect(cap.forceClosed).toContain(cap.minted[0]?.grantId); // the live WS was force-closed
    expect(cap.revoked).toContain(cap.minted[0]?.grantId); //     the grant revoked
    expect(route.unmounted).toContain(view.handoff_id); //         the route unmounted
    expect(svc.get(sessionId).state).toBe("active"); //            the session returned to `active`
  });

  it("cancel revokes the grant, force-closes the WS, unmounts the route, and clears the timer", async () => {
    const timer = new ManualTimer();
    const { svc, sessionId, cap, route } = liveSession({ timer });
    const view = await svc.openHandoff(sessionId);
    expect(timer.armed).toBe(1);

    await svc.cancelHandoff(view.handoff_id);
    expect(cap.forceClosed).toContain(cap.minted[0]?.grantId);
    expect(cap.revoked).toContain(cap.minted[0]?.grantId);
    expect(route.unmounted).toContain(view.handoff_id);
    expect(timer.armed).toBe(0); // the TTL timer was cleared on cancel (cannot fire after close)
    // A second cancel is idempotent (already terminal).
    const again = await svc.cancelHandoff(view.handoff_id);
    expect(again.state).toBe("cancelled");
  });

  it("openHandoff on a session with NO live capsule -> a catchable state.conflict (exit 7), not a crash", async () => {
    const { svc } = liveSession();
    // A session that was never made live (proposed/issued) cannot open a window.
    const s = svc.createFromAdmitted(TASK, resolved());
    await expect(svc.openHandoff(s.id)).rejects.toMatchObject({ code: "state.conflict" });
  });
});
