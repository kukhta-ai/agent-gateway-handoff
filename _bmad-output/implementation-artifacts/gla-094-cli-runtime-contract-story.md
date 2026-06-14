---
story: GLA-094
branch: feature/authentik-task-094
---

# Story GLA-094: Reconcile the CLI Runtime Contract with the Documented Surface

Status: done

Backlog source of truth: `backlog task GLA-094 --plain`

BMAD workflow invoked for Rule 3 evidence:
- `bmad-create-story`: invoked in this worker lane to create this context-filled story artifact.
- `bmad-dev-story`: implementation pass added the CLI contract registry, parser/help/schema behavior, docs split, and contract tests.
- `bmad-qa-generate-e2e-tests`: TEA lane mapped and validated focused CLI/transport contract tests.
- Skill files read: `/home/agent/.codex/skills/bmad-create-story/SKILL.md`, `discover-inputs.md`, `template.md`, and `checklist.md`.

Spec-exists fallback note: `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent. This story was created from the Backlog.md task contract plus committed docs/code, not from upstream BMAD sprint-status or planning artifacts. Backlog.md remains authoritative for task status, ACs, and DoD.

Implementation pass note: Backlog.md remains the source of truth for status, ACs, and DoD. This artifact records story context, implementation evidence, validation commands, and review handoff.

## Story

As a maintainer of the agent-facing CLI contract,
I want the documented CLI, help/schema output, parser, runtime behavior, and tests to agree on the current supported surface,
so agents can introspect and execute the scenario-control slice reliably while the future CLI vision remains preserved as explicitly deferred work.

## Acceptance Criteria

1. The docs, root help, command-scoped help, and runtime parser agree on the currently supported CLI commands: whoami, version, catalog list, template list/show, skill list/show, task create/get/list/complete/revoke, session create/get/list/connector/revoke, and handoff open/wait/get/list/cancel.
2. Documented but currently unsupported surfaces such as policy mounts, events, audit list, auth login/logout, ndjson streaming, context selection, trace correlation, and batch operations are either implemented intentionally or marked deferred in docs/help and rejected at runtime with stable unsupported diagnostics.
3. A machine-readable schema/help surface exists for the supported current commands and exposes each command's noun, verb, args, flags, output shape category, error codes, and whether the command reads, mutates, or blocks.
4. The documented scenario examples that use field masks and quiet mode work against the runtime: --fields returns only requested top-level fields from successful JSON results, unknown fields fail with a usage diagnostic, and --quiet does not suppress machine-readable results or errors.
5. Connection behavior is one coherent contract across docs and runtime: GLA_ENDPOINT and --endpoint semantics, daemon-shared state versus in-process fallback, local-profile no-login behavior, and unreachable daemon errors are described and observed consistently.
6. Output and error behavior is consistent with the agent-facing contract: stdout contains parseable results in agent mode, stderr contains parseable error objects in agent mode, text mode behavior is documented, and unsupported or invalid commands use the documented exit-code taxonomy.
7. Version and compatibility reporting accurately distinguish client-only, in-process, and connected-daemon cases without implying a server version is known when no daemon was queried.
8. Contract tests fail when docs/help/schema examples drift from the runtime parser for supported commands, global flags, exit codes, field masks, connection errors, and deferred-surface diagnostics.
9. Future CLI vision and planned surfaces from docs/05 remain preserved in a clearly labeled roadmap, future-contract, or deferred-surface section; the task may relabel unsupported features but must not delete the product direction for schema depth, policy, events, audit, auth, ndjson, context, trace correlation, MCP parity, or other planned agent-first CLI capabilities.

## Definition of Done

1. Typecheck passes with no errors.
2. Linter passes clean.
3. Tests are added for the change and the full suite is green.
4. Public functions and exported types are documented.
5. No dead code or unused exports are introduced.
6. The core import-boundary holds: core depends only on ports, never on concrete adapters.
7. Docs split the current supported CLI surface from deferred/future surface and include follow-up references for any deferred commands that remain intentionally unimplemented.
8. Tests cover root help, command-scoped machine help/schema, documented scenario snippets that use --fields, unsupported documented commands, endpoint resolution, output/error channels, and representative success and failure paths.
9. Documentation review confirms future CLI plans and agent-first design principles were preserved, separated from the current executable contract, and linked to follow-up backlog where implementation is deferred.

## Context Read

- `backlog task GLA-094 --plain`
- `docs/05-cli-and-entities.md`
- `docs/components/agent-bridge.md`
- `surfaces/cli/src/cli.ts`
- `surfaces/cli/src/index.ts`
- `surfaces/cli/src/output.ts`
- `surfaces/cli/src/transport.ts`
- `surfaces/cli/src/transport.test.ts`
- `surfaces/cli/src/cli.test.ts`
- `_bmad-output/implementation-artifacts/gla-093-authentik-gateway-e2e-proof-quality-story.md`

## Current Runtime Contract

`surfaces/cli/src/cli.ts` currently implements these agent-control commands:
- `whoami`
- `version`
- `catalog list`
- `template list`
- `template show <id>`
- `skill list`
- `skill show <id>`
- `task create`
- `task get <id>`
- `task list`
- `task complete <id>`
- `task revoke <id>`
- `session create`
- `session get <id>`
- `session list`
- `session connector <id>`
- `session revoke <id>`
- `handoff open`
- `handoff wait <id>`
- `handoff get <id>`
- `handoff list`
- `handoff cancel <id>`
- `auth diagnostics [--recipient <ref>]`

`auth diagnostics` is current runtime behavior from recent authentik work, but it is not in GLA-094 AC #1's current-command list. Treat this as a reconciliation point, not an instruction to delete it blindly. Either document/schema it as a current operator diagnostic extension or explicitly raise a main-agent decision if AC #1 is intended to be exclusive.

The root dispatcher parses `-o/--output json|text`, `-q/--quiet`, `-h/--help`, `-f/--file`, command-scoped `--name value` flags, and repeatable `--mount`, `--detector`, and `--entrypoint`. `--fields`, `--context`, `--trace-id`, `--no-input`, and `--output ndjson` are documented in `docs/05-cli-and-entities.md` but are not implemented as contract features.

`surfaces/cli/src/index.ts` implements process-level `--endpoint <path|host:port>` as an override for `GLA_ENDPOINT`; when no endpoint is resolved, the CLI composes a fresh in-process `AgentBridge` per invocation. With an endpoint, `DaemonBridgeClient` forwards commands to a running daemon over a local Unix socket or loopback TCP and maps unreachable daemon errors to `dependency.unavailable` / exit 8.

`surfaces/cli/src/output.ts` emits JSON results to stdout by default when stdout is not a TTY and text output when stdout is a TTY or `-o text` is forced. In JSON mode, errors are JSON objects on stderr. In text mode, errors are human text on stderr; the docs must describe that this is text-mode behavior, not agent-mode behavior.

`surfaces/cli/src/transport.ts` constrains daemon endpoints to Unix socket paths or loopback TCP (`127.0.0.1`, `[::1]`, `localhost`) and refuses URLs/public hosts with `usage.bad_argument`. `surfaces/cli/src/transport.test.ts` covers endpoint parsing, local endpoint classification, shared daemon bridge state, wire error serialization, and unknown daemon ops.

`surfaces/cli/src/cli.test.ts` covers existing success/error paths for version, help, whoami, catalog/template/skill reads, task/session/handoff operations, JSON/text output, endpoint redaction, exit-code mapping, admission rejects, handoff redaction, timeout remapping, and teardown verbs. It does not yet cover schema, command-scoped machine help, field masks, deferred-surface diagnostics, docs/help/parser drift, or version mode distinctions.

## Documented Future Contract To Preserve

`docs/05-cli-and-entities.md` intentionally defines an agent-first CLI vision beyond the current implementation:
- MCP parity over the same primitives.
- `gla schema [<noun> [<verb>]]` and command-scoped `--help -o json`.
- `policy mounts`.
- `events [--task <id>] [--follow]` as NDJSON.
- `audit list --task <id>`.
- authenticated profiles with `auth login/logout`.
- `--output ndjson`, `--fields`, `--no-input`, `--context`, `--trace-id`.
- batch operations as an open/future question.
- deeper schema exposure for assembly specs.

GLA-094 must not erase this product direction. The fix is separation and truthful labeling: current executable contract versus deferred/future contract, with stable runtime diagnostics for unsupported current invocations.

## Architecture Guardrails

- Keep the CLI a thin Agent Bridge transport. It must route to Bridge/Admission/Task/Session/Handoff primitives and must not implement authorization, capability minting, recipient binding, policy decisions, or retry cognition locally.
- Preserve trusted-local bridge semantics. Default local CLI/MCP does not add login, bearer tokens, mTLS, or per-call credentials. Remote/multi-agent authenticated profiles remain future work.
- Preserve endpoint safety from GLA-090. `--endpoint` and `GLA_ENDPOINT` must remain local-only: Unix socket or loopback TCP, never public URLs or `0.0.0.0`.
- Preserve agent-channel discipline. In agent JSON mode, stdout is parseable results and stderr is parseable error objects. Text mode is for humans and must be explicitly documented as text.
- Preserve future CLI vision. Relabel unsupported commands/flags as deferred; do not delete planned nouns, MCP parity, ndjson, context, trace correlation, audit/events, or schema depth from docs/05.
- Do not hand-edit backlog. If follow-up backlog is needed for deferred surfaces, use the Backlog CLI in a later implementation pass with main-agent coordination.
- Avoid source-of-truth drift. Define command metadata once if possible, then derive root help, command help, schema output, and parser validation from that metadata or test them against the same table.

## Developer Tasks / Subtasks

- [x] Define the current CLI command registry (AC: #1, #3, #8).
  - [x] Enumerate every supported command from the backlog AC and current runtime.
  - [x] Classify current `auth diagnostics` as a current daemon/operator diagnostic extension, not as agent login.
  - [x] Record noun, verb, args, flags, output shape category, read/mutate/block effect, and expected exit codes.
  - [x] Use the registry to drive root help, command-scoped help, schema output, field validation, and parser tests.
- [x] Split docs/05 into current contract and deferred/future contract (AC: #1, #2, #5, #9; DoD: #7, #9).
  - [x] Keep the scenario-01 current command sequence executable.
  - [x] Move unsupported planned surfaces into a clearly labeled deferred/future section.
  - [x] Keep follow-up references for schema depth, policy, events, audit, auth, ndjson, context, trace correlation, MCP parity, and batch operations.
  - [x] Add `GLA_ENDPOINT` and `--endpoint` semantics to the current connection contract.
- [x] Implement machine-readable schema/help for current commands (AC: #3, #8).
  - [x] Add `gla schema [<noun> [<verb>]]`.
  - [x] Add command-scoped `gla <noun> [<verb>] --help -o json`.
  - [x] Include args, flags, output shape category, error codes, and read/mutate/block effect.
  - [x] Ensure unsupported/deferred surfaces appear as deferred metadata or stable unsupported diagnostics, not as apparently supported commands.
- [x] Implement field masks and quiet-mode contract (AC: #4, #6, #8).
  - [x] Implement `--fields a,b,c` for successful JSON object and object-array results.
  - [x] Restrict masks to top-level fields; unknown requested fields fail with `usage.bad_field`.
  - [x] Ensure `--quiet` does not suppress machine-readable stdout results or stderr error objects.
  - [x] Verify the scenario-style `--fields ... -q` behavior through task/session/handoff contract tests.
- [x] Add stable unsupported diagnostics for deferred surfaces (AC: #2, #6, #8).
  - [x] Reject deferred nouns/flags with `usage.unsupported` and `detail.status: "deferred"`.
  - [x] Cover `policy mounts`, `events`, `audit list`, `auth login`, `auth logout`, `--output ndjson`, `--context`, `--trace-id`, and representative batch forms.
  - [x] Do not silently accept and ignore unsupported flags.
- [x] Reconcile connection and version behavior (AC: #5, #7, #8).
  - [x] Document and test `GLA_ENDPOINT` and `--endpoint` precedence.
  - [x] Test unreachable daemon exit 8 and non-local endpoint exit 2 with redacted diagnostics.
  - [x] Ensure version output distinguishes client-only/in-process/connected-daemon cases and does not invent a server version when no daemon was queried.
  - [x] Omit server version unless a real daemon/server version is available.
- [x] Harden output/error channel tests (AC: #6, #8).
  - [x] Keep stdout empty on errors in agent JSON mode.
  - [x] Keep stderr parseable JSON in agent JSON mode.
  - [x] Document and test text mode separately.
  - [x] Verify invalid commands, invalid flags, deferred commands, not found, timeout, conflict, dependency, and policy errors map to the documented exit taxonomy.

## AC-To-Test Map

| AC | Required test evidence |
| --- | --- |
| AC1 | Contract test compares docs current command table, root help, command-scoped help/schema, and parser-supported commands for the listed current surface. |
| AC2 | Tests invoke each deferred noun/flag and assert stable unsupported diagnostics, documented exit code, no state mutation, and docs/help label as deferred. |
| AC3 | Tests for `gla schema`, scoped schema, and `--help -o json` assert metadata includes noun, verb, args, flags, output category, error codes, and read/mutate/block classification. |
| AC4 | Tests run documented scenario snippets using `--fields task_id -q` and `--fields handoff_id -q`; unknown field masks fail with usage diagnostics; `--quiet` preserves JSON results/errors. |
| AC5 | Tests cover no-endpoint in-process behavior, `GLA_ENDPOINT`, `--endpoint` override, local endpoint acceptance, non-local refusal, unreachable daemon exit 8, and daemon shared state versus per-invocation in-process fallback. |
| AC6 | Tests assert stdout/stderr separation in JSON mode, text mode behavior, unsupported/invalid command exit codes, and representative taxonomy mapping. |
| AC7 | Tests cover `gla version` with no daemon, in-process mode, and connected daemon or explicit unknown-server case. |
| AC8 | A drift test fails if docs/help/schema examples diverge from runtime parser support, global flags, exit codes, fields behavior, connection errors, or deferred diagnostics. |
| AC9 | Documentation review/test checks future surfaces remain present under a deferred/future heading and are not presented as current executable commands. |

Recommended focused commands after implementation:
- `pnpm exec vitest run surfaces/cli/src/cli.test.ts surfaces/cli/src/transport.test.ts --reporter=dot`
- Any new docs/runtime drift test introduced for GLA-094
- `pnpm run gate`

## Files Likely to Change

- `docs/05-cli-and-entities.md`
- `docs/components/agent-bridge.md` if the Bridge component contract needs a current-vs-future clarification.
- `surfaces/cli/src/cli.ts`
- `surfaces/cli/src/index.ts`
- `surfaces/cli/src/output.ts`
- `surfaces/cli/src/transport.ts`
- `surfaces/cli/src/cli.test.ts`
- `surfaces/cli/src/transport.test.ts`
- A new CLI contract/schema helper or fixture under `surfaces/cli/src/` if a single command registry is introduced.
- A docs/help drift test fixture if implemented separately from `cli.test.ts`.

## Implementation Notes

Prefer a single command metadata source over parallel hand-maintained strings. The current `USAGE`, `NOUNS`, parser switch, and tests can drift because they are separate. A small `COMMANDS` registry can support `schema`, root help, command help, parser validation, and drift tests without building the full future CLI.

Field masks should initially be top-level only because AC #4 names top-level fields. If nested masks are desired, defer them explicitly; do not silently implement a partial nested syntax that agents may depend on.

Unsupported diagnostics should be stable and machine-parseable. Avoid returning generic `usage.unknown_command` for documented-but-deferred surfaces if the docs list them as future; a distinct unsupported code makes agent behavior and tests clearer.

`--quiet` currently has no practical effect because the CLI emits no progress output. That can satisfy the "does not suppress results/errors" half only after tests prove results and errors remain present with `-q`.

Version behavior must not over-claim. With no daemon, `{client, mode:"in-process"}` or equivalent is safer than a missing or invented server field. With a daemon, either query a real server/version op or state that server version is unavailable.

The `auth diagnostics` command is a current runtime addition and daemon/operator diagnostic path. Do not remove it without an explicit main-agent decision; reconcile it in docs/help/schema as current extra surface or identify it as an allowed non-agent operator diagnostic.

## Risks / Anti-Patterns

- Scope creep: implementing all future docs/05 nouns would exceed GLA-094. Mark deferred surfaces explicitly unless intentionally promoted.
- Vision loss: deleting future CLI direction would violate AC #9. Separate current from future instead.
- Silent flag acceptance: ignored `--fields`, `--context`, or `--trace-id` is worse than a stable unsupported error because agents will believe the request worked.
- Source-of-truth drift: updating docs, help strings, schema output, and parser separately without a drift test will recreate this issue.
- Output-channel regression: text-mode changes must not break JSON mode's stdout/stderr parseability for agents.
- Endpoint overreach: do not broaden `--endpoint`/`GLA_ENDPOINT` beyond local Unix socket or loopback TCP.
- Auth over-hardening: do not add login/tokens/mTLS to trusted-local CLI as part of this task.
- Compatibility over-claim: do not report a server version unless a connected daemon actually provided it.

## Open Implementation Risks

- `auth diagnostics` is intentionally preserved as a current daemon/operator diagnostic extension. It remains distinct from deferred `auth login/logout`.
- Docs/runtime drift is guarded by a focused docs/current-contract test rather than parsing the whole Markdown table as a schema source.
- Command-scoped help is intentionally machine-first. Human text help is generated from the same registry but remains concise.
- Connected-daemon version reporting currently reports connection mode and omits server version unless a real server value is later available.

## Verification Evidence

- `pnpm run lint:fix`: passed; Biome checked 197 files.
- `pnpm exec vitest run surfaces/cli/src/cli.test.ts surfaces/cli/src/transport.test.ts --reporter=dot`: passed, 80 tests.
- `pnpm run typecheck`: passed.
- `pnpm run gate`: passed; 64 test files, 726 passed, 15 skipped.

Review follow-up evidence:
- Architect review found `auth diagnostics --fields summary,concerns` did not match the real diagnostic read model; fixed by aligning the registry fields with the current `AuthDiagnostics` shape and adding a regression test.
- Reviewer review found unknown command-scoped flags were silently accepted and could allow mutating commands to execute; fixed by validating parsed command flags against the command registry before dispatch and adding no-mutation regression tests.
- Registry reconciliation found `session create --intent` was an actually supported parser/runtime flag missing from the command metadata; fixed by adding it to the registry instead of weakening validation.
- Architect follow-up found docs/05 omitted current `session create --intent`; fixed by adding the flag to the current executable command tree and the target per-command action signature.
- Reviewer follow-up found value-bearing flags without values could still dispatch; fixed by deriving required-value flags from the command registry and rejecting missing values before mutation.
- Reviewer follow-up found valueless boolean flags could consume values and change mutating behavior; fixed by rejecting unexpected values for registry-declared boolean flags before dispatch.
- TEA/security follow-up found docs scenario snippets treated masked JSON objects as scalar IDs; fixed docs to parse masked JSON and to retrieve connector data through `gla session connector`, with a scenario-style regression test.
- Final specialist statuses: Mill architecture APPROVE, Wegener adversarial review APPROVE, Helmholtz TEA/security PASS.

## Dev Agent Record

Worker: Dirac, persistent worker/dev specialist

Created by: `bmad-create-story` workflow in spec-exists fallback mode

Source of truth: Backlog task GLA-094 and committed docs/code

Completion notes:
- Added a current CLI contract registry used by root help, command-scoped help, schema output, and field-mask validation.
- Implemented `gla schema`, scoped machine help, top-level `--fields`, stable deferred diagnostics, and version connection-mode reporting.
- Added command-scoped flag validation from the command registry so unsupported flags, missing required values, and unexpected values for boolean flags fail with `usage.bad_flag` before command dispatch or mutation.
- Preserved `auth diagnostics` as a daemon/operator diagnostic extension while rejecting `auth login/logout` as deferred.
- Split `docs/05-cli-and-entities.md` into current executable contract and future/target CLI roadmap without deleting the future vision.
- Added contract tests for supported command inventory, docs/help/schema drift, deferred surfaces, field masks, unknown/missing-value/unexpected-value command flags with no-mutation behavior, documented field-mask snippet reuse, quiet mode, endpoint override/failure, output/error channels, `session connector`, and version modes.

File List:
- `.bmad/sdlc-state.yaml`
- `_bmad-output/implementation-artifacts/gla-094-cli-runtime-contract-story.md`
- `_bmad-output/implementation-artifacts/tests/test-summary.md`
- `backlog/tasks/gla-094 - Align-CLI-runtime-contract-with-documented-commands.md`
- `docs/05-cli-and-entities.md`
- `surfaces/cli/src/cli.test.ts`
- `surfaces/cli/src/cli.ts`
- `surfaces/cli/src/contract.ts`
- `surfaces/cli/src/index.ts`
