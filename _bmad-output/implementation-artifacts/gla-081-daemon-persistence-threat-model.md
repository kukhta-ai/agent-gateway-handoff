# GLA-081 Daemon Persistence Threat Model and Security Gate

Task: GLA-081 - Make daemon security-critical state restart-safe  
Gate type: TEA/security architecture gate before implementation  
Date: 2026-06-13  
Verdict: CONCERNS until the must-fix architecture decisions in this artifact are adopted by implementation.

## BMAD/TEA Execution Note

`bmad-testarch-nfr` was selected as the closest TEA workflow, but it is evidence-audit oriented and assumes implementation evidence exists. GLA-081 is explicitly pre-implementation work, so this artifact is the documented fallback: a docs/source-driven pre-implementation NFR/security gate using the BMAD test-architecture mindset.

Inputs reviewed: project design set under `docs/`, `backlog task GLA-081 --plain`, `_bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md`, and the current daemon/security seams in `packages/app/src/daemon.ts`, `packages/app/src/index.ts`, `packages/session/src/index.ts`, `packages/gateway/src/index.ts`, `packages/capability/src/index.ts`, `packages/identity/src/index.ts`, `packages/worker/src/index.ts`, `packages/route/src/index.ts`, `adapters/auth-authentik/src/index.ts`, `adapters/auth-authentik/src/stores.ts`, `adapters/connector-cdp/src/index.ts`, and `adapters/launcher-process/src/index.ts`.

## Scope

This gate covers daemon-owned state that affects identity, authorization, session reachability, credential delegation, cleanup, and recovery. It does not select a final storage library or database. It defines the security contract that any implementation must satisfy.

Current code context: security-critical state is primarily process-local today: authentik subject bindings and pending OIDC attempts default to in-memory stores; `IdentityService` enrollment facts are in memory; `SessionService` sessions, handoffs, provision records, timers, completion envelopes, and live route/grant references are in memory; `AccessGateway` routes, authorized grants, recipient auth reuse, and live sockets are in memory; capability revocations and enrollment spent nonces are in memory; worker lifecycle records are in memory.

## Must-Fix Architecture Decisions

1. Persist a typed daemon state store, not an object dump. Each persisted record must have an explicit kind, schema version, owner, lifecycle, timestamps, and redaction classification.
2. Use fail-closed integrity protection for every authorization-relevant record. Corrupt, tampered, downgraded, stale, or unknown-version records must never authorize, bind a subject, reopen a route, or resurrect a grant.
3. Never persist raw bearer tokens or raw secrets unless a design exception explicitly encrypts them with a daemon secret not exposed in backups/debug dumps. Prefer capability ids, token hashes, secret refs, and regeneration.
4. Persist revocations, spent enrollment nonces, and OIDC one-time attempt state before public traffic is accepted after restart. The gateway must not serve handoff/enrollment traffic from an empty revocation/spent snapshot.
5. Persist authentik subject bindings and identity-level enrollment facts atomically as one committed enrollment outcome. A restart must not leave a provider subject bound without an enrolled identity fact, or the reverse.
6. Treat open windows/routes as recoverable intents, not as live truth. On restart, restore a public route only after session, live capsule, recipient-bound grant, revocation state, expiry, and connector-suspension state all reconcile successfully. Otherwise close the window safely.
7. Persist cleanup bookkeeping for capsules/workspaces/connectors enough to reconcile after a daemon crash. PIDs must be validated by process identity/start metadata before kill; workspace deletion must be constrained to daemon-owned workspace roots.
8. Persist auth reuse only as a last-committed, TTL-bound recipient fact. Restart must never extend it, upgrade it, or use it without rechecking the deployment assurance policy.
9. Place the state store outside any agent/capsule mountable path, with service-user ownership and `0700` directory / `0600` file or database permissions. Startup must refuse unsafe permissions.
10. Add a redaction boundary for diagnostics, repair, migration, backups, logs, traces, metrics, public errors, bridge responses, and audit events before persistence is implemented.

## Threat Model

Primary assets:

