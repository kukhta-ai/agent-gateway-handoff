---
id: GLA-014
title: Plan the inbound-request and agent-connect step
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - plan
  - architecture
  - row
  - inbound
dependencies:
  - GLA-002
documentation:
  - docs/components/channel-adapter.md
  - docs/components/agent-bridge.md
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the flow starts when a human request arrives over a channel and the agent connects to GLA; this fixes the inbound seam and the agent-authority anchor. Produces architecture and the build plan; no code. Use the architect skills and research channel-ingress and agent-CLI connection patterns on the internet. Depends on the contracts plan. Out of scope: orientation reads; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Channel adapter's part is specified: how an inbound human message is delivered to the agent with its recipient binding attached, as a port the core depends on rather than a provider-specific call.
- [ ] #2 The Agent Bridge's part is specified: how the agent connects and obtains an agent-authority anchor that scopes its operations.
- [ ] #3 The Capability service's part is specified: how the agent-authority capability is issued without becoming something the agent can forge.
- [ ] #4 The operating experience of connecting is designed: how the agent discovers it is connected and what it is allowed to do.
- [ ] #5 An implementation plan for the build task exists, with how a delivered, recipient-bound, connected state is observed.
- [ ] #6 Dependencies are identified and classified; the channel client is named for in-tree integration, and any non-traditional one has a wpm-installer-package task in this backlog.
- [ ] #7 The channel seam is specified at full capability so a second channel is added as a provider with no seam change.
<!-- AC:END -->
