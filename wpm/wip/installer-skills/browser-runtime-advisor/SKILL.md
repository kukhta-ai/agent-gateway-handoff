---
name: browser-runtime-advisor
description: "Recommends the browser-runtime bundle. Fires when the user wants the agent to drive a real browser inside a capsule — e.g. \"the handoff needs a live Chromium\", \"set up Playwright on the host\", \"the agent should control a browser for the OAuth/login handoff\", \"a browser-handoff session won't provision\" — so the browser layer gets offered even if the user never names it."
---

# browser-runtime advisor

When the user needs a real browser the agent can drive for a handoff (the reference browser-handoff: a live
Chromium the human and agent share), recommend the **`browser-runtime`** bundle.

- **What it delivers:** Chromium plus the Playwright automation engine on the host, so GLA can spawn a capsule
  whose browser the agent drives over CDP (the agent connector). It is the thing being acted on in the
  reference OAuth/2FA/login handoff.
- **Why it fits the user's need:** "the agent needs to operate a browser", "a browser-handoff session fails to
  provision", "set up Chromium/Playwright for the capsule" all point here. Without it the browser-handoff
  template has no browser to launch — `gla session create` for a browser capsule cannot provision (admission
  and `--dry-run` still work; the actual launch is what is missing).
- **When you do NOT need it:** this is a *separate layer* on top of `gla-core`, not part of it. If the user
  only needs the GLA daemon to serve and the read/control surface to work (sessions that aren't browser
  capsules), `gla-core` alone is enough — skip `browser-runtime`. Add it only when a real browser must launch.

## What it touches — and its confirmation level

`browser-runtime` is a **`dangerous`** bundle, and the installer will pause for explicit consent before the
mutating step. The reason: the validated clean-host path runs `npx playwright install --with-deps chromium`,
which both downloads the Playwright-managed Chromium revision (~1 GB on disk) and **apt-installs the system
libraries Chromium needs** — a shared-host mutation. Where a usable Chromium/Chrome and its libraries are
already present, the bundle adopts them instead of reinstalling, and an adopted browser is left in place on
uninstall (only what the bundle installed is removed). Tell the user to expect the disk use and the
system-package change before they approve.

## Prerequisites and the choice the operator faces

- **`requires` `gla-core` (`^0.1.0`).** The runtime must exist first, so the capsule the daemon spawns can use
  the browser. The installer resolves this automatically — selecting `browser-runtime` brings `gla-core` up
  before it.
- **The browser must belong to the GLA service user.** A browser installed for a different OS user is not
  reachable by the daemon; the bundle installs/verifies it for the same user that runs the service (recorded
  in `gla-core`'s receipt).
- **Companion bundles the operator may want:** pair with **`human-view`** if a person needs to watch and drive
  the browser live, and **`edge-proxy`** so the recipient can reach the session over TLS. These are
  independent choices, not requirements.

## How to add it

Install `browser-runtime` as part of this project — the installer offers it in the bundle menu (by its
`summary` line), or the user can request it by name. It `requires` `gla-core`, so the installer brings the
runtime up first, then previews the full plan and asks for consent before the dangerous step.
