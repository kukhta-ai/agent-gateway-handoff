# edge-proxy — bundle scope notes

These are **scope notes for the `edge-proxy` bundle** of the `gla` project (version
`0.1.0`). They are not a second front door: the project root `AGENTS.md` and its install loop still
govern. By the agents' **closest-wins** rule, this file *refines* the root instructions while `edge-proxy`
is your working directory, and any skills under this bundle's `installer-skills/` light up **in addition to**
the root's (a union) for the duration (doc 06, "Self-similar surfaces").

## What `edge-proxy` stands up

`edge-proxy` puts **Caddy in front of GLA as the sole public entry point**. Caddy terminates inbound TLS on
the operator's public HTTPS URL and reverse-proxies every request — including the WebSocket upgrade the
human-view (noVNC) session and the gateway's verified upgrades depend on — to the address that reaches GLA's
gateway on `:3000` (docs/01 §2 "Access Gateway", docs/03 §3). The recipe is a **detect → setup → verify**
trio over the host reverse proxy; the only payload is a parameterized `payload/templates/Caddyfile.tmpl`
(a site block the executor fills in for this host, then installs or merges into an existing Caddyfile).

The capability it delivers: a delivered handoff/enrollment link is openable by a recipient on the public
internet over valid TLS, with the live-view session working end to end.

## What this bundle is

`edge-proxy` is one independent, installable unit. Its parts:

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

Work this bundle with `edge-proxy/` as your working directory, walking `install-backlog/`'s tasks in
dependency order under the uniform loop — **detect → setup → verify → record**:

- **detect** whether the task's intent is already satisfied here (idempotent; skip if so);
- **setup** the step, honoring this bundle's `confirmation` level;
- **verify** the task's acceptance criteria actually hold (handing off to the user where a step needs them);
- **record** the receipt into the task **before** marking it Done — the install-backlog's Definition of Done
  gates this, so you cannot progress without it.

Record only what inspection cannot recover (installed-vs-adopted, the inverse op, an overwritten file, a chosen
value); the exact mechanics live in the project root installer skill's `references/journaling.md`. Contain any
failure to this bundle — never reach into another bundle's state, and never assume an undeclared prerequisite.

## Key decisions, ownership & host gotchas

- **Confirmation is `dangerous`, and it is earned.** Setup edits the **host reverse proxy** (the Caddyfile),
  which can affect other sites Caddy already serves. Surface the routing change and get consent *before*
  applying it. Where a Caddy already exists, **reload it, don't replace it** — add or merge the GLA site
  block rather than clobbering the operator's config.
- **Ownership: adopt vs. install.** If a manageable Caddy is already present, record it as **adopted** so
  the inverse op leaves it in place; only a Caddy this bundle installed is ours to remove. The inverse op is
  "remove the GLA site block (or restore the prior Caddyfile) and reload Caddy" — gated on whether we
  installed Caddy or merely added a block to an adopted one. Capture the placed/modified config via `--ref`
  with its checksum.
- **The upstream must actually reach `:3000` on *this* topology — the load-bearing gotcha.**
  - Caddy and GLA on the **same host/container** → `reverse_proxy 127.0.0.1:3000`.
  - Caddy on the **HOST with GLA in a CONTAINER** (the **hermes-1** case) → point at the **host-side
    forward**, not the container address. hermes-1 runs an LXD forkproxy mapping `host:13000 →
    container:3000`, so the upstream is `127.0.0.1:13000`. Pointing Caddy straight at the container address
    is the easy mistake here. Record the topology in the receipt.
- **TLS depends on having a real domain.** A real domain lets Caddy auto-provision a Let's Encrypt cert. A
  **bare-IP deploy cannot get a public ACME cert** — fall back to `tls internal` or a supplied cert, and
  note that WebAuthn/passkeys (the identity-provider bundle) need a *trusted* HTTPS origin, which a
  locally-trusted IP cert does not provide.
- **The contract with gla-core.** `requires: { gla-core: ^0.1.0 }`. gla-core's `GLA_PUBLIC_BASE_URL` **must
  equal** the public URL Caddy serves here, because the daemon builds handoff/enrollment links against it
  and they must resolve, through this proxy, back to the same daemon. Verify treats that round-trip
  (public URL → proxy → same daemon, including a non-downgraded WebSocket upgrade) as the proof the edge works.
