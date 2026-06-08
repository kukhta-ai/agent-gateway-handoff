---
name: human-view-advisor
description: "Recommends the human-view bundle. Fires when a person needs to watch and drive the agent's live browser themselves — e.g. \"I want to see what the browser is doing\", \"let me take over the live Chromium\", \"watch the OAuth/login handoff in my own tab\", \"the session only runs headless and I need eyes on it\", \"give me a noVNC/live view of the capsule\" — so the live-view layer gets offered even if the user never names it."
---

# human-view advisor

This is the pull-UX advisor for the **`human-view`** bundle. It fires on the operator's *need* — a person who
must watch and drive the agent's live browser, not just let it run unseen — so someone who never asked for
`human-view` by name still gets pointed at it. It recommends; it does not install.

## What `human-view` delivers

It stands up the **noVNC view stack** so a person can watch and drive the live browser inside their own browser
tab — no native VNC client to install. Four components, each inspected and installed independently:

- a **virtual X display** (Xvfb) — the screen the browser renders to;
- a **VNC server** (x11vnc) — exports that display;
- the **websockify** bridge — fronts the VNC stream as a WebSocket;
- the **noVNC** web client — the browser-native viewer the human opens.

With the full stack present, GLA's launcher (`GLA_LAUNCHER_MODE=auto`) can select the **full (noVNC) view path**;
without it the launcher degrades to **headless**. So this bundle is what turns "the agent ran the browser
somewhere you couldn't see" into "you watched and steered it live."

## When you need it (and when you don't)

Install `human-view` when a person needs to **see and take over** the live browser — watch an OAuth/2FA or login
handoff as it happens, intervene mid-session, confirm a page visually, or co-drive a browser capsule with the
agent.

You **don't** need it when the browser only needs to run headless — the agent drives over CDP with no human
eyes on the pixels. `human-view` is a *view* layer on top of the browser, not part of running one: it adds the
ability to watch, it does not add the browser itself. If detection finds part of the stack already on the host,
the bundle completes only the missing components rather than reinstalling the lot (re-running is safe Repair).

## What it touches / confirmation level

`confirmation: dangerous` — the installer pauses for explicit consent before the mutating step. The reason: the
validated path **apt-installs system packages** — `xvfb`, `x11vnc`, `websockify`, and the noVNC client assets
(on Debian/Ubuntu the `novnc` package, or the upstream assets where it is unavailable) — a shared-host mutation.
Where a component is already present it is **adopted** rather than reinstalled, and an adopted component is left
in place on uninstall (only what the bundle installed is removed). Each component's source (installed-by-us vs
adopted), its **inverse op**, and any service started are journaled to the receipt so the stack can be cleanly
removed later. The bundle contains itself to its own state and never reaches into a sibling bundle's. Tell the
user to expect the system-package change before they approve.

## Prerequisites (`requires`)

- **`gla-core` (`^0.1.0`).** The GLA runtime must exist first — the view stack must operate for the **same OS
  user that runs the GLA service** (recorded in `gla-core`'s receipt) so a daemon-spawned capsule can expose its
  display through it.
- **`browser-runtime` (`^0.1.0`).** This stack views the browser *that* bundle provides; there is nothing to
  watch without it. The installer resolves both automatically — selecting `human-view` brings `gla-core` and
  `browser-runtime` up before it.

## The choice the operator faces

- **Shared-memory (`/dev/shm`) sizing.** Chromium rendering heavy pages can exhaust the default `/dev/shm`
  (often only 64 MB in a container), crashing tabs and making the live view unstable under real pages. Where the
  host or capsule runtime allows it, **raise the shared-memory size** (e.g. a larger `--shm-size` for a
  container, or mounting a bigger `/dev/shm`) and record the choice. This is a tuning decision for stability, not
  a hard requirement for bring-up.

## How to add it

Install `human-view` as part of this project — the installer offers it in the bundle menu (by its `summary`
line), or the operator can request it by name. It `requires` `gla-core` and `browser-runtime`, so the installer
brings the runtime and the browser up first, then previews the full plan and asks for consent before the
dangerous (system-package) step.
