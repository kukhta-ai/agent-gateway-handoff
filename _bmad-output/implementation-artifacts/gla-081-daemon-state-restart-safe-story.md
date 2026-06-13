---
story_id: GLA-081
story_title: Make daemon security-critical state restart-safe
story_status: ready-for-dev
workflow: bmad-create-story
phase: 5-create-story
branch: feature/authentik-task-081
source_of_truth: Backlog.md task GLA-081
created_at: 2026-06-13
artifact_path: _bmad-output/implementation-artifacts/gla-081-daemon-state-restart-safe-story.md
---

# GLA-081 - Make Daemon Security-Critical State Restart-Safe

## Status

ready-for-dev

## Workflow Note

This story was created by running the `bmad-create-story` workflow scope in the repo's spec-exists mode. The
BMAD skill instructions and direct referenced files were read, then the story was seeded from
`backlog task GLA-081 --plain` plus the committed design set and current implementation seams.

Backlog.md remains the story source of truth for status, acceptance criteria, and Definition of Done. This repo's
committed specs and backlog are authoritative here; upstream BMAD sprint/planning artifacts are not assumed to be
authoritative for this task. No source, docs, backlog, git state, or `.bmad/sdlc-state.yaml` changes are part of
this create-story step.

## Story

As the GLA daemon operator, I need daemon-owned security-critical state to survive process restarts or be safely
reconciled, so that enrollment, handoff, authorization, cleanup, and agent-blind boundaries remain enforceable
after a crash, deploy, or planned restart.

This is a security-critical persistence story. The implementation must not persist a raw process-memory dump.
It must define explicit record schemas, lifecycle ownership, integrity protection, recovery behavior, and
failure handling for each daemon-owned fact that can affect authorization, identity binding, session reachability,
credential delegation, or cleanup.

## Acceptance Criteria

1. After daemon restart, a previously enrolled recipient remains enrolled for the selected provider, and a later
   handoff step-up verifies against the same credential or authentik subject.
2. An in-flight authentik enrollment or step-up begun before restart can complete after restart, while expired,
   replayed, wrong-kind, or wrong-recipient callbacks are refused without binding a recipient or authorizing access.
3. Sessions and handoff windows created before restart are queryable after restart with their last committed states,
   and no session is silently lost.
4. Open handoff routes after restart are either restored only when backed by a live session and valid grant, or made
   unreachable with the window or session reconciled to a safe closed or terminal state.
5. Completing, revoking, shutting down, or reconciling after restart tears down every recorded live capsule, reaps
   ephemeral workspace state, revokes connector and session grants, and leaves the orphan scan empty.
6. Repeated restart recovery or cleanup is idempotent and creates no duplicate sessions, routes, grants, capsules,
   enrollment records, or half-bound OIDC state.
7. Every daemon-owned persisted record that can affect authorization, identity binding, session reachability,
   credential delegation, or cleanup has a documented classification and lifecycle: secret, sensitive, critical
   operational, or non-sensitive; owner; retention; recovery behavior; and disposal behavior.
8. Raw critical bearer or credential values are not exposed through logs, traces, metrics, error messages, public
   responses, bridge responses, task receipts, audit egress, or debug/state dumps during normal operation, restart
   recovery, or failure handling.
9. Persisted authorization and identity state is protected against tampering, corruption, downgrade, replay, and
   staleness such that invalid records fail closed with an audit-visible diagnostic and never authorize access,
   bind a recipient, or reopen a route.
10. Restart recovery never resurrects revoked or expired grants, wrong-recipient bindings, spent enrollment grants,
    stale OIDC attempts, closed handoff routes, or prior auth strength beyond the last committed authorized value.
11. Daemon persistence uses least-privilege storage: state files or databases are not world-readable, are outside
    agent/capsule-controlled mount paths, and backup, migration, repair, and diagnostic outputs do not disclose
    critical values.
12. Terminal cleanup and restart reconciliation remove or revoke persisted critical values for ended lifecycles, and
    repeated cleanup leaves no orphaned grants, OIDC attempts, connector capabilities, session secrets, or
    capsule-sensitive materials.

## Required DoD Security Gate

The following backlog Definition of Done items are part of the implementation contract, not optional follow-up:

- DoD #7: Complete a security architecture gate before implementation. The gate must include a threat model and
  data-flow plan that classify daemon persistence and define confidentiality, integrity, replay/staleness,
  retention, redaction, filesystem-permission, migration, and incident-audit requirements.
