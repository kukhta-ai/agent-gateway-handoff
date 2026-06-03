# AGENTS.md — agent front door (development)

> **This file governs how an agent develops *this project*.** You are an engineering agent building the
> software specified by this repo's **design set** (the committed docs under `docs/`). Work is tracked as a
> [Backlog.md](https://github.com/MrLesk/Backlog.md) backlog in `backlog/`. You take tasks from that backlog
> and implement them under the process below — an autonomous, **BMAD-based** SDLC with persistent specialist
> subagents, sequential git branching, and a tracked state machine.
>
> This template is **stack-agnostic**: nothing here assumes a language or toolchain. Wherever a concrete
> command is needed (build, lint, test) the process refers to the project's **quality gate** — defined once
> in `CONTRIBUTING.md` and wired identically into pre-commit, CI, and the backlog Definition of Done.

---

## Before anything else — read the design set, in order

Your first action in this repo, before installing tooling, touching the backlog, or writing a line, is to
**read the project's design set fully and sequentially** — every document under `docs/`, in order. This is
mandatory, not optional skimming:

- Read each document in full before opening the next; later docs build on earlier ones.
- Do not skip, sample, or rely on summaries — the design set is the specification you conform to.
- Read `backlog task list --plain` last, so you enter the work with both the design and the task graph in
  mind.

Treat this as loading the project's source of truth into your head. Everything below — the BMAD process, the
state machine, the per-task loop — presupposes you have done this read.

> **Greenfield vs. spec-already-exists.** This SDLC runs the full BMAD pipeline (analyst → pm → architect →
> tea → sm → build → gate → handoff). In a *greenfield* project the early phases **produce** the design set.
> In a project that already has a committed design set, the early phases become **conformance reviews** that
> steer the BMAD workflows from the committed docs rather than designing from scratch (see "How the doc-set
> maps onto BMAD"). The diagram in `docs/SDLC.md` is the authoritative flow either way.

---

## What is fixed vs. what is open to refinement

The design set is the source of truth, but it is **not all equally frozen.** Read it with this distinction,
because it governs how much you may adapt during the build:

- **Fixed — do not drift (the contract).** The **project goals**, the **user problems** being solved, and the
  **style** (the model, the vocabulary, the voice and conventions of the docs and the product). These are
  decided. A change here is a scope change — a user gate; stop and surface it, never decide it yourself.
- **Open to refinement (proposals & drafts).** Much of the **architecture and concrete code-level detail**
  are proposals, not commitments. The acceptance criteria say *what* must be true; the exact module shapes,
  internal APIs, and many decisions will rightly be refined as you reach concrete tasks and hit real
  problems. The BMAD agents (`architect`, `tea`, the review loop) exist partly to **refine these as you go.**

So: hold the goals, the user problems, and the style invariant; treat architecture and realization as the
best current proposal, to be sharpened by real implementation. When the code teaches you something the docs
didn't foresee, **evolve the design rather than forcing the code to match a stale sketch** — and record the
change (`backlog task edit <id> --notes`, and update the affected doc through the normal flow). If a
refinement would alter a goal, a user problem, or the model/vocabulary, that is the fixed core — stop and
surface it as a user gate.

---

## Three hard rules — read first, they override convenience

**1. Backlog.md is operated *only* through its CLI. Never hand-edit anything under `backlog/`.**
Every task touch — create, read, status, acceptance-criteria check, dependency, note, archive — goes
through the `backlog` command. Task files, `config.yml`, sequences, and indexes are CLI-managed state;
editing them by hand corrupts the index and the IDs. There is always a `backlog task edit` flag for what
you want; opening `backlog/tasks/*.md` in an editor is never correct. (A repo hook also blocks direct edits.)

```
backlog task list --plain                  # the backlog (ALWAYS --plain for agents)
backlog task <id> --plain                  # one task: its AC + DoD
backlog sequence list                      # dependency-ordered execution plan (what's ready next)
backlog task edit <id> -s "In Progress"    # status
backlog task edit <id> --check-ac <n>      # tick an acceptance criterion (only when truly met)
backlog task edit <id> --check-dod <n>     # tick a Definition-of-Done item
backlog task edit <id> --notes "<text>"    # record an implementation note / decision
backlog task create "<title>" --ac "..." --dep <id>   # only if the process below calls for it
```
For anything else: `backlog <cmd> --help`. Never a text editor.

The CLI governs *how* you touch a task; **the acceptance-criteria contract governs *what* goes into one** —
and reading that contract (`docs/task-writing-conventions.md`) is mandatory before any `backlog task create`
or acceptance-criteria edit.

**2. Prefer tools over hand-editing, everywhere a tool exists.** Scaffold with generators, fix
formatting/lint with the formatter and linter (never manual whitespace), manage dependencies through the
package manager (never hand-edit the manifest), apply review feedback by re-running the relevant workflow.
Hand-writing files is for genuinely new logic only — not for what a tool does deterministically. This
extends to BMAD — its workflows are **run**, not transcribed (Rule 3).

**3. The BMAD workflows are *run*, not paraphrased — inside the specialist whose workflow it is.** Every
persona step in the SDLC below is a literal invocation of its BMAD skill *by that persistent subagent*: the
`worker` invokes `create-story`, then `dev-story`, then `qa-generate-e2e-tests`; the reviewer invokes
`story-automator-review`; the planning personas invoke `product-brief` / `prd` / `create-architecture` /
`testarch-*`. You **steer** each workflow from the design set — you supply its elicitation answers — but you
never replace it with a hand-written brief that merely *describes* what the workflow would do. A freehand
approximation of a workflow is the same defect as hand-editing a task file instead of using its CLI: it
looks like the SDLC and isn't. Make each invocation **visible** — record *which* skill the specialist
actually ran, in its state-file entry and the story's `--notes`, so a skipped workflow can't hide behind
plausible output. If a skill genuinely cannot run unattended, that is a deviation to **surface** (name the
blocker, drive the step from the docs as a stated fallback, record it) — never a silent substitution.
Confirm *once*, at Step 0, that a spawned specialist can actually invoke its skill; never assume it.

---

## How tasks are written — read the contract before you create one

**Before you create or edit any task, you must have read `docs/task-writing-conventions.md` in full.** Do
not run `backlog task create`, and do not add or change a task's acceptance criteria, until you have. That
doc is the binding standard for task *content*.

The contract in one line: a task's **acceptance criteria state an observable outcome (the *what*), never the
method (the *how*)** — one concern per criterion, negative and edge behaviour covered as outcomes too, and
the Definition of Done never restated per task. Name a thing only when it is a genuine boundary (an exit
code, a file format, an interface's method shape, a typed error kind) — *specify the seam, leave the
stuffing.* A task whose criteria prescribe steps is mis-written. The doc's **author checklist** is the gate
for "well-formed," and its **worked rewrites** show *how*→*what*.

---

## How the design set maps onto BMAD

The BMAD SDLC is a full greenfield pipeline (analyst → pm → ux → architect → tea → sm → workers → retro →
epic gate → handoff). BMAD's workflows expect certain **named artifacts to physically exist** (`prd.md`,
`architecture.md`, `sprint-status.yaml`, per-story files, a test-design doc, etc.), and a phase or tool may
refuse to proceed without them.

| BMAD artifact | Greenfield: produced by | Spec-exists variant: already lives as |
|---|---|---|
| product brief, PRD, UX spec | `analyst`/`pm`/`ux` running their workflows | your committed `docs/` (the model + roles) |
| architecture decisions | `architect` running `create-architecture` | your committed architecture docs |
| epics + stories | `architect` `create-epics-and-stories` + `sm` | the `backlog/` tasks (an epic = a feature; a task = a story) |
| test architecture / CI design | `tea` `testarch-*` | your committed test/CI docs |

You always produce these **by running the proper BMAD workflow** — never by hand-writing the file. In the
spec-exists variant you additionally **steer each workflow from the committed docs:** feed the workflow your
docs (not fresh invention), don't drift from the goals, let the docs win on conflict, and point the
generated artifact back at the canonical doc (`see docs/<x>`) rather than restating it. Your real effort
then goes into BMAD's **per-story build loop (Phase 5)**, applied to each backlog task.

---

## Step 0 — Install BMAD and initialize the persistent specialists  (do this once, first)

You cannot run the SDLC without the BMAD agents and workflows installed; the template ships without them. Run
the bootstrap to install them into your project — they are committed (the `.gitignore` does not exclude
them) — then keep one long-lived
("persistent") session per specialist, spawned once and **resumed** for each later call (the diagram's
SPAWN vs RESUME distinction).

1. **Run the bootstrap script** from the repo root (installs the Backlog.md CLI and the BMAD modules this
   SDLC uses — `bmm`, `tea`, `automator` — at pinned versions):
   ```
   bash scripts/setup.sh
   ```
   Or do it by hand:
   ```
   npx bmad-method install --modules bmm,tea
   npx bmad-method install --modules automator
   ```
   - **BMM** — the core method: agents `analyst, pm, ux-designer, architect, sm, dev, tea, tech-writer` and
     the workflows `create-story, dev-story, qa-generate-e2e-tests, retrospective, sprint-planning,
     create-architecture, create-epics-and-stories, check-implementation-readiness`.
   - **TEA** (test architecture) — agent `tea` and the `testarch-*` workflows: `test-design, framework, ci,
     trace, nfr, atdd, automate, test-review`.
   - **automator** — the autonomous build loop (`story-automator` + `story-automator-review`) for Phase 5.
2. **If any package fails to resolve or its commands are unknown, STOP and read the module source before
   proceeding** — do not invent agent names or workflow steps. Clone `bmad-code-org/BMAD-METHOD` (and the
   `tea` / `automator` module repos) and read each module's agent/workflow definitions to confirm the exact
   commands.
3. **Spawn the persistent specialists** you will resume throughout (one session each, kept alive): `analyst,
   pm, ux-designer, architect, tea, sm`, plus the build **worker** and **investigator** roles (from
   `dev`/`qa`) and **retro** (from the retrospective workflow). Record, in the state file, that each is
   initialized and its role.
4. **Confirm** the install *and that a subagent can drive it*: a spawned specialist subagent can itself
   invoke its skill (run one persona's skill end-to-end once before trusting the loop to it). If a subagent
   cannot load or run a BMAD skill, STOP and surface it — the SDLC assumes the workflow runs *inside* the
   specialist (Rule 3), not that you paraphrase it.

> Persistent ≠ stateless: a specialist spawned in an early phase is **resumed** in a later one. Treat each
> as a durable collaborator, not a fresh call each time.

---

## The SDLC state tracker — you must always know where you are

Because this loop is long and resumable, **maintain an explicit, durable record of SDLC position** and
re-read it on every resume. Keep two things in sync:

1. **A state file in the repo** — `.bmad/sdlc-state.yaml` (initialize it in Step 0, update at every
   transition). It records the current phase, branch, epic, active story, review cycle, the persistent
   specialists (spawned? + role + the BMAD skill each LAST ran — Rule 3 evidence), pending gates, and a
   timestamp. The template ships a blank one to fill in.
2. **Backlog.md status is the source of truth for *story* progress** — task status (`To Do` / `In Progress`
   / `Done`) and ticked AC/DoD are authoritative. `backlog sequence list` tells you which task is ready
   next. The state file points *at* the current task; the task's own record holds its detail.

On any resume: read `.bmad/sdlc-state.yaml`, then `backlog task list --plain` and `backlog sequence list`,
reconcile, and continue from exactly that point. Never restart completed work; never guess the phase.

---

## Branch topology  (sequential — one story in flight, single working tree, no worktrees)

```
main → dev → feature/<epic> → feature/<epic>-task-<id>
                     \__ fix/<epic>/<issue>     (only at the epic gate, on failure)
```
- `dev` holds long-lived integration work. Each **epic** lives on `feature/<epic>` (off `dev`).
- Each task (story) gets its own sub-branch off the epic branch, merged back **`--no-ff`** when Done, then
  the sub-branch is **deleted**. One worker active at a time.
- A failure at the epic gate gets a `fix/<epic>/<issue>` sub-branch, same merge-and-delete rule.
- The story branch uses a **hyphen** (`feature/<epic>-task-<id>`), not a slash, so it can coexist with the
  `feature/<epic>` ref (git cannot have both a file and a directory at `refs/heads/feature/<epic>`). See
  `CONTRIBUTING.md` → Branching model.

---

## The full SDLC schema — phases, personas, workflows, git, gates

The complete sequence — every persona call, workflow, git operation, and gate — is the diagram in
**`docs/SDLC.md`** (an agent-readable Mermaid sequence). This section is the prose form; read them together.
Run top to bottom. **(GATE)** = a user gate: **stop and wait for a human**. Update `.bmad/sdlc-state.yaml`
at every phase boundary.

**Phase 1 — Analysis** · branch `dev` · persona `analyst`
- `analyst` runs `product-brief`. In a spec-exists project, confirm the brief is captured by the design set
  rather than inventing scope; surface any gap.
- **(GATE)** human approves the brief.

**Phase 2 — Planning** · branch `dev` · personas `pm`, `ux-designer` (optional)
- `pm` runs `prd`; `ux-designer` runs the UX workflow if the product has a UI. Commit produced planning
  artifacts on `dev`.
- **(GATE)** human approves the plan-of-record.

**Phase 3 — Solutioning + test architecture** · branch `feature/<epic>` (off `dev`) · personas `architect`,
`tea`
- `git checkout -b feature/<epic>` from `dev`.
- `architect`: `create-architecture`, then `create-epics-and-stories` (seeds the backlog), then
  `check-implementation-readiness`.
- `tea`: `testarch-test-design`, `testarch-framework`, `testarch-ci` — reconciled with this project's
  **quality gate** (the build/lint/test commands declared in `CONTRIBUTING.md`).
- Commit architecture + epics + test-architecture + CI on `feature/<epic>`.
- **(GATE)** human approves solutioning.

**Phase 4 — Sprint setup** · branch `feature/<epic>` · personas `sm`, `tea`
- `sm` confirms the ready set via `backlog sequence list`; the backlog tasks *are* the stories. If BMAD
  needs per-story files or a `sprint-status.yaml`, produce them by running `create-story` seeded one-to-one
  from the existing tasks (a task's acceptance criteria are the story's; keep Backlog.md the source of truth
  for status).
- **(GATE)** human marks the sprint ready to build.

**Phase 5 — Autonomous build** · branch `feature/<epic>` → per-story sub-branches · personas `worker`
(dev), `tea`, `retro`
- Configure the **automator** (Step 0). Then, **per backlog task**, run the per-story loop below.
- After the epic's tasks are Done, spawn `retro` to run `retrospective`; commit the retrospective on
  `feature/<epic>`.

**Phase 6 — Epic gate** · branch `feature/<epic>` (+ `fix/<epic>/<issue>` if needed) · personas `tea`,
`investigator`, `worker`
- `tea`: `testarch-trace` (coverage matrix + interim gate) and `testarch-nfr` (NFR report).
- Reset to a clean environment and run the whole test/E2E suite **cold**, the way CI does — a fresh
  checkout, nothing warm.
- On failure: spawn `investigator` (systematic debugging) → root cause + fix plan → `fix/<epic>/<issue>` →
  `worker` applies the fix → commit → merge `--no-ff` → delete the fix branch → re-run cold. Repeat until
  green.
- `tea`: re-run `testarch-trace` → **final** gate verdict (PASS / CONCERNS / FAIL / WAIVED).
- **(GATE)** human disposes any CONCERNS.

**Phase 7 — Handoff** · branch `feature/<epic>` → `dev` → `main`
- Push `feature/<epic>`; open a PR `--base dev` (`gh pr create`). The PR must show **green CI** (the quality
  gate).
- **(GATE)** human reviews the PR and merges → `dev`. Promotion to `main` is a separate human decision.
- Never self-merge to `dev` or `main`.

---

## The per-story loop (Phase 5, applied to one backlog task)

Pick the **next task whose dependencies are all Done** (`backlog sequence list`; ids are in dependency
order). Then:

1. **Claim & read.** `backlog task edit <id> -s "In Progress"`; `backlog task <id> --plain`. Set
   `active_story` and `review_cycle: 0` in the state file. The acceptance criteria are the contract — they
   say *what* must be true, not *how* (standard: `docs/task-writing-conventions.md`); you pick the how.
2. **Branch.** `git checkout feature/<epic> && git checkout -b feature/<epic>-task-<id>`. Update `branch`.
3. **create-story (worker).** The worker **invokes the `create-story` skill** (not a hand-written spec —
   Rule 3) to turn the task into a concrete work spec grounded in the docs.
4. **dev-story (worker).** The worker **invokes `dev-story`** to implement the task with its tests together —
   the DoD requires the project quality gate to pass (build/lint clean, tests green).
5. **qa-generate-e2e-tests (worker / tea).** **Invoke `qa-generate-e2e-tests`** to add the
   end-to-end/acceptance tests for the task's behavior.
6. **story-automator-review cycle (reviewer — a *separate* subagent, never the worker self-reviewing).** The
   reviewer **invokes `story-automator-review`** + runs the full quality gate (the same one CI runs). Treat
   findings as blocking; bump `review_cycle`. Loop dev-story → review **until clean**, up to ~5 cycles. If it
   won't converge, record why via `--notes` and raise it.
7. **Verify against acceptance criteria.** Criterion by criterion, each observably true; tick as they pass
   (`--check-ac <n>`). Never tick what you haven't shown.
8. **Record & close.** Tick DoD items (`--check-dod <n>`), record in `--notes` which BMAD skills this story
   actually ran (Rule 3's evidence trail), add a decision note if worth keeping, then `backlog task edit
   <id> -s "Done"`.
9. **Integrate.** Commit on the sub-branch (message references `task-<id>`); `git checkout feature/<epic> &&
   git merge --no-ff feature/<epic>-task-<id>`; `git branch -d feature/<epic>-task-<id>`. Clear
   `active_story`; update state.
10. **Next.** Return to the top with the next dependency-ready task. When the epic's tasks are Done, proceed
    to the Phase 6 epic gate.

Honor the repo's branching, PR/review, and versioning conventions (`CONTRIBUTING.md`) for commit and merge
mechanics.

---

## User gates — pause and wait for a human
Stop and ask rather than proceeding past any of: a change to scope or to the design docs (the spec is
human-owned); the phase gates above; merging into `dev` or `main`; an epic-gate verdict of CONCERNS/FAIL;
anything destructive or irreversible.

## Definition of Done (also enforced per task in the backlog)
A task is Done only when **the project quality gate is green** (build/typecheck clean, linter/formatter
clean, tests added and green), public interfaces are documented with no dead code, every acceptance
criterion is observably satisfied and ticked, and the work is committed on its sub-branch and merged to
`feature/<epic>`. The concrete gate commands live in `CONTRIBUTING.md` (and `backlog/config.yml`'s
`definition_of_done`).

## When stuck
Re-read the relevant design doc. For BMAD mechanics, read the module sources rather than guessing. If a
task's acceptance criteria seem to contradict a doc, that's a real conflict — stop and surface it.
