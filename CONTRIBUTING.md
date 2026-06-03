# Contributing

This guide covers the engineering conventions for developing this project: the **quality gate**, the
**branching model**, **pull-request review and merge** rules, and **versioning**. It governs *how we build
the software*. The authoritative process is the BMAD-based SDLC in [`AGENTS.md`](./AGENTS.md) and its
sequence diagram in [`docs/SDLC.md`](./docs/SDLC.md); the sections below are the concrete conventions those
describe.

This project is **stack-agnostic by template**: the conventions here do not assume a language. The one place
you make it concrete is the **Quality gate** section immediately below — fill it in once for your stack, and
the rest of the process (pre-commit, CI, the backlog Definition of Done) refers back to it.

## Quality gate

> **TODO (per project): replace the placeholders below with your stack's real commands.**

The quality gate is the **single, named set of checks** that defines "this change is acceptable." It runs in
three places and must be **identical** in all three — there is no separate, stricter CI-only bar:

| Check | Local command | What it asserts |
|---|---|---|
| **Build / type-check** | `<your build/typecheck command>` | the code compiles / type-checks with no errors |
| **Lint + format** | `<your lint/format-check command>` | style and static-analysis rules pass (including any architectural boundary rules) |
| **Tests** | `<your test command>` | the suite is green — unit for pure logic, integration where it touches external edges |

