---
id: GLA-015
title: Receive a request and connect the agent
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - impl
  - row
  - inbound
dependencies:
  - GLA-004
documentation:
  - docs/components/channel-adapter.md
  - docs/components/agent-bridge.md
priority: medium
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the first observable behaviour, an inbound message reaching the agent and the agent connected with a scoped authority. Builds the step designed in its plan. Depends on the kernel. Out of scope: orientation reads.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An inbound message on the configured channel is delivered to the agent together with the recipient it is bound to.
- [ ] #2 On connecting, the agent receives an agent-authority anchor and the set of operations it allows.
- [ ] #3 Receiving and connecting change no task or session state.
- [ ] #4 Adding a second channel provider requires no change to how the agent receives messages.
<!-- AC:END -->
