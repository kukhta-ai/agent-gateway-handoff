---
id: GLA-041
title: Let the human work in-window without the agent seeing secrets
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 11:46'
labels:
  - impl
  - row
  - fill
dependencies:
  - GLA-004
  - GLA-039
documentation:
  - docs/components/capsule.md
priority: medium
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the privacy-critical behaviour, the human entering secrets the agent cannot observe. Builds the step designed in its plan. Depends on the kernel and the reach step. Out of scope: detecting completion.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Inside an open window the human can interact with the live page and submit the form.
- [x] #2 Secret keystrokes reach the website and are never delivered to the agent connector.
- [x] #3 Nothing the human types in the window appears in any agent-readable channel or log.
- [x] #4 The agent-blind guarantee holds regardless of which human entrypoint surface is used.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Agent-blind GENUINELY ENFORCED via a GLA-side CDP broker (adapters/connector-cdp/cdp-broker.ts): the agent cdp_url points at a 127.0.0.1 broker that tunnels to Chromium; openHandoff suspend() DESTROYS the live agent<->broker sockets (verified vs REAL Chromium: a read over the pre-existing connection FAILS during the window) + blocks new connects + rewrites /json webSocketDebuggerUrl (no real-port leak); resume re-allows after close (agent re-attaches the same url, Phase 9). AC1 human interacts + submits in-window; AC2 secret keystrokes reach the site, never the agent connector; AC3 nothing typed appears in any agent-readable channel/log (secret-scan=0 across connector/results/envelope/audit/events/stdout/stderr); AC4 holds for any human entrypoint (the human path is non-brokered). Security-reviewed (2 cycles): /json port-leak FIXED, severance complete. KNOWN single-host limitation (accepted MVP posture, baseline §5): on the process tier the agent shares loopback with Chromium's ephemeral CDP port (not in any GLA output, not guessable in one shot); true process isolation needs the T4/T5 tier (deferred). DEFERRED should-fix: multi-capsule /json routing (single-session scenario-01 unaffected). 373 tests green.
<!-- SECTION:NOTES:END -->