- Recipient identity bindings and authentik stable subjects.
- Pending OIDC attempts: `state`, `nonce`, `codeVerifier`, attempt kind, recipient/user id, TTL, and consumed state.
- Session and handoff state that determines whether a human can reach a capsule.
- Recipient-bound session grants, operator-discharge enrollment grants, revocations, spent nonces, and grant lineage.
- Connector capability references, CDP broker urls, secret refs, and any secret material or bearer material kept daemon-side.
- Capsule/process/workspace cleanup records.
- Recipient auth reuse facts and last committed auth strength/assurance.
- Recovery diagnostics, repair records, and audit trails.

Threat actors and failure modes:

- Remote holder of a forwarded or replayed link/grant.
- Wrong recipient attempting to use a grant or callback.
- Malicious or compromised agent process with bridge access and access to agent/capsule mounts.
- Capsule browser content trying to read mounted files or leak data through logs/errors.
- Local same-host user/process attempting to read or tamper with daemon state.
- Operator mistake: wrong backup restore, manual repair, permission drift, stale migration, or debug dump.
- Crash/restart during enrollment, OIDC callback, handoff open/close, grant revocation, route mount/unmount, session teardown, or workspace cleanup.

Trust boundaries:

- Public Access Gateway is the only public entry and must verify grants on every request/WS upgrade.
- Agent Bridge is local/operator-trusted but must not receive secrets or public-route bearer values.
- Authentik owns user credentials; GLA owns only stable subject bindings, pending OIDC attempts, and provider-neutral assurance facts.
- Capability signing/verification stays stateless at the edge, but mutable revocation/spent snapshots are security-critical daemon state.
- Worker/capsule workspaces are untrusted from the daemon-state perspective. Daemon persistence must never live under workspace roots, profile dirs, outputs, or agent-requested mounts.

## Data-Flow Plan

Startup/recovery order:

1. Acquire an exclusive daemon-state lock before binding gateway or bridge.
2. Verify the state root owner and permissions. Refuse startup, or start in recovery-disabled mode with public gateway closed, if permissions are unsafe.
3. Load the manifest, schema version, migration marker, and daemon instance epoch.
4. Verify per-record integrity before use. Quarantine invalid records with redacted diagnostics and fail closed for the affected object.
5. Rebuild revocation and spent-nonce snapshots before accepting any public request.
6. Load identity/enrollment bindings and authentik subject bindings. Cross-check that identity-level enrollment facts and provider subject bindings agree.
7. Load pending OIDC attempts. Drop expired attempts. Keep consumed/tombstone records until replay windows expire.
8. Load sessions, handoffs, routes, grant metadata, completion envelopes, auth reuse facts, and cleanup records.
9. Reconcile live capsules, broker state, routes, and windows. Routes may be restored only after live session, live capsule, valid grant, non-revoked lineage, non-expired window, correct recipient, and connector suspension/resume posture are all confirmed.
10. Run orphan cleanup for persisted live-capsule records that are terminal, missing, stale, or no longer expected.
11. Bind the Access Gateway only after safety reconciliation completes. If recovery has blocking integrity failures, serve no public handoff/enrollment routes.

Write/commit rules:

- Enrollment commit is atomic: verified provider subject, identity enrollment fact, selected provider, auth strength/assurance, and enrollment timestamp commit together.
- Pending OIDC attempt creation commits before redirect. Completion claims the attempt in one atomic state transition and records a consumed tombstone. A crash after claim but before final verification must fail closed on retry; it must not make the state reusable.
- Handoff open commits in ordered phases: grant metadata, route intent, window state, session `opened`, connector suspended. If later phases fail, compensating close/revoke/unmount records must commit.
- Handoff close commits terminal window state, route unmount intent, grant revoke/force-close, session return to `active`, connector resumed, and completion envelope if any.
- Terminal teardown commits cleanup intent before destructive work; final live-capsule record disposal happens only after stop/reap convergence, while failures keep the record durable for the next reconcile pass.
- Auth reuse commits only after a successful step-up result that satisfies current policy; it stores the observed assurance and original expiry, never a derived extension.

## Classification and Lifecycle

