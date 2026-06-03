// UNIT tests for the Route controller (packages/route) — GLA-033 AC#4/#5.
// program → the route is reachable (mounted on the abstract edge); unmount → unreachable (and the edge force-closes
// any live WS); a programming FAILURE → a TYPED error + NO partial route (the edge holds nothing); reconcile →
// converges the edge to Session truth (dangling routes removed). The edge is a STUB RouteGatewayPort (the
// abstract-seam proof: the controller names no concrete gateway), so a different gateway satisfies the same port.

import type { CapabilityId, HandoffWindow, RouteId, SessionId } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { RouteController, type RouteGatewayPort, type RouteMount } from "./index.js";

const SESS = "sess_abc1" as SessionId;
const GRANT = "cap_grant1" as CapabilityId;
const ENDPOINT = "ws://127.0.0.1:6080/";

function win(id: string, sessionId: SessionId = SESS): Pick<HandoffWindow, "id" | "sessionId"> {
  return { id: id as HandoffWindow["id"], sessionId };
}

/** A stub edge: records mounted routes by id, so a test can assert reachability + force-close on unmount. */
class StubGateway implements RouteGatewayPort {
  readonly mounts = new Map<RouteId, RouteMount>();
  /** Route ids whose WS was force-closed on unmount (the gateway force-closes on revoke/unmount). */
  readonly forceClosed: RouteId[] = [];
  /** When set, the next `mount` throws (a programming failure). */
  failNextMount = false;

  async mount(route: RouteMount): Promise<void> {
    if (this.failNextMount) {
      this.failNextMount = false;
      throw new Error("edge refused to program the route");
    }
    this.mounts.set(route.routeId, route);
  }
  async unmount(routeId: RouteId): Promise<void> {
    if (this.mounts.delete(routeId)) {
      // Force-close the live WS bound to this route (the gateway does this on unmount/revoke).
      this.forceClosed.push(routeId);
    }
  }
  mountedRouteIds(): Set<RouteId> {
    return new Set(this.mounts.keys());
  }
  /** Is a path currently reachable on the edge? (Any mounted route exposing it.) */
  isReachable(path: string): boolean {
    return [...this.mounts.values()].some((m) => m.path === path);
  }
}

describe("RouteController.program — mounts a grant-bound route, reachable (GLA-033)", () => {
  it("program → the public path is reachable, the route is bound to the grant + the capsule endpoint", async () => {
    const gw = new StubGateway();
    const ctl = new RouteController({ gateway: gw });
    const route = await ctl.program(win("hand_1"), GRANT, ENDPOINT);

    expect(route.id).toMatch(/^route_/);
    expect(route.path).toBe(`/handoff/${SESS}`);
    expect(route.internalEndpoint).toBe(ENDPOINT);
    expect(route.boundGrantId).toBe(GRANT);
    // Reachable on the edge, bound to exactly one grant.
    expect(gw.isReachable(`/handoff/${SESS}`)).toBe(true);
    const mounted = gw.mounts.get(route.id);
    expect(mounted?.boundGrantId).toBe(GRANT);
    expect(mounted?.internalEndpoint).toBe(ENDPOINT);
    // The controller records it for the window (so the session can read it / reconcile).
    expect(ctl.routeFor("hand_1" as HandoffWindow["id"])?.id).toBe(route.id);
  });
});

describe("RouteController.unmount — makes the route unreachable + force-closes the WS (GLA-033)", () => {
  it("unmount → the path is no longer reachable and the WS bound to the route is force-closed", async () => {
    const gw = new StubGateway();
    const ctl = new RouteController({ gateway: gw });
    const route = await ctl.program(win("hand_1"), GRANT, ENDPOINT);
    expect(gw.isReachable(`/handoff/${SESS}`)).toBe(true);

    await ctl.unmount("hand_1" as HandoffWindow["id"]);
    expect(gw.isReachable(`/handoff/${SESS}`)).toBe(false);
    // The live WS bound to the route was force-closed (revoke/unmount).
    expect(gw.forceClosed).toContain(route.id);
    // The controller no longer records it.
    expect(ctl.routeFor("hand_1" as HandoffWindow["id"])).toBeUndefined();
  });

  it("unmount is idempotent — unmounting an unknown/already-unmounted window is a no-op", async () => {
    const gw = new StubGateway();
    const ctl = new RouteController({ gateway: gw });
    await ctl.program(win("hand_1"), GRANT, ENDPOINT);
    await ctl.unmount("hand_1" as HandoffWindow["id"]);
    // A second unmount does nothing (no throw, no extra force-close).
    const closedBefore = gw.forceClosed.length;
    await ctl.unmount("hand_1" as HandoffWindow["id"]);
    await ctl.unmount("hand_unknown" as HandoffWindow["id"]);
    expect(gw.forceClosed.length).toBe(closedBefore);
  });
});

