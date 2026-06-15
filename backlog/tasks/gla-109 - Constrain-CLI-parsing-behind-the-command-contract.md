---
id: GLA-109
title: Constrain CLI parsing behind the command contract
status: Done
assignee: []
created_date: '2026-06-15 11:46'
updated_date: '2026-06-15 13:07'
labels:
  - tech-debt
  - cli
  - architecture
dependencies:
  - GLA-094
  - GLA-107
references:
  - docs/05-cli-and-entities.md
  - surfaces/cli/src/cli.ts
  - surfaces/cli/src/contract.ts
  - surfaces/cli/src/transport.ts
priority: medium
ordinal: 122000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from the architecture/library review: the CLI now has a growing hand-written parser while the command contract already lives in surfaces/cli/src/contract.ts. The selected direction is to keep GLA's machine-readable command contract, JSON output, redaction, and daemon forwarding behavior authoritative while allowing a constrained parser adapter such as Commander to own low-level argument parsing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every current executable CLI command accepts the same documented arguments and flags as the command contract exposes.
- [x] #2 Root help, scoped help, and schema output remain derived from the same current command contract and continue to list deferred surfaces separately from executable commands.
- [x] #3 Unknown commands, unsupported deferred commands, unknown flags, missing flag values, bad field selections, and bad arguments still fail before any bridge mutation with stable usage error codes and exit code 2.
- [x] #4 Successful commands preserve the existing stdout JSON shapes, stderr JSON error envelope, redaction behavior, and exit-code taxonomy.
- [x] #5 In-process and daemon-forwarded command execution remain equivalent at the CLI boundary for read, mutating, and blocking commands.
- [x] #6 The parser layer does not become a second source of command truth: adding or changing an executable command requires updating one authoritative command contract.
<!-- AC:END -->













## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GLA-109 implemented on feature/provider-graph-task-109. Evidence: bmad-create-story/dev-story/qa-generate-e2e-tests/story-automator-review were handled via explicit docs/Backlog.md fallback because BMAD sprint story files are absent; independent reviewer Planck ran adversarial story review and re-review cycles, final result: no blocking findings. Quality gate passed: pnpm run gate (typecheck, Biome CI, required browser preflight, 859 tests passed / 15 skipped). CLI parser now derives deferred command matching and arg/flag/field validation from surfaces/cli/src/contract.ts, exposes catalog show, rejects bad args/flags/fields before dispatch, and keeps deferred UX flows explicit. Serve enrollment policy parsing now uses the provider selected by profile resolution.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