- DoD #8: Add security tests for tampered or corrupt persisted state, expired or replayed attempts,
  wrong-recipient state, log and egress redaction, least-privilege storage checks, and orphaned critical-value
  cleanup.
- DoD #9: Add operator and developer documentation explaining what critical daemon state is persisted, where it
  lives, required permissions, backup and migration implications, rotation or re-enrollment recovery, and incident
  cleanup.

## Pre-Implementation Security Architecture Gate

Before changing runtime code, produce an explicit security architecture gate artifact or story section that covers
the items below. This gate should be reviewed before storage mechanics are selected.

### Threat Model

Model at least these actors and failure modes:

- Local unprivileged user on the daemon host attempts to read or tamper with persisted daemon state.
- Agent or capsule-controlled process attempts to access, mount, exfiltrate, or corrupt daemon state.
- Recipient or attacker replays OIDC callback state, enrollment grants, handoff grants, or stale auth-reuse data
  after restart.
- Operator restores an old backup or migrates state across versions, causing rollback, replay, or downgrade.
- Daemon crashes after a partial write, partial grant consume, partial route mount, partial capsule spawn, or partial
  cleanup.
- Diagnostic, audit, debug dump, error, metric, or task receipt path accidentally exposes bearer tokens,
  client secrets, PKCE verifiers, session grants, connector tokens, or capsule-sensitive paths.

### Data-Flow Plan

Classify every persisted daemon-owned record. The initial classification must include at least:

| Record | Owner | Classification | Recovery Requirement | Disposal Requirement |
|---|---|---|---|---|
| Identity `EnrollmentRecord` keyed by userId | `packages/identity` | critical operational, sensitive when it names a provider subject | Restore before handoff step-up; wrong/tampered records fail closed | Remove or replace on re-enrollment/incident cleanup |
| Authentik `BoundSubject` userId to `sub` | `adapters/auth-authentik` via app-injected store | critical operational, sensitive identity binding | Restore exactly; subject mismatch fails closed | Remove on re-enrollment/disposal |
| Authentik `PendingAttempt` state/nonce/codeVerifier/kind/createdAt | `adapters/auth-authentik` via app-injected store | secret and replay-critical | Survive restart until TTL; claim/delete must remain one-time across processes | Delete on claim, expiry, failure, or cleanup |
| Capability signer key material | capability/kernel composition | secret | Stable across restart or all prior tokens become unverifiable by design; rotation semantics documented | Rotate with explicit invalidation and audit |
| Revocation snapshot and spent enrollment nonces | `packages/capability` | critical operational | Restore before any verify path; stale/missing revocation data must not authorize | Retain until all descendant grants/TTLs are dead, then compact safely |
| Task/session capability ids and bearer tokens held GLA-side | task/capability/session/app | secret or sensitive depending on bearer/reference | Restore only when needed for valid lineage/revoke; never expose to agent | Revoke/delete on terminal task/session cleanup |
| Session aggregate and handoff windows | `packages/session` | critical operational | Query last committed state after restart; timers/watchers reconstructed from persisted facts | Terminal records retained only as documented; live grants/routes cleared on close |
| Open route intent and grant binding | session/route/gateway | critical operational | Restore only if session, live capsule, route, and grant remain valid; otherwise make unreachable and reconcile safe | Delete on window terminal state |
| Gateway authorized-grant markers and recipient auth-reuse state | `packages/gateway` | critical operational, sensitive auth fact | Do not exceed last committed authorized value; stale/expired reuse must not authorize | Expire by TTL and clear on revoke/close/restart reconciliation |
| Connector refs, CDP URL bindings, broker records | session/connector/app | sensitive, agent-blind boundary critical | Restore only as references to a live capsule; do not expose bearer token bytes | Unbind and revoke on teardown or orphan cleanup |
| Worker lifecycle records, runtime ids, workspace/profile paths, launcher PIDs | worker/app/session | critical operational, sensitive paths | Probe live reality after restart; do not trust stale PIDs blindly | Stop/reap temp profiles; preserve host-mounted outputs |
| Audit/recovery diagnostics | audit/operator docs | sensitive metadata | Must be available enough to explain fail-closed recovery | Redact raw critical values; retention documented |

The plan must also specify:

- Confidentiality: which fields must be encrypted, redacted, or never persisted; which fields can be persisted as
  references; which secrets remain in env/config only.
- Integrity: how records are authenticated or validated, how schema versions are checked, and how corruption or
  tampering fails closed.
