# Route controller

**Zone:** Control plane
**Kind:** GLA component (traditional code)
**Scenario-01 lane:** Route ctrl

> Programs the Access Gateway: it mounts a route to a capsule when a handoff window opens, unmounts it when the window closes, and reconciles the gateway against session state.

## Role

The Route controller is the bridge between session intent and the public edge. When the Session service opens a window, the Route controller programs a gateway route bound to that window's grant; when the window closes or the grant is revoked, it unmounts the route and forces the connection closed. It also periodically reconciles the gateway's routes against the Session service's truth, so a missed message can't leave a route dangling.

## Responsibilities (owns)

- Mount/unmount routes on the Access Gateway per session/window lifecycle, each bound to a specific grant.
- Force-close WebSockets on revoke.
- Periodically reconcile programmed routes against Session state.

## Interfaces

**Receives** — from the Session service: mount/unmount for a session window + the grant to bind.
**Produces** — to the Access Gateway: route programming and close commands.

## What it does NOT do

It does **not** verify requests (the Gateway does) or mint grants (Capability). It does **not** decide when a window opens (Session). It programs, it does not judge.

## Entities & data

`Route` ({ path, internal_endpoint }), bound to a grant capability id.

## In scenario 01

Phases 5 / 11 — mounts the route to the capsule entrypoint, bound to `grant-1` / `grant-2`. Phases 8 / 13 — unmounts and triggers force-close on revoke.

## Failure modes

A gateway programming failure is surfaced and retried; the reconciler is the backstop that converges routes to the intended set, catching drift from missed events or restarts.

## Invariants

A route exists only while its window is open. A route is bound to exactly one grant. Reconciliation makes the gateway's routes converge to the Session service's state (this is one of the few reconcilers the design keeps).

## Related

`session-service.md` (drives it), `access-gateway.md` (the thing it programs), `capability-service.md` (the grant a route is bound to).