describe("RouteController.program — a programming FAILURE leaves NO partial route (GLA-033 AC#4)", () => {
  it("on an edge mount failure → throws a TYPED dependency.unavailable and the edge holds NO route", async () => {
    const gw = new StubGateway();
    gw.failNextMount = true;
    const ctl = new RouteController({ gateway: gw });

    await expect(ctl.program(win("hand_1"), GRANT, ENDPOINT)).rejects.toMatchObject({
      code: "dependency.unavailable",
    });
    // NO PARTIAL ROUTE: the edge has nothing mounted, and the controller records nothing.
    expect(gw.mounts.size).toBe(0);
    expect(gw.isReachable(`/handoff/${SESS}`)).toBe(false);
    expect(ctl.routeFor("hand_1" as HandoffWindow["id"])).toBeUndefined();
  });

  it("after a failure, a RETRY starts clean and succeeds", async () => {
    const gw = new StubGateway();
    gw.failNextMount = true;
    const ctl = new RouteController({ gateway: gw });
    await expect(ctl.program(win("hand_1"), GRANT, ENDPOINT)).rejects.toBeDefined();
    // The retry: failNextMount has been consumed → it succeeds and the route is reachable.
    const route = await ctl.program(win("hand_1"), GRANT, ENDPOINT);
    expect(gw.isReachable(`/handoff/${SESS}`)).toBe(true);
    expect(gw.mounts.get(route.id)?.boundGrantId).toBe(GRANT);
  });
});

describe("RouteController.reconcile — converges the edge to Session truth (route-controller.md invariant)", () => {
  it("a route whose window is no longer open is UNMOUNTED (dangling removed, WS force-closed)", async () => {
    const gw = new StubGateway();
    const ctl = new RouteController({ gateway: gw });
    const r1 = await ctl.program(win("hand_1"), GRANT, ENDPOINT);
    const r2 = await ctl.program(win("hand_2", SESS), GRANT, ENDPOINT, `/handoff/${SESS}/2`);

    // Session truth: only hand_1 is still open. Reconcile must drop hand_2's route.
    const unmounted = await ctl.reconcile(new Set(["hand_1" as HandoffWindow["id"]]));
    expect(unmounted).toContain(r2.id);
    expect(gw.forceClosed).toContain(r2.id);
    expect(gw.mounts.has(r1.id)).toBe(true);
    expect(gw.mounts.has(r2.id)).toBe(false);
  });

  it("an edge route the controller has NO record of is removed (drift from a restart)", async () => {
    const gw = new StubGateway();
    const ctl = new RouteController({ gateway: gw });
    // Simulate a dangling edge route the controller never recorded (e.g. a restart lost its record).
    const orphanId = "route_orphan" as RouteId;
    gw.mounts.set(orphanId, {
      routeId: orphanId,
      path: "/handoff/ghost",
      internalEndpoint: ENDPOINT,
      boundGrantId: GRANT,
      sessionId: SESS,
    });
    const unmounted = await ctl.reconcile(new Set());
    expect(unmounted).toContain(orphanId);
    expect(gw.mounts.has(orphanId)).toBe(false);
  });
});

describe("RouteController — the edge seam is ABSTRACT (GLA-033 AC#5)", () => {
  it("the controller drives ANY RouteGatewayPort — a second, different gateway needs no controller change", async () => {
    // A completely different edge implementation (e.g. a Caddy adapter) — the controller is unchanged.
    class OtherGateway implements RouteGatewayPort {
      readonly programmed: string[] = [];
      async mount(route: RouteMount): Promise<void> {
        this.programmed.push(`${route.path}->${route.internalEndpoint}`);
      }
      async unmount(_routeId: RouteId): Promise<void> {}
      mountedRouteIds(): Set<RouteId> {
        return new Set();
      }
    }
    const other = new OtherGateway();
    const ctl = new RouteController({ gateway: other });
    await ctl.program(win("hand_1"), GRANT, ENDPOINT);
    expect(other.programmed).toEqual([`/handoff/${SESS}->${ENDPOINT}`]);
  });
});
