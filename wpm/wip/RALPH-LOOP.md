# RALPH-LOOP — the unattended install prompt for gla

This is plain prose, not a program. It is the **per-iteration prompt** an unattended loop feeds to each fresh
agent instance installing `gla`: the install task statement plus the SDLC instructions for one
pass. A loop runner (if the author vendored one) executes it each iteration; with no runner, an agent can
simply re-read this file and the task records each pass and behave loop-like. The runner is a separate thing —
this is only the prompt it runs.

## The task

Install `gla` into this environment by working the selected bundles' `install-backlog/` recipes to
completion, following `AGENTS.md` and the `gla-installer` skill. The **task records are the
receipt** — they, not your memory, tell you what is already done.

## Each iteration

1. **Re-orient from the record, not from memory.** Read `manifest.yml`, then the in-progress install's task
   records, to find what is done and where to resume. A fresh instance has no conversation history — the record
   is the single source of truth.
2. **Pick the next unblocked task** in dependency order for a selected bundle.
3. **Run the uniform loop** for it — detect (skip if already done) → setup (honor the confirmation level) →
   verify (against the acceptance criteria) → **record** the receipt before marking it Done.
4. **Stop the iteration on a handoff or a blocker** — if a step needs the user, or a Definition-of-Done item
   cannot be satisfied, record the state (`status: Blocked` + a note) and halt this pass rather than guessing.
5. **Otherwise continue** to the next task, or finish when every selected bundle's backlog is Done and verified.

Never reverse what you did not install; never overwrite a config file without comparing its checksum first;
contain a failing bundle so it cannot affect the others. The standing rules in `AGENTS.md` apply on every pass.