- Replay and staleness: how TTLs, nonces, spent sets, revocations, and backup rollback are detected or bounded.
- Redaction: exact redaction policy for logs, traces, metrics, public responses, bridge responses, task receipts,
  audit egress, repair output, and debug/state dumps.
- Filesystem permissions: state root location, file/dir modes, owner expectations, refusal behavior for
  world-readable or agent/capsule-mounted paths.
- Retention and disposal: terminal cleanup, expired attempts, closed windows, revoked grants, orphan scan results,
  audit retention, and compaction.
- Migration and repair: versioned record schemas, migration failure behavior, backup restore behavior, diagnostic
  output redaction, and operator recovery steps.
- Incident audit: which recovery/refusal/repair events are audit-visible without leaking raw critical values.

## Architecture Constraints

- Preserve provider neutrality. `gateway`, `session`, `capability`, `identity`, and other core/core-adjacent
  packages must remain behind ports and must not import concrete auth adapters. `packages/app` remains the
  composition root for wiring concrete persistence and adapters.
- Do not change the identity model, grant semantics, auth-strength/assurance model, capability vocabulary, or
  recipient-binding semantics. Persist the existing facts; do not redefine them.
- Preserve agent-blind boundaries. The agent may receive refs such as `secret_ref`, never raw signing material,
  bearer tokens, provider client secrets, PKCE verifiers, session grant tokens, or privileged filesystem paths.
- Preserve bridge/public split. The Access Gateway remains the sole public entry. The Agent Bridge remains local.
  Persistence state must live outside agent/capsule-controlled mount paths.
- Preserve stateless edge verification in the common path. If persistence backs revocations or signer state, load
  an in-memory revocation/key snapshot for verification rather than adding unbounded async storage lookups to every
  gateway verify.
- Persistence must be explicit record storage, not serialization of raw service objects, live sockets, timers,
  async iterators, process handles, closures, or arbitrary process memory.
- Runtime handles, sockets, watchers, timers, and PIDs are recoverable observations, not durable truth. On restart,
  probe and reconcile live reality before restoring routes or connector access.
- Invalid, corrupt, old-version, downgraded, replayed, wrong-recipient, or expired persisted records must fail
  closed with audit-visible diagnostics and no authorization side effect.

## Current Implementation Context

The current daemon composes fresh process-local state on every start:

- `packages/app/src/daemon.ts` calls `createProvisioningBridge()` for one shared runtime stack and only performs
  graceful shutdown cleanup for currently live sessions in that process.
- `packages/app/src/index.ts` currently constructs a fresh `HmacCapabilitySigner`, `CapabilityService`,
  `IdentityService`, `AccessGateway`, `RouteController`, `CapsuleLifecycleManager`, `CleanupReconciler`, and
  `ConnectorCdpAdapter` per daemon start.
- `packages/session/src/index.ts` holds sessions, handoff windows, provisioned connector bookkeeping, completion
  envelopes, TTL timers, and detector-watch abort flags in memory.
- `packages/capability/src/index.ts` holds enrollment spent nonces in memory and delegates revocation state to the
  in-process capability signer snapshot.
- `packages/identity/src/index.ts` holds identity enrollment facts in memory.
- `adapters/auth-authentik/src/stores.ts` already exposes injectable `KvStore` seams for durable `subjects` and
  transient `attempts`, but the default store is `InMemoryKv`.
- `adapters/auth-authentik/src/index.ts` claims and deletes `state` before token exchange. Restart-safe persistence
  must preserve that one-time claim behavior across daemon processes.
- `packages/gateway/src/index.ts` holds routes, authorized grant markers, recipient auth-reuse records, and live
  proxied sockets in memory. Any restored route must be justified by persisted session/window/grant facts plus a
  live capsule probe, not by trusting stale edge memory.

## Tasks and Subtasks

### 1. Complete the Security Architecture Gate

- Produce the threat model and data-flow plan described above before runtime implementation.
- Classify every daemon-owned persisted record that can affect authz, identity binding, session reachability,
  credential delegation, and cleanup.
- Define fail-closed handling for tamper, corruption, downgrade, replay, stale backup restore, partial write, and
  partial cleanup.
- Define redaction and diagnostic policy for normal operation, restart recovery, failure handling, repair, backup,
  audit egress, public responses, bridge responses, task receipts, logs, traces, and metrics.

### 2. Introduce Explicit Durable State Seams

