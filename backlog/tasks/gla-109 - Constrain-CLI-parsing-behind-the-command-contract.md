---
id: GLA-109
title: Adopt Commander-backed CLI parsing behind the command contract
status: Done
assignee: []
created_date: '2026-06-15 11:46'
updated_date: '2026-06-15 14:30'
labels:
  - tech-debt
  - cli
  - architecture
  - commander
dependencies:
  - GLA-094
  - GLA-107
references:
  - docs/05-cli-and-entities.md
  - surfaces/cli/src/cli.ts
  - surfaces/cli/src/contract.ts
  - surfaces/cli/src/transport.ts
  - 'https://github.com/tj/commander.js'
modified_files:
  - pnpm-lock.yaml
  - surfaces/cli/package.json
  - surfaces/cli/src/cli.ts
  - surfaces/cli/src/contract.ts
  - surfaces/cli/src/index.ts
  - surfaces/cli/test/integration/cli.test.ts
priority: high
ordinal: 122000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from the architecture/library review: the CLI parser must be refactored from the growing hand-written argument parser to a Commander-backed parser adapter. GLA's command contract, JSON output, redaction, daemon forwarding, deferred-surface reporting, and exit-code taxonomy remain the product boundary; Commander owns the low-level command/argument/flag parsing mechanics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The CLI package uses Commander for executable command parsing, including positionals, boolean flags, value flags, repeated flags, help dispatch, and parse failures.
- [x] #2 The existing command contract remains the authoritative source for executable commands, flags, args, effects, output shape, exit codes, and deferred surfaces; Commander configuration is derived from or checked against that contract.
- [x] #3 Root help, scoped help, and schema output preserve the current machine-readable shapes and continue to list deferred surfaces separately from executable commands.
- [x] #4 Unknown commands, unsupported deferred commands, unknown flags, missing flag values, bad field selections, and bad arguments still fail before any bridge mutation with stable usage error codes and exit code 2.
- [x] #5 Successful read, mutating, and blocking commands preserve the existing stdout JSON shapes, stderr JSON error envelope, redaction behavior, daemon-forwarding behavior, and exit-code taxonomy.
- [x] #6 The previous hand-maintained parser pathways are removed or reduced to contract-to-Commander mapping code, with no second source of command truth left behind.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Corrected GLA-109 implementation: adopted Commander-backed parsing behind the existing CLI command contract. The parser now builds a Commander command tree from CLI_COMMANDS, including positionals, value/boolean/repeated flags, help-mode arity, --flag=value syntax, and Commander parse-failure translation into the stable GLA JSON usage taxonomy. Machine help/schema preserve prior public shape and keep deferred surfaces separate; internal repeatable flag metadata is stripped from emitted schema/help. Process entry now runs parse/usage/help/deferred preflight before resolving or connecting to GLA_ENDPOINT, so daemon-unavailable state cannot mask usage errors. BMAD evidence: bmad-dev-story workflow loaded/resolved with Backlog.md docs-driven fallback; bmad-story-automator-review run by independent reviewer Planck, initial HIGH daemon-preflight finding fixed, re-review APPROVE. Verification: pnpm exec vitest run surfaces/cli/test/integration/cli.test.ts passed (81 tests); pnpm run typecheck passed; touched-file Biome passed; full pnpm run gate passed with 867 passed / 15 skipped.
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
