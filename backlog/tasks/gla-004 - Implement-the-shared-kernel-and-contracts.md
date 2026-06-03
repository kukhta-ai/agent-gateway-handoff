---
id: GLA-004
title: Implement the shared kernel and contracts
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 06:53'
labels:
  - foundation
  - impl
dependencies:
  - GLA-002
  - GLA-003
documentation:
  - docs/04-capsule-assembly.md
  - docs/components/capability-service.md
  - docs/components/task-service.md
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: every module depends on the core entities, the capability primitive, the assembly contract, and the error taxonomy. Builds them as in-tree code behind the designed ports. Depends on the contracts plan and the scaffold. Out of scope: module-specific behaviour and any provider.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The core entities exist with their specified fields and state transitions, and an invalid transition surfaces a typed, machine-distinguishable error.
- [x] #2 A capability can be minted, attenuated, and verified, and verification succeeds or fails purely from the capability and request without a central lookup.
- [x] #3 A recipient-bound capability verifies only for its bound recipient and fails closed for any other.
- [x] #4 An AssemblySpec is validated offline against its schema: a well-formed spec passes, and each distinct defect is reported with its location in a single pass.
- [x] #5 A provider config-schema rejects a value that violates a declared constraint, naming the offending field, before anything runs.
- [x] #6 Every taxonomy error carries a stable code mapping to the documented exit code, so callers branch without parsing prose.
- [x] #7 The kernel has no dependency on any concrete adapter or external service.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented packages/kernel (zero runtime deps; node:crypto only). 59 repo tests green (48 kernel), pnpm gate + gate:selftest pass. Rule-3: bmad-dev-story loaded in subagent but requires sprint-status.yaml/a story file -> not unattended; implemented directly as the recorded fallback. SEPARATE code review (2 cycles): cycle 1 found a BLOCKER (capability lineage/parentRef serialized but UNSIGNED -> forgeable revocation bypass) + scope-caveat fail-open + immediate-parent-only revocation + non-recursive canonical encoding; ALL fixed (lineage folded into the signed HMAC seed; verify checks self+every ancestor vs the passed-in revocation snapshot; scope fails closed via new auth.scope_required->exit4; recursive canonical serializer); cycle 2 verdict CLEAN, no new issues, constant-time tag compare intact. Latent non-blocker: seed 'cls:id:canonical(lineage)' not formally prefix-free but non-exploitable (cap_ ids are hex+base36, no ':'). AC mapping: #1 entities+typed invalid-transition errors (state.conflict); #2 mint/attenuate/stateless pure verify; #3 recipient-binding fails closed for wrong/missing presenter; #4 AssemblySpec offline all-defects-single-pass w/ JSON paths; #5 config_schema rejects+names offending field; #6 stable code->exit map incl mount.*->3/5/7/8; #7 purity (no adapter/service deps).
<!-- SECTION:NOTES:END -->
