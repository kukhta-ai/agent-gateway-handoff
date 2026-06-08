---
name: gla-core-advisor
description: "Advises whether to install the gla-core bundle. Fires on the NEED, not on the name: when an agent must hand a step to a human it can't do itself (a same-session OAuth/2FA login, a secret it must never see, a last-mile document edit, a destructive-action approval, a live app preview), or when someone wants to stand up the GLA runtime / Access Gateway / Agent Bridge / 'gla serve' daemon for agent↔human handoff. Use when a task is blocked on a person and a bridge is needed, or when planning a GLA deployment."
---

# gla-core advisor

This is the pull-UX advisor for the **`gla-core`** bundle. It fires on the operator's *need* — an agent
that hits a wall only a human can clear, or an intent to stand up the GLA runtime — so someone who never
asked for `gla-core` by name still gets pointed at it. It recommends; it does not install.

## What `gla-core` delivers

It stands up the **GLA runtime**: the long-running `gla serve` daemon, supervised so it survives reboots
and logout. The daemon binds two doors:

- the **Access Gateway** — the *sole public entry*, on port 3000 — the surface a human opens (front it with
  a TLS reverse proxy for real use);
- the **Agent Bridge** — a *local-only* unix socket (fail-closed: it refuses to bind anything public) — the
  door the agent drives through the `gla` CLI.

It builds GLA from source (a pnpm workspace, `pnpm install` + `pnpm build`), places an env file and a
systemd unit (templates filled for the host), enables the service, and verifies both doors answer. It also
delivers the **`connect-and-drive-gla`** agent skill — the runtime knowledge a *using* agent needs to
connect to the bridge and drive a handoff. This is the **root** of the GLA bundle family: install it first;
the others layer onto the runtime it stands up.

## When you need it (and when you don't)

Install `gla-core` when:

- an agent carrying a task hits a step that is the **human's to clear** — a same-session OAuth/2FA login, a
  secret the agent must never see (it gets a `secret_ref`, never the value), a last-mile document edit, a
  pick-a-file-by-content, a destructive-action approval, a live app preview — and you want a temporary,
  scoped, recipient-bound surface to bridge it; or
- you are setting up a host to run the GLA gateway/bridge at all (it is the prerequisite every other GLA
  bundle builds on).

You **don't** need it if: no agent in your environment ever hands work to a human (there is nothing to
bridge), or a GLA runtime is already up on the host — detection will find an existing build tree or an
enabled `gla` service and reconcile rather than duplicate it (re-running is safe Repair).

## What it touches / confirmation level

`confirmation: safe`. It builds into a GLA build root, places a host-specific **env file** and a
**systemd unit** (user-scope by default for least privilege; system-scope or a documented foreground run
command as alternatives), and **enables a service** (for a user unit, lingering so it survives logout).
Every placement, the source-tree provenance (cloned/copied by us vs adopted), the enabled service, and the
**inverse op** (disable + remove the unit, remove the tree if we cloned it) are journaled to the receipt,
so the whole runtime can be cleanly removed later. It contains itself to its own state and never reaches
into a sibling bundle's.

## Prerequisites (`requires`)

**None** — `gla-core` is the root bundle; it requires no other bundle. Its *host* prerequisites are
detected, not assumed: **Node 22+** (the workspace's engine floor; a newer Node is adopted, only an
absent/too-old one is installed via NodeSource `setup_22.x`), **pnpm** (obtained from the corepack that
ships with Node — `corepack enable && corepack prepare pnpm@<pinned> --activate` — not a global npm
install), roughly **2 GB free disk** for a from-source build, and a **service supervisor** (user-scope
systemd preferred, system-scope or a foreground command as fallbacks). An absent Node 22 is a blocker; the
rest are resolvable prerequisites, not blockers.

## Choices the operator faces

- **The public base URL (`GLA_PUBLIC_BASE_URL`).** This must be the externally reachable URL a recipient's
  device can actually open — handoff/enrollment links are built against it — **not** the container-internal
  `:3000`. With a TLS proxy in front (the **edge-proxy** bundle, or any reverse proxy) it is the proxy's
  `https://` URL (preferred); standalone with no proxy yet, use the host's own reachable address and port
  (e.g. `http://<public-ip>:3000/`) and update it when a proxy is added. Note: **passkeys (WebAuthn)
  require https or localhost**, so passkey login ultimately needs the proxy.
- **Supervisor scope.** User-scope systemd (least privilege; socket at `/run/user/<uid>/gla.sock`, needs
  lingering) vs system-scope (needs root; set `User=`/`Group=` and a fixed bridge socket) vs a documented
  foreground run command where no supervisor exists.
- **Whether you also want the sibling bundles.** `gla-core` runs on its own, but a real deployment usually
  pairs it with **edge-proxy** (TLS in front), **identity-provider** (passkey RP — its `GLA_RP_ID` default
  is set here and must match the host in the public URL), and the **isolation / browser-runtime /
  human-view** stack (the `GLA_LAUNCHER_MODE=auto` capsule tiers). Those are separate recommendations; this
  one only gets the runtime standing.

## How to add it

Install `gla-core` as part of this project — the installer offers it in the bundle menu, or the operator
can request it by name. As the root of the GLA family, install it first.