| State class | Classification | Owner | Persisted form | Recovery rule | Retention and disposal |
| --- | --- | --- | --- | --- | --- |
| Enrollment bindings | Sensitive and authorization-critical | Identity service | Recipient/user id, provider, credential/subject reference, auth strength/assurance, enrolledAt; no raw credential | Load only if integrity-valid and provider binding agrees | Until explicit re-enrollment/removal; dispose old binding on replacement after audit tombstone |
| Authentik subjects | Sensitive identity binding, authorization-critical | Authentik adapter / Identity | `{userId, sub, providerId, boundAt}`; no id_token | Required for authentik step-up; mismatch with enrollment fact fails closed | Until re-enrollment/removal; redacted in backups/diagnostics |
| Pending OIDC attempts | Secret-bearing and replay-critical | Authentik adapter | State id/hash, nonce, encrypted or protected codeVerifier, kind, userId, createdAt, expiresAt, claim/consume status | Pending can complete after restart if unexpired and unclaimed; claimed/consumed/expired attempts reject | Attempt TTL plus short replay tombstone; wipe codeVerifier after claim/expiry |
| Sessions | Critical operational, may contain sensitive task metadata | Session service | Session id, task id, immutable spec hash/ref, recipient, state, runtime ref if live, timestamps, completion | Queryable after restart; live runtime must reconcile before being considered reachable | Until terminal cleanup/audit retention; remove runtime and grant refs on terminal |
| Handoffs/windows | Sensitive and authorization-critical | Session service | Window id, session id, recipient, grant id/hash, route id, state, expiry, reason, completion | Open windows restore only if grant/session/capsule/route all validate; else safe-close | Open until close/expiry; terminal tombstone through grant TTL plus audit grace |
| Routes | Critical operational | Route controller / Gateway | Route id, handoff id, path, session id, boundGrantId, endpoint ref; no raw token | Re-mount only from valid open window and live endpoint; otherwise unmount/drop | Only while open; terminal route records removed after reconciliation/audit |
| Grants, revocations, spent nonces | Bearer tokens are secret; ids/hashes/revocations are critical | Capability service / signer | Grant ids, token hashes if needed, caveats metadata, revocation tombstones, spent enrollment nonces; avoid raw tokens | Revocation/spent snapshot loaded before public traffic; stale/missing snapshot fails closed for affected objects | At least max token TTL plus skew/audit grace; revoke tombstones kept long enough to defeat backups/replay |
| Connector references/secrets | Secret-ref is sensitive; raw connector bearer/secret is secret | Session/Capability/Connector | Connector cap id, secret_ref, brokered CDP url/ref, parent task cap id; no raw signing key or raw secret | Rebind only if live capsule validates; if open window persisted, broker must remain suspended or window safe-closes | Live session only; remove on teardown and after failed recovery |
| Capsule/process/workspace cleanup bookkeeping | Critical operational, sensitive paths/PIDs | Worker lifecycle/reconciler | Session id, launcher, runtime handle, pid/pgid, process start marker, workspace handle/root, cleanup phase | Validate PID identity before kill; reap only daemon-owned workspace roots; retry idempotently | Until confirmed stop/reap/revoke/unbind plus orphan-scan grace |
| Auth reuse / last committed auth strength | Sensitive authorization cache | Gateway/Identity | Recipient, assurance evidence/strength, policy profile id, issuedAt, expiresAt | Use only if integrity-valid, unexpired, same recipient, and sufficient under current policy | Until expiresAt or recipient re-enrollment/revocation; never extend on restart |
| Audit/recovery diagnostics | Redacted operational evidence; may be sensitive | Daemon audit/recovery | Event code, record kind/id/hash, reason, timestamps, action; no raw bearer/secret/token/codeVerifier | Used for incident response and repair; invalid records referenced by hash/id only | Operator policy; protect as sensitive logs; scrub before public/bridge exposure |

## Security Requirements

Confidentiality:

- Raw bearer tokens, OIDC authorization codes, PKCE code verifiers, client secrets, id_tokens, access tokens, raw WebAuthn credential material, raw signing keys, and raw connector bearer material must not appear in persisted plaintext, logs, traces, metrics, public errors, bridge responses, task output, audit records, debug dumps, repair reports, or backups.
- Persist token hashes, capability ids, secret refs, or opaque record ids instead of bearer values. If a raw value is unavoidable, it must be encrypted/protected and excluded/redacted from all diagnostic paths.
- Authentik client secret remains configuration/secret-store material, not daemon state.

Integrity and tamper detection:

