# Capability service

**Zone:** Control plane
**Kind:** GLA component (traditional code)
**Scenario-01 lane:** Capability svc

> The one place capabilities are minted, attenuated, verified, and revoked — the single authorization primitive that lets the edge stay stateless and the mental model stay small.

## Role

Every authorization in GLA is one kind of thing: a signed bearer credential with HMAC-chained caveats. The Capability service is its factory and registrar. It mints the six classes, attenuates them down the chain, verifies them, owns the signing keys (with rotation), and maintains the revocation cache it pushes to the edge verifiers. One verifier shape, one mental model, distributed verification, central revocation.

## Responsibilities (owns)

- Mint, attenuate, verify, and revoke capabilities of all six classes.
- Own and rotate signing keys.
- Maintain the revocation cache and push it to verifiers (notably the Access Gateway).

## Interfaces

**Receives** — mint/attenuate/revoke requests from the Bridge (agent-authority), Task (`task`), Session (grant), Secret handling (`secret-ref`), Channel (`channel-delegation`).
**Produces** — minted capabilities back to the requester; the revocation cache to verifiers.

## What it does NOT do

It does **not** decide policy (Admission/Cedar) or authenticate principals (Identity + Auth). It mints what it is *asked* to, scoped by caveats; the *decision* to ask is upstream. A recipient-bound grant presupposes the recipient was **enrolled** in Identity + Auth — Capability binds to that identity, it does not establish it.

## Entities & data

`Capability` (class ∈ {agent-authority, task, session, secret-ref, channel-delegation, operator-discharge}; identifier; caveats[]; signature; parent ref). `RevocationEntry`. Signing keys.

## In scenario 01

Phase E — a single-use `operator-discharge` enrollment grant authorizes the one-time recipient enrollment. Phase 1 — `agent-authority`. Phase 2 — `task`. Phase 3 — `agent-connector`. Phases 5 / 11 — `grant-1` / `grant-2` (recipient-bound, short TTL). Phases 8 / 13 / 15 — revocations.

## Failure modes

Key compromise → rotate keys, mass-revoke (the kill-switch). Revocation-cache propagation lag is bounded by cache size/TTL. A forged capability fails signature verification at the edge.

## Invariants

One verifier shape across all classes. Caveats only ever *attenuate* — a child can never be broader than its parent. Revocation propagates to every verifier. The agent receives capability *references*, never raw signing material.

## Related

`access-gateway.md` (verifies grants), `session-service.md` / `task-service.md` (request mints), `identity-and-auth.md` (authn ≠ this), `admission-and-policy.md` (the decision upstream).
