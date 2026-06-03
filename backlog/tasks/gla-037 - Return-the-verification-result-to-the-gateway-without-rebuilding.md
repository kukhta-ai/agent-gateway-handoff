---
id: GLA-037
title: Return the verification result to the gateway without rebuilding
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 12:21'
labels:
  - impl
  - check
  - row
  - auth
dependencies:
  - GLA-035
documentation:
  - docs/components/identity-and-auth.md
priority: low
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the gateway must act on the verifier's result; reuse the auth build, do not rewrite. Builds only the delta. Depends on the auth step. Out of scope: rebuilding verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The verifier's result and auth strength reach the gateway and gate the entrypoint, using the existing auth build with no rewrite.
- [x] #2 A failure result is conveyed as a refusal, not an unstructured error.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 (second handoff + deltas, Phases 9-14): verified by the REAL two-handoff E2E (packages/app/src/two-handoff-e2e.test.ts) + per-delta tests; see docs/architecture/slice-6-second-handoff.md for per-delta verdicts. Most deltas verified-as-is (no rebuild); AUTH-REUSE on re-open + url-watcher intermediate edge-trigger + handoff-grant class=session added and reviewed CLEAN. 384 tests green.
<!-- SECTION:NOTES:END -->
