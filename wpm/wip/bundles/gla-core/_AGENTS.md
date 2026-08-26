# gla-core — bundle scope notes

These are **scope notes for the `gla-core` bundle** of the `gla` project (version
`0.1.0`). They are not a second front door: the project root `AGENTS.md` and its install loop still
govern. By the agents' **closest-wins** rule, this file *refines* the root instructions while `gla-core`
is your working directory, and any skills under this bundle's `installer-skills/` light up **in addition to**
the root's (a union) for the duration (doc 06, "Self-similar surfaces").

## What this bundle is

`gla-core` is one independent, installable unit. Its parts:

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

## What `gla-core` stands up (the specifics)

`gla-core` is the **root** of the GLA bundle family — it `requires` nothing, and every other GLA bundle
layers onto the runtime it brings up. What it delivers:

- **The `gla serve` daemon**, supervised. It binds two doors:
  - the **Access Gateway** — the *sole public entry*, on port `3000` (front it with the **edge-proxy**
    bundle's Caddy, or any TLS reverse proxy);
  - the **Agent Bridge** — a *local-only* unix socket (`$XDG_RUNTIME_DIR/gla.sock`, else `/run/gla.sock`).
    The daemon **refuses to bind the bridge to a public interface (fail-closed)** — leave it on the socket.
- **Payload placed:** the env file (from `payload/templates/gla.env.tmpl`) and the systemd unit (from
  `payload/templates/gla.service.tmpl`), both filled for the host. Plus the delivered agent skill
  **`connect-and-drive-gla`** (the runtime knowledge a *using* agent needs to drive a handoff over the
  bridge — copied into the agent's scanned scope at install, inert in the repo).

### Key decisions (preserve these)

- **Build from source.** GLA is a pnpm workspace: ensure **Node 22+** (the `engines.node` floor — adopt a
  newer Node, install only an absent/too-old one via NodeSource `setup_22.x`), enable **pnpm via the
  corepack that ships with Node** (`corepack enable && corepack prepare pnpm@<pinned> --activate`, *not* a
  global npm install), then `pnpm install --frozen-lockfile` + `pnpm build` (`tsc -b`). The build must
  leave `packages/app/bin/gla.mjs` runnable, and needs ~**2 GB free disk**. These are the steps proven on
  the hermes-1 reference host — guidance to adapt, not a script to copy.
- **`GLA_PUBLIC_BASE_URL` must be externally reachable**, never the container-internal `:3000` — every
  handoff/enrollment link is built against it. With a TLS proxy in front, the proxy's `https://` URL
  (preferred); standalone, the host's own reachable address+port (e.g. `http://<public-ip>:3000/`), updated
  when a proxy is added. **WebAuthn/passkeys require https or localhost**, so passkey login ultimately needs
  the proxy. So `gla-core` stands up on its own without requiring edge-proxy first.
- **`GLA_RP_ID`** must match the host in the public URL. The **identity-provider** bundle owns the RP, but
  its default is set here.
- **Supervisor scope:** prefer **user-scope systemd** for least privilege (socket at `/run/user/<uid>/gla.sock`,
  enable **lingering** so it survives logout); **system-scope** is the alternative (needs root; set
  `User=`/`Group=` and a fixed `GLA_ENDPOINT`); a **documented foreground run command** is the fallback when
  neither is usable: `env $(grep -v '^#' gla.env | xargs) node packages/app/bin/gla.mjs serve`.

### Ownership & inverse-op notes (what the receipt must carry)

Record what inspection cannot recover: the **source-tree provenance** (cloned/copied **by us** vs an
**adopted** pre-existing tree), the env and unit files placed (with **checksums**), the **enabled service**
(and, for a user unit, whether lingering was enabled), and the **inverse op** — `systemctl [--user] disable
--now gla` + remove the unit, and remove the build tree *only if we cloned it* (never delete an adopted
tree). Detection (`step:detect`) must reconcile an existing build tree or enabled `gla` service rather than
duplicate it — re-running the loop is safe Repair.

### Host gotchas

- **hermes-1 reference deploy:** an Ubuntu 24.04 LXD container with Node 22 + systemd, reached from outside
  through the host's Caddy at `https://<vps-ip>/`; a host-to-container **forkproxy maps host:13000 →
  container:3000**. Detection still *inspects* rather than assumes — another host may differ.
- **Verification means the runtime genuinely answers**, not that `serve` ran: the gateway returns a
  well-formed HTTP response on `3000` (not a connection refusal), a `gla` control command over the bridge
  socket succeeds, the bridge is confirmed local-only, and the service survives a supervisor restart.

## How to work it

Work this bundle with `gla-core/` as your working directory, walking `install-backlog/`'s tasks in
dependency order under the uniform loop — **detect → setup → verify → record**:

- **detect** whether the task's intent is already satisfied here (idempotent; skip if so);
- **setup** the step, honoring this bundle's `confirmation` level;
- **verify** the task's acceptance criteria actually hold (handing off to the user where a step needs them);
- **record** the receipt into the task **before** marking it Done — the install-backlog's Definition of Done
  gates this, so you cannot progress without it.

Record only what inspection cannot recover (installed-vs-adopted, the inverse op, an overwritten file, a chosen
value); the exact mechanics live in the project root installer skill's `references/journaling.md`. Contain any
failure to this bundle — never reach into another bundle's state, and never assume an undeclared prerequisite.
