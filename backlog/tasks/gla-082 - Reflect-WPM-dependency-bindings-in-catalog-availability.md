---
id: GLA-082
title: Reflect WPM install receipts in catalog availability
status: To Do
assignee: []
created_date: '2026-06-12 20:02'
updated_date: '2026-06-12 22:12'
labels:
  - hardening
  - catalog
  - dependency
  - wpm
  - availability
  - installer
  - architecture
dependencies:
  - GLA-005
  - GLA-007
  - GLA-008
  - GLA-009
  - GLA-010
  - GLA-011
  - GLA-017
  - GLA-021
  - GLA-074
references:
  - >-
    _bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md
  - docs/01-architecture-overview.md
  - docs/02-provider-and-extension-model.md
  - docs/architecture/dependency-strategy.md
  - docs/architecture/test-strategy.md
  - wpm/wip/README.md
  - wpm/wip/_AGENTS.md
  - wpm/wip/RALPH-LOOP.md
  - wpm/wip/installer-skills/gla-installer/references/journaling.md
  - wpm/wip/bundles/gla-core/_AGENTS.md
  - wpm/wip/bundles/browser-runtime/_AGENTS.md
  - wpm/wip/bundles/edge-proxy/_AGENTS.md
  - wpm/wip/bundles/human-view/_AGENTS.md
  - wpm/wip/bundles/identity-provider/_AGENTS.md
  - packages/catalog/src/manifests.ts
  - packages/catalog/src/index.ts
priority: high
ordinal: 82000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: catalog availability currently treats seeded provider dependencies as already bound even when no real WPM DependencyBinding receipt or live probe proves the dependency is usable. Orientation and admission should reflect actual host dependency evidence produced by WPM's install loop, not assumed seeded state.

Architectural framing: this task sits on the GLA↔WPM seam. WPM deliberately combines deterministic classic installation artifacts (bundle manifests, payload templates/files, installer scripts, probes, checksums, typed Backlog.md task fields) with agent-instruction-driven adaptation (detect the actual host, choose install vs adopt vs manual/remote, ask for consent, record decisions and inverse ops). GLA must consume the resulting structured receipt as dependency evidence and re-probe it at runtime; GLA must not become an installer or trust free-form agent memory.

Boundaries: pure in-tree providers can remain probe-derived without WPM receipts; host-touching dependencies need recorded binding and current availability evidence. WPM owns detect/setup/verify/record and host mutation; GLA owns read-only binding ingest, runtime probes, catalog orientation, and admission decisions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With no recorded dependency binding for a host-touching dependency, every provider and template that requires it is reported unavailable, excluded from available catalog listings, and visible in template details as a missing dependency.
- [ ] #2 With a valid dependency binding whose ownership, connection, installed or adopted state, and last probe result are usable, and whose current GLA probe succeeds, dependent providers and templates are reported available.
- [ ] #3 If a recorded binding is missing required evidence, is disabled, has no successful last probe, or has a current probe that reports degraded or unavailable, dependent providers and templates are not reported available.
- [ ] #4 Admission uses the same derived availability as orientation: a proposal requiring an unavailable provider is rejected with catalog.unavailable, exit 8, and no session or capsule is created.
- [ ] #5 Template details for browser-handoff report each required part's backing dependency evidence, including dependency name, ownership mode, installed/adopted state, and last probe result, while showing connection secrets only as secret references.
- [ ] #6 A fresh catalog with no binding source no longer reports host-touching reference providers as available from seeded bound data; pure in-tree providers with no host dependency can still become available from their own probe result.
- [ ] #7 Catalog availability distinguishes deterministic WPM bundle evidence from agent-recorded environment decisions: bundle identity/version, declared requires, payload/template or file refs, probe result, ownership mode, installed/adopted/manual/remote/disabled state, connection references, and inverse-op/decision notes are visible as separate evidence classes where applicable.
- [ ] #8 A DependencyBinding derived from a WPM receipt is accepted only when the structured evidence needed by the dependency contract is present and machine-readable; free-form prose, prior conversation context, seeded defaults, or unchecked task status alone cannot make a host-touching dependency available.
- [ ] #9 Managed, adopted/local-external, remote-external, manual-BYO, and disabled dependency outcomes are represented without collapsing their ownership semantics; catalog details expose enough evidence for repair/uninstall safety while never exposing connection secrets except as secret references.
- [ ] #10 GLA runtime never executes WPM install, repair, uninstall, package-manager, service-manager, or host-mutation steps while deriving availability; it only ingests binding evidence and runs current runtime probes.
- [ ] #11 WPM receipt evidence and GLA runtime probes answer different questions in diagnostics: install convergence versus current runtime health are reported separately when a dependency is unavailable or degraded.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Prepared from the transcript comparison and independent subagent draft: Heisenberg/catalog-availability.

Architecture correction requested by user: plan this task from the WPM vision, where deterministic installer artifacts and probes are combined with agent-instruction-driven host adaptation. The catalog should consume structured receipts and current probes, not assume a fully scripted installer or trust conversation-memory state.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [ ] #7 Architecture gate completed: the GLA runtime catalog/binding-ingest seam and the WPM executor/receipt seam are documented, including which deterministic installer artifacts and which agent-adaptive receipt facts cross into GLA.
- [ ] #8 Docs and installer guidance preserve the WPM vision: deterministic artifacts are used where they can be pre-authored, agent instructions handle host-specific adaptation, receipts are the source of truth across resumes, and GLA remains a runtime consumer rather than an installer.
- [ ] #9 Fixtures or tests cover managed install, adopted existing dependency, remote/manual binding, disabled dependency, missing structured receipt evidence, stale/degraded probe evidence, and secret-reference-only connection reporting.
<!-- DOD:END -->
