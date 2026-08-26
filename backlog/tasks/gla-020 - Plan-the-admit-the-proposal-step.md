---
id: GLA-020
title: Plan the admit-the-proposal step
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 08:21'
labels:
  - plan
  - architecture
  - row
  - admit
dependencies:
  - GLA-002
documentation:
  - docs/components/admission-and-policy.md
  - docs/04-capsule-assembly.md
  - docs/components/catalog.md
priority: medium
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: this is the gate from proposal to provisioning, the heart of agent-assembles, GLA-validates; it fixes the admission pipeline. Produces architecture and the build plan; no code. Use the architect skills and research admission-control patterns (mutate then validate, Cedar) on the internet. Depends on the contracts plan. Out of scope: provisioning; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Admission's mutate-then-validate pipeline is specified: the defaults and mount canonicalization it applies, the offline checks it runs (policy, capability scope, catalog availability, recipient and identity, per-mount), and that it mints and runs nothing.
- [x] #2 The Catalog availability check is specified as a contract: a referenced entity that is unavailable is a rejection.
- [x] #3 The Capability scope check is specified: a proposal outside the presented capability's scope is rejected from the capability and request alone.
- [x] #4 The Task dispatch is specified: an accepted proposal is dispatched to the task, with the reject path returning a stable namespaced code.
- [x] #5 The operating experience is designed: how a dry-run and a stable rejection code let the agent recover without reading internals.
- [x] #6 An implementation plan for the build task exists, with how acceptance and each rejection class are observed, and how dry-run matches the real run.
- [x] #7 Dependencies are identified and classified; the policy engine is named as in-tree, and any non-traditional one has a wpm-installer-package task in this backlog.
- [x] #8 The admission stages and policy are specified at full capability so a new check or policy is added with no change to the pipeline contract.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: docs/architecture/slice-2-propose-admit.md §admit. Mutate->validate spec (defaults + mount canonicalization/symlink-resolve; offline checks policy/cap-scope/catalog-avail/recipient/identity/per-mount; mints+runs nothing); catalog-availability-as-contract (unavailable -> reject); capability-scope from cap+request alone; task dispatch + stable namespaced reject code; operating experience (dry-run + stable codes -> recover without internals); build/observation plan (acceptance + each reject class; dry-run==real); policy engine named in-tree; stages+policy full-capability (new check/policy = no pipeline-contract change). Rule-3 docs-driven fallback. Implemented+tested in GLA-021.
<!-- SECTION:NOTES:END -->
