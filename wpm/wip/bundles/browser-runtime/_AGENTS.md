# browser-runtime — bundle scope notes

These are **scope notes for the `browser-runtime` bundle** of the `gla` project (version
`0.1.0`). They are not a second front door: the project root `AGENTS.md` and its install loop still
govern. By the agents' **closest-wins** rule, this file *refines* the root instructions while `browser-runtime`
is your working directory, and any skills under this bundle's `installer-skills/` light up **in addition to**
the root's (a union) for the duration (doc 06, "Self-similar surfaces").

## What `browser-runtime` stands up

This bundle delivers the **in-capsule browser the human and agent jointly act on, plus the automation engine
the agent drives it with**: **Chromium driven over CDP via Playwright** (docs/03 §7, §10 — the agent
connector). It is the thing being acted on in the reference OAuth/2FA/login *browser-handoff*. Its recipe is a
single `detect → setup → verify` trio (all `kind:state`, idempotent — re-running is Repair):

- **detect** — what does the host already have? An adoptable Chromium/Chrome usable by Playwright; an existing
  Playwright install + any cached browser revision; the OS libraries Chromium needs to launch; and whether the
  filesystem has room for a ~1 GB browser download. Anticipate the missing-shared-library and out-of-disk
  failures *before* setup, not at first launch.
- **setup** — make a Playwright-launchable Chromium available. The validated clean-host path is
  `npx playwright install --with-deps chromium` (downloads the managed Chromium revision **and** apt-installs
  its system libraries). Adopt a usable pre-existing browser instead of reinstalling where one is present.
- **verify** — prove it's *functional*, not merely installed: a headless Chromium launches under Playwright/CDP
  and reports its version, and a trivial navigation (open a page, read its title) succeeds.

## Key decisions, ownership, and host gotchas — read before you act

- **This is a SEPARATE layer on top of `gla-core`, not part of it.** It `requires` `gla-core` `^0.1.0` (the
  runtime must exist) but installs independently. Without `browser-runtime` the daemon still serves and the
  read/control surface + `gla session create --dry-run` (admission only) work; a *real* `gla session create`
  for a browser capsule cannot provision because there is no browser to launch — that gap is exactly what this
  bundle closes.
- **`confirmation: dangerous` — pause for consent before the apt step.** The `--with-deps` part is a
  shared-host mutation (system packages). Surface any system-level package change *first*; never run it
  unattended. Expect ~1 GB of disk for the browser download too.
- **Ownership: managed where we install, adopted where we reuse.** Record which case occurred. An **adopted**
  pre-existing browser must be recorded as adopted so the inverse op (uninstall) **leaves it in place** and
  removes only what we installed (the managed browser revision, Playwright, any OS packages we added).
- **Host gotcha — the browser must belong to the GLA service user.** Verification must succeed for the *same*
  OS user that runs the GLA service (recorded in `gla-core`'s receipt). A browser installed only for a
  different user is not reachable by the daemon's capsule.
- **No payload.** This bundle ships no `files/`, `templates/`, `agent-skills/`, or installer scripts — its
  whole effect is host-side state (the browser + Playwright + OS libraries) captured in the receipt. There is
  nothing to copy into the agent's scope.

## What this bundle is

`browser-runtime` is one independent, installable unit. Its parts:

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

Work this bundle with `browser-runtime/` as your working directory, walking `install-backlog/`'s tasks in
dependency order under the uniform loop — **detect → setup → verify → record**:

- **detect** whether the task's intent is already satisfied here (idempotent; skip if so);
- **setup** the step, honoring this bundle's `confirmation` level;
- **verify** the task's acceptance criteria actually hold (handing off to the user where a step needs them);
- **record** the receipt into the task **before** marking it Done — the install-backlog's Definition of Done
  gates this, so you cannot progress without it.

Record only what inspection cannot recover (installed-vs-adopted, the inverse op, an overwritten file, a chosen
value); the exact mechanics live in the project root installer skill's `references/journaling.md`. Contain any
failure to this bundle — never reach into another bundle's state, and never assume an undeclared prerequisite.
