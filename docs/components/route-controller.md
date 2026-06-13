# Route controller

**Zone:** Control plane
**Kind:** GLA component (traditional code)
**Scenario-01 lane:** Route ctrl

> Programs the Access Gateway: it mounts a route to a capsule when a handoff window opens, unmounts it when the window closes, and reconciles the gateway against session state.

## Role

The Route controller is the bridge between session intent and the public edge. When the Session service opens a window, the Route controller programs a gateway route bound to that window's grant; when the window closes or the grant is revoked, it unmounts the route and forces the connection closed. It also periodically reconciles the gateway's routes against the Session service's truth, so a missed message can't leave a route dangling.

Route programming carries two separate payloads: **route authorization** (`path`, `grant`, `session`, `entrypointResourceId`) and **reverse-proxy transport** (`protocol`, upstream locator, browser-client asset metadata). The controller owns the first as session intent; the gateway/transport layer owns the second as upstream reachability. Diagnostics name the layer that failed.

## Responsibilities (owns)

- Mount/unmount authorization routes on the Access Gateway per session/window lifecycle, each bound to a specific grant and entrypoint resource id.
- Pass the selected human-entrypoint transport binding to the gateway without interpreting provider-specific upstream data.
- Force-close WebSockets on revoke.
- Periodically reconcile programmed routes against Session state.

## Interfaces

**Receives** — from the Session service: mount/unmount for a session window + the grant to bind + a provider-neutral human-entrypoint binding.
**Produces** — to the Access Gateway: route authorization state, reverse-proxy transport binding, and close commands.

## What it does NOT do

It does **not** verify requests (the Gateway does) or mint grants (Capability). It does **not** decide when a window opens (Session). It programs, it does not judge.

## Entities & data

`Route` ({ path, entrypoint_resource_id, client, transport }), bound to a grant capability id. `transport` is not an authorization decision; it is the upstream programming input for the edge transport layer.

## In scenario 01

Phases 5 / 11 — mounts the authorization route to the capsule entrypoint resource, bound to `grant-1` / `grant-2`, and passes the entrypoint's transport binding to the gateway. Phases 8 / 13 — unmounts and triggers force-close on revoke.

## Failure modes

A gateway programming failure is surfaced and retried; the error detail identifies `access-gateway-authorization-route` versus `reverse-proxy-transport` where possible. The reconciler is the backstop that converges routes to the intended set, catching drift from missed events or restarts.

## Invariants

A route exists only while its window is open. A route is bound to exactly one grant. Reconciliation makes the gateway's routes converge to the Session service's state (this is one of the few reconcilers the design keeps).

## Related

`session-service.md` (drives it), `access-gateway.md` (the thing it programs), `capability-service.md` (the grant a route is bound to).
