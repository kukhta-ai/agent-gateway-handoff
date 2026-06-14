---
id: GLA-099
title: Migrate channel adapters and SecretStore seams behind Provider Host
status: Done
assignee: []
created_date: '2026-06-14 13:24'
updated_date: '2026-06-14 16:30'
labels:
  - architecture
  - provider-host
  - channel
  - secret-store
  - security
dependencies:
  - GLA-095
references:
  - docs/components/channel-adapter.md
  - docs/components/capability-service.md
  - docs/architecture/kernel-contracts.md
  - packages/kernel/src/ports.ts
  - adapters/channel-cli/src/index.ts
documentation:
  - docs/architecture/provider-host-extension-architecture.md
modified_files:
  - packages/app/src/index.ts
  - packages/app/src/daemon.ts
  - packages/app/src/provision.test.ts
  - packages/app/src/handoff-e2e.test.ts
  - packages/app/src/scenario-01-e2e.test.ts
  - packages/app/src/authentik-scenario-e2e.test.ts
  - packages/app/package.json
  - packages/app/tsconfig.json
  - packages/catalog/src/manifests.ts
  - packages/provider-set-reference/src/index.ts
  - packages/provider-set-reference/src/reference-provider-set.test.ts
  - docs/architecture/provider-host-extension-architecture.md
  - docs/components/channel-adapter.md
  - pnpm-lock.yaml
priority: high
ordinal: 99000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: channel adapters and secret stores are listed as provider families in the design set, but the current slice only wires the CLI channel directly and has not made SecretStore provider registration first-class. These seams need the same extension path before Telegram/Slack/email or external secret stores are added.

Context: ChannelAdapter is a delivery surface with recipient-binding requirements. SecretStore is security-sensitive because it carries agent-blind values. This task should keep the initial provider set small while ensuring both families can be added through the Provider Host without app-level provider branches.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The current CLI channel is registered and selected through Provider Host modules while preserving existing delivery behavior and recipient-binding expectations.
- [x] #2 Channel provider selection is represented by provider id, manifest capability, config schema, probe, and diagnostics, with no app-level list of concrete channel adapter implementations.
- [x] #3 The SecretStore provider family is represented in the provider-host and catalog contracts, including config schema, state schema, probe, and secret-ref-only diagnostics even if the first concrete store is a safe in-tree test/reference provider.
- [x] #4 Secret-bearing channel or secret-store config never appears as literal values in catalog output, logs, diagnostics, task notes, or test snapshots.
- [x] #5 A fake channel provider and fake secret-store provider can be registered and selected without changes to kernel, gateway, session, capability, identity, or bridge core packages.
- [x] #6 Developer documentation explains how channel adapters and secret stores differ in trust and redaction requirements while sharing the same provider-host registration path.
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented channel and SecretStore Provider Host migration. Channel delivery in app provisioning/enrollment now creates ChannelPort through ProviderHost with provider id selection and provider-family services; app runtime/package metadata no longer depends on concrete channel adapters. provider-set-reference owns channel-cli and secret-store-reference provider modules, manifests, probes, state schema, and creation helpers. Channel config modes are enforced fail-closed. SecretStore output remains opaque secret refs with redacted diagnostics and sensitive state schema. Docs updated for channel vs SecretStore trust/redaction requirements. Rule-3 evidence: worker invoked/read bmad-create-story and bmad-dev-story; customization resolution succeeded, but sprint-status/story artifact was absent, so documented specs/backlog fallback was used. Independent reviewer, architect, and TEA/security reviews approved after fixes. Full pnpm gate passed after final fixes: typecheck, Biome, browser E2E preflight, and 66 Vitest files with 760 passed / 15 skipped.
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
