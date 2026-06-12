---
id: GLA-084
title: >-
  Harden operator and installer redaction for bearer URLs and secret
  placeholders
status: To Do
assignee: []
created_date: '2026-06-12 20:03'
updated_date: '2026-06-12 23:01'
labels:
  - hardening
  - security
  - wpm
  - operator-output
  - authentik
dependencies:
  - GLA-066
  - GLA-074
references:
  - >-
    _bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md
  - docs/architecture/baseline.md
  - docs/architecture/test-strategy.md
  - docs/architecture/dependency-strategy.md
  - wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl
  - >-
    wpm/wip/bundles/identity-provider/install-backlog/tasks/identity-provider-5
    -
    Stand-up-or-adopt-authentik-and-configure-the-RP-application-and-dual-method-flow.md
  - packages/app/src/daemon.ts
  - packages/audit/src/index.ts
priority: high
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: operator-facing installer and runtime output must not expose bearer grant URLs or raw secrets, and redacted placeholders must never be accepted as real secret, config, env, or receipt values. This hardens the WPM receipt/env boundary and GLA daemon/audit egress while preserving recipient delivery of usable handoff and enrollment links.

Boundaries: recipient-facing delivery may still carry the grant where the protocol requires it; the restriction is on operator-facing surfaces, logs, receipts, diagnostics, and audit egress.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Operator-facing stdout and stderr, install-backlog notes, receipts, daemon diagnostics, and audit egress contain no raw secret values, grant tokens, or full grant-bearing handoff or enrollment URLs.
- [ ] #2 Recipient delivery and browser consumption still receive usable handoff or enrollment links where a grant is required; only non-recipient and operator-facing surfaces are redacted.
- [ ] #3 Secret, config, env, and receipt inputs reject redaction or template placeholders, including literal ***, <redacted>, and unresolved angle-bracket placeholders, with a clear recoverable failure and no valid receipt or service start.
- [ ] #4 Sensitive connection records distinguish secret references from literals; authentik client secrets and comparable sensitive fields are recorded only as secret references or secret-store pointers.
- [ ] #5 A canary install or run with known secret, token, and grant values leaves zero raw canary occurrences in generated env, receipts, operator logs, daemon output, and audit egress.
- [ ] #6 Non-sensitive public configuration such as public base URL, RP ID, ownership mode, checksums, and inverse-op metadata remains visible enough for operator repair and verification.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Prepared from the transcript comparison and independent subagent draft: Arendt/redaction.

Review mapping update: secret-ref and redaction findings are covered here, while public-browser bearer transport is split to GLA-089. Evidence: WPM identity-provider templates describe secret references, but packages/app/src/daemon.ts can receive authentik client secret material through env/argv/plain config. This task should ensure placeholders are rejected and sensitive connection records persist only secret references or secret-store pointers.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
