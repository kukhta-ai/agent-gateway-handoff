# GLA-087 Edge Guard Investigation

## Hand-off Brief

Current GLA treats authentik as an opt-in OIDC `AuthProviderPort`, not as the component that authorizes GLA handoff routes. The Access Gateway remains the public policy-enforcement point for enrollment, handoff pages, and WebSocket upgrades, while authentik only supplies identity/auth-strength facts. The design is mostly well layered and security-conscious, but GLA-087 is needed to remove deployment ambiguity around authentik proxy/forward-auth, diagnostics, and stale root-mounted wording after GLA-079.

## Evidence

- `packages/kernel/src/ports.ts:83` defines `AuthProviderPort`; comments state WebAuthn/authentik/OIDC are adapters that report facts, never access decisions.
- `packages/app/src/index.ts:107` documents the provider-selection seam; `packages/app/src/index.ts:158` wires either `AuthWebauthnProvider` or `AuthAuthentikProvider` behind the same port.
- `packages/app/src/index.ts:453` constructs one `AccessGateway` with capability grants plus identity step-up/enrollment seams, so the same gateway owns grant verification regardless of provider.
- `packages/gateway/src/index.ts:427` routes all public enrollment/handoff requests through the gateway; `packages/gateway/src/index.ts:600`, `packages/gateway/src/index.ts:654`, `packages/gateway/src/index.ts:696`, and `packages/gateway/src/index.ts:758` show grant verification before handoff page/options/verify/WS proxy.
- `adapters/auth-authentik/src/index.ts:1` states authentik is a delegated OIDC relying-party adapter behind `AuthProviderPort`; `adapters/auth-authentik/src/index.ts:343` consumes attempts one-time before network exchange; `adapters/auth-authentik/src/oidc.ts:308` validates signatures, issuer, audience, azp, time, nonce, and subject.
- `packages/gateway/src/handoff-page.ts:1` and `packages/gateway/src/enroll-page.ts:1` use a provider-agnostic `options.kind === "redirect"` branch, not authentik-specific page code.
- `docs/components/access-gateway.md:7` states the Access Gateway is the sole public entry and verifies capabilities on every request/upgrade.
- `docs/architecture/authentik-integration.md:290` splits authentik into runtime adapter code versus WPM installer concern; `docs/architecture/authentik-service-standup.md:204` requires OIDC redirect URI to land back on GLA's public origin.
- `docs/02-provider-and-extension-model.md:36` defines a uniform provider package model and `docs/02-provider-and-extension-model.md:121` requires derived availability via binding/probe.

## Findings

1. Confirmed: authentik is not currently modeled as the GLA edge authorization guard. It is an identity provider adapter; GLA still verifies handoff/enrollment grants and authorizes WS proxying.
2. Confirmed: the auth-provider seam is structurally extendable. Adding another provider should mean a new adapter implementing `AuthProviderPort` plus app composition and installer/binding work, not gateway/kernel changes.
3. Confirmed: safety posture is reasonable inside the current OIDC adapter: PKCE, state/nonce, one-time attempt consumption, id token validation, subject binding, method-to-strength mapping, and fail-closed gateway checks are present.
4. Deduced: authentik proxy/forward-auth can safely guard other upstream apps, but it cannot replace GLA grant verification for GLA handoff routes without changing the authorization model.
5. Gap: GLA-087 must clarify operator-facing deployment semantics and diagnostics. A deployment protected only by authentik proxy session but missing GLA's `GLA_AUTH_PROVIDER=authentik` or callback wiring will not satisfy the current code path.
6. Gap: GLA-087's current root-mounted/subpath wording is stale relative to the updated GLA-079 direction. The task should be revised to say "configured public base path" rather than root-only/no-subpath.

## Conclusion

The current codebase is well architected for delegated identity providers and mostly safe at the GLA boundary: authentik supplies identity facts, while GLA remains the handoff authorization point. It is extendable to other auth providers at the port/composition level, and the generic redirect page branch makes OIDC-like providers possible without provider-specific gateway code. The unsafe part is deployment misunderstanding: if operators expect authentik proxy/forward-auth to be the sole guard for GLA internals, the docs and diagnostics do not yet make the supported boundary obvious enough.
