---
name: block-backlog-manual-writes-bash
enabled: true
event: bash
action: block
conditions:
  - field: command
    operator: regex_match
    pattern: '(\bsed\s+-i|\btee\b|\bdd\b|\bcp\b|\bmv\b|\brm\b|\btruncate\b|>>?)'
  - field: command
    operator: regex_match
    # Targets a Backlog.md root path — but NOT one under templates/ (template content, not a live backlog;
    # see the file-event hook for the rationale). The negative lookahead lets a command that writes a shipped
    # template's backlog scaffold through, while still blocking out-of-band writes to the real backlog/.
    pattern: '^(?!.*templates/).*\b[\w-]*backlog/'
---

🚫 **Manual shell write to a Backlog.md file is forbidden — use the `backlog` CLI.**

This command performs a write/move/delete/redirect **and** targets a path inside a Backlog.md root
(`backlog/`, `.backlog/`, `*-backlog/`). Per this project's `AGENTS.md` — a hard rule, every layer:

> **Backlog.md is operated *only* through its CLI. Never hand-edit anything under `backlog/`.**

Editing task files, `config.yml`, or the board out-of-band (sed -i, echo/cat/printf redirects, tee, mv/cp,
rm, truncate) corrupts the index and recycles/loses task IDs.

**Use the `backlog` CLI instead:**
- create / edit / status / notes: `backlog task create|edit ...`
- tick criteria: `backlog task edit <id> --check-ac <n>` / `--check-dod <n>`
- retire a done-forever task: `backlog task archive <id>`
- read: `backlog task list --plain`, `backlog sequence list`, `backlog task <id> --plain`

`backlog ...` CLI commands and read-only shell (`cat`, `grep`, `ls`) are **not** blocked.
