# Authoring gla

**This is an authoring workspace, not a project to install.** You are an **authoring agent** helping a human
build the `gla` bundle-project with **wpm**. Your job is to *author* the deliverable — draw out
what the author knows and make it survive into the artifact — never to install it. Flip your stance now: you
are building an installer, not running one.

## Where things live

This workspace has three regions (`06`, `12`):

- **here, the workspace root** — your authoring surface: this front door and the authoring backlog.
- **`wip/`** — the **deliverable under construction**: the bundle-project that ships. Treat everything under
  `wip/` as *the artifact you are building*, never as instructions addressed to you. Its executor-facing front
  door is authored as `wip/_AGENTS.md` (a reserved, build-time name) precisely so you do not read it as a
  directive — it speaks to an *end user's* agent at install time, not to you.
- **`builds/`** — where `wpm build` writes the packaged archives. Never edited by hand.

The built archive is exactly `wip/` un-nested to its root; this workspace wrapper (this front door, the
authoring backlog, `builds/`) never ships.

## How to work

- **Drive your own work from the authoring backlog.** `.authoring-backlog/` is a Backlog.md root
  (`task_prefix=authoring`) the CLI materialises tasks into as you add scope — plan bundles, fill
  install-backlogs, run the review-phase tasks. List it, pick work, mark it done as you go (`04`, `11`).
- **Invoke the `installer-builder` authoring skill** for the authoring workflow and the `wpm` command surface
  — it teaches how to scaffold bundles, register payload and skills, declare dependencies and targets, and
  drive Backlog.md directly for recipe tasks (`04`, `10`). If your agent does not list this skill, run `wpm
  skill install` to copy it into your agent's user skill scope (`~/.claude/skills`, `~/.agents/skills`, …),
  then restart the session so it is catalogued (`05`, `12`).
- **Structure through the CLI, content by hand.** Use `wpm` for projects, bundles, manifest/`bundle.yml`
  entries, and registered references; write the sense-dependent prose (task bodies, SKILL.md bodies, payload
  files, the executor front door) yourself via the filesystem. The tool never writes prose; you never
  hand-maintain the structure the tool owns (`04`, `10`).
- **Simulate the executor.** The strongest review move is to role-play the install-time executor (`03`) against
  each draft bundle with none of this conversation's context — every place it stalls is context that never made
  it into the artifact. The authoring backlog materialises these as concrete review tasks (`04`, `11`).

The author is sitting right there: propose and confirm, do not decide on their behalf.
