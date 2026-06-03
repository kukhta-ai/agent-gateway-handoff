// @gla/route — core ring (baseline §1, components/route-controller.md, GLA-033).
// The Route controller: the bridge between session intent and the public edge. When the Session service opens a
// handoff window it `program`s a gateway route bound to that window's grant; when the window closes (or the grant
// is revoked) it `unmount`s the route and forces the connection closed; and it `reconcile`s programmed routes
// against Session truth so a missed message can't leave a route dangling (one of the few reconcilers the design
// keeps — route-controller.md invariants).
//
// It PROGRAMS; it does not JUDGE (route-controller.md "What it does NOT do"): it does not verify requests (the
// gateway does), mint grants (Capability), or decide when a window opens (Session). A `program` failure surfaces a
// TYPED error and leaves NO partial route (GLA-033 AC#4) — partial programming is rolled back so the gateway never
// holds a half-mounted route bound to a grant that the session does not believe is live.
//
// The EDGE SEAM is ABSTRACT (GLA-033 AC#5): the controller talks to a {@link RouteGatewayPort} — GLA's own Access
// Gateway in dev, or a reverse-proxy dependency (Caddy, the hermes-1 host edge — dependency-strategy.md §4 D5,
// GLA-010) satisfies the SAME port with NO session/route-code change. The reverse-proxy is transport; grant
// VERIFICATION stays in the Access Gateway (the authorization PEP), so a different proxy changes no authorization.
//
// Boundary (core ring): depends ONLY on @gla/kernel. The gateway/edge is injected as a kernel-port-shaped
// interface (defined here as the minimal shape route programming needs), so the route controller never names a
// concrete gateway/proxy — `app` wires the real Access Gateway (or a Caddy adapter).

import {
  type CapabilityId,
  type HandoffWindow,
  type Route,
  type RouteId,
  type SessionId,
  glaError,
} from "@gla/kernel";

/** Stable identifier for this module, used by the `app` composition root's wiring record. */
export const ROUTE_MODULE = "@gla/route" as const;

/** Ring classification from the architecture baseline (informational). */
export const ROUTE_RING = "core" as const;

/**
 * A request to mount one grant-bound route on the edge (what {@link RouteGatewayPort.mount} consumes). The edge
 * exposes `path` publicly and proxies an authorized request to `internalEndpoint` (the capsule's human-entrypoint
 * address). A route is bound to EXACTLY one grant (`boundGrantId`); the edge force-closes its live WS on revoke.
 */
export interface RouteMount {
  /** The route id (so unmount/force-close target exactly this route). */
  routeId: RouteId;
  /** The public path the edge exposes (the handoff link path). */
  path: string;
  /** The capsule's internal human-entrypoint address the edge proxies an authorized request to. */
  internalEndpoint: string;
  /** The grant this route is bound to (a route binds to exactly one grant — route-controller.md invariant). */
  boundGrantId: CapabilityId;
  /** The session this route serves (so the edge can reconcile / scope force-close by session). */
  sessionId: SessionId;
}

/**
 * The ABSTRACT edge seam the Route controller programs (GLA-033 AC#5). GLA's own Access Gateway satisfies it; a
 * reverse-proxy dependency (Caddy — dependency-strategy.md §4 D5, GLA-010) satisfies the SAME shape with no
 * session/route-code change. The controller depends only on this port — it never names a concrete gateway/proxy.
 *
 * Guarantees a contract-test enforces:
 *  - `mount` makes the route's path reachable; `unmount` makes it unreachable (and force-closes any live WS).
 *  - `mount` is reject-or-nothing from the controller's view: on failure the controller rolls back so NO partial
 *    route survives (GLA-033 AC#4).
 *  - `mountedRouteIds()` is the edge's truth the reconciler converges to the Session service's truth.
 */
export interface RouteGatewayPort {
  /** Mount a grant-bound route. Throws (any error) if the edge cannot program it — the controller rolls back. */
  mount(route: RouteMount): Promise<void>;
  /** Unmount a route by id, force-closing any live WS bound to it (idempotent — a no-op if not mounted). */
  unmount(routeId: RouteId): Promise<void>;
  /** The set of route ids currently programmed on the edge (the reconciler's view of edge truth). */
  mountedRouteIds(): Set<RouteId>;
}

/** Options for {@link RouteController}. */
export interface RouteControllerOptions {
  /** The abstract edge the controller programs (GLA's Access Gateway in dev, a Caddy adapter in hermes-1). */
  gateway: RouteGatewayPort;
  /** Route-id generator (injectable for deterministic tests). */
  newRouteId?: () => RouteId;
}

let routeCounter = 0;
function defaultRouteId(): RouteId {
  routeCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `route_${rand}${routeCounter.toString(36)}`;
}

/**
 * The Route controller (components/route-controller.md). It mounts/unmounts grant-bound routes on the abstract
 * edge per the Session service's window lifecycle, force-closes WebSockets on revoke (via the edge's `unmount`),
 * and reconciles the edge's routes against Session truth. It PROGRAMS; it does not judge (the gateway verifies, the
 * Capability service mints, the Session service decides when a window opens).
 */
export class RouteController {
  private readonly gateway: RouteGatewayPort;
  private readonly newRouteId: () => RouteId;
  /** The controller's record of intended routes, keyed by handoff-window id (the reconciler's "intended" set). */
  private readonly programmed = new Map<HandoffWindow["id"], Route & { sessionId: SessionId }>();

