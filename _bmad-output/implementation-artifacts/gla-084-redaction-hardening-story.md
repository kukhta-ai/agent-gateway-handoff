# Story GLA-084: Harden operator and installer redaction for bearer URLs and secret placeholders

Status: review

BMAD workflow note: `bmad-create-story` was invoked for this context pass. `_bmad-output/implementation-artifacts/sprint-status.yaml` is absent in this repo, so the workflow could not use sprint-status discovery and ran as a docs-driven fallback using `backlog task GLA-084 --plain` as the story contract.

## Story

As an operator and installer maintainer,
I want operator-facing output, receipts, diagnostics, and audit egress to redact secrets and grant-bearing URLs while rejecting redaction placeholders as real inputs,
so that install/runtime evidence remains safe and recoverable without breaking recipient delivery of usable handoff and enrollment links.

## Acceptance Criteria

1. Operator-facing stdout and stderr, install-backlog notes, receipts, daemon diagnostics, and audit egress contain no raw secret values, grant tokens, or full grant-bearing handoff or enrollment URLs.
2. Recipient delivery and browser consumption still receive usable handoff or enrollment links where a grant is required; only non-recipient and operator-facing surfaces are redacted.
3. Secret, config, env, and receipt inputs reject redaction or template placeholders, including literal `***`, `<redacted>`, and unresolved angle-bracket placeholders, with a clear recoverable failure and no valid receipt or service start.
4. Sensitive connection records distinguish secret references from literals; authentik client secrets and comparable sensitive fields are recorded only as secret references or secret-store pointers.
5. A canary install or run with known secret, token, and grant values leaves zero raw canary occurrences in generated env, receipts, operator logs, daemon output, and audit egress.
6. Non-sensitive public configuration such as public base URL, RP ID, ownership mode, checksums, and inverse-op metadata remains visible enough for operator repair and verification.

## Tasks / Subtasks

- [x] Classify egress surfaces before coding. Treat daemon banners/errors, CLI/operator stdout/stderr, install-backlog notes, WPM receipts, catalog diagnostics, and audit egress as redacted surfaces. Treat channel/recipient delivery sinks and browser handoff/enrollment pages as recipient surfaces that may carry required grants.
- [x] Add one shared redaction and placeholder-validation utility instead of duplicating regexes. It should redact raw secret canaries, grant/token query parameters in handoff/enrollment URLs, and sensitive fields by key name while preserving non-sensitive context.
- [x] Wire placeholder rejection into daemon env/flag parsing and authentik config construction. `***`, `<redacted>`, existing Unicode template placeholders such as `⟨https://your-public-host/⟩`, and unresolved ASCII angle placeholders such as `<client-secret>` must fail before `serve()` starts.
- [x] Harden WPM receipt/catalog ingest. Structured `DependencyBinding` evidence must reject placeholder-looking values in connection refs, receipt facts, probe details, inverse-op fields, and decision notes; secret-bearing refs must remain `kind: "secret-ref"`.
- [x] Harden audit egress. Implement the audit package beyond the current marker-only skeleton if needed, ensuring exported audit detail is recursively redacted before any operator-visible output.
- [x] Review CLI/operator JSON output paths. Do not emit full handoff/enrollment URLs with `grant=` on operator/agent read surfaces unless the path is explicitly the recipient-delivery channel.
- [x] Keep recipient delivery usable. Do not redact `DeliverySink.write(...)` payloads or browser-consumed handoff/enrollment links when those are the actual recipient channel.
- [x] Update WPM/env guidance so generated env files cannot be accepted with unresolved template placeholders, while public base URL, RP ID, checksums, ownership mode, and inverse-op metadata remain visible.

## Current Behavior Notes

