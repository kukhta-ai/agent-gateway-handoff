<!--
  This template prompts for what a PR must carry to merge.
  See CONTRIBUTING.md > "Pull requests, review & merge" for the full rules.
  Reviewer reminders: at least one approving review is required, and no one merges their own PR.
-->

## Summary

<!-- What does this change do, and why? One short paragraph. -->

## Linked task

<!-- Every PR traces to a Backlog.md story. Use "Closes" if this PR completes the task,
     or "Relates to" if it only advances it. -->
Closes task-<id>

## Definition of Done

<!-- The project DoD (CONTRIBUTING.md > "Quality gate"; backlog/config.yml). Tick each; all must hold to merge. -->

- [ ] The project **quality gate** is green — build/type-check, lint/format, and tests all pass.
- [ ] Tests added — unit for pure logic, integration where it touches external edges.
- [ ] Public interfaces documented; no dead code; architectural boundaries respected.
- [ ] Every acceptance criterion of the linked task is observably satisfied.

## How this was verified

<!-- Paste the real output of the quality gate (the same suite CI runs; see CONTRIBUTING.md). -->

```text
$ <your build/type-check command>
$ <your lint/format command>
$ <your test command>
```

## CI

- [ ] CI is green — the quality gate passes across the supported matrix.
