---
id: GLA-077
title: Serve a real noVNC handoff client to the recipient
status: To Do
assignee: []
created_date: '2026-06-12 20:01'
updated_date: '2026-06-12 22:58'
labels:
  - hardening
  - human-view
  - novnc
  - e2e
dependencies:
  - GLA-008
  - GLA-023
  - GLA-039
  - GLA-041
  - GLA-076
  - GLA-088
references:
  - >-
    _bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md
  - docs/architecture/test-strategy.md
  - docs/architecture/dependency-strategy.md
  - docs/components/access-gateway.md
  - docs/components/worker-plane.md
  - docs/components/capsule.md
  - packages/gateway/src/handoff-page.ts
  - adapters/launcher-process/src/index.ts
  - adapters/entrypoint-novnc/src/index.ts
priority: high
ordinal: 77000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the host human-view stack and gateway WebSocket proxy exist, but the recipient page currently opens a raw WebSocket and does not present a browser-rendered noVNC client. This task closes the recipient-facing path from a verified handoff link to a visible, controllable capsule browser.

Architectural context: Human Entrypoint is the product layer; noVNC is only the current reference browser-stream provider for that layer. The current codebase has the inner seam but not the full extension path: catalog/admission can carry an entrypoint provider choice, session/route use injected ports, but app composition still instantiates EntrypointNovncAdapter directly and gateway/page behavior is WebSocket/noVNC-shaped. The implementation must therefore improve the recipient noVNC experience without making noVNC a core/session/capability/auth assumption, and must preserve an extendable HumanEntrypoint/client/proxy boundary for future providers such as KasmVNC, Guacamole, Xpra, or a non-browser-stream surface.

Boundaries: this is not a host package install task and must not widen gateway routes, proxy targets, grant semantics, or auth semantics. Stub-only WebSocket reachability is not sufficient evidence. If any temporary noVNC-specific app or gateway coupling remains, it must be explicit boundary debt with the owning package and follow-up seam documented before the task can close.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A full-mode browser handoff with a valid recipient-bound grant presents the authenticated recipient with a live capsule browser viewport in the browser tab.
- [ ] #2 Keyboard and pointer input through the recipient viewport reaches the capsule browser and can change or submit the target page.
- [ ] #3 User-entered secret text through the viewport is absent from agent-readable connector output, gateway responses, logs, audit/event text, and completion data.
- [ ] #4 A reused-auth second handoff opens the same live client onto the same capsule without a second identity ceremony while the reuse window is valid.
- [ ] #5 Absent, expired, revoked, wrong-recipient, or not-yet-authorized grants cannot establish the client connection and cause no traffic to reach the capsule entrypoint.
- [ ] #6 When the human-view stack or capsule noVNC endpoint is unavailable, the recipient sees a clear unavailable or refusal state and no false connected surface remains reachable.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Prepared from the transcript comparison and independent subagent draft: Sartre/noVNC.

Architecture constraint requested by user: noVNC is the reference human-view provider, not the architectural layer. The task must preserve the Capsule model of a Human Entrypoint plus Agent Connector over shared state, keep Access Gateway authorization/proxying provider-neutral, and isolate noVNC-specific realization to the human-entrypoint/client/provider side so another browser-stream provider such as KasmVNC, Guacamole, or Xpra could satisfy the same seam later.

Entrypoint extensibility investigation added: _bmad-output/implementation-artifacts/investigations/entrypoint-extensibility-investigation.md. The task must account for the current gap that catalog/admission can carry an entrypoint provider choice, but app composition still instantiates only EntrypointNovncAdapter and gateway/page code is WebSocket/noVNC-shaped. Implement GLA-077 so noVNC is the reference provider behind an extendable HumanEntrypoint/client/proxy boundary, not a layer assumption. If the implementation keeps any temporary noVNC-specific app or gateway coupling, it must be explicitly documented as a follow-up boundary debt before the task can close.

Review mapping update: GLA-088 is now the prerequisite architecture seam task for provider-neutral runtime connector and Human Entrypoint contracts. GLA-077 should consume that seam when adding the real noVNC client, not solve the cross-cutting CDP/noVNC coupling locally.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [ ] #7 Architecture gate completed: the implementation preserves the HumanEntrypointPort/provider boundary, keeps noVNC-specific code out of core/session/capability/auth logic, and documents which package owns the browser client, host human-view dependency, and gateway proxy seam.
- [ ] #8 Entrypoint extensibility is preserved by design: the noVNC client is integrated behind a provider-neutral human-entrypoint/client boundary, adding another browser-stream HumanEntrypoint provider requires no session/capability/auth/core edits, and any app/gateway/provider seams needed for provider selection, endpoint shape, client assets, and proxy transport are documented with owning packages and boundary tests.
<!-- DOD:END -->