- Add narrow persistence interfaces at ownership boundaries rather than dumping service instances.
- Keep concrete storage selection and filesystem policy wired from `packages/app`, preserving import boundaries.
- Persist versioned records with atomic write/commit semantics and schema validation.
- Refuse unsafe state roots: world-readable files, group/world-writable directories, symlink escapes, and paths under
  agent/capsule workspaces or mounted host paths.
- Add startup repair/lock behavior so two daemons cannot concurrently own the same state directory unless the design
  explicitly supports it.

### 3. Persist Identity and Provider Enrollment State

- Make `IdentityService` enrollment facts restart-safe for the selected provider.
- Wire authentik `subjects` and `attempts` to durable stores through the app composition root.
- Preserve OIDC pending-attempt semantics: state is one-time, kind-scoped, user-scoped, TTL-scoped, and contains a
  PKCE verifier that must not leak.
- Ensure a recipient enrolled before restart remains enrolled after restart and later verifies against the same
  WebAuthn credential or authentik `sub`.
- Ensure a pending authentik enrollment or step-up begun before restart can complete after restart when valid, and
  invalid callbacks bind or authorize nothing.

### 4. Persist Capability Security State

- Make capability signer/key material, revocation snapshots, lineage state, and spent enrollment nonces
  restart-safe.
- Preserve recipient-bound grant, single-use enrollment grant, attenuation-only, lineage-revocation, and
  stateless-edge verification semantics.
- Ensure replayed, revoked, expired, wrong-class, wrong-kind, or stale grants cannot be revived by restart or backup
  rollback.
- Define key rotation and incident recovery behavior, including whether prior tokens are invalidated or migrated.

### 5. Persist Session, Handoff, Route Intent, and Cleanup Facts

- Persist session aggregates and handoff windows with last committed state and enough lineage to revoke or reconcile
  grants and connector refs after restart.
- Persist route intent only as a recoverable desired state, not as a guarantee that a live route still exists.
- On restart, restore an open route only if the session is live, the capsule is confirmed live, the grant is valid,
  the route target is safe, and the window has not expired or closed.
- Otherwise make the route unreachable and reconcile the window/session to a safe closed or terminal state.
- Reconstruct TTL timers, detector watchers, and auth-reuse state from persisted facts without extending lifetimes.

### 6. Reconcile Worker, Connector, and Workspace State

- Persist enough lifecycle bookkeeping to tear down recorded live capsules after restart.
- Probe live process reality rather than trusting stale runtime handles or PIDs.
- Ensure terminal cleanup after restart stops live capsule process groups, reaps ephemeral workspace/profile state,
  preserves host-mounted outputs, revokes connector/session grants, unbinds connector refs, and leaves orphan scan
  empty.
- Make repeated recovery and cleanup idempotent: no duplicate capsules, routes, grants, sessions, enrollment records,
  OIDC attempts, connector refs, or half-bound states.

### 7. Add Operator/Developer Documentation

- Document persisted daemon state, state root location, required owner/mode, and refusal behavior for unsafe
  permissions.
- Document backup, restore, migration, repair, rotation, re-enrollment recovery, and incident cleanup.
- Document redaction guarantees and how operators can verify orphan scans, grant revocation, expired attempts, and
  safe route reconciliation after restart.

### 8. Add Tests and Validation

- Add unit tests for persistent record validation, redaction, tamper/corruption rejection, schema-version handling,
  and filesystem permission checks.
- Add integration tests that restart the daemon or reconstruct services over the same state root and prove AC #1
  through AC #6.
- Add security tests required by DoD #8 for tampered/corrupt persisted state, expired/replayed attempts,
  wrong-recipient state, log/egress redaction, least-privilege storage checks, and orphaned critical-value cleanup.
- Add E2E/browser-relevant tests for authentik callback continuation after restart, including same-origin callback
  state delivery and wrong-kind/wrong-recipient/replayed callback refusal.
- Run the project quality gate from `CONTRIBUTING.md`: `pnpm gate`.

## Files Likely Touched During Implementation

Implementation may reasonably touch or add tests around these areas:

- `packages/app/src/daemon.ts`
- `packages/app/src/index.ts`
- `packages/session/src/index.ts`
- `packages/session/src/*.test.ts`
- `packages/capability/src/index.ts`
- `packages/capability/src/*.test.ts`
- `packages/identity/src/index.ts`
- `packages/identity/src/*.test.ts`
- `adapters/auth-authentik/src/stores.ts`
- `adapters/auth-authentik/src/index.ts`
- `adapters/auth-authentik/src/*.test.ts`
- `packages/gateway/src/index.ts`
- `packages/gateway/src/*.test.ts`
- `packages/worker/src/*`
- `adapters/connector-cdp/src/*`
- `adapters/workspace-profile/src/*`
- Operator/developer documentation required by DoD #9