- Every persisted authorization-relevant record requires integrity protection, schema versioning, and typed decode validation.
- Parent-child consistency must be checked: session to handoff, handoff to route, route to grant, grant to revocation snapshot, connector cap to task parent, enrollment fact to authentik subject.
- Unknown schema versions, downgraded migrations, invalid MAC/checksum, impossible state transitions, or cross-record mismatch must quarantine the affected record and deny authorization.
- Writes must be atomic and crash-safe, using transactional storage or temp-write/fsync/rename semantics with a manifest generation.

Replay and staleness:

- OIDC state, enrollment grant nonce, and operator-discharge single-use semantics must survive restart.
- Expiry is evaluated against current time on every recovery and request. Restart never refreshes TTLs.
- Revoked/expired grants, spent enrollment grants, consumed OIDC attempts, closed routes, terminal sessions, and prior auth strengths beyond expiry must not resurrect from backup or stale state.
- If a rollback cannot be distinguished from a valid older backup, recovery must disable public routes and auth reuse and require explicit operator repair/re-enrollment.

Redaction:

- Define one redactor shared by storage diagnostics, logger, audit sink, public HTTP errors, CLI/bridge errors, test snapshots, repair output, and migration output.
- Redaction must recognize token-like query params (`grant`, `code`, `state`), OIDC fields (`id_token`, `access_token`, `refresh_token`, `code_verifier`, `nonce`), CDP/broker urls, capability tokens, secret refs, client secrets, and workspace paths where needed.
- Public errors must expose typed outcomes, not state contents.

Least-privilege filesystem storage:

- Default state root should be under an operator-owned daemon state directory, not under any workspace/profile/output/mount path. If `GLA_STATE_DIR` is used, daemon security state must be isolated from workspace subdirectories.
- Directory permissions must be `0700`; files or database must be `0600`; owner must be the daemon service user. Startup must refuse group/world-readable or symlinked state roots unless explicitly repaired.
- State files must not be readable by the agent uid if the deployment separates daemon and agent users. In the single-operator profile, the state root must still be denied from capsule mounts and must be protected from accidental exposure.

Retention and disposal:

- Pending OIDC attempts expire at attempt TTL and then retain only a replay tombstone briefly.
- Route/window/grant operational records are removed or tombstoned when closed, expired, revoked, or terminal, retaining enough revocation/spent evidence to defeat replay until all associated tokens expire.
- Connector refs, broker mappings, runtime handles, workspace handles, and session secrets are removed on terminal teardown or failed recovery.
- Cleanup is idempotent: repeated recovery/cleanup must converge to no live route, no live grant authorization, no connector binding, and no daemon-owned ephemeral workspace for terminal sessions.

Backup, migration, and repair:

- Backups must either exclude secret-bearing fields or protect them equivalently to live state. Backup/restore documentation must warn that stale restores can resurrect revoked state unless recovery detects and disables unsafe records.
- Migrations must be explicit, versioned, integrity-preserving, and fail closed. Repair tools may remove/quarantine records but must not invent enrollment bindings, grant validity, auth strength, or subject mappings.
- Repair output must use record ids/hashes and typed reasons. It must not print raw secrets, bearer tokens, OIDC values, or code verifiers.

Incident and audit diagnostics:

- Recovery must emit audit-visible events for unsafe permissions, corrupt/tampered records, stale/downgraded schema, discarded OIDC attempts, refused route restoration, grant/revocation mismatch, orphan cleanup action, and identity binding mismatch.
- Diagnostics must support incident cleanup: identify affected recipient/session/window/grant by stable id or hash, what action was taken, and whether operator repair/re-enrollment is required.
- Audit events must distinguish fail-closed safety actions from successful restoration.

## Safe-Failure Behavior

- Missing or unreadable state store: do not serve public handoff/enrollment routes; either refuse daemon startup or start bridge-only with recovery diagnostics.
- Unsafe state-root permissions: refuse startup until permissions are repaired.
- Corrupt/tampered identity binding: recipient is treated as not enrolled; no automatic rebind.
- Corrupt/tampered pending OIDC attempt: callback is refused; no binding or authorization.
- Expired, consumed, wrong-kind, wrong-recipient, or claimed OIDC attempt: callback is refused and audited.
- Corrupt session: mark unavailable for route restore; require repair; do not expose capsule.
- Open window whose grant/session/capsule/route cannot reconcile: close/unmount/revoke or mark safe-closed; do not proxy.
- Corrupt cleanup record: run constrained orphan scan by daemon-owned roots/tags only; do not delete arbitrary paths; require operator repair when ownership cannot be proven.
- Auth reuse record missing/tampered/expired/insufficient under current policy: require fresh step-up.
- Revocation/spent snapshot unavailable or invalid: public grant verification must fail closed until repaired.

