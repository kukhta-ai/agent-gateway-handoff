# Story GLA-090: Verify local Agent Bridge isolation and socket hygiene

Status: implemented-reviewed

Source task: GLA-090 via `backlog task GLA-090 --plain`
Branch: feature/authentik-task-090
BMAD workflows invoked: `bmad-create-story`, then `bmad-dev-story` in planning-only mode before source edits
Workflow mode: spec-exists fallback. `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent, so Backlog.md remains the story contract and committed docs/code provide implementation context.

## Story

As the operator of the trusted-local GLA reference profile,
I want the Agent Bridge endpoint to be isolated by local OS socket ownership and permissions,
so that the same-user agent and CLI keep working without credentials while other local users, unsafe paths, and accidental network exposure fail closed.

## Acceptance Criteria

1. The trusted-local default bridge remains usable by the same-user agent and CLI without a login prompt, bearer token, mTLS certificate, or per-call credential ceremony.
2. The default Unix-domain bridge endpoint is usable only when its runtime directory and socket path are owned and permissioned so other local users cannot open, replace, or pre-create the endpoint.
3. Unsafe bridge endpoint paths, including symlinks, regular files, directories, wrong-owner paths, unsafe parent directories, or replaced sockets, fail before security-bearing operations are served and produce actionable diagnostics.
4. Non-local bridge endpoints are refused; loopback TCP, if supported, is explicitly identified as a development or advanced mode and is not presented as equivalent to a private Unix-domain socket for cross-user isolation.
5. Trusted-local documentation states that same-UID compromise is out of scope and points remote, multi-agent, multi-tenant, per-agent attribution, and revocation needs to a separate authenticated-agent profile.
6. Bridge and CLI diagnostics for refused endpoints do not disclose raw grants, secret values, local sensitive paths beyond what is needed for repair, or request bodies.

## Scope Guardrails

- Do not add a login prompt, bearer token, mTLS certificate, per-call credential, or agent AuthProvider requirement to the trusted-local default path.
- Do not change `AgentBridge.connect()` local-profile semantics. It still admits the co-deployed local agent and mints the `agent-authority` anchor without credential verification.
- Do not implement the future authenticated-agent profile. Remote bridge, multi-agent, multi-tenant, per-agent attribution, and per-agent revocation remain separate profile work.
- Do not defend against a compromised same-UID process. The trusted-local boundary is OS user and local endpoint isolation, not same-UID adversarial containment.
- Do not expose the Bridge publicly. The Access Gateway remains the sole public entry; the Bridge remains local/private.

## Context Read

- `docs/task-writing-conventions.md`
- `docs/components/agent-bridge.md`
- `docs/components/identity-and-auth.md`
- `docs/architecture/baseline.md`
- `docs/05-cli-and-entities.md`
- `packages/app/src/daemon.ts`
- `packages/app/src/daemon.test.ts`
- `packages/app/src/daemon-state.ts`
- `packages/app/src/daemon-state.test.ts`
- `packages/bridge/src/index.ts`
- `surfaces/cli/src/transport.ts`
- `surfaces/cli/src/transport.test.ts`
- `surfaces/cli/src/index.ts`
- `surfaces/cli/src/cli.test.ts`

## Current Behavior Model

- `docs/components/agent-bridge.md` defines the Bridge as the agent's enforcement point and protocol adapter. It triggers authentication only when a deployment profile requires it; in trusted-local it admits based on verified local isolation and then anchors `agent-authority`.
- `docs/architecture/baseline.md` §5 says agent authentication is deferred in the local single-operator profile and replaced by verified Bridge network isolation. Strict or multi-tenant profiles require mTLS or signed tokens later.
- `packages/bridge/src/index.ts` implements `DEFAULT_LOCAL_PROFILE` and `AgentBridge.connect()` with no credential argument. This must remain true for GLA-090.
- `packages/app/src/daemon.ts` binds the public Access Gateway separately from the local Agent Bridge. `endpointIsLocal()` already refuses `0.0.0.0` and other non-loopback host:port endpoints.
- `defaultBridgeEndpoint()` currently prefers `$XDG_RUNTIME_DIR/gla.sock`, else `/run/gla.sock`.
- `prepareUdsPath()` currently creates the parent directory if missing and unlinks any existing path before `server.listen()`. It does not validate parent ownership/mode, path type, symlink status, stale-vs-live socket state, wrong owner, or post-bind socket permissions.
- `surfaces/cli/src/transport.ts` treats any non-`host:port` endpoint as a Unix-domain socket path and sends JSON-RPC over it. It does not currently reject non-local TCP endpoints on the client side; daemon-side bind refusal exists.
- `surfaces/cli/src/index.ts` reports daemon connection failures with the endpoint string and error message. GLA-090 diagnostics must remain repairable but redacted and must not include request bodies or security-bearing values.
- `packages/app/src/daemon-state.ts` already has secure filesystem patterns for persisted daemon state: path resolution, symlink rejection, 0700/0600 permissions, owner locking, and redacted diagnostics. Reuse patterns where appropriate, but keep bridge socket hygiene separate from persisted state storage.

## Architecture Constraints

- The Bridge is an edge package and thin transport over server-side admission, task, session, capability, and policy seams. It must not import adapters or acquire business logic.
- The app composition root owns binding the daemon and socket listener. Filesystem socket validation belongs in or near `packages/app/src/daemon.ts` unless extracted to a small app-local helper.
- The CLI transport owns client connection parsing and diagnostics, not daemon bind policy. It may refuse obviously non-local endpoints before connecting, but it must not add credentials to the local profile.
- Unix-domain socket isolation must be based on directory ownership and permissions. The implementation should prefer a private runtime directory owned by the current uid, with no group/world write access, and a socket file owned by the current uid with restrictive mode.
- Existing `/run/gla.sock` fallback must fail with actionable diagnostics when the process cannot create or secure it. Do not silently downgrade to an unsafe world-writable directory.
- Loopback TCP is local-network only, not cross-user isolation. If retained, startup and docs must label it as development or advanced mode and not equivalent to a private Unix socket.
- All refusal diagnostics must pass through existing redaction behavior where possible, such as `redactDaemonState()` / `redactOperatorText()`.

## Tasks and Subtasks

- [x] Define bridge endpoint hygiene checks without changing trusted-local authentication semantics. (AC: #1, #2, #3, #4)
  - [x] Keep same-user daemon/CLI round-trip tests passing with no token, login, mTLS, or per-call credential.
  - [x] Add a narrow endpoint-classification or validation helper for Unix sockets and TCP endpoints.
  - [x] Keep non-local TCP refusal fail-fast before serving bridge operations.

- [x] Harden Unix-domain socket bind preparation in the daemon. (AC: #2, #3)
  - [x] Reject relative paths, symlink components, regular files, directories at the socket path, wrong-owner paths, unsafe parent directories, and paths whose parent can be modified by other local users.
  - [x] Remove only safe stale sockets owned by the current uid, and do not blindly unlink arbitrary existing filesystem entries.
  - [x] After `listen()`, verify the bound socket path is still a socket owned by the current uid and apply/verify restrictive socket mode where the platform supports it.
  - [x] On shutdown, remove only the socket path that this daemon owns and only when it is still safe to do so.

- [x] Make refused endpoint diagnostics actionable and redacted. (AC: #3, #4, #6)
  - [x] Use stable messages that identify the unsafe category and minimal repair action.
  - [x] Avoid echoing raw request bodies, grants, secret-looking values, or overly broad local paths.
  - [x] Keep CLI failure shape compatible with existing exit-code and JSON/text output contracts.

- [x] Document the trusted-local bridge profile. (AC: #4, #5)
  - [x] State same-UID compromise is out of scope.
  - [x] State trusted-local relies on private Unix socket isolation, not agent credentials.
  - [x] State loopback TCP is development/advanced mode, not equivalent to Unix-socket cross-user isolation.
  - [x] Point remote, multi-agent, multi-tenant, per-agent attribution, and revocation needs to a separate authenticated-agent profile.

- [x] Add focused tests and run the quality gate. (AC: #1-#6)
  - [x] Add daemon filesystem tests for unsafe runtime directories, stale sockets, symlinks, replaced endpoints, wrong-owner paths where testable, regular files, directories, and safe same-user sockets.
  - [x] Add transport/CLI tests for non-local endpoint refusal, loopback labeling, and redacted refused-endpoint diagnostics.
  - [x] Run focused tests first, then `pnpm run gate`.

## AC-to-Test Plan

- AC1: Extend the existing daemon round-trip test in `packages/app/src/daemon.test.ts` or add a focused test proving `gla whoami` / `task create` over the default trusted-local bridge still works without `GLA_TOKEN`, login, mTLS, certificate config, or a credential field in bridge requests.
- AC2: Add daemon tests that create a private temp runtime directory, start `serve()` on `gla.sock`, assert directory mode/owner expectations, assert the socket exists as a socket, and assert same-user CLI can connect. Add failure tests for group/world-writable runtime directories and unsafe parents.
- AC3: Add focused tests for symlink endpoint path, symlink parent, regular file at endpoint, directory at endpoint, existing live/replaced socket, stale safe socket, wrong-owner path when the platform/test environment can simulate it, and unsafe parent directory. Each refusal must occur before `serveBridgeConnection()` can process a security-bearing op.
- AC4: Preserve existing `endpointIsLocal("0.0.0.0:...") === false` coverage and add client/daemon tests for non-loopback TCP refusal. If loopback TCP remains supported, tests must assert diagnostics/banner/help identify it as development or advanced mode, not Unix-socket-equivalent isolation.
- AC5: Add/update documentation tests or doc assertions covering trusted-local attacker model, same-UID out of scope, Unix-socket permission expectations, loopback limitations, and future authenticated-agent profile triggers.
- AC6: Add diagnostics tests with canary endpoint/request values containing grant-shaped and secret-shaped strings. Assert daemon startup errors, CLI connection errors, and transport wire errors redact grants/secrets, avoid request bodies, and expose only minimal repairable endpoint information.

## Files Likely to Change

- `packages/app/src/daemon.ts`
- `packages/app/src/daemon.test.ts`
- `surfaces/cli/src/transport.ts`
- `surfaces/cli/src/transport.test.ts`
- `surfaces/cli/src/index.ts`
- `surfaces/cli/src/cli.test.ts`
- `docs/components/agent-bridge.md`
- `docs/components/identity-and-auth.md`
- `docs/05-cli-and-entities.md`
- Possibly a new app-local helper/test pair such as `packages/app/src/bridge-socket.ts` and `packages/app/src/bridge-socket.test.ts` if keeping daemon.ts small is cleaner.

## Implementation Plan from bmad-dev-story

1. Start with tests, not implementation. Add RED tests for safe default same-user behavior, unsafe Unix socket paths, non-local endpoints, loopback diagnostics, and redaction.
2. Extract endpoint parsing/validation only as much as needed. A small helper should classify `unix`, `loopback-tcp`, and `non-local-tcp`; it should not introduce auth or profile negotiation.
3. Replace permissive `prepareUdsPath()` behavior with safe Unix-socket preparation:
   - Resolve and require an absolute socket path.
   - Validate parent directory ownership and mode before bind.
   - Reject symlinks and non-socket existing paths.
   - Treat existing live sockets as conflict, not stale cleanup.
   - Remove only owned stale socket files in safe directories.
4. Verify the post-bind socket and apply restrictive mode. If platform behavior differs, fail with a clear diagnostic or test-gate the assertion by platform while keeping Linux behavior covered.
5. Harden CLI/daemon diagnostics by redacting secret-like endpoint strings and avoiding request-body echo. Use existing redaction utilities instead of inventing a new secret scanner.
6. Update trusted-local docs to describe the OS boundary, same-UID out-of-scope assumption, loopback limitations, and authenticated-agent profile triggers.
7. Run focused tests:
   - `pnpm exec vitest run packages/app/src/daemon.test.ts surfaces/cli/src/transport.test.ts surfaces/cli/src/cli.test.ts`
   - Any new focused socket helper tests.
   - Final: `pnpm run gate`.

## Security Risks to Watch

- Over-hardening by adding default bridge credentials would violate the task and architecture. Local default must stay no-login/no-token/no-mTLS.
- Under-hardening by only checking `endpointIsLocal()` would leave filesystem socket replacement, pre-creation, and cross-user access risks unresolved.
- Blindly unlinking existing paths is dangerous: it can delete regular files, follow unsafe setup assumptions, or disrupt another live daemon.
- World-writable or wrong-owner parent directories allow another local user to replace or pre-create the socket even if the socket path itself looks safe.
- Loopback TCP does not provide cross-user isolation on a shared host. Treat it as development/advanced, not equivalent to a private Unix socket.
- Same-UID compromise remains out of scope; do not claim this task prevents a malicious process running as the same user from using or racing the bridge.
- Diagnostics can accidentally leak raw grants, secrets, request bodies, or sensitive local paths. Redact canaries and keep repair detail minimal.
- Some owner/mode checks are platform-sensitive. Tests should cover Linux behavior directly and avoid pretending unsupported platforms provide the same guarantees.

## Open Decisions for Main Agent

- Whether to keep `/run/gla.sock` as the fallback default or prefer a user-owned runtime path when `$XDG_RUNTIME_DIR` is absent. If `/run/gla.sock` remains, startup must fail with a repairable diagnostic when it cannot be made private for the current user.
- Exact policy for existing owned stale sockets: remove only if confirmed stale, or always fail with a repair action. Either is acceptable if it prevents live/replaced socket takeover and is tested.
- Whether loopback TCP should remain accepted at all. If retained, it needs explicit dev/advanced labeling in startup diagnostics and docs.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-13: Invoked `bmad-create-story`; sprint-status absent, so used Backlog task GLA-090 and committed docs/code as the spec-exists story source.
- 2026-06-13: Invoked `bmad-dev-story` in planning mode only and stopped before source edits per user instruction.

### Completion Notes List

- Story artifact created with trusted-local scope guardrails, AC-to-test mapping, likely file list, security risks, and implementation plan.
- Implemented daemon UDS hygiene, client/server non-local endpoint refusal, redacted daemon/CLI diagnostics, and trusted-local documentation.
- Independent reviewer approved; TEA/security returned PASS.
- Verification: `pnpm exec vitest run surfaces/cli/src/cli.test.ts surfaces/cli/src/transport.test.ts packages/app/src/daemon.test.ts` passed; `pnpm run gate` passed with 63 files, 678 passed, 15 skipped.

### File List

- `_bmad-output/implementation-artifacts/gla-090-bridge-socket-hygiene-story.md`
- `docs/05-cli-and-entities.md`
- `docs/components/agent-bridge.md`
- `packages/app/src/daemon.ts`
- `packages/app/src/daemon.test.ts`
- `surfaces/cli/src/cli.test.ts`
- `surfaces/cli/src/index.ts`
- `surfaces/cli/src/transport.ts`
- `surfaces/cli/src/transport.test.ts`

## Change Log

- 2026-06-13: Initial GLA-090 create-story and planning artifact.
- 2026-06-13: Implemented and reviewed trusted-local Agent Bridge socket hygiene; full gate green.
