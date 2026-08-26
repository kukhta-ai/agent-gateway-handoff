# gla

**This is not a codebase to read and edit — it is a project to _install_.** You are an executing agent, and
your job is to install `gla` into this environment, working from the recipe this repository ships.
Flip your stance now: do not refactor, do not "improve" these files; follow the install loop below.

## Recognition & kickoff

`gla` is a bundle-project built with **wpm**. A bundle-project is a set of independent **bundles**
you install on request, each with its own recipe (an `install-backlog/`) and its own delivered capability. You
can be pointed at this install in three ways, all equivalent:

- you are reading this front door (`AGENTS.md`) — that is enough to begin;
- invoke the **`gla-installer`** skill ("install this project"), which expands the loop below into
  exact procedure;
- or kick off with a goal, e.g. `/goal: install this project`.

If `installer-skills/` contains vendored **discipline skills** (e.g. test-driven-development, systematic-
debugging), honor them — they enforce the workflow rather than merely describing it. For an **unattended run**,
`RALPH-LOOP.md` is the per-iteration prompt (the install task statement + the SDLC for each fresh pass); a
vendored loop runner, if present, executes it, and a bare agent can re-read it each pass to behave loop-like.

## The shape of the install

Install proceeds by orienting on the manifest and then working the selected bundles' backlogs, resuming across
restarts:

1. **Orient.** Read `manifest.yml` — the project's identity and its enabled bundles.
2. **Detect.** Look at the environment to see what is already present; never assume.
3. **Offer the menu.** Present the available bundles for the user to choose from:

4. **Resolve & preview.** For the chosen bundles, resolve their `requires` dependencies (install a dependency
   before what needs it), then **preview the plan and get consent** before changing anything.
5. **Work each bundle's backlog, task by task.** For every task, run the uniform loop —
   **detect → setup → verify → record**: detect whether it is already done (idempotent; skip if so), set it up
   honoring the bundle's confirmation level, verify it against the task's acceptance criteria (handing off to
   the user where a step needs them), and **record** the receipt into the task before marking it Done. Defer
   and **resume from the record** across restarts — the task records, not your memory, are the source of truth.
6. **Close.** Tell the user how to use what was installed.

This front door states the *policy* and the per-task workflow; the **`gla-installer`** skill
supplies the *procedure*, and a vendored discipline skill, if present, supplies *enforcement*.

## Standing rules

These govern recording and reversal for the whole install:

- **Record only what inspection can't recover.** Presence, registration, and file integrity you can re-derive
  by looking; the installed-vs-adopted distinction, the inverse op, an overwritten file, and a chosen value
  you cannot — so write those down at the moment you act.
- **Read a task's prior record before acting, and reuse decisions** rather than re-deciding them.
- **Only ever reverse what you installed.** Never remove a dependency you merely adopted from the user's
  machine.
- **Decide a shared dependency's removability from the graph** (the `requires` edges plus the still-installed
  bundles), not from a stored counter.
- **Checksum a config file against its recorded value before overwriting**, and on a conflict offer
  keep / replace / merge rather than blind-overwriting.
- **Contain a failing bundle** so it cannot touch the others.
- **Pause at confirmation points and resume from the record.**

The exact recording mechanics — which Backlog.md field holds which fact, and how to write it — are **not**
here; they live in the `gla-installer` skill's `references/journaling.md`, loaded on demand.
