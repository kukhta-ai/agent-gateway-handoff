---
id: GLA-015
title: Receive a request and connect the agent
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 07:16'
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
- [x] #1 An inbound message on the configured channel is delivered to the agent together with the recipient it is bound to.
- [x] #2 On connecting, the agent receives an agent-authority anchor and the set of operations it allows.
- [x] #3 Receiving and connecting change no task or session state.
- [x] #4 Adding a second channel provider requires no change to how the agent receives messages.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
channel-cli (ChannelPort) + bridge connect + capability service. Verified pnpm gate green (105 tests, +46). AC#1 inbound delivered with recipient binding (channel-cli.test receiveBound); AC#2 connect -> agent-authority anchor + allowed_ops (agent-bridge.test); AC#3 receive/connect change no task/session state (byte-identical-stores test); AC#4 2nd channel = no change to how agent receives (ChannelPort boundary + import-boundary: only app imports channel-cli). Non-forgeable agent-authority confirmed by orchestrator spot-check (whoami is verify-first via kernel verify; reads identity/ops only from the signed caveat chain; capability-service.test rejects tampered/forged/wrong-key).
<!-- SECTION:NOTES:END -->
