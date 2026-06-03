---
name: block-backlog-manual-edits
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    # Block writes to any Backlog.md root (backlog/, .backlog/, *-backlog/, etc.) EXCEPT under templates/.
    # A path under templates/ is template CONTENT (a shipped scaffold that may carry {{placeholders}}), not a
    # live, CLI-managed Backlog.md — those are hand-authored, so the leading negative lookahead exempts them
    # while keeping the rule's full force for the real, CLI-managed backlog/.
    pattern: '^(?!.*(^|/)templates/).*?(^|/)\.?[\w-]*backlog/'
---

🚫 **Manual edit of a Backlog.md file is forbidden — use the `backlog` CLI.**

This path is inside a Backlog.md root (the top-level `backlog/`, a `.backlog/`, or any `*-backlog/`).
(Template content under `templates/` is exempt — that is a shipped scaffold with `{{placeholders}}`, not a
live CLI-managed backlog.) Per this project's `AGENTS.md` — a hard rule, on every layer:

> **Backlog.md is operated *only* through its CLI. Never hand-edit anything under `backlog/`.**

Hand-editing task files, `config.yml`, sequences, or the board corrupts the index and the task IDs.

**Do it through the CLI instead:**
- `backlog task create "<title>" --ac "..." --dod "..." --dep <id>`
- `backlog task edit <id> -s "In Progress"` · `--check-ac <n>` · `--check-dod <n>` · `--notes "..."` · `--ac "..."`
- `backlog task list --plain` · `backlog sequence list` · `backlog task <id> --plain` · `backlog task archive <id>`
- Anything else: `backlog <cmd> --help`

Reading these files is fine — only writes are blocked. To change `config.yml`, use the `backlog` config flow
(`backlog config --help`) or re-run `backlog init` rather than editing it by hand.
