# Daemon State Recovery

GLA daemon persistence is opt-in with `--state-root <dir>` or `GLA_STATE_ROOT`. When enabled, the app composition
root wires encrypted, authenticated stores into the existing owners of security-critical state. Core packages keep
owning their aggregates and ports; only `packages/app` imports filesystem storage.

## Storage Boundary

- The state root must be outside agent workspaces, capsule profiles, host mounts, and output directories.
- The daemon creates the root and `records/` with mode `0700`; record files and `state.key` use mode `0600`.
- Startup refuses symlink state roots, group/world-accessible existing state directories, group/world-accessible records, pre-existing owner locks, and roots under configured workspace paths.
- Startup acquires `daemon.lock` before loading records or binding public traffic. A stale lock is fail-closed operator evidence; remove it only after verifying no daemon owns the state root.
- Record files are AES-256-GCM encrypted and authenticated with the daemon state key. Tampered, corrupt, wrong-kind, or unsupported-schema records fail closed before use.
- Public gateway traffic is bound only after `createProvisioningBridge()` has loaded the configured state root and reconstructed security snapshots.

## Persisted Records

| Kind | Owner | Classification | Recovery behavior |
| --- | --- | --- | --- |
| `daemon.owner-lock` | `@gla/app` | critical operational | Prevents two daemon processes from owning the same state root. |
| `identity.enrollments` | `@gla/identity` | sensitive | Restores provider-neutral enrollment facts before handoff step-up. |
| `provider.webauthn.credentials` | `@gla/auth-webauthn` | sensitive | Restores passkey credential public key and counter. |
| `provider.webauthn.challenges` | `@gla/auth-webauthn` | secret | Allows in-flight WebAuthn ceremonies to remain bounded by provider checks. |
| `provider.authentik.subjects` | `@gla/auth-authentik` | sensitive | Restores stable `userId -> sub` binding. |
| `provider.authentik.attempts` | `@gla/auth-authentik` | secret | Restores OIDC `state`, `nonce`, PKCE verifier, kind, user, and creation time. |
| `capability.signing-key` | `@gla/kernel` | secret | Keeps pre-restart capabilities verifiable. |
| `capability.revocations` | `@gla/capability` | critical operational | Keeps revoked capability ids revoked across restart. |
| `capability.spent-enrollment-nonces` | `@gla/capability` | critical operational | Keeps consumed operator-discharge grants single-use. |
| `task.state` | `@gla/task` | secret | Restores tasks plus encrypted held task-capability tokens. |
| `session.state` | `@gla/session` | critical operational | Restores sessions, handoff windows, provision records, and completion envelopes. |
| `worker.lifecycle` | `@gla/worker` | critical operational | Restores live-capsule records for restart cleanup. |

Gateway route tables, authorized-grant markers, live WebSocket sockets, detector watchers, and auth-reuse markers are
not treated as durable truth. On daemon reconstruction, recovered open handoff windows are safe-closed by default
unless an implementation explicitly proves the live route, live capsule, non-expired grant, revocation snapshot, and
connector posture before remounting. Today that means restart does not preserve re-prompt-free auth reuse; the human
must step up again on a new window.

## Recovery Rules

- Identity and provider binding state is loaded from Provider Host namespaces before handoff/enrollment requests
  can reach the public gateway.
- Authentik pending attempts remain one-time: the adapter still claims and deletes the attempt before token exchange.
- Expired authentik attempts are rejected by the adapter TTL check after restart; wrong-kind and wrong-recipient
callbacks are rejected by the persisted attempt metadata.
- Capability verification uses the restored HMAC key and restored revocation snapshot. `verify()` remains pure and
does not perform filesystem I/O.
- Spent enrollment nonces are loaded before enrollment traffic, so a consumed invite is still refused after restart.
- Session and handoff records are queryable after restart. Open windows are reconciled to safe closed state, their grants are force-closed/revoked where the capability seam is available, and route restoration is not attempted unless explicitly proven.
- Worker lifecycle records are restored so cleanup can call the launcher stop path and workspace reap path after a
process restart. Cleanup keeps the live record while stop or reap fails, and deletes it only after both cleanup steps converge, making repeated cleanup idempotent and restart-retriable.

## Redaction

Diagnostics and repair output must use `redactDaemonState()` before leaving the storage boundary. Redaction covers
grant/code/state/nonce query fields, PKCE verifiers, OIDC tokens, client secrets, capability-like tokens, and
secret-ref-shaped values. Public HTTP errors and bridge responses must continue to expose typed refusal codes, not
record contents.

## Backup, Migration, Rotation

- Treat the whole state root, including `state.key`, as secret operational data.
- A backup without `state.key` is intentionally not enough to decrypt records.
- Restoring an old backup can revive old operational facts; operators must prefer explicit incident cleanup or
re-enrollment when rollback is suspected.
- Schema migrations must be explicit and fail closed. Unknown schema versions are not auto-interpreted.
- Capability signing-key rotation invalidates previously issued bearer capabilities unless a future migration
explicitly reissues them. After suspected key exposure, stop the daemon, preserve the state root for incident
evidence, rotate/remove the state root, re-enroll recipients, and recreate active tasks/sessions.

## Incident Cleanup

1. Stop the daemon.
2. Preserve a protected copy of the state root for investigation if required.
3. Remove or quarantine the affected record files under `records/`; do not edit ciphertext by hand. If startup fails on `daemon.lock`, remove the lock only after verifying no daemon process still owns that state root.
4. Restart with the same `--state-root` to let fail-closed recovery and orphan cleanup run.
5. Re-enroll affected recipients or recreate affected tasks/sessions rather than inventing bindings.
6. Confirm no live capsules remain with the daemon's orphan scan and confirm consumed grants remain refused.
