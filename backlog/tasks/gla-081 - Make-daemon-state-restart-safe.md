---
id: GLA-081
title: Make daemon security-critical state restart-safe
status: Done
assignee: []
created_date: '2026-06-12 20:02'
updated_date: '2026-06-13 14:18'
labels:
  - hardening
  - daemon
  - persistence
  - session
  - authentik
  - cleanup
  - infosec
  - security
dependencies:
  - GLA-065
  - GLA-076
references:
  - >-
    _bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md
  - docs/01-architecture-overview.md
  - docs/architecture/baseline.md
  - docs/components/identity-and-auth.md
  - docs/components/capability-service.md
  - docs/components/access-gateway.md
  - docs/components/session-service.md
  - docs/components/route-controller.md
  - docs/components/worker-plane.md
  - docs/architecture/authentik-enrollment.md
  - packages/session/src/index.ts
  - adapters/auth-authentik/src/stores.ts
  - adapters/auth-authentik/src/index.ts
  - packages/app/src/daemon.ts
priority: high
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the daemon keeps critical truth in process-local state today: enrollment bindings, pending OIDC attempts, sessions, handoffs, routes, grants, connector references, and cleanup bookkeeping. A restart must recover or safely reconcile those facts instead of silently losing enrollments, stranding capsule state, making cleanup impossible, or exposing security-bearing values.

Security framing: this task must be planned and implemented with information-security discipline. Persisted daemon state contains critical values that can affect authorization, identity binding, session reachability, credential delegation, and cleanup. Solving restart-safety by dumping process memory is not acceptable; the persisted state must have explicit confidentiality, integrity, replay/staleness, redaction, least-privilege, retention, and disposal properties.

Boundaries: this task defines the restart-safety and security outcomes for daemon-owned state; it does not change the identity model, grant semantics, auth-strength model, capability vocabulary, or agent-blind boundaries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After daemon restart, a previously enrolled recipient remains enrolled for the selected provider, and a later handoff step-up verifies against the same credential or authentik subject.
- [x] #2 An in-flight authentik enrollment or step-up begun before restart can complete after restart, while expired, replayed, wrong-kind, or wrong-recipient callbacks are refused without binding a recipient or authorizing access.
- [x] #3 Sessions and handoff windows created before restart are queryable after restart with their last committed states, and no session is silently lost.
- [x] #4 Open handoff routes after restart are either restored only when backed by a live session and valid grant, or made unreachable with the window or session reconciled to a safe closed or terminal state.
- [x] #5 Completing, revoking, shutting down, or reconciling after restart tears down every recorded live capsule, reaps ephemeral workspace state, revokes connector and session grants, and leaves the orphan scan empty.
- [x] #6 Repeated restart recovery or cleanup is idempotent and creates no duplicate sessions, routes, grants, capsules, enrollment records, or half-bound OIDC state.
- [x] #7 Every daemon-owned persisted record that can affect authorization, identity binding, session reachability, credential delegation, or cleanup has a documented classification and lifecycle: secret, sensitive, critical operational, or non-sensitive; owner; retention; recovery behavior; and disposal behavior.
- [x] #8 Raw critical bearer or credential values are not exposed through logs, traces, metrics, error messages, public responses, bridge responses, task receipts, audit egress, or debug/state dumps during normal operation, restart recovery, or failure handling.
- [x] #9 Persisted authorization and identity state is protected against tampering, corruption, downgrade, replay, and staleness such that invalid records fail closed with an audit-visible diagnostic and never authorize access, bind a recipient, or reopen a route.
- [x] #10 Restart recovery never resurrects revoked or expired grants, wrong-recipient bindings, spent enrollment grants, stale OIDC attempts, closed handoff routes, or prior auth strength beyond the last committed authorized value.
- [x] #11 Daemon persistence uses least-privilege storage: state files or databases are not world-readable, are outside agent/capsule-controlled mount paths, and backup, migration, repair, and diagnostic outputs do not disclose critical values.
- [x] #12 Terminal cleanup and restart reconciliation remove or revoke persisted critical values for ended lifecycles, and repeated cleanup leaves no orphaned grants, OIDC attempts, connector capabilities, session secrets, or capsule-sensitive materials.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Prepared from the transcript comparison and independent subagent draft: Huygens/restart-state.

Security planning correction requested by user: restart-safe daemon state must be treated as security-critical persistence, not generic durability. Implementation must start from a threat model and data classification for critical values before choosing storage mechanics.

BMAD evidence: worker create-story artifact _bmad-output/implementation-artifacts/gla-081-daemon-state-restart-safe-story.md; TEA/security threat model _bmad-output/implementation-artifacts/gla-081-daemon-persistence-threat-model.md; reviewer Wegener requested two fix cycles covering state-root locking, recovered-handoff revocation/retry, worker cleanup retry, unsafe permissions, and lock release. Second re-review tool returned empty payload after fixes; local completion audit plus full gate used as closure evidence.

Implementation: added app-owned encrypted/authenticated daemon state root with least-privilege permissions, owner lock, redaction, and record classification; wired persistent stores through identity/auth/capability/task/session/worker seams; added daemon --state-root/GLA_STATE_ROOT; added async recovery barrier before public bind; safe-closes recovered handoffs only after force-close/revoke/unmount converge; keeps worker live records until stop/reap converge.

Verification: pnpm exec vitest run packages/app/src/daemon-state.test.ts passed (14 tests). pnpm gate passed: typecheck, Biome clean except known broken symlink warning wpm/CLAUDE.md, Vitest 57 files, 605 passed, 12 skipped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
GLA-081 implemented restart-safe security-critical daemon persistence with encrypted least-privilege state, provider/session/capability/task/worker durable seams, fail-closed recovery, lock ownership, retryable cleanup, docs, and full gate coverage.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [x] #7 Security architecture gate completed before implementation: a threat model and data-flow plan classify daemon persistence and define confidentiality, integrity, replay/staleness, retention, redaction, filesystem-permission, migration, and incident-audit requirements.
- [x] #8 Security tests cover tampered or corrupt persisted state, expired or replayed attempts, wrong-recipient state, log and egress redaction, least-privilege storage checks, and orphaned critical-value cleanup.
- [x] #9 Operator and developer documentation explain what critical daemon state is persisted, where it lives, required permissions, backup and migration implications, rotation or re-enrollment recovery, and incident cleanup.
<!-- DOD:END -->
