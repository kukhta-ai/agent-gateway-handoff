---
id: GLA-010
title: Build a wpm installer package for the edge proxy
status: To Do
assignee: []
created_date: '2026-06-03 03:31'
labels:
  - dependency
  - wpm
  - impl
dependencies:
  - GLA-005
documentation:
  - docs/components/access-gateway.md
  - docs/components/route-controller.md
priority: high
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the public entry needs an edge proxy in front of the operator host; it touches the host, so it ships as a wpm installer package. Depends on the dependency strategy. Out of scope: the GLA Access Gateway and Route controller that program it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A wpm installer package for the edge proxy exists in this project and is the unit that gets built, not an inline install.
- [ ] #2 The package detects an existing usable edge proxy before changing anything.
- [ ] #3 On completion the host has an edge proxy able to terminate inbound connections and forward to a local upstream.
- [ ] #4 An already-adequate proxy is left unchanged and recorded.
- [ ] #5 The package records a verifiable receipt and is idempotent on re-run.
- [ ] #6 A host where the proxy cannot be provisioned fails clearly without leaving a half-configured proxy.
<!-- AC:END -->
