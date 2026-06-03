---
id: GLA-021
title: Admit a session proposal
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 08:21'
labels:
  - impl
  - row
  - admit
dependencies:
  - GLA-004
  - GLA-006
  - GLA-019
documentation:
  - docs/components/admission-and-policy.md
  - docs/04-capsule-assembly.md
priority: medium
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers deterministic accept-or-reject from proposal to provisioning. Builds the step designed in its plan. Depends on the kernel, the policy engine, and the propose step. Out of scope: provisioning.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A proposal passing policy, capability scope, catalog availability, recipient and identity, and every per-mount check is accepted and dispatched to its task.
- [x] #2 A proposal failing any one of those is rejected with a stable namespaced code and the documented exit code, and nothing is minted or run.
- [x] #3 Mutation fills defaults and canonicalizes mount paths but never invents missing semantics; a missing required detail is a rejection, not a guess.
- [x] #4 Mount and policy validation run offline, so a dry-run accept-or-reject matches the real run for the same spec.
- [x] #5 Adding a new policy check changes no caller of admission.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
packages/admission mutate->validate pipeline + Cedar. AC1 proposal passing policy+cap-scope+catalog-avail+recipient+per-mount -> accept + dispatch to task (session issued, no spawn=Slice3); AC2 failing any -> stable namespaced code + documented exit (3/4/5/7/8), nothing minted/run; AC3 mutate fills declared defaults + canonicalizes mounts (incl realpath symlink-resolve), missing required detail -> reject not guess; AC4 mount+policy offline -> dry-run == real run; AC5 new check changes no admission caller. SECURITY-reviewed 2 cycles: found+fixed denylist(+~/.ssh,GLA state dir), symlink-escape, template-fixed-part override, compatibleWith, implicit-task-leak. Verdict: sound to build provisioning on. 188 tests green.
<!-- SECTION:NOTES:END -->