- `packages/app/src/daemon.ts` parses `GLA_AUTHENTIK_CLIENT_SECRET` / `--authentik-client-secret` as a plain string, passes it into `AuthentikConfig`, and correctly avoids printing it in the startup banner. It currently has no general placeholder rejection for `***`, `<redacted>`, or unresolved template values.
- `packages/app/src/daemon.ts` logs daemon diagnostics to stderr and keeps recipient delivery separate through `DeliverySink`. Preserve that separation: redacting diagnostics is safe; redacting recipient delivery would break AC #2.
- `packages/app/src/index.ts` defines `AuthentikConfig.clientSecret` as a literal string and constructs `AuthAuthentikProvider` from it. If this story introduces secret refs, keep adapter/provider selection in `app`; do not move authentik knowledge into gateway/kernel.
- `packages/catalog/src/index.ts` already rejects secret-bearing connection facts that are not `secret-ref`. It does not currently reject placeholder-looking secret refs, receipt metadata, probe details, inverse-op text, or decision notes.
- `packages/catalog/src/catalog-service.test.ts` already has GLA-082 coverage for managed/adopted/remote/manual/disabled receipt availability and secret-ref-only connection facts. Extend those tests rather than creating a parallel receipt validator.
- `packages/audit/src/index.ts` is currently a placeholder marker despite the architecture requiring audit egress to be redacted.
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl` intentionally contains unresolved template placeholders. The template may contain placeholders, but a rendered env used for service start must reject them.
- The identity-provider WPM task requires authentik client secrets to be held as secret references and says the GLA grant must never travel to authentik. Preserve both semantics.

## Architecture Guardrails

- Agent-blind secrets remain load-bearing. Raw secrets must never enter chat, prompts, transcripts, logs, receipts, diagnostics, audit egress, or agent-visible read models when the design can avoid it.
- Gateway/core remain provider-neutral. Redaction hardening must not add authentik-specific branches to `packages/gateway` or `packages/kernel` authorization logic.
- GLA must not become a WPM installer. GLA may validate and read structured receipts; it must not execute WPM install, repair, or inverse operations at runtime.
- Do not collapse WPM ownership semantics. Managed, local-external/adopted, remote-external, manual-BYO, and disabled must remain visible for repair and uninstall decisions.
- Do not redact non-sensitive operational facts needed for repair: public base URL, RP ID, provider/ownership mode, task ids, checksums, inverse-op descriptions, bundle ids, and probe status may remain visible unless they contain sensitive values.
- Redaction markers are egress-only. If a marker or placeholder is later provided as env/config/secret/receipt input, reject it with a recoverable error.
- Do not break recipient links. Handoff/enrollment browser pages and recipient channel delivery still need the real grant-bearing URL where the protocol requires it.

## Files Likely Needing Changes

- `packages/app/src/daemon.ts` - parse/env validation, startup error redaction, authentik secret input handling, canary log checks.
- `packages/app/src/index.ts` - `AuthentikConfig` shape or construction seam if switching from literal client secret to secret-ref/secret-store pointer at the composition boundary.
- `packages/audit/src/index.ts` - shared audit egress redaction behavior and exported public helpers/types.
- `packages/kernel/src/config-schema.ts` - config input placeholder rejection if the project chooses to enforce it centrally for typed config.
- `packages/catalog/src/index.ts` and `packages/catalog/src/manifests.ts` - WPM `DependencyBinding` placeholder rejection and secret-ref-only diagnostics.
- `surfaces/cli/src/cli.ts` - operator/agent-facing JSON/text output redaction if command results can expose full grant-bearing URLs or secrets.
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl` - guidance/defaults so unresolved placeholders are never valid rendered env.
- `wpm/wip/installer-skills/gla-installer/references/journaling.md` and identity-provider installer guidance - receipt wording if needed; do not hand-edit Backlog.md-managed task state.

## Tests To Add / Update

- `packages/app/src/daemon.test.ts`: `parseServeArgs` / `serve` reject `GLA_PUBLIC_BASE_URL=⟨https://your-public-host/⟩`, `GLA_RP_ID=<rp-id>`, `GLA_AUTHENTIK_CLIENT_SECRET=***`, `GLA_AUTHENTIK_CLIENT_SECRET=<redacted>`, and ASCII angle placeholders before binding listeners.
- `packages/app/src/daemon.test.ts`: canary startup with authentik config proves stderr banner and startup errors do not contain the known client secret, token canary, or full grant-bearing URL.
- `packages/app/src/auth-provider-selection.test.ts`: if `AuthentikConfig` changes, assert authentik still wires only through `app` and adapter selection remains composition-only.
- `packages/catalog/src/catalog-service.test.ts`: placeholder-looking `connection.refs.*.ref`, receipt refs/checksums, probe detail, inverse-op command/condition, and decision notes make the binding unbound with specific `missingEvidence`, while public base URL/checksum/ownership metadata remains visible when safe.
- `packages/kernel/src/config-schema.test.ts`: typed config rejects exact redaction/template placeholders while preserving normal strings and collecting defects in one pass.
- `packages/audit/src` tests: recursive audit egress redacts canary secrets, grant tokens, and handoff/enrollment URLs but preserves non-sensitive task/session/kind fields.
- `surfaces/cli/src/cli.test.ts`: operator/agent read outputs do not expose full `?grant=` URLs or raw secrets; recipient delivery path remains separately tested as usable.
- Add a canary integration test that scans generated env/receipt/operator output/audit JSON for known canary values and asserts zero raw occurrences.

