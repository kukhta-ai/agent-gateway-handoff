---
id: GLA-109
title: Adopt Commander-backed CLI parsing behind the command contract
status: To Do
assignee: []
created_date: '2026-06-15 11:46'
updated_date: '2026-06-15 13:30'
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
  - surfaces/cli/package.json
  - surfaces/cli/src/cli.ts
  - surfaces/cli/src/contract.ts
  - surfaces/cli/src/transport.ts
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
- [ ] #1 The CLI package uses Commander for executable command parsing, including positionals, boolean flags, value flags, repeated flags, help dispatch, and parse failures.
- [ ] #2 The existing command contract remains the authoritative source for executable commands, flags, args, effects, output shape, exit codes, and deferred surfaces; Commander configuration is derived from or checked against that contract.
- [ ] #3 Root help, scoped help, and schema output preserve the current machine-readable shapes and continue to list deferred surfaces separately from executable commands.
- [ ] #4 Unknown commands, unsupported deferred commands, unknown flags, missing flag values, bad field selections, and bad arguments still fail before any bridge mutation with stable usage error codes and exit code 2.
- [ ] #5 Successful read, mutating, and blocking commands preserve the existing stdout JSON shapes, stderr JSON error envelope, redaction behavior, daemon-forwarding behavior, and exit-code taxonomy.
- [ ] #6 The previous hand-maintained parser pathways are removed or reduced to contract-to-Commander mapping code, with no second source of command truth left behind.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
