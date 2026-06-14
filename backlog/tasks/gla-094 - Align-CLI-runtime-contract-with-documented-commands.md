---
id: GLA-094
title: Reconcile the documented CLI contract with the runtime surface
status: Done
assignee: []
created_date: '2026-06-12 23:00'
updated_date: '2026-06-14 11:14'
labels:
  - cli
  - docs
  - contract
  - consistency
  - hardening
dependencies:
  - GLA-066
references:
  - docs/05-cli-and-entities.md
  - docs/components/agent-bridge.md
  - surfaces/cli/src/cli.ts
  - surfaces/cli/src/index.ts
  - surfaces/cli/src/output.ts
  - surfaces/cli/src/transport.ts
  - surfaces/cli/src/cli.test.ts
priority: medium
ordinal: 94000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: validation against docs/05 and the current CLI implementation shows that the documentation describes both implemented commands and aspirational future surface as if all of it were currently available. The runtime supports the scenario control slice (whoami, version, catalog/template/skill reads, task/session/handoff operations) but docs also promise schema, policy, events, audit, auth, ndjson streams, field masks, context/trace globals, command-scoped machine help, and daemon connection behavior that are not consistently implemented or clearly marked.

Scope: this task reconciles the agent-facing CLI contract for the current product slice. It should make the implemented surface truthful, self-describing, and test-backed; implement small contract features that current docs and examples already rely on, especially field masks and machine-readable schema/help for supported commands; and explicitly mark or reject deferred nouns and flags instead of silently presenting them as working.

Boundaries: this is not a task to implement the whole future CLI. It does not need to build event streaming, audit browsing, authenticated-agent login, full policy inspection, MCP parity, or batch operations unless the implementation intentionally promotes one of those surfaces to the supported current contract. Deferred surfaces must be visible as deferred/unsupported with stable diagnostics and follow-up backlog, not half-implemented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The docs, root help, command-scoped help, and runtime parser agree on the currently supported CLI commands: whoami, version, catalog list, template list/show, skill list/show, task create/get/list/complete/revoke, session create/get/list/connector/revoke, and handoff open/wait/get/list/cancel.
- [x] #2 Documented but currently unsupported surfaces such as policy mounts, events, audit list, auth login/logout, ndjson streaming, context selection, trace correlation, and batch operations are either implemented intentionally or marked deferred in docs/help and rejected at runtime with stable unsupported diagnostics.
- [x] #3 A machine-readable schema/help surface exists for the supported current commands and exposes each command's noun, verb, args, flags, output shape category, error codes, and whether the command reads, mutates, or blocks.
- [x] #4 The documented scenario examples that use field masks and quiet mode work against the runtime: --fields returns only requested top-level fields from successful JSON results, unknown fields fail with a usage diagnostic, and --quiet does not suppress machine-readable results or errors.
- [x] #5 Connection behavior is one coherent contract across docs and runtime: GLA_ENDPOINT and --endpoint semantics, daemon-shared state versus in-process fallback, local-profile no-login behavior, and unreachable daemon errors are described and observed consistently.
- [x] #6 Output and error behavior is consistent with the agent-facing contract: stdout contains parseable results in agent mode, stderr contains parseable error objects in agent mode, text mode behavior is documented, and unsupported or invalid commands use the documented exit-code taxonomy.
- [x] #7 Version and compatibility reporting accurately distinguish client-only, in-process, and connected-daemon cases without implying a server version is known when no daemon was queried.
- [x] #8 Contract tests fail when docs/help/schema examples drift from the runtime parser for supported commands, global flags, exit codes, field masks, connection errors, and deferred-surface diagnostics.
- [x] #9 Future CLI vision and planned surfaces from docs/05 remain preserved in a clearly labeled roadmap, future-contract, or deferred-surface section; the task may relabel unsupported features but must not delete the product direction for schema depth, policy, events, audit, auth, ndjson, context, trace correlation, MCP parity, or other planned agent-first CLI capabilities.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented current CLI contract registry, schema/help, field masks, deferred diagnostics, endpoint/version reconciliation, and parser validation for unknown flags, missing values, and unexpected boolean values. Docs/05 now separates current executable contract from future/target roadmap and scenario snippets parse masked JSON IDs before reuse. Rule-3 evidence: bmad-create-story, bmad-dev-story, bmad-qa-generate-e2e-tests, and bmad-story-automator-review were used in the persistent lanes. Final specialist statuses: Mill APPROVE, Wegener APPROVE, Helmholtz PASS. Validation: pnpm run lint:fix; focused CLI/transport 80 tests; pnpm run typecheck; pnpm run gate with 64 files, 726 passed, 15 skipped.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [x] #7 Docs split the current supported CLI surface from deferred/future surface and include follow-up references for any deferred commands that remain intentionally unimplemented.
- [x] #8 Tests cover root help, command-scoped machine help/schema, documented scenario snippets that use --fields, unsupported documented commands, endpoint resolution, output/error channels, and representative success and failure paths.
- [x] #9 Documentation review confirms future CLI plans and agent-first design principles were preserved, separated from the current executable contract, and linked to follow-up backlog where implementation is deferred.
<!-- DOD:END -->
