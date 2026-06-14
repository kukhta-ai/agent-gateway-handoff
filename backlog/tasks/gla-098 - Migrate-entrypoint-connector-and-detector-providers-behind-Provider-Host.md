---
id: GLA-098
title: Migrate entrypoint connector and detector providers behind Provider Host
status: To Do
assignee: []
created_date: '2026-06-14 13:24'
labels:
  - architecture
  - provider-host
  - human-entrypoint
  - agent-connector
  - completion
  - noVNC
  - CDP
dependencies:
  - GLA-095
  - GLA-088
  - GLA-077
references:
  - docs/components/access-gateway.md
  - docs/components/session-service.md
  - docs/components/completion-service.md
  - packages/session/src/index.ts
  - packages/gateway/src/index.ts
  - adapters/entrypoint-novnc/src/index.ts
  - adapters/connector-cdp/src/index.ts
  - adapters/detector-url/src/index.ts
documentation:
  - docs/architecture/provider-host-extension-architecture.md
priority: high
ordinal: 98000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: GLA-088 established provider-neutral runtime resource descriptors, but the current app composition still knows noVNC, CDP, and URL watcher as concrete technologies. Human entrypoint, agent connector, and completion detector should extend horizontally like every other provider family.

Context: noVNC, CDP, and url-watcher remain the reference providers. This task migrates their construction, client assets, contracts, and diagnostics behind Provider Host registration so alternatives such as KasmVNC, Guacamole, Xpra, filesystem connectors, secret-ref connectors, exit-code detectors, or DOM detectors can be added without editing core session/gateway/completion logic.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The noVNC human entrypoint, CDP agent connector, url-watcher detector, and user-done detector are registered and selected through Provider Host modules while preserving existing scenario behavior.
- [ ] #2 Human-entrypoint client assets and reverse-proxy transport requirements come from provider-host metadata, and gateway code serves them through generic entrypoint bindings without naming noVNC.
- [ ] #3 Agent connector DTOs may carry provider-owned fields, but session, capability, worker, gateway, and route lifecycle logic continues to key on provider-neutral resource ids and connector bindings.
- [ ] #4 Completion detector contracts, raw-signal validation, and watch behavior are supplied by provider-host registration, and out-of-contract detector signals remain rejected by the Completion service.
- [ ] #5 Fake non-noVNC entrypoint, non-CDP connector, and non-url detector providers can be registered and exercised without changes to kernel, session, gateway, route, identity, or completion core packages.
- [ ] #6 Unavailable entrypoint, connector, or detector providers fail proposal admission or provisioning with stable provider-host diagnostics rather than falling back to reference-slice defaults.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
