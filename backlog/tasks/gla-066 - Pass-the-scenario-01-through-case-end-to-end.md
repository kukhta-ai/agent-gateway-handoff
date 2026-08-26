---
id: GLA-066
title: Pass the scenario-01 through-case end to end
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 13:03'
labels:
  - e2e
  - impl
dependencies:
  - GLA-013
  - GLA-015
  - GLA-017
  - GLA-019
  - GLA-021
  - GLA-023
  - GLA-025
  - GLA-027
  - GLA-033
  - GLA-035
  - GLA-039
  - GLA-041
  - GLA-043
  - GLA-045
  - GLA-065
documentation:
  - docs/01-architecture-overview.md
  - docs/05-cli-and-entities.md
  - docs/scenario-01-unified.html
priority: high
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the MVP is defined by the full scenario-01 thread working through the real modules, proving the slice and the horizontal-extension property. Composes the implemented steps; adds no new module behaviour. Depends on every full-build step. Out of scope: any second provider per family, which is the later horizontal extension this MVP enables.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 From a single channel request, given an enrolled recipient, the agent orients, proposes, and provisions a live capsule under a task.
- [x] #2 The agent drives the capsule to the form, opens a recipient-bound window, and the bound human authenticates and completes the form without the agent seeing the secret.
- [x] #3 A second window re-opens onto the same capsule, the human's auth is reused, and the verification-code step completes.
- [x] #4 Completing the task tears everything down, leaving no live capsule, route, grant, or runtime.
- [x] #5 Throughout, every cross-module call goes over the designed seams: no core module imports a concrete adapter.
- [x] #6 Swapping any single provider the slice uses (channel, launcher, gateway, identity, view, detector) for a compatible one needs no core code change.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
THE MVP CAPSTONE — packages/app/src/scenario-01-e2e.test.ts (1084 lines, ~109 assertions) runs the FULL scenario-01 thread Phases E,0-15 COLD in one gate-included test (3.2s). AC1 single channel request + enrolled recipient -> orient/propose(dry-run accepted, 0 capsules)/provision a LIVE capsule under a task; AC2 drive to /register + handoff-1 + WebAuthn step-up + form completed AGENT-BLIND (secret-scan=0 across 17 outputs; connector socket severed during the window, live read fails); AC3 2nd window on the SAME capsule + AUTH REUSED (step-up count stays 1) + verification-code completes (/dashboard verified); AC4 gla task complete tears everything down (pid ESRCH, no route/grant/runtime, caps auth.revoked, reconciler no orphan); AC5 import-boundary holds (tools/boundary-check; only app imports adapters); AC6 provider-swap proven (a 2nd compatible ChannelPort runs through the thread + a 2nd LauncherPort registers in the SpawnerRegistry, no core change). Security invariants asserted in-thread: S-1, S-2, S-3 (sync verify, no DB), S-7 (offline reject exit 3/5), S-8, S-10 (forwarded link to a different recipient denied); S-4/5/6/9 covered by per-slice/unit tests. Honest gaps: the launcher is CORRECTLY template-pinned (so the swap is proven via the channel family); gla audit/events CLI noun is unimplemented (AuditEvent entity exists; not needed for scenario-01); docs/05 §6 short provider-labels are illustrative (assembly uses full provider names). Rule-3: bmad-qa-generate-e2e-tests interactive -> docs-driven fallback. 408 tests green.
<!-- SECTION:NOTES:END -->
