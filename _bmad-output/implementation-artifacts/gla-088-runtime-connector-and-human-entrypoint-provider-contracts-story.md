---
baseline_commit: c6fbf043c356d3c11e359add0089eec4a6d59532
---

# GLA-088 - Runtime Connector and Human Entrypoint Provider Contracts

Status: done

## BMAD Workflow Evidence

- Skill invoked: `bmad-create-story`
- Skill files read: `/home/agent/.codex/skills/bmad-create-story/SKILL.md`, `discover-inputs.md`, `template.md`, `checklist.md`
- Workflow mode: spec-exists/docs-driven fallback
- Fallback reason: `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent, and this repository treats Backlog.md tasks as the authoritative story source.
- Story contract source: `backlog task GLA-088 --plain`
- Scope for this pass: create/update this story artifact only. No code, backlog, `.bmad` state, or git changes.

## Story

As the GLA runtime architecture,
I want runtime connector and human entrypoint contracts to be provider-neutral,
so future Agent Connector and Human Entrypoint providers can be added without encoding CDP/noVNC assumptions into kernel, session, gateway, route, worker, capability, or auth core logic.

## Observable Contract

The following acceptance criteria are copied from Backlog.md and remain the source contract:

1. Runtime handles expose provider-neutral endpoint descriptors for agent connectors and human entrypoints without CDP or noVNC field names in kernel contract.
2. Session lifecycle, bind, unbind, reuse, teardown identify connector and entrypoint resources through provider-neutral resource identities rather than CDP URLs or noVNC endpoint shapes.
3. Access Gateway authorization and route registration can represent HumanEntrypoint providers with different browser-client asset and transport requirements while preserving identical grant/recipient enforcement outcomes.
4. Reverse-proxy transport programming and Access Gateway authorization route programming are distinct boundaries, and diagnostics show which layer owns a route failure.
5. Missing/unresolved provider workspace state fails closed with actionable diagnostic instead of silently falling back to provider-specific default workspace.
6. Existing CDP/noVNC providers remain behaviorally compatible through adapter-owned mappings, and import-boundary tests prevent provider-specific runtime fields from re-entering kernel/session/capability/auth logic.

## Definition Of Done Emphasis

- DoD #7 requires architecture docs to be updated for the new seams, not just code.
- DoD #8 requires boundary tests with a fake non-CDP connector and a fake non-noVNC human-entrypoint provider without kernel/session/capability/auth edits.
- Core quality gate remains required: typecheck, lint/format, tests, public type docs, no dead code, and import-boundary preservation.

## Tasks/Subtasks

- [x] Define provider-neutral runtime endpoint descriptors in the kernel and keep provider-specific endpoint fields out of the kernel runtime contract.
- [x] Move session connector binding, reuse, teardown, and compensation ownership from CDP URLs to provider-neutral connector resource identities.
- [x] Generalize human-entrypoint contracts so entrypoints return resource identity, client binding, and transport binding instead of a noVNC-shaped internal endpoint.
- [x] Split authorization route registration from reverse-proxy transport programming and expose diagnostics for the owning failure layer.
- [x] Remove provider-specific default workspace fallback from worker/launcher realization and fail closed with typed actionable diagnostics.
- [x] Preserve CDP/noVNC behavior through adapter-owned mappings and compatibility tests.
- [x] Update architecture docs for provider-neutral runtime endpoint, connector-resource, human-entrypoint, route-authorization, and reverse-proxy transport seams.
- [x] Add boundary and fake-provider tests proving non-CDP/non-noVNC providers pass through core contracts without kernel/session/capability/auth edits.

## Current Behavior Model

- `packages/kernel/src/runtime-handle.ts` currently exposes `RuntimeDescriptor.cdpWebSocketUrl` and `RuntimeDescriptor.novncEndpoint`, which makes the kernel contract name concrete provider realizations.
- `packages/kernel/src/ports.ts` currently models `HumanEntrypointPort.open()` as returning `{ internalEndpoint }` and `AgentConnector` as `type`, `cdp_url`, `path`, and `secret_ref`, so the port surface still leaks concrete CDP/noVNC shapes.
- `packages/kernel/src/entities.ts` models routes around `internalEndpoint`, which conflates the public authorization route with the upstream transport target.
- `packages/session/src/index.ts` stores and tears down provisioned connector state by `cdpUrl`; `bindSecretRef`, `unbindSecretRef`, completion suspend/resume, and teardown plumbing therefore key lifecycle ownership to a CDP URL instead of a provider-neutral connector resource identity.
- `packages/gateway/src/index.ts` correctly owns grant/recipient checks for handoff/enrollment/callback traffic, but the reverse proxy path currently parses and proxies a noVNC/WebSocket-style `internalEndpoint`.
- `packages/route/src/index.ts` programs a `RouteMount` containing `internalEndpoint`, so route authorization registration and reverse-proxy transport routing are represented as one object.
- `packages/worker/src/index.ts` silently falls back to `{ use: "browser-profile-temp" }` when workspace state is missing, which violates fail-closed provider resolution and hides unresolved workspace state.
- `packages/app/src/index.ts` wires concrete `ConnectorCdpAdapter` and `EntrypointNovncAdapter` into the provisioning bridge and still exposes CDP/noVNC-oriented adapter surfaces to app-level orchestration.

## Architecture Guardrails

- Provider model: follow `docs/02-provider-and-extension-model.md`. Providers are operator-installed, manifest-driven extension points. GLA core consumes structured provider outputs; it must not hard-code provider lists or concrete provider field names.
- Kernel boundary: follow `docs/architecture/kernel-contracts.md`. Kernel owns pure domain types and port interfaces only. Concrete adapter fields, host dependency details, protocol-specific upstream strings, and provider implementation types stay outside kernel.
- Access Gateway boundary: follow `docs/components/access-gateway.md`. The gateway remains the sole public entry and verifies grant, recipient caveat, and auth-assurance on every request or WebSocket upgrade. Outer reverse proxies, Caddy, authentik proxy, noVNC, and future entrypoint transports cannot replace GLA authorization.
- Session boundary: follow `docs/components/session-service.md`. Session service owns the session aggregate and state transitions. It must track connector and entrypoint resources by provider-neutral identities while preserving existing compensation, close-window, teardown, and restart-recovery semantics.
- Route boundary: follow `docs/components/route-controller.md`. RouteController programs authorization route state. Reverse-proxy transport programming is a separate boundary with separate diagnostics and rollback behavior.
- Worker boundary: follow `docs/components/worker-plane.md`. Worker Plane realizes workspace/launcher/entrypoint/connector provider outputs but does not decide public exposure or authorization. Missing workspace/provider state must be explicit and fail closed.
- Provider-neutrality: do not let CDP/noVNC strings, fields, or imports re-enter `kernel`, `session`, `capability`, or `auth` logic. Existing CDP/noVNC behavior must be maintained by adapter-owned compatibility mappings.
- Authorization vs transport: a route being reachable at the proxy layer is never proof of grant authorization. Diagnostics must make the failing layer explicit: authorization registration, grant/recipient check, transport programming, upstream reachability, or provider asset contract.

## Implementation Guidance

1. Define provider-neutral runtime endpoint descriptors.
   - Replace CDP/noVNC-named runtime fields in kernel contracts with generic descriptors for runtime-owned resources.
   - Model at least these dimensions without concrete provider names: resource identity, provider id, resource family (`agent-connector` or `human-entrypoint`), transport kind, endpoint/upstream data, browser-client assets when applicable, and redacted diagnostics.
   - Keep descriptors stable enough for session persistence and teardown. Do not use raw URLs as the identity of a resource.
   - Ensure `encodeRuntimeHandle` and `decodeRuntimeHandle` continue to round-trip opaque launcher data while exposing only provider-neutral contract fields to core packages.

2. Move connector lifecycle to resource identities.
   - Replace session lifecycle keys based on `cdpUrl` with a connector resource identity returned by the connector provider/adapter.
   - Update bind, unbind, reuse, completion suspend/resume, teardown, and recovered-cleanup paths so they receive provider-neutral connector binding references.
   - Preserve the existing security behavior: connector capabilities remain scoped to the agent subject, secret refs remain grant-bearing/secret material, and teardown revokes capability before clearing binding state.
   - Existing CDP adapters may map the generic resource id to a CDP URL internally, but session records should not store the CDP URL as the lifecycle owner.

3. Generalize human entrypoint contracts.
   - Replace `{ internalEndpoint }` as the core entrypoint contract with a provider-neutral human-entrypoint resource descriptor.
   - Represent browser-client requirements explicitly enough for non-noVNC providers: assets, route surfaces, transport kind, upstream binding, and any provider-owned client bootstrap metadata.
   - Preserve identical GLA grant/recipient enforcement for every entrypoint provider.
   - Keep provider-specific asset and transport handling inside the entrypoint adapter or transport adapter, not in session/capability/auth logic.

4. Split authorization route programming from reverse-proxy transport programming.
   - RouteController should program authorization route state: session id, grant id, public path, entrypoint resource id, and route lifecycle.
   - Transport/proxy programming should consume a transport descriptor and own upstream/proxy details.
   - Diagnostics should identify whether a route failure belongs to Access Gateway authorization registration, grant/recipient enforcement, transport programming, upstream reachability, or client asset delivery.
   - Preserve no-partial-route rollback: failed transport or authorization registration must not leave a public route mounted without a valid grant and teardown path.

5. Fail closed on unresolved workspace state.
   - Remove the silent provider-specific fallback to `browser-profile-temp` from Worker Plane runtime realization.
   - Missing or unresolved workspace state should produce an actionable typed diagnostic before spawn/attach, with no host mutation and no implicit provider selection.
   - The actionable message should identify the missing provider/workspace evidence and the expected admission/catalog/WPM source, while redacting secret values.
   - If a default workspace is desired, it must be resolved before Worker Plane runtime realization, not invented inside `WorkspaceManager.realize()`.

6. Preserve CDP/noVNC compatibility through adapters.
   - `ConnectorCdpAdapter` should own any mapping between the generic connector resource descriptor and CDP URL/secret-ref behavior.
   - `EntrypointNovncAdapter` should own any mapping between the generic human-entrypoint descriptor and noVNC/WebSocket/browser-client assets.
   - Existing CLI, daemon, gateway, and E2E behavior that depends on current CDP/noVNC providers should remain behaviorally compatible unless an explicitly versioned public contract is changed.
   - Compatibility shims must be adapter-local; do not preserve compatibility by keeping CDP/noVNC fields in kernel/session/capability/auth logic.

7. Update architecture docs and boundary tests together.
   - Update provider-extension, kernel-contract, access-gateway, session-service, route-controller, and worker-plane docs to describe the new provider-neutral seams.
   - Add tests proving a fake non-CDP connector and fake non-noVNC human-entrypoint can pass through the contract without kernel/session/capability/auth code changes.
   - Add import-boundary or contract tests that fail if provider-specific runtime fields reappear in protected core packages.

## Acceptance Criteria Mapping

- AC1 is not satisfied by current code because kernel runtime and port contracts still name CDP/noVNC fields. Required work: provider-neutral descriptor types plus compatibility adapters.
- AC2 is not satisfied by current code because session bind/unbind/reuse/teardown is keyed to `cdpUrl`. Required work: connector and entrypoint resource identities in session records and lifecycle ports.
- AC3 is partially satisfied only for grant/recipient enforcement in the Access Gateway. Required work: represent non-noVNC human-entrypoint asset/transport contracts while preserving identical authorization outcomes.
- AC4 is not satisfied by current code because `RouteMount.internalEndpoint` combines authorization route state with reverse-proxy upstream transport. Required work: separated route and transport boundaries plus diagnostic ownership.
- AC5 is not satisfied by current code because Worker Plane falls back to `browser-profile-temp`. Required work: fail-closed unresolved workspace diagnostics.
- AC6 is not satisfied until compatibility and boundary tests prove CDP/noVNC providers remain adapter-owned and fake non-CDP/non-noVNC providers work without core edits.

## Files Likely Touched

- `packages/kernel/src/runtime-handle.ts`
- `packages/kernel/src/ports.ts`
- `packages/kernel/src/entities.ts`
- `packages/kernel/src/index.ts`
- `packages/session/src/index.ts`
- `packages/session/src/*.test.ts`
- `packages/gateway/src/index.ts`
- `packages/gateway/src/*.test.ts`
- `packages/route/src/index.ts`
- `packages/route/src/*.test.ts`
- `packages/worker/src/index.ts`
- `packages/worker/src/*.test.ts`
- `packages/app/src/index.ts`
- `packages/app/src/*.test.ts`
- `adapters/connector-cdp/src/*`
- `adapters/entrypoint-novnc/src/*`
- `adapters/launcher-process/src/*`
- `adapters/workspace-profile/src/*` if workspace resolution diagnostics require adapter participation
- `docs/02-provider-and-extension-model.md`
- `docs/architecture/kernel-contracts.md`
- `docs/components/access-gateway.md`
- `docs/components/session-service.md`
- `docs/components/route-controller.md`
- `docs/components/worker-plane.md`
- Import-boundary or architecture tests, wherever this repo currently enforces core package boundaries

## Test Plan

- AC1: Add kernel contract tests proving runtime handles round-trip provider-neutral connector and human-entrypoint descriptors with no `cdpWebSocketUrl`, `cdp_url`, `cdpUrl`, `novncEndpoint`, or noVNC-named fields in kernel contracts.
- AC1/AC6: Add boundary tests or static import scans that fail if CDP/noVNC field names or adapter imports appear in `packages/kernel`, `packages/session`, `packages/capability`, or `packages/auth`.
- AC2: Add session tests using a fake non-CDP connector resource id for provision, bind, reuse, completion suspend/resume, teardown, and recovered cleanup.
- AC2/AC6: Add CDP compatibility tests proving existing CDP adapter behavior still binds secret refs and tears down correctly through adapter-owned mappings.
- AC3: Add gateway/route/session tests using a fake non-noVNC human-entrypoint descriptor with different browser-client assets or transport requirements, while asserting the same grant/recipient enforcement outcomes as the current handoff route.
- AC3: Add unauthorized, wrong-recipient, expired/revoked grant, and authorized WebSocket/request cases for the fake entrypoint provider.
- AC4: Add RouteController tests for authorization-route programming failure versus transport-programming failure, with diagnostics showing the owning layer and rollback leaving no public orphan route.
- AC4: Add Access Gateway tests proving transport/upstream success cannot bypass grant/recipient authorization.
- AC5: Add Worker Plane tests proving missing workspace state throws an actionable typed diagnostic and does not call workspace realization, launcher spawn, host mutation, or provider-specific default fallback.
- AC6: Keep existing CDP/noVNC gateway, app, and handoff tests green; add at least one compatibility test that exercises current noVNC WebSocket routing through the new adapter-owned transport mapping.
- DoD #8: Add fake non-CDP connector and fake non-noVNC human-entrypoint tests that require no modifications to kernel/session/capability/auth logic when the fake providers are added.

## Risks And Anti-Patterns To Avoid

- Do not solve AC1 by renaming `cdpUrl` to `endpointUrl` while still treating the raw CDP URL as the resource identity.
- Do not move noVNC WebSocket parsing or CDP connection semantics into kernel/session/capability/auth packages.
- Do not let a reverse proxy, transport adapter, or public path registration replace Access Gateway grant and recipient checks.
- Do not silently choose `browser-profile-temp` or any other host-touching provider when workspace state is missing.
- Do not expose internal upstream endpoints, secret refs, capability ids, grant-bearing URLs, or provider credentials in diagnostics.
- Do not break current CDP/noVNC behavior by removing adapter compatibility before a versioned public API migration exists.
- Do not hard-code future provider names, provider-strength enums, or closed transport lists in core contracts; use typed extensibility with recognized current adapters.
- Do not treat provider identity as an authorization decision. Authorization remains grant, recipient, session state, and auth-assurance based.

## Open Architecture Decisions For Main Agent

- Public compatibility shape: decide whether existing operator/CLI surfaces continue to expose legacy CDP/noVNC names as adapter-owned DTOs for this task, or whether a versioned provider-neutral public output is introduced now. The core contract must be provider-neutral either way.
- Transport adapter boundary: decide whether reverse-proxy transport programming belongs behind the existing gateway port, a new transport port, or adapter-local mount descriptors. The implementation must keep diagnostics separated by layer.
- Workspace defaulting source: decide whether catalog/admission should materialize a default workspace descriptor before worker spawn, or whether missing workspace must always be operator-provided for this story.

## References Read

- `backlog task GLA-088 --plain`
- `_bmad-output/implementation-artifacts/gla-087-authentik-edge-guard-role-story.md`
- `docs/02-provider-and-extension-model.md`
- `docs/architecture/kernel-contracts.md`
- `docs/components/access-gateway.md`
- `docs/components/session-service.md`
- `docs/components/route-controller.md`
- `docs/components/worker-plane.md`
- `packages/kernel/src/runtime-handle.ts`
- `packages/kernel/src/ports.ts`
- `packages/kernel/src/entities.ts`
- `packages/session/src/index.ts`
- `packages/gateway/src/index.ts`
- `packages/route/src/index.ts`
- `packages/worker/src/index.ts`
- `packages/app/src/index.ts`

## Dev Agent Record

Agent model used: Codex GPT-5

Completion notes:
- Invoked `bmad-create-story` to produce this story artifact, then used `bmad-dev-story` instructions for implementation.
- Implemented provider-neutral `RuntimeEndpointDescriptor` contracts and helper lookup in the kernel while keeping CDP/noVNC fields adapter-local.
- Reworked session lifecycle ownership around connector resource ids, including bind/unbind, teardown, completion suspend/resume, and daemon restart recovery.
- Replaced the core human-entrypoint `{ internalEndpoint }` shape with an entrypoint binding carrying resource id, provider id, client binding, and transport binding.
- Separated route authorization state from reverse-proxy transport binding in route/gateway code, including layer-owned diagnostics for transport failures.
- Removed silent worker/launcher workspace defaulting; missing workspace context now fails closed before host mutation or provider selection.
- Preserved current CDP/noVNC compatibility through `connector-cdp`, `entrypoint-novnc`, and `launcher-process` adapter-owned mappings.
- Updated provider-extension, kernel-contract, access-gateway, route-controller, session-service, and worker-plane docs for the new seams.
- QA/E2E generation evidence: updated existing app E2E and gateway/session/route tests to exercise fake non-noVNC entrypoints and provider-neutral bindings; added kernel boundary coverage for provider-specific runtime fields.
- Independent reviewer Wegener ran `bmad-story-automator-review` read-only and approved with no blocking findings.
- Worker Dirac ran `bmad-qa-generate-e2e-tests` read-only validation and mapped tests to AC1-AC6.
- TEA/security Helmholtz raised two medium findings: gateway did not consume client binding, and route-controller errors could leak raw downstream adapter messages. Both were fixed before close.
- Follow-up fixes: gateway handoff pages now embed the provider-declared browser-client binding with script-data escaping for provider bootstrap metadata, malformed WebSocket transport is rejected before mount, route-controller public errors redact downstream transport text, and focused tests cover those regressions.
- Verification: `pnpm run gate` passed after the review fixes, with typecheck, Biome CI, and 60 Vitest files green (656 passed, 12 skipped). The only warning is the known broken `wpm/CLAUDE.md` symlink.
- Untracked `.codex/` remains local Codex configuration and is intentionally excluded from this story's task evidence and commit scope.

File list:
- `_bmad-output/implementation-artifacts/gla-088-runtime-connector-and-human-entrypoint-provider-contracts-story.md`
- `_bmad-output/implementation-artifacts/tests/test-summary.md`
- `.bmad/sdlc-state.yaml`
- `backlog/tasks/gla-088 - Generalize-runtime-connector-and-human-entrypoint-provider-contracts.md`
- `adapters/connector-cdp/src/connector-cdp.test.ts`
- `adapters/connector-cdp/src/index.ts`
- `adapters/entrypoint-novnc/src/entrypoint-novnc.test.ts`
- `adapters/entrypoint-novnc/src/index.ts`
- `adapters/launcher-process/src/index.ts`
- `docs/02-provider-and-extension-model.md`
- `docs/architecture/kernel-contracts.md`
- `docs/components/access-gateway.md`
- `docs/components/route-controller.md`
- `docs/components/session-service.md`
- `docs/components/worker-plane.md`
- `packages/app/src/authentik-dual-method.test.ts`
- `packages/app/src/authentik-scenario-e2e.test.ts`
- `packages/app/src/completion-e2e.test.ts`
- `packages/app/src/daemon-state.test.ts`
- `packages/app/src/handoff-e2e.test.ts`
- `packages/app/src/index.ts`
- `packages/app/src/provision.test.ts`
- `packages/app/src/scenario-01-e2e.test.ts`
- `packages/app/src/teardown-e2e.test.ts`
- `packages/app/src/two-handoff-e2e.test.ts`
- `packages/gateway/src/handoff-page.ts`
- `packages/gateway/src/handoff.test.ts`
- `packages/gateway/src/index.ts`
- `packages/kernel/src/entities.ts`
- `packages/kernel/src/index.ts`
- `packages/kernel/src/ports.ts`
- `packages/kernel/src/provider-runtime-boundary.test.ts`
- `packages/kernel/src/runtime-handle.ts`
- `packages/route/src/index.ts`
- `packages/route/src/route.test.ts`
- `packages/session/src/completion-close.test.ts`
- `packages/session/src/handoff-saga.test.ts`
- `packages/session/src/index.ts`
- `packages/session/src/session-service.test.ts`
- `packages/session/src/session-teardown.test.ts`
- `packages/worker/src/index.ts`
- `packages/worker/src/worker.test.ts`

Change log:
- 2026-06-13: Implemented provider-neutral runtime connector and human-entrypoint contracts; added boundary/fake-provider tests; updated architecture docs; `pnpm run gate` passed.
- 2026-06-13: Addressed TEA/security review findings by consuming browser-client binding in gateway page data, escaping provider bootstrap metadata in script data islands, rejecting malformed WebSocket transport at gateway mount, and redacting route-controller downstream error text; `pnpm run gate` passed with 656 tests.