## Test Strategy

| Contract | Pre-implementation test design |
| --- | --- |
| AC #1 | Restart daemon after authentik enrollment; assert same recipient remains enrolled and later step-up verifies the same authentik `sub`. Tamper subject binding and assert fail-closed/not enrolled. |
| AC #2 | Start enrollment and step-up OIDC attempts, restart before callback, complete successfully while unexpired. Add cases for expired, replayed, wrong-kind, wrong-recipient, claimed-but-crashed, and unknown state; assert no binding/authorization. |
| AC #3 | Create active/open/terminal sessions, restart, list/get them, and assert last committed state is preserved without silent session loss. |
| AC #4 | Restart with open handoff routes under four cases: live valid session/grant, expired grant, revoked grant, missing capsule. Assert only the valid case restores reachability; all others safe-close/unmount with typed diagnostics. |
| AC #5 | Restart with recorded live capsules/workspaces/connectors, then complete/revoke/shutdown/reconcile. Assert processes are stopped, daemon-owned workspaces reaped, connector/session grants revoked, secret refs unbound, and orphan scan empty. |
| AC #6 | Run repeated restart/recovery/cleanup loops and concurrent callback/teardown races. Assert idempotence: no duplicate routes, duplicate enrollments, half-bound OIDC records, or repeated cleanup side effects. |
| AC #7 | Add a classification/lifecycle contract test that enumerates every persisted record kind and fails if a kind lacks classification, owner, retention, recovery, disposal, and redaction policy. |
| AC #8 | Use log/trace/metric/error/audit/bridge/public-response capture around normal, restart, failure, and repair paths. Assert no raw bearer, client secret, code verifier, auth code, id_token, access token, secret-ref bearer, CDP token, or raw credential appears. |
| AC #9 | Fuzz/tamper persisted auth, identity, grant, route, and session records: bit flips, bad MAC, old schema, downgrade, cross-record mismatch, stale generation, corrupt JSON. Assert fail-closed with redacted diagnostic and no authorization/bind/route. |
| AC #10 | Persist revoked/expired grants, spent enrollment nonces, closed routes, stale OIDC attempts, and expired auth reuse, then restart. Assert none resurrect and all public attempts are refused. |
| AC #11 | Filesystem test creates state root and verifies owner/mode, no symlink traversal, no group/world read, outside workspace/profile roots, and no agent/capsule mount exposure. Backup/migration/repair outputs are scanned for sensitive values. |
| AC #12 | Terminal cleanup tests assert persisted critical values are removed/tombstoned: OIDC attempts, grant authorization markers, connector refs, broker mappings, session secrets, and capsule-sensitive materials. Repeated cleanup remains clean. |

DoD #8 coverage requirements:

- Tampered/corrupt persisted state: property/fuzz tests plus targeted identity/session/grant/route fixtures.
- Expired/replayed attempts: OIDC attempt and enrollment-grant replay suites across restart boundaries.
- Wrong-recipient state: subject-binding mismatch, grant-recipient mismatch, callback user mismatch, and forwarded-link cases.
- Log/egress redaction: golden capture tests over logs, public HTTP, bridge, audit, repair, backup, migration, and debug paths.
- Least-privilege storage checks: startup permission refusal and state-root/mount-deny tests.
- Orphaned critical-value cleanup: recovery and teardown suites that verify no live route, grant auth marker, connector binding, process, or daemon-owned workspace remains.

## Non-Goals

- Do not change the identity model, capability vocabulary, grant semantics, auth-strength model, or recipient-binding semantics.
- Do not make GLA own authentik user credentials. Authentik remains the credential authority; GLA persists only bindings and OIDC ceremony state it owns.
- Do not require preserving an active human browser connection through daemon restart. Safe close and re-step-up are acceptable when live continuity cannot be proven.
- Do not expose raw persisted state through CLI, bridge, public endpoints, debug dumps, or repair reports.
- Do not make storage durability a substitute for grant verification. The gateway still verifies every grant on every request/WS upgrade.
- Do not delete arbitrary host paths during repair. Cleanup is limited to daemon-owned workspace roots and verified process identities.
