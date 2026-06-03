---
id: GLA-005
title: Plan the dependency and ownership strategy
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 06:15'
labels:
  - foundation
  - dependency
  - plan
dependencies:
  - GLA-001
documentation:
  - docs/02-provider-and-extension-model.md
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the slice needs external pieces, and each must be classified before it is built; this does that research once and is the basis for the dependency tasks. Produces a classification artifact, not code. Use the architect skills and research current real-world options (policy engines, browser runtimes, view stacks, container runtimes, edge proxies, WebAuthn providers) on the internet. The capsule is assembled from separate local components, not one image. Out of scope: integrating or installing anything.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every external dependency the scenario-01 slice needs is enumerated, including the capsule's separate layers: browser plus automation, the human-view stack, and the control protocol.
- [x] #2 Each dependency is classified by the ownership rule (long-lived in-tree code, versus something touching the operator host or wiring the operator agent), with the classification justified.
- [x] #3 Each traditional-code dependency is named for in-tree integration with a concrete current candidate identified by research.
- [x] #4 Each non-traditional dependency has a corresponding wpm-installer-package task in this backlog rather than a direct inline install.
- [x] #5 The five ownership modes (managed, local-external, remote-external, manual-BYO, disabled) are mapped onto each dependency for the reference profile.
- [x] #6 For each dependency the seam it plugs into is stated, so an alternative can later replace it with no core change.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Artifact: docs/architecture/dependency-strategy.md (267 lines). Rule-3: docs-driven fallback (recorded in artifact). Enumerates scenario-01 deps incl the capsule's separate layers (browser+automation, human-view stack, control protocol); classifies each in-tree-code vs host-touching (wpm bundle) with justification; names in-tree candidates; maps the 5 ownership modes + the seam per dependency. Table: Chromium/Playwright->GLA-007(Managed); noVNC/websockify/Xvfb->GLA-008(Managed); isolation runtime->GLA-009(process-tier T2 default, Docker alt); Caddy->GLA-010(Local-External, host TLS edge, GLA keeps grant verify); WebAuthn->in-tree @simplewebauthn default (authentik alt->GLA-011); Telegram->in-tree channel + CLI fallback; Cedar->in-tree policy-cedar->GLA-006. DependencyBinding contract (written by wpm, read+re-probed by GLA; availability system-derived).
<!-- SECTION:NOTES:END -->
