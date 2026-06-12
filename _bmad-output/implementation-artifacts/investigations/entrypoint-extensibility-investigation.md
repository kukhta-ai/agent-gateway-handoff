# Investigation: Human Entrypoint Extensibility

## Hand-off Brief

1. **What happened.** The user asked whether the app already has an extensible way to integrate new human-entrypoint technology, and what a developer must do to add one.
2. **Where the case stands.** Complete. The repo has a real architectural seam for human entrypoints, but the current app composition is still hard-wired to noVNC.
3. **What's needed next.** If true provider extensibility is desired before adding more human-view tech, add an app-level entrypoint provider registry and a provider-neutral client/proxy contract.

## Case Info

| Field | Value |
| --- | --- |
| Ticket | N/A |
| Date opened | 2026-06-12 |
| Status | Complete |
| System | Local repo investigation on `feature/authentik` |
| Evidence sources | Docs and source code in `/workspace/active/agent-gateway-handoff` |

## Problem Statement

Is there already an extensible way in the app to integrate new human-entrypoint technology, given that noVNC is only one possible provider at that layer? What would a developer need to do to add support for another entrypoint provider?

## Evidence Inventory

| Source | Status | Notes |
| --- | --- | --- |
| Architecture docs | Available | Dependency strategy, provider model, capsule, gateway, worker-plane. |
| Kernel ports | Complete | `HumanEntrypointPort.open(runtime) -> { internalEndpoint }`; runtime descriptor currently has noVNC-specific `novncEndpoint`. |
| Catalog/assembly | Complete | `entrypoint` is an open part in the template model, and CLI/admission can carry/validate overrides. |
| Runtime wiring | Complete | `packages/app` constructs exactly one concrete entrypoint adapter: `EntrypointNovncAdapter`. |
| Existing noVNC adapter | Complete | The adapter reads `runtime.novncEndpoint` and returns it as the gateway upstream. |
| Gateway/page | Complete | Access gateway/page are WebSocket/noVNC-shaped today, not a general human-entrypoint client host. |

## Investigation Backlog

| # | Path to Explore | Priority | Status | Notes |
| - | --- | --- | --- | --- |
| 1 | Identify the formal human-entrypoint port and its return contract. | High | Done | `packages/kernel/src/ports.ts` defines the intended seam. |
| 2 | Trace whether catalog/admission can select entrypoint providers dynamically. | High | Done | Selection metadata exists, but currently only `entrypoint-novnc` is listed as compatible. |
| 3 | Trace app composition to see whether selected providers are actually instantiated. | High | Done | Runtime instantiation is hard-coded to noVNC. |
| 4 | Summarize developer steps to add a new provider. | High | Done | See conclusion and recommended next steps. |

## Timeline of Events

| Time | Event | Source | Confidence |
| --- | --- | --- | --- |
| 2026-06-12 | User requested investigation of entrypoint extensibility. | Conversation | Confirmed |
| 2026-06-12 | Kernel seam found: `HumanEntrypointPort.open(RuntimeHandle)` returns an internal endpoint. | `packages/kernel/src/ports.ts` | Confirmed |
| 2026-06-12 | Catalog/template model found: `entrypoint` is an open part and can be overridden in proposals. | `packages/catalog/src/manifests.ts`, `packages/assembly/src/index.ts`, `packages/admission/src/index.ts`, `surfaces/cli/src/cli.ts` | Confirmed |
| 2026-06-12 | Runtime hard-code found: app imports and constructs `EntrypointNovncAdapter` directly. | `packages/app/src/index.ts` | Confirmed |
| 2026-06-12 | Protocol/client hard-code found: gateway/page open and proxy raw WebSocket streams to the internal endpoint. | `packages/gateway/src/index.ts`, `packages/gateway/src/handoff-page.ts` | Confirmed |

## Confirmed Findings