Examples by stack (delete the ones that don't apply, keep one):

```text
Node/TS : tsc --noEmit            | biome ci .            | vitest run
Python  : mypy . / pyright        | ruff check .          | pytest
Go      : go build ./...          | golangci-lint run     | go test ./...
Rust    : cargo check             | cargo clippy -- -D warnings && cargo fmt --check | cargo test
```

The same three commands run locally (before you push), in the **pre-commit hook** (on staged files, see
`.husky/` or your hook manager), and in **CI** (`.github/workflows/ci.yml`, across your support matrix). Run
them locally before opening a PR and you have already run the gate. The project **Definition of Done** in
[`backlog/config.yml`](./backlog/config.yml) is this same gate, declared once so every task carries it.

## Branching model

Development is **sequential**: one story is in flight at a time, in a single working tree (no git
worktrees). Work flows inward from short-lived story branches to the integration branch and, by a
deliberate human decision, to the release branch. The topology is
`main → dev → feature/<epic> → feature/<epic>-task-<id>`, with a `fix/<epic>/<issue>` branch opened only at
the epic gate on failure (`AGENTS.md` → "Branch topology"; `docs/SDLC.md` Legend).

### The branches

| Branch | Role | Releasable? | Direct commits? |
|---|---|---|---|
| `main` | The release branch — always in a releasable state. Protected. | **Yes, at all times.** | **Never** — see [What may never be committed to `main`](#what-may-never-be-committed-to-main). |
| `dev` | Long-lived integration branch. Completed epic work lands here via a reviewed, green-CI PR. | No — not guaranteed releasable; `main` is. | No — lands only via PR from an epic branch. |
| `feature/<epic>` | Per-epic branch off `dev` (e.g. `feature/checkout` for the checkout epic). Collects that epic's stories. | No | Only the epic's own merges (see below). |
| `feature/<epic>-task-<id>` | Per-story branch off the epic branch (e.g. `feature/checkout-task-12`). One per backlog task. | No | Yes — this is where a story's work is committed. |
| `fix/<epic>/<issue>` | Opened **only** at the epic gate when the cold-start suite fails (`docs/SDLC.md` Phase 6). Same merge-and-delete rule as a story branch. | No | Yes — the fix is committed here, then merged back. |

### Which branch is releasable

**`main` is releasable at all times.** That is its single defining property: any commit on `main` has passed
review and green CI and represents a state we are willing to ship. `dev` is the integration branch where
epic work accumulates; it is *not* guaranteed releasable. When you need "the last known-good state," that is
`main` — never `dev`.

### Naming convention

| Kind | Pattern | Examples |
|---|---|---|
| Release | `main` | `main` |
| Integration | `dev` | `dev` |
| Epic | `feature/<epic>` | `feature/checkout` |
| Story | `feature/<epic>-task-<id>` | `feature/checkout-task-12`, `feature/checkout-task-2` |
| Epic-gate fix | `fix/<epic>/<issue>` | `fix/checkout/cold-start-suite` |

**Why the story branch uses a hyphen (`-task-<id>`), not a slash.** The natural form would be
`feature/<epic>/task-<id>`. Git cannot represent that **at the same time** as the epic branch
`feature/<epic>`: git stores a branch ref as a file at `.git/refs/heads/feature/<epic>`, but
`feature/<epic>/task-<id>` would require `feature/<epic>` to be a *directory* — a file-vs-directory clash on
the same path. Because the epic branch and its story branches must coexist, story branches join the segment
with a hyphen. The merge target and the Phase-7 push branch are unchanged by this — only the story-branch
*spelling* differs. (The epic-gate `fix/<epic>/<issue>` branch keeps the slash form because no `fix/<epic>`
ref exists to clash with.)

### What may never be committed to `main`

**Nothing is ever committed directly to `main`.** No hotfix, no docs-only tweak, no "trivial" change goes
straight onto `main`. Every change reaches `main` the same way:

1. it is developed on a story branch, integrated into its epic branch, and merged into `dev` via a reviewed
   pull request that shows **green CI**; then
2. promotion from `dev` to `main` is a **separate, deliberate human decision** (`docs/SDLC.md` Phase 7).

Equivalently: a direct push/commit to `main`, a self-merge, or any change that has not been through a
reviewed green-CI PR is prohibited. `main` is protected to enforce this mechanically.

### Story-branch lifecycle

Per the per-story loop (`AGENTS.md` → "The per-story loop", step "Integrate"; `docs/SDLC.md` Phase 5):

1. Branch the story off the epic branch:
   `git checkout feature/<epic> && git checkout -b feature/<epic>-task-<id>`.
2. Do the work and commit it on the story branch (commit messages reference `task-<id>`).
3. When the task is Done, merge it back **with `--no-ff`** so the merge is an explicit, revertable unit:
   `git checkout feature/<epic> && git merge --no-ff feature/<epic>-task-<id>`.
4. **Delete** the story branch: `git branch -d feature/<epic>-task-<id>`.

Only one story branch is active at a time, in a single working tree — no parallel worktrees. The same
`--no-ff` merge-and-delete rule applies to an epic-gate `fix/<epic>/<issue>` branch.

## Pull requests, review & merge

A pull request is how completed epic work reaches the integration branch: at the handoff, the epic branch is
pushed and opened as a PR against `dev` (`docs/SDLC.md` Phase 7).

### What a pull request must satisfy before merge

A PR is mergeable only when all three hold:

- **Passing checks.** CI runs the **quality gate** (above), and a failure **blocks the merge**. This is the
  *same* suite a contributor runs locally, green across the supported matrix.
- **Review.** At least one approving review is required, and you **never self-merge** — merging into `dev`
  (or `main`) is a human gate, performed by a reviewer other than the author (`AGENTS.md` → "User gates").
- **A linked backlog task.** Every PR traces to a Backlog.md story by id — `Closes task-<id>` (or `Relates
  to task-<id>` when it only advances one). No PR lands without a task it implements; the backlog is the
  source of truth for *what* the change is for.

### Merge strategy and why

- **Story branch → epic branch: `--no-ff` (no fast-forward).** Each story is merged back into its epic
  branch as an explicit merge commit, then the story branch is deleted. **Why `--no-ff` and not squash or
  rebase:** it keeps each story an explicit, revertable merge unit and preserves that story's real commit
  history. If a story has to be backed out, its merge commit is the one thing to revert.
- **Epic branch → `dev`: reviewed pull request** (`gh pr create --base dev`), subject to the review and
  check rules above.
- **`dev` → `main`: a separate, deliberate human decision.** Promotion to the release branch is never
  automatic and never bundled with the `dev` merge.

### Opening a pull request

Opening a PR auto-populates the body from
[`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md), which prompts you for: a
**summary**; the **linked task** (`Closes task-<id>`); the **DoD checklist** to tick; **how you verified it**
(paste the quality-gate output); and **confirmation CI is green**. Fill it in fully — a reviewer approves
against exactly that information, and no one merges their own PR.

## Versioning & releases

This project is versioned `MAJOR.MINOR.PATCH` with [Semantic Versioning](https://semver.org/) semantics:

- **MAJOR** — a **breaking change** to the public surface or behaviour (a removed/renamed command, API,
  flag, or contract) that could break an existing consumer.
- **MINOR** — a **backward-compatible** new capability: additive surface that doesn't change or remove
  existing behaviour.
- **PATCH** — a **backward-compatible bug fix** with no surface change.

**For any change, decide:** *Could this break an existing consumer?* → **MAJOR**. *Else, does it add new
surface?* → **MINOR**. *Else (it only fixes a bug)* → **PATCH**.

Pre-1.0 caveat: while the project is `0.y.z`, the surface is still stabilizing — a breaking change may land
in a **minor** (`0.y`) bump rather than forcing `1.0.0`. The first stable surface is `1.0.0`.

### Changelog

Release history lives in [`CHANGELOG.md`](./CHANGELOG.md), in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format:

- `## [Unreleased]` always sits on top and collects in-progress changes as they merge.
- Each released version appears below it as `## [X.Y.Z] - YYYY-MM-DD`, grouped under **Added**, **Changed**,
  **Fixed**, **Removed** (and **Deprecated** / **Security** as needed).
- At release time, move the `[Unreleased]` entries under the new version heading and leave a fresh empty
  `[Unreleased]` on top.

## Tracking work — the backlog

All development work is tracked as tasks in the in-repo [`backlog/`](./backlog/) root, using
[Backlog.md](https://github.com/MrLesk/Backlog.md). The work — the tasks that turn the design set into code —
lives there as a dependency-ordered backlog.

### Operate the backlog only through the `backlog` CLI

**Never hand-edit anything under `backlog/`.** The task files, `config.yml`, the sequence, and the indexes
are CLI-managed state; editing them by hand corrupts the index and the task IDs. There is always a `backlog`
command for what you need (this mirrors the hard rule in [`AGENTS.md`](./AGENTS.md); a repo hook also blocks
direct edits). The everyday commands:

```bash
backlog task list --plain                  # the whole backlog (ALWAYS --plain for agents/scripts)
backlog task <id> --plain                  # one task: its acceptance criteria + Definition of Done
backlog sequence list                      # dependency-ordered plan — what's ready to work next
backlog task edit <id> -s "In Progress"    # move a task into progress when you start it
backlog task edit <id> --check-ac <n>      # tick acceptance criterion n (only once it truly holds)
backlog task edit <id> --check-dod <n>     # tick Definition-of-Done item n
backlog task edit <id> -s "Done"           # close it (only when AC + DoD are all satisfied)
```

For anything else, `backlog <cmd> --help`.

### Status lifecycle and the Definition-of-Done gate

Each task moves through **To Do → In Progress → Done** and is gated by a **shared, project-level Definition
of Done** configured once in `backlog/config.yml` (`definition_of_done`), so **every** task carries the same
items — the **quality gate** above. A task is **not** marked `Done` until both its **acceptance criteria**
and these **Definition-of-Done** items are observably satisfied and ticked (`--check-ac` / `--check-dod`).
The DoD here is the same bar the merge gate enforces, so per-task completion and mergeability stay aligned.

### The front door for working on the project

The agent front door is [`AGENTS.md`](./AGENTS.md) (and its `CLAUDE.md` symlink): it defines the BMAD-based
SDLC — reading the design set, the persistent specialists, the per-story loop, and the user gates. This
section is the quick reference that workflow relies on for the backlog mechanics; `AGENTS.md` is the
authoritative process and is human-owned (changing it is a user gate, not a routine edit).
