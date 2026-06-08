# gla

`gla` is an **agentic installer** built with wpm — a bundle-project an AI coding agent installs
into your environment on request. It is not run directly; you point an agent at it, and the agent works the
install recipe this repository ships.

## What it installs

The capabilities `gla` delivers are organized as independent **bundles**, listed in
`manifest.yml`. A fresh project starts with none — add them with `wpm bundle new <id>`. Each bundle carries its
own install recipe and its own delivered capability; the agent offers them as a menu and installs the ones you
choose, resolving any dependencies between them.

## How to install it

Point your coding agent (Claude Code, Codex, Hermes, …) at this directory. The agent reads **`AGENTS.md`** —
the always-live front door — or invokes the **`gla-installer`** skill, and drives the install:
orient on the manifest, detect what is present, offer the bundle menu, preview a plan for your consent, then
work each selected bundle to completion, recording what it did so it can repair or uninstall later.

For an unattended run, `RALPH-LOOP.md` is the per-iteration prompt a loop runner feeds each fresh agent pass.

## Learn more

See `docs/` for the project-wide reference. The `gla-installer` skill's `references/journaling.md`
documents exactly how the install records its receipt.