1. The design intends human entrypoints to be provider-extensible. `docs/components/capsule.md` defines a capsule as one or more Human Entrypoints plus an Agent Connector over shared state, and names noVNC, forms, and document editors as examples. `docs/architecture/dependency-strategy.md` classifies noVNC/websockify/VNC/Xvfb as the reference human-view layer and explicitly lists KasmVNC, Guacamole, and Xpra as alternatives behind `HumanEntrypointPort`.
2. The formal kernel seam exists. `packages/kernel/src/ports.ts` defines `HumanEntrypointPort.open(h: RuntimeHandle): Promise<{ internalEndpoint: string }>` and the session uses only a smaller injected `HandoffEntrypointPort`.
3. The catalog and assembly layers can describe and validate an entrypoint choice. `BROWSER_HANDOFF_TEMPLATE` has `openParts: ["entrypoint", "connector", "detector"]`; CLI supports repeatable `--entrypoint`; admission rejects incompatible providers through `compatibleProviders`.
4. The in-tree catalog currently registers only one compatible human entrypoint: `entrypoint-novnc`. `BROWSER_HANDOFF_TEMPLATE.compatibleProviders.entrypoint` contains only `entrypoint-novnc`, so a second provider would also need catalog/template relation changes.
5. The app does not yet instantiate entrypoints registry-driven. `packages/app/src/index.ts` imports `EntrypointNovncAdapter`, constructs `new EntrypointNovncAdapter()`, exposes it in `ProvisioningStack`, and passes it into handoff. There is no `EntrypointRegistry` equivalent to `SpawnerRegistry`, and no dispatch from `ResolvedAssemblySpec.spec.entrypoints[].use` to a provider implementation.
6. The runtime descriptor is noVNC-shaped. `RuntimeDescriptor` has `novncEndpoint?: string`, and `LauncherProcessAdapter` starts Xvfb, x11vnc, and websockify, then stores `novncEndpoint` in the runtime handle. A new provider that needs a different endpoint shape has no generic runtime contract today.
7. The gateway/page surface is also WebSocket/noVNC-shaped. `AccessGateway.handleUpgrade` only proxies WebSocket upgrades; `handoff-page.ts` opens `new WebSocket(...)` after auth. That is compatible with the current noVNC stream but not with entrypoints that require an HTTP reverse proxy, provider-owned web client, iframe, or non-WS transport.

## Deduced Conclusions

The app has a partial extension mechanism, not a complete one.

What is already extendable:

- Core/session/capability code is isolated from concrete entrypoint adapters.
- Catalog/admission/assembly understand an `entrypoint` part and can validate compatible provider names.
- Route programming carries an opaque `internalEndpoint` string instead of naming noVNC in the route model.

What is not yet extendable:

- Runtime app composition does not resolve entrypoint providers by selected provider name.
- The only in-tree provider is `entrypoint-novnc`.
- The runtime handle and launcher full-mode path are tied to `novncEndpoint`.
- The browser handoff page and gateway proxy assume a WebSocket stream.

Therefore a developer cannot currently "drop in a provider package" and have it usable end-to-end. They must add the adapter plus change composition, catalog/template compatibility, and likely the launcher/gateway/client contract.

## Hypothesized Paths

### Hypothesis 1: The architecture defines a provider seam, but app composition is still hard-coded to noVNC.

**Status:** Confirmed

**Theory:** Docs and catalog may model `HumanEntrypointPort` as pluggable, but `packages/app` may instantiate only `EntrypointNovncAdapter`.

**Supporting indicators:** Earlier GLA-077 review found noVNC is referenced as current provider and the app wires `entrypoint-novnc`.

**Would confirm:** Source evidence showing `HumanEntrypointPort` exists but `createProvisioningBridge` always constructs `EntrypointNovncAdapter` except tests.

**Would refute:** Source evidence showing runtime provider registry loads selected entrypoint provider from catalog/assembly.

**Resolution:** Confirmed. The inner port is present, but provider selection is not wired through app composition.

## Missing Evidence

| Gap | Impact | How to Obtain |
| --- | --- | --- |
| Dynamic provider loading path, if any | None found | No entrypoint registry or selected-provider dispatch was found. |
| Provider-neutral runtime endpoint shape | Missing | Current runtime descriptor exposes `novncEndpoint`, not a generic human-entrypoint map. |
| Provider-neutral browser client/proxy contract | Missing | Current handoff page and gateway implement WebSocket stream proxy behavior. |

## Source Code Trace

1. Docs:
   - `docs/02-provider-and-extension-model.md` says providers should self-describe and register into registries; the target property is adding a capability by package, not core edits.
   - `docs/components/capsule.md` says a capsule may expose one or more human entrypoints and names noVNC/form/doc-editor as examples.
   - `docs/architecture/dependency-strategy.md` says noVNC is the current D2 candidate, with KasmVNC/Guacamole/Xpra as alternatives behind `HumanEntrypointPort`.
   - `docs/architecture/slice-4b-handoff.md` and `slice-5-completion.md` say alternate human view surfaces should sit behind the port and not require session/connector core edits.

2. Kernel/session seam:
   - `packages/kernel/src/ports.ts` defines `HumanEntrypointPort`.
   - `packages/session/src/index.ts` defines `HandoffEntrypointPort` and uses it at handoff open: `entrypoint.open(session.runtime)`, then `route.program(..., entry.internalEndpoint, ...)`.

