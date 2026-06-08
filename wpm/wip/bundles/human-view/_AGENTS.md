# human-view — bundle scope notes

These are **scope notes for the `human-view` bundle** of the `gla` project (version
`0.1.0`). They are not a second front door: the project root `AGENTS.md` and its install loop still
govern. By the agents' **closest-wins** rule, this file *refines* the root instructions while `human-view`
is your working directory, and any skills under this bundle's `installer-skills/` light up **in addition to**
the root's (a union) for the duration (doc 06, "Self-similar surfaces").

## What this bundle is

`human-view` is one independent, installable unit. Its parts:

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

## What `human-view` stands up (bundle specifics)

`human-view` delivers the **noVNC view stack** so a person can watch and drive the live browser inside their
own browser tab — a virtual X display (**Xvfb**), a VNC server (**x11vnc**), the **websockify** bridge, and the
**noVNC** web client (docs/03 §6). The point of the bundle is the *view*: it lets the launcher take the full
(noVNC) path instead of headless, not run the browser itself.

- **Launcher tier — why completeness matters.** GLA's launcher mode is `auto`/`full`/`headless`; the full
  (noVNC) view path activates **only when the whole stack is complete**, else it degrades to headless. So
  detect each component **independently** (detect → setup → verify): a partially-present stack must be
  *completed at the gap*, never reinstalled wholesale or skipped. Detection drives the full-vs-headless verdict.
- **Dangerous — system packages.** Setup is `confirmation: dangerous` because the validated path **apt-installs
  system packages**: `xvfb`, `x11vnc`, `websockify`, and the noVNC client assets (Debian/Ubuntu `novnc`, or the
  upstream assets where unavailable). Surface the plan and obtain consent before installing anything.
- **Same-user-as-the-service gotcha.** The stack must operate for the **same OS user that runs the GLA service**
  (recorded in `gla-core`'s receipt) so a daemon-spawned capsule can expose its display through it. A stack
  brought up for the wrong user is not reachable by the daemon. Verify proves a websockify-fronted endpoint
  accepts a connection with the noVNC assets served — the browser-native remote view is reachable end to end.
- **`/dev/shm` tuning (decision to pin).** Chromium on heavy pages can exhaust the default `/dev/shm` (often
  64 MB in a container) and crash tabs. Where the runtime allows it, raise the shared-memory size (a larger
  `--shm-size`, or mounting a bigger `/dev/shm`) for a stable live view, and **record the choice**. This is a
  stability tuning decision, not a hard bring-up requirement.
- **Ownership & inverse op.** Record each component as **installed-by-us vs adopted** from the host. The inverse
  op removes only what we installed; an **adopted** component is left in place on uninstall. Record any service
  started.
- **`requires`** `gla-core ^0.1.0` (the runtime + service user) **and** `browser-runtime ^0.1.0` (the browser
  this stack views) — declared prerequisites the installer resolves before this bundle. Never assume an
  undeclared prerequisite, and never touch a sibling bundle's state.

## How to work it

Work this bundle with `human-view/` as your working directory, walking `install-backlog/`'s tasks in
dependency order under the uniform loop — **detect → setup → verify → record**:

- **detect** whether the task's intent is already satisfied here (idempotent; skip if so);
- **setup** the step, honoring this bundle's `confirmation` level;
- **verify** the task's acceptance criteria actually hold (handing off to the user where a step needs them);
- **record** the receipt into the task **before** marking it Done — the install-backlog's Definition of Done
  gates this, so you cannot progress without it.

Record only what inspection cannot recover (installed-vs-adopted, the inverse op, an overwritten file, a chosen
value); the exact mechanics live in the project root installer skill's `references/journaling.md`. Contain any
failure to this bundle — never reach into another bundle's state, and never assume an undeclared prerequisite.
