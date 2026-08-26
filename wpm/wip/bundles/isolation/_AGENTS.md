# isolation — bundle scope notes

These are **scope notes for the `isolation` bundle** of the `gla` project (version
`0.1.0`). They are not a second front door: the project root `AGENTS.md` and its install loop still
govern. By the agents' **closest-wins** rule, this file *refines* the root instructions while `isolation`
is your working directory, and any skills under this bundle's `installer-skills/` light up **in addition to**
the root's (a union) for the duration (doc 06, "Self-similar surfaces").

## What this bundle is

`isolation` is one independent, installable unit. Its parts:

- **`bundle.yml`** — the bundle's identity: its stable `id`, current `version`, user-facing `summary` (the menu
  line), `confirmation` level, and its `requires` map (the dependency contract). This is the structural source
  of truth; the operation writes it.
- **`install-backlog/`** — the **recipe**: a pre-initialized Backlog.md whose tasks walk
  **detect → setup → verify**, idempotently. Re-running it is Repair. Its `config.yml` carries a
  **Definition of Done** that makes recording the receipt a precondition for marking any task Done.
- **`payload/`** — everything the bundle delivers: `files/` and `templates/` placed into the environment, and
  `agent-skills/` (the runtime product, copied into the agent's scope at install).
- **`installer-skills/`** — optional install-time *helpers*, active only while this bundle is in focus (not
  pull-UX advisors — those stay at the project root).
- **`installer-scripts/`** — install-time tooling (probes, smoke tests) that runs during install; not delivered.

## How to work it

Work this bundle with `isolation/` as your working directory, walking `install-backlog/`'s tasks in
dependency order under the uniform loop — **detect → setup → verify → record**:

- **detect** whether the task's intent is already satisfied here (idempotent; skip if so);
- **setup** the step, honoring this bundle's `confirmation` level;
- **verify** the task's acceptance criteria actually hold (handing off to the user where a step needs them);
- **record** the receipt into the task **before** marking it Done — the install-backlog's Definition of Done
  gates this, so you cannot progress without it.

Record only what inspection cannot recover (installed-vs-adopted, the inverse op, an overwritten file, a chosen
value); the exact mechanics live in the project root installer skill's `references/journaling.md`. Contain any
failure to this bundle — never reach into another bundle's state, and never assume an undeclared prerequisite.

## What `isolation` stands up (bundle-specific)

`isolation` chooses the **capsule isolation tier** — the Spawner/Launcher tier that runs a capsule (docs/01
§7, docs/04 §5). Its tasks are **all `kind:state`**: this bundle's primary, load-bearing effect is a
**recorded decision**, not a software install. There is **no `payload/`** to place (files, templates,
agent-skills are all empty) and **no installer-scripts or installer-skills** — the recipe is three state
steps and a receipt.

- **`isolation-1` (detect)** — recognize the **process tier** as available by default (it needs no isolation
  runtime beyond the browser and view layers, which come from the `browser-runtime` and `human-view`
  bundles), determine by inspection whether a **usable Docker daemon** is present, and record any constraint
  that would make Docker unreliable here.
- **`isolation-2` (setup)** — record the selected tier as a **pinned decision with rationale**. The process
  tier is the selection **unless the operator explicitly opts into Docker**. Docker is the *alternative*, not
  the default.
- **`isolation-3` (verify)** — prove the selected tier actually isolates and runs a capsule on this host (a
  capsule spawns and tears down), not merely that a tier was named; then re-read and confirm the recorded
  decision and receipt entries.

## Key decisions, ownership, and inverse ops

- **Process-tier-default is the load-bearing decision** this bundle documents. Pin it (with rationale) even
  when nothing is installed — the *why* is the deliverable.
- **This bundle does not install a container runtime.** If Docker is selected, **adopt** the daemon already
  on the host and record it as **adopted** so uninstall **leaves it** in place. The process-tier path
  installs nothing, so its inverse op is just removing the recorded decision.
- `confirmation: safe` — the effect is a decision in the receipt; honor that level when setting up.

## Host gotchas

- **Nested-container storage-driver limitation.** Inside an unprivileged LXD container (the **hermes-1**
  environment), Docker's nested-container storage driver can be unreliable. Identify and **record this caveat
  at detect** rather than discovering it at first capsule spawn. If Docker is selected, acknowledge the caveat
  in the decision; at verify, a container capsule must start and stop cleanly **despite** the caveat — or the
  caveat is shown to block it and the **tier selection is reconsidered** rather than left silently broken.
- **Docker is offered only when actually usable** — a running daemon the service user can reach. Absent or
  unreachable, stay on the process tier; do not declare a tier you cannot run.
