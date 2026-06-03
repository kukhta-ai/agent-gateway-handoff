# Access Gateway

**Zone:** Edge / Worker
**Kind:** GLA component (traditional code)
**Scenario-01 lane:** Access Gateway

> The sole public entry. Every request a user makes transits it; it verifies a capability statelessly and proxies to a capsule — and nothing else is publicly reachable.

## Role

The Access Gateway is the user's policy-enforcement point and the only door open to the public internet. It verifies the grant on every request and every WebSocket upgrade, consults the revocation cache, and proxies authorized traffic to the capsule's human entrypoint. It is the membrane that lets a remote, unknown party reach exactly one scoped surface and nothing more.

## Responsibilities (owns)

- Verify the macaroon grant cryptographically on every request and WS upgrade (signature, recipient caveat, TTL, scope).
- Consult the revocation cache; force-close WebSockets when a grant is revoked.
- Trigger recipient step-up via Identity + Auth when `auth_strength` is insufficient.
- Proxy authorized traffic to the capsule's internal human-entrypoint endpoint.

## Interfaces

**Receives** — from the user (public HTTPS/WS) carrying a grant; route programming from the Route controller; the revocation cache from the Capability service; auth results from Identity + Auth.
**Produces** — proxied traffic to the capsule; deny/close to the user; "challenge required" hand-off to Identity + Auth.

## What it does NOT do

It does **not** mint or revoke capabilities (Capability service). It does **not** program its own routes (Route controller). It does **not** own authentication (Identity + Auth) — it *triggers* it. It does **not** verify the *agent* — that is the Bridge side.

## Entities & data

Grant capabilities (verified), `RevocationEntry` cache, `Route` (consumed).

## In scenario 01

Phase E (one-time) — fronts recipient enrollment: verifies the single-use `operator-discharge` enrollment grant the invite carries, then forwards the passkey-registration flow to Identity + Auth. Phase 6 — verify `grant-1`, find auth insufficient → trigger step-up, then authorize the WS upgrade and proxy the noVNC stream. Phase 12 — verify `grant-2`, reuse auth, proxy to the same capsule. Phases 8 / 13 — on revoke, force-close the WebSocket.

## Failure modes

A forwarded link (wrong recipient) fails the recipient caveat → denied. An expired grant → denied; window TTL-closed. Revocation-cache lag is bounded; a revoked-but-not-yet-propagated grant is the residual risk the cache size/TTL controls.

## Invariants

No public path bypasses it. Verification is cryptographic and, in the common case, free of a database round-trip. The recipient caveat is enforced on every request and every upgrade. A revoked grant cannot hold a live WebSocket open.

## Related

`capability-service.md` (grants + revocation), `route-controller.md` (route programming), `identity-and-auth.md` (step-up), `capsule.md` (the proxied target).