3. Catalog/assembly/admission:
   - `packages/catalog/src/manifests.ts` registers provider manifest `entrypoint-novnc` with kind `HumanEntrypoint`.
   - The `browser-handoff` template default entrypoint is `entrypoint-novnc`; `entrypoint` is open, but compatible providers currently list only `entrypoint-novnc`.
   - `packages/assembly/src/index.ts` carries `proposal.entrypoints` into the resolved spec.
   - `packages/admission/src/index.ts` validates open-part overrides against `compatibleProviders`.
   - `surfaces/cli/src/cli.ts` supports repeatable `--entrypoint` flags.

4. App/runtime wiring:
   - `packages/app/src/index.ts` imports `EntrypointNovncAdapter`, constructs it directly, and passes `h.entrypoint ?? entrypoint` to handoff.
   - `packages/worker/src/index.ts` has a real launcher registry, but there is no matching entrypoint registry in app/session/worker.

5. Current noVNC provider:
   - `adapters/entrypoint-novnc/src/index.ts` implements `HumanEntrypointPort`, decodes the runtime handle, reads `novncEndpoint`, and returns it.
   - `adapters/launcher-process/src/index.ts` creates that endpoint by starting Xvfb, x11vnc, and websockify.

6. Gateway/browser client:
   - `packages/route/src/index.ts` stores `internalEndpoint` generically.
   - `packages/gateway/src/index.ts` parses the endpoint as a WebSocket endpoint and proxies the upgrade.
   - `packages/gateway/src/handoff-page.ts` opens a WebSocket to the route path; it does not render a provider-specific web client.

## Conclusion

**Confidence:** High

There is an architectural and type-level seam for human entrypoints, but not a complete end-to-end extension mechanism in the app today.

To add a new entrypoint today, a developer must:

1. Create an adapter package, e.g. `adapters/entrypoint-<tech>`, implementing `HumanEntrypointPort`.
2. Decide how the launcher exposes the provider's internal endpoint in `RuntimeHandle`; today this likely requires extending `RuntimeDescriptor` beyond `novncEndpoint`.
3. Add provider manifest/catalog data with kind `HumanEntrypoint`, dependency requirements, probe, config schema, skills, and relations.
4. Add or update a `wpm` dependency binding/bundle if the provider requires host software.
5. Update the `browser-handoff` template or create a new template so the provider is compatible/selectable.
6. Wire the adapter into `packages/app` manually, because no entrypoint registry exists yet.
7. If the provider is not a raw WebSocket stream, extend the gateway/client contract so the handoff page can load the correct provider client and the edge can proxy the right protocol.
8. Add contract tests for the adapter and E2E tests proving grant enforcement, agent-blind input, unavailable-state behavior, and reused-auth behavior.

## Recommended Next Steps

### Fix direction

Add a backlog item before or alongside GLA-077 if the project wants true entrypoint extensibility:

- Introduce an app-level `HumanEntrypointRegistry` mapping provider names to `HumanEntrypointPort` implementations.
- Resolve the active entrypoint from the admitted/resolved assembly spec, not from a hard-coded default.
- Replace `RuntimeDescriptor.novncEndpoint` as the only shared entrypoint field with a provider-neutral endpoint descriptor, for example a keyed map of human entrypoint endpoints.
- Define a provider-neutral handoff client/proxy contract: endpoint protocol, client assets/HTML ownership, route behavior, and unsupported protocol outcomes.
- Keep noVNC as the reference provider and ensure GLA-077 does not deepen noVNC coupling in session/capability/auth/core packages.

### Diagnostic

For any proposed new entrypoint provider, run this trace before implementation:

1. Can the provider be represented as a `HumanEntrypoint` manifest with declared dependencies and probe?
2. Can the launcher produce the endpoint data without adapter-to-adapter imports?
3. Can the app map the selected provider name to an implementation?
4. Can the gateway authorize and proxy the provider's transport without widening grant semantics?
5. Can the browser page load the provider's client without hard-coding the provider in core?

## Reproduction Plan

For exploration, the verification plan is to define a hypothetical second entrypoint provider and trace where it would need to register, be selected, be instantiated, and return an endpoint to the gateway.

## Side Findings

GLA-077's architecture DoD is correctly scoped: noVNC must remain a provider, not the layer. However, GLA-077 alone may not be enough if it only installs a real noVNC browser client. The missing extensibility pieces are a separate architectural concern unless GLA-077 explicitly includes them.
