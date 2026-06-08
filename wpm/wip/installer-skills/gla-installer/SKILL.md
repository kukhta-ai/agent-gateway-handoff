---
name: gla-installer
description: Install the gla bundle-project into this environment. Use when the user asks to install this project, run the installer, or set up gla.
---

# gla installer

You are installing **gla**. The front door (`AGENTS.md`) states the policy and the standing
rules; this skill is the **procedure** — the actual steps for orienting, detecting, offering, resolving, and
driving the install loop. Load `references/journaling.md` for the exact receipt-recording mechanics.

## Orient

Read `manifest.yml`: the project's `name`, `version`, the `targets` (the agents this install supports), and the
flat list of enabled `bundles`. For each enabled bundle, read its `bundles/<id>/bundle.yml` for its `summary`
(the user-facing menu line), `version`, `confirmation-level`, and `requires` map.

## Offer the menu and resolve dependencies

Present the bundles by their `summary`. For the bundles the user selects, resolve `requires` into install
order (a dependency installs before what needs it); detect cycles and stop if any exist. **Preview the full
plan and get explicit consent before making any change.**

## Drive the loop, one bundle's backlog at a time

Work each selected bundle with that bundle directory as your working directory, walking its `install-backlog/`
tasks in dependency order. For each task, run **detect → setup → verify → record**:

- **detect** — is this already done? Idempotent: if so, skip (this is what makes re-runs safe / Repair work).
- **setup** — perform the step, honoring the bundle's `confirmation-level` (pause for consent on a `dangerous`
  step).
- **verify** — check the task's acceptance criteria; hand off to the user where a step needs them.
- **record** — write the receipt into the task (see `references/journaling.md`) **before** you mark it Done.
  The bundle's Definition of Done makes recording a precondition for Done — you cannot progress without it.

Defer and **resume from the task records** across restarts; never rely on conversation memory for what is done.

## Close

When the selected bundles are installed and verified, tell the user how to use what was installed.

## Migrations and updates

On an update (a bumped bundle version), re-run the recipe against the persistent receipt: the idempotent
`kind:state` tasks reconcile, and any pending `kind:migration` tasks fire oldest-first, gated on the recorded
from-version.