## Security Risks To Avoid

- Do not redact the actual recipient delivery payload or browser link and accidentally make handoff/enrollment unusable.
- Do not accept `***`, `<redacted>`, `⟨...⟩`, or `<...>` as a "safe" secret, URL, receipt ref, or config value. That recreates the transcript failure where redaction output became live configuration.
- Do not rely on key-name redaction alone. Full grant-bearing URLs can appear under innocent field names and must be detected by value shape too.
- Do not leak by error path. Validation failures must name the field and recovery action without echoing the rejected secret/token value.
- Do not hide repair-critical metadata. Over-redaction of public base URL, ownership mode, checksums, or inverse-op metadata can make repair/uninstall unsafe.
- Do not add provider-specific authorization logic outside the app/adapter seam.

## References Read

- `backlog task GLA-084 --plain`
- `_bmad-output/implementation-artifacts/investigations/gla-authentik-transcript-investigation.md`
- `docs/architecture/baseline.md`
- `docs/architecture/test-strategy.md`
- `docs/architecture/dependency-strategy.md`
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`
- `wpm/wip/bundles/identity-provider/install-backlog/tasks/identity-provider-5 - Stand-up-or-adopt-authentik-and-configure-the-RP-application-and-dual-method-flow.md`
- `packages/app/src/daemon.ts`
- `packages/app/src/index.ts`
- `packages/audit/src/index.ts`
- `packages/catalog/src/index.ts`
- `packages/catalog/src/manifests.ts`
- `packages/catalog/src/catalog-service.test.ts`
- `packages/kernel/src/config-schema.ts`
- `packages/kernel/src/entities.ts`
- `wpm/wip/installer-skills/gla-installer/references/journaling.md`

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Completion Notes List

- Story context created from Backlog.md and committed references only.
- Implemented shared kernel redaction/placeholder utilities and removed duplicated app daemon redaction regexes.
- Added daemon argv/env/direct-option placeholder rejection so placeholder config fails before listeners bind.
- Added audit egress redaction helpers and tests for JSON-line operator sinks.
- Hardened catalog/WPM binding validation for placeholder and unsafe bearer-shaped receipt, connection, probe, inverse-op, and decision-note values; secret-bearing connection facts remain secret refs.
- Redacted CLI handoff read models and operator `enrollInvite` readback while preserving usable recipient-delivered links.
- Redacted `gla handoff wait` completion envelopes so detector result URLs cannot leak token/grant/password query canaries to operator stdout.
- Updated identity-provider dependency-binding example to the current structured receipt contract with authentik client secrets represented only as `secret-ref` pointers.
- Addressed independent reviewer blockers for direct `serve()` bypass, catalog unsafe values, operator enrollment readback, and composed secret-key redaction.
- Verification: final `pnpm gate` passed with 59 test files, 628 tests passed, 12 skipped; known warning only for broken symlink `wpm/CLAUDE.md`.

### File List

- `_bmad-output/implementation-artifacts/gla-084-redaction-hardening-story.md`
- `packages/app/src/authentik-enrollment.test.ts`
- `packages/app/src/daemon-state.test.ts`
- `packages/app/src/daemon-state.ts`
- `packages/app/src/daemon.test.ts`
- `packages/app/src/daemon.ts`
- `packages/app/src/enrollment-e2e.test.ts`
- `packages/app/src/index.ts`
- `packages/app/src/scenario-01-e2e.test.ts`
- `packages/app/src/two-handoff-e2e.test.ts`
- `packages/audit/src/audit.test.ts`
- `packages/audit/src/index.ts`
- `packages/catalog/src/catalog-service.test.ts`
- `packages/catalog/src/index.ts`
- `packages/catalog/src/manifests.ts`
- `packages/kernel/src/index.ts`
- `packages/kernel/src/redaction.test.ts`
- `packages/kernel/src/redaction.ts`
- `surfaces/cli/src/cli.test.ts`
- `surfaces/cli/src/cli.ts`
- `wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl`
- `wpm/wip/bundles/identity-provider/payload/templates/dependency-binding.example.json`

### Change Log

- 2026-06-13: Implemented GLA-084 redaction hardening and passed full project gate.