The create-story step itself only created this artifact.

## Test Plan

Minimum acceptance evidence:

- Enrollment restart: enroll a recipient, stop/recreate the daemon stack with the same state root, then prove
  `isEnrolled` and later handoff step-up verify against the same WebAuthn credential or authentik subject.
- Pending authentik restart: begin `register` and `authenticate` attempts, restart before callback, then complete
  valid callbacks and assert expired, replayed, wrong-kind, wrong-recipient, bad nonce, and missing-state callbacks
  fail without binding or authorizing.
- Session restart: create sessions and handoff windows, restart, then query sessions/handoffs and assert last
  committed state with no silent loss.
- Open route recovery: restart with open windows and prove routes are either restored only with live session plus
  valid grant or made unreachable with safe terminal/closed reconciliation.
- Cleanup restart: restart before complete/revoke/shutdown, then complete/revoke/reconcile and assert live capsules
  stopped, ephemeral workspace state reaped, connector and session grants revoked, connector refs unbound, and orphan
  scan empty.
- Idempotence: run restart recovery and cleanup repeatedly and assert no duplicate sessions, routes, grants,
  capsules, enrollment records, OIDC attempts, or half-bound states.
- Tamper/corruption: modify persisted records, downgrade schema versions, restore stale backups, corrupt signatures,
  alter recipient/kind/state/nonce/ttl fields, and assert fail-closed with audit-visible diagnostics.
- Redaction: scan logs, traces, metrics, error bodies, public responses, bridge responses, task receipts, audit
  egress, repair output, backup output, and debug/state dumps for seeded critical values.
- Permissions: assert state roots/files are created with least-privilege modes and startup refuses unsafe,
  world-readable, world-writable, symlinked, or agent/capsule-controlled paths.

## Risks and Watch Points

- Persisting bearer tokens, PKCE verifiers, or signing keys creates a higher confidentiality burden than existing
  in-memory state. The architecture gate must justify each field and prefer references or derived facts where
  possible.
- Rotating or changing the capability signing key without a migration/revocation plan can either break valid
  recovery or accidentally revive invalid grants.
- Restoring gateway `authorizedGrants` or recipient auth-reuse too broadly can skip required step-up. Never restore
  a stronger auth fact or longer lifetime than the last committed authorized value.
- Restoring route tables without probing live capsules can reopen a public path to a wrong or dead target.
- Deleting OIDC attempts on claim must remain atomic across restart-capable storage; async get/delete races can
  reintroduce replay.
- Backup restore can be replay unless the design includes rollback detection, bounded retention, or explicit
  operator invalidation.
- Any persistence path under workspace/capsule/agent-controlled locations breaks the agent-blind boundary.

## References

- `backlog task GLA-081 --plain`
- `docs/task-writing-conventions.md`
- `docs/01-architecture-overview.md`
- `docs/architecture/baseline.md`
- `docs/components/identity-and-auth.md`
- `docs/components/capability-service.md`
- `docs/components/access-gateway.md`
- `docs/components/session-service.md`
- `docs/components/route-controller.md`
- `docs/components/worker-plane.md`
- `docs/components/agent-bridge.md`
- `docs/architecture/slice-3-provision-connector.md`
- `docs/architecture/slice-4a-enrollment.md`
- `docs/architecture/slice-4b-handoff.md`
- `docs/architecture/slice-7-teardown.md`
- `docs/architecture/test-strategy.md`
- `docs/architecture/authentik-enrollment.md`
- `_bmad-output/implementation-artifacts/gla-079-public-base-paths-story.md`
- `_bmad-output/implementation-artifacts/gla-080-authentik-callback-landing-contract-story.md`
- `packages/app/src/daemon.ts`
- `packages/app/src/index.ts`
- `packages/session/src/index.ts`
- `packages/capability/src/index.ts`
- `packages/identity/src/index.ts`
- `adapters/auth-authentik/src/stores.ts`
- `adapters/auth-authentik/src/index.ts`

## Dev Agent Record Placeholder

- BMAD skills expected next: `bmad-dev-story`, then `bmad-qa-generate-e2e-tests`, then independent review.
- Before implementation begins, record the completed security architecture gate and link the documentation/test
  evidence for DoD #7 through DoD #9.
- Do not tick backlog ACs until each outcome is proven by code plus tests.
