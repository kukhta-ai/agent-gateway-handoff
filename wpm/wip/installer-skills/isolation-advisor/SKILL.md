---
name: isolation-advisor
description: "Use when the operator is deciding how strongly to isolate or sandbox the agent capsules GLA runs — e.g. \"how do capsules get isolated from each other / from the host?\", \"can I run capsules in Docker / containers?\", \"is the process-level sandbox enough or do I need something stronger?\", \"which isolation tier should I pick?\". Fires on the need to choose a capsule isolation tier, even when the operator never names the isolation bundle."
---

# isolation advisor

Recommend the **`isolation`** bundle when an operator (or their agent) is weighing **how a capsule's runtime
is contained** — how strongly each agent capsule is isolated from the host and from its siblings — and which
tier to run it under.

## What it delivers

`isolation` chooses the **capsule isolation tier**: the Spawner/Launcher tier that actually runs a capsule.
It is a *decision* bundle — its primary, load-bearing effect is a **pinned, recorded decision with
rationale**, not a software install. The two tiers it reconciles:

- **Process tier (the default).** GLA's standard tier. The launcher runs a capsule as an ordinary process
  under the service user. It installs **no isolation runtime** of its own — the browser and view layers a
  capsule needs come from their own bundles (`browser-runtime`, `human-view`), not from here.
- **Docker tier (the stronger, opt-in alternative).** A container-isolated capsule. Offered **only when a
  usable Docker daemon is actually present** (the service user can reach a running daemon), and only when the
  operator explicitly opts in. The bundle records the well-known **nested-container storage-driver caveat**
  (e.g. running inside an unprivileged LXD container, as in hermes-1) so it is acknowledged up front rather
  than discovered at first spawn.

The bundle then **verifies** the chosen tier really isolates and runs a capsule on this host: a capsule
spawns and tears down cleanly (process tier — starts as the service user and is fully reaped, no orphan;
Docker tier — a container starts and stops cleanly, or the caveat is shown to block it and the choice is
reconsidered rather than left silently broken).

## When you need it (and when you don't)

- **You're standing up GLA at all.** Every install picks a tier; the process-tier default is a deliberate,
  recorded choice, so this bundle belongs in essentially every installation — it documents *why* you're on
  the tier you're on.
- **You want stronger isolation between capsules / from the host** than a plain process gives — reach for the
  **Docker tier** here. That's the choice this bundle exists to make and verify.
- **You don't need it as a separate concern** when you're happy with the process-tier default and just want
  capsules to run: it still applies, but it's a no-friction `safe` decision rather than work. You do **not**
  use this bundle to install Docker, the browser, or the view layer — it adopts an existing Docker daemon and
  leans on the other bundles for the rest.

## What it touches / confirmation level

- **Confirmation: `safe`.** Its effect is overwhelmingly a recorded decision in the receipt; the process-tier
  path installs nothing.
- It **does not install a container runtime.** If Docker is selected, it *adopts* the daemon already on the
  host and records it as **adopted**, so uninstalling `isolation` leaves that daemon in place.
- It writes the tier decision (and any caveat) into the receipt with an inverse op, so the choice is
  auditable and reversible.

## Prerequisites (`requires`)

- **`gla-core` (`^0.1.0`).** The core must be in place first.
- For the **Docker tier only**: a running Docker daemon the service user can reach. Absent or unreachable,
  Docker simply isn't offered and you stay on the process tier.

## The choice the operator faces

**Process tier vs Docker tier.** Process is the default and needs nothing extra; pick it unless you have a
concrete reason for container-grade isolation. Choose **Docker** when you want stronger containment *and* a
usable daemon is present — accepting the recorded nested-container storage caveat. Selecting Docker is
treated as the alternative, never the default.

## How to add it

Install `isolation` as part of this project — the installer offers it in the bundle menu, or the operator can
request it by name. Picking the tier happens during its install loop.
