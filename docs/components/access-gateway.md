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
- Trigger recipient step-up via Identity + Auth when the reported auth assurance is insufficient for the selected deployment policy.
- After authorization succeeds, proxy traffic using the route's reverse-proxy transport binding.

## Interfaces

**Receives** — from the user (public HTTPS/WS) carrying a grant; route-authorization and transport bindings from the Route controller; the revocation cache from the Capability service; auth results from Identity + Auth.
**Produces** — proxied traffic to the mounted entrypoint transport; deny/close to the user; "challenge required" hand-off to Identity + Auth.

## What it does NOT do

It does **not** mint or revoke capabilities (Capability service). It does **not** program its own routes (Route controller). It does **not** own authentication (Identity + Auth) — it *triggers* it. It does **not** verify the *agent* — that is the Bridge side.

It also does **not** delegate handoff authorization to an outer reverse proxy, including authentik proxy or
forward-auth. Such a proxy may be deployed as defense-in-depth before traffic reaches GLA, but proxy headers,
cookies, or an authentik browser session are not GLA grants and cannot satisfy the recipient caveat, route
scope, TTL/revocation, enrollment, or assurance checks the Access Gateway owns.

## Entities & data

Grant capabilities (verified), `RevocationEntry` cache, `Route` authorization state (path, grant, session/entrypoint resource), and a reverse-proxy transport binding (protocol + upstream).

## In scenario 01

Phase E (one-time) — fronts recipient enrollment: verifies the single-use `operator-discharge` enrollment grant the invite carries, then forwards the registration flow to Identity + Auth. Phase 6 — verify `grant-1`, find auth assurance insufficient for the deployment policy → trigger step-up, then authorize the upgrade and proxy through the mounted transport binding. Phase 12 — verify `grant-2`, reuse auth only if the retained assurance still satisfies the same policy, proxy to the same capsule entrypoint resource. Phases 8 / 13 — on revoke, force-close the live transport sockets.

## Failure modes

A forwarded link (wrong recipient) fails the recipient caveat → denied. An expired grant → denied; window TTL-closed. Password-grade or ambiguous provider evidence under the default `phishing-resistant` policy → denied with `auth.insufficient`; no silent fallback. Revocation-cache lag is bounded; a revoked-but-not-yet-propagated grant is the residual risk the cache size/TTL controls.

## Invariants

No public path bypasses it. Verification is cryptographic and, in the common case, free of a database round-trip. The recipient caveat is enforced on every request and every upgrade. A revoked grant cannot hold a live transport socket open. Auth decisions read only the provider-neutral assurance contract plus grant and recipient facts; gateway authorization never branches on raw provider method names such as `amr`/`acr` or concrete provider identities. Transport diagnostics must distinguish access-gateway authorization failures from reverse-proxy transport failures and provider entrypoint failures.

## Related

`capability-service.md` (grants + revocation), `route-controller.md` (route programming), `identity-and-auth.md` (step-up), `capsule.md` (the proxied target).
