---
id: GLA-003
title: Scaffold the modular-monolith skeleton and quality gate
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 06:16'
labels:
  - foundation
  - impl
dependencies:
  - GLA-001
documentation:
  - docs/01-architecture-overview.md
  - docs/05-cli-and-entities.md
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the rest of the backlog needs a repository with enforced module boundaries and a runnable CLI entrypoint. Builds the empty skeleton and the quality gate every task's completion depends on. Depends on the architecture baseline. Out of scope: any module behaviour; the kernel contracts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The repository builds and typechecks from a clean checkout.
- [x] #2 The module boundaries from the architecture baseline exist as separate units, and a check fails the build if a core module imports a concrete adapter.
- [x] #3 A single CLI binary named gla is present and runs, returning the documented exit codes (0 success, 2 usage) for trivial invocations.
- [x] #4 The gla binary emits JSON to stdout by default and human-readable text only when stdout is a TTY.
- [x] #5 Lint, typecheck, and test all run through one documented entrypoint.
- [x] #6 A deliberately failing example in any quality gate is observable as a non-zero result, so the gate cannot be silently bypassed.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified green by orchestrator: pnpm gate (tsc -b + biome ci . + vitest 11/11) -> exit 0; pnpm gate:selftest rejects the deliberately-bad fixture (biome exit 1) -> guard works; gla version -> {client:0.1.0} exit 0; gla bogus -> JSON error exit 2; JSON emitted on non-TTY pipe. Layout per baseline §1: 15 packages/* (7 core + 5 core-adjacent + gateway/bridge + app) + 11 adapters/* (incl alternatives auth-authentik, launcher-docker) + 2 surfaces/* (cli,mcp) + tools/boundary-check. Import-boundary enforced twice: pnpm package graph (core cannot resolve adapter pkgs -> TS2307) + Biome noRestrictedImports (only packages/app exempt). Pins: TS 5.9.3, Biome 1.9.4, Vitest 3.2.6, Node 22 ESM, project references. CONTRIBUTING quality-gate table + .github/workflows/ci.yml wired to pnpm gate + gate:selftest; pnpm-lock.yaml committed. wpm/ installer project intentionally deferred (non-runtime).
<!-- SECTION:NOTES:END -->
