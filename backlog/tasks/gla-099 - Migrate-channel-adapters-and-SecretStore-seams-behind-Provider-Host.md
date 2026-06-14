---
id: GLA-099
title: Migrate channel adapters and SecretStore seams behind Provider Host
status: To Do
assignee: []
created_date: '2026-06-14 13:24'
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
- [ ] #1 The current CLI channel is registered and selected through Provider Host modules while preserving existing delivery behavior and recipient-binding expectations.
- [ ] #2 Channel provider selection is represented by provider id, manifest capability, config schema, probe, and diagnostics, with no app-level list of concrete channel adapter implementations.
- [ ] #3 The SecretStore provider family is represented in the provider-host and catalog contracts, including config schema, state schema, probe, and secret-ref-only diagnostics even if the first concrete store is a safe in-tree test/reference provider.
- [ ] #4 Secret-bearing channel or secret-store config never appears as literal values in catalog output, logs, diagnostics, task notes, or test snapshots.
- [ ] #5 A fake channel provider and fake secret-store provider can be registered and selected without changes to kernel, gateway, session, capability, identity, or bridge core packages.
- [ ] #6 Developer documentation explains how channel adapters and secret stores differ in trust and redaction requirements while sharing the same provider-host registration path.
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
