---
id: GLA-098
title: Migrate entrypoint connector and detector providers behind Provider Host
status: Done
assignee: []
created_date: '2026-06-14 13:24'
updated_date: '2026-06-14 16:02'
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
- [x] #1 The noVNC human entrypoint, CDP agent connector, url-watcher detector, and user-done detector are registered and selected through Provider Host modules while preserving existing scenario behavior.
- [x] #2 Human-entrypoint client assets and reverse-proxy transport requirements come from provider-host metadata, and gateway code serves them through generic entrypoint bindings without naming noVNC.
- [x] #3 Agent connector DTOs may carry provider-owned fields, but session, capability, worker, gateway, and route lifecycle logic continues to key on provider-neutral resource ids and connector bindings.
- [x] #4 Completion detector contracts, raw-signal validation, and watch behavior are supplied by provider-host registration, and out-of-contract detector signals remain rejected by the Completion service.
- [x] #5 Fake non-noVNC entrypoint, non-CDP connector, and non-url detector providers can be registered and exercised without changes to kernel, session, gateway, route, identity, or completion core packages.
- [x] #6 Unavailable entrypoint, connector, or detector providers fail proposal admission or provisioning with stable provider-host diagnostics rather than falling back to reference-slice defaults.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GLA-098 implemented on feature/provider-host-task-098. BMAD evidence: worker loaded bmad-create-story and bmad-dev-story; literal workflow was blocked by missing sprint-status/story artifacts, so implementation used the committed design set and backlog fallback already recorded in SDLC state. Provider Host now selects entrypoint, connector, and detector runtime ports from each session's admitted ResolvedAssemblySpec; provider-set-reference owns concrete noVNC/CDP/url-watcher/user-done modules and client asset resolution; app package/tsconfig no longer directly depend on migrated concrete providers. Gateway no longer falls back missing client.ref to noVNC. Independent reviewer, architect, and TEA/security re-reviews approved after fixes. Verification: focused provider-host/app/gateway suite passed after typecheck (80 passed, 2 skipped); full pnpm gate passed (66 test files, 755 passed, 15 skipped).
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
