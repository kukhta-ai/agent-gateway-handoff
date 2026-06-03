---
id: GLA-020
title: Plan the admit-the-proposal step
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
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
- [ ] #1 Admission's mutate-then-validate pipeline is specified: the defaults and mount canonicalization it applies, the offline checks it runs (policy, capability scope, catalog availability, recipient and identity, per-mount), and that it mints and runs nothing.
- [ ] #2 The Catalog availability check is specified as a contract: a referenced entity that is unavailable is a rejection.
- [ ] #3 The Capability scope check is specified: a proposal outside the presented capability's scope is rejected from the capability and request alone.
- [ ] #4 The Task dispatch is specified: an accepted proposal is dispatched to the task, with the reject path returning a stable namespaced code.
- [ ] #5 The operating experience is designed: how a dry-run and a stable rejection code let the agent recover without reading internals.
- [ ] #6 An implementation plan for the build task exists, with how acceptance and each rejection class are observed, and how dry-run matches the real run.
- [ ] #7 Dependencies are identified and classified; the policy engine is named as in-tree, and any non-traditional one has a wpm-installer-package task in this backlog.
- [ ] #8 The admission stages and policy are specified at full capability so a new check or policy is added with no change to the pipeline contract.
<!-- AC:END -->