  constructor(opts: RouteControllerOptions) {
    this.gateway = opts.gateway;
    this.newRouteId = opts.newRouteId ?? defaultRouteId;
  }

  /**
   * Program a grant-bound route for an opening handoff window (GLA-033). Builds the {@link Route} (a fresh route
   * id, the public `path`, the capsule's `internalEndpoint`, bound to the window's `grantId`), then mounts it on
   * the edge. **No partial route (GLA-033 AC#4):** if the edge `mount` throws, the controller best-effort unmounts
   * (rolls back any partial programming) and rethrows a TYPED `dependency.unavailable` — the gateway is left with
   * NO route for this window, and the controller records none, so a retry starts clean.
   *
   * @param window           the opening window (its id keys the controller's record; its grant binds the route)
   * @param grantId          the grant capability id the route binds to (the window's recipient-bound grant)
   * @param capsuleEntrypoint the capsule's internal human-entrypoint address the edge proxies to
   * @param path             the public path the edge exposes (defaults to the window's scope `/handoff/<sessionId>`)
   * @returns the programmed {@link Route} (so the session can pin it on the aggregate)
   * @throws GlaErrorException (`dependency.unavailable`) on an edge programming failure — NO partial route remains.
   */
  async program(
    window: Pick<HandoffWindow, "id" | "sessionId">,
    grantId: CapabilityId,
    capsuleEntrypoint: string,
    path?: string,
  ): Promise<Route> {
    const routeId = this.newRouteId();
    const publicPath = path ?? `/handoff/${window.sessionId}`;
    const route: Route = {
      id: routeId,
      path: publicPath,
      internalEndpoint: capsuleEntrypoint,
      boundGrantId: grantId,
    };
    const mount: RouteMount = {
      routeId,
      path: publicPath,
      internalEndpoint: capsuleEntrypoint,
      boundGrantId: grantId,
      sessionId: window.sessionId,
    };
    try {
      await this.gateway.mount(mount);
    } catch (e) {
      // NO PARTIAL ROUTE (GLA-033 AC#4): roll back any partial programming, record nothing, and surface a
      // TYPED error. A best-effort unmount converges the edge even if mount partially applied.
      try {
        await this.gateway.unmount(routeId);
      } catch {
        // The rollback is best-effort; the reconciler is the backstop that converges edge truth.
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw glaError("dependency.unavailable", `route programming failed: ${msg}`, {
        detail: { window: window.id, session: window.sessionId, cause: msg },
      });
    }
    this.programmed.set(window.id, { ...route, sessionId: window.sessionId });
    return route;
  }

  /**
   * Unmount a window's route (GLA-033, route-controller.md "Phases 8/13 — unmounts and triggers force-close on
   * revoke"). Tells the edge to remove the route AND force-close any live WS bound to it, then drops the
   * controller's record. **Idempotent + restart-safe:** unmounting an unknown window is a no-op (the record is
   * dropped FIRST so a re-entrant unmount sees it gone); the edge `unmount` is itself idempotent.
   */
  async unmount(windowId: HandoffWindow["id"]): Promise<void> {
    const route = this.programmed.get(windowId);
    if (route === undefined) {
      return; // already unmounted / never programmed — idempotent no-op.
    }
    // Drop the intended-record FIRST so a re-entrant unmount (or a reconcile) sees it gone (convergence).
    this.programmed.delete(windowId);
    await this.gateway.unmount(route.id);
  }

  /** The route currently programmed for a window (so the session can read its id/path), or undefined. */
  routeFor(windowId: HandoffWindow["id"]): Route | undefined {
    const r = this.programmed.get(windowId);
    if (r === undefined) {
      return undefined;
    }
    return {
      id: r.id,
      path: r.path,
      internalEndpoint: r.internalEndpoint,
      boundGrantId: r.boundGrantId,
    };
  }

  /**
   * Reconcile the edge's programmed routes against the Session service's truth (route-controller.md invariant: the
   * reconciler converges the gateway's routes to the Session service's state). Given the set of window ids that
   * SHOULD currently be open (per Session truth), it:
   *   - UNMOUNTS any edge route whose window is no longer open (drift from a missed unmount / a restart);
   * Mounting missing routes is the open-window saga's job (it has the grant + endpoint); the reconciler's role is
   * to remove DANGLING routes so a revoked/closed window can't leave a route holding a connection open. Returns the
   * route ids it unmounted (for observability/audit).
   *
   * @param openWindowIds the window ids the Session service believes are currently open (the intended set)
   */
  async reconcile(openWindowIds: ReadonlySet<HandoffWindow["id"]>): Promise<RouteId[]> {
    const unmounted: RouteId[] = [];
    // Remove any controller-recorded route whose window is no longer supposed to be open (dangling).
    for (const [windowId, route] of [...this.programmed.entries()]) {
      if (!openWindowIds.has(windowId)) {
        this.programmed.delete(windowId);
        await this.gateway.unmount(route.id);
        unmounted.push(route.id);
      }
    }
    // Also remove any edge route the controller has NO record of (e.g. a restart lost the record) — converge to
    // the controller's intended set, which is itself reconciled to Session truth above.
    const intendedRouteIds = new Set([...this.programmed.values()].map((r) => r.id));
    for (const routeId of this.gateway.mountedRouteIds()) {
      if (!intendedRouteIds.has(routeId)) {
        await this.gateway.unmount(routeId);
        unmounted.push(routeId);
      }
    }
    return unmounted;
  }
}
