# Worker plane

**Zone:** Worker
**Kind:** GLA component (traditional code); spawners ship as plugins
**Scenario-01 lane:** Worker spawner

> The runtime substrate that starts, watches, and reaps capsules: a tiered spawner abstraction, a lifecycle manager, a workspace manager, and a cleanup reconciler.

## Role

The Worker plane is where capsules actually run. It hides the choice of isolation tier behind one abstract spawner interface (the JupyterHub Spawner pattern), drives the spawn → health → stop lifecycle, realizes and reaps each capsule's workspace, and reconciles terminal sessions to torn-down resources. It does the *hosting*; what to host is decided upstream by the session assembly.

## Responsibilities (owns)

- **Spawner Registry** — the abstract spawner interface and its concrete launchers (start with `local-process` and `container`; add `systemd-user`, `rootless`, `remote-worker` only as providers demand); each launcher declares its **mount capability** — which host mounts it can realize (file / directory, `ro`/`rw`, or none for a remote worker).
- **Capsule Lifecycle Manager** — spawn → health-probe → stop; per-session runtime tracking; orphan detection.
- **Workspace Manager** — realize the declared workspace strategy (e.g. `browser-profile-temp`) and the agent's requested host mounts (with the agent's *own* authority, within the operator allowed-set — `../04-capsule-assembly.md` §6), enforce path-safety, reap the capsule's own ephemeral materials.
- **Cleanup Reconciler** — idempotent, restart-safe teardown of terminal sessions; periodic orphan scans; terminal audit emission.

## Interfaces

**Receives** — from the Session service: spawn/attach/stop a capsule for a given assembly.
**Produces** — a runtime handle back to the Session service; a running capsule; teardown + audit on completion.

## What it does NOT do

It does **not** decide *what* to spawn (the session assembly does) or expose anything publicly (the Access Gateway is the only public path). It does not authorize access to the capsule.

## Entities & data

`Launcher`, `Workspace`, `Sidecar` (catalog kinds); the runtime handle on `Session`.

## In scenario 01

Phase 3 — spawns the browser capsule (temp profile, isolation tier) and returns the handle. Phase 15 — terminates the browser, wipes the temp-profile workspace, and the reconciler confirms no orphans.

## Failure modes

Spawn failure → session `failed`, contained. A health-probe failure → the lifecycle manager stops/replaces the runtime. The cleanup reconciler is idempotent and restart-safe, so a crash mid-teardown converges on a clean state.

## Invariants

The agent never receives a privileged path (the Docker socket, the gateway admin API). Host mounts the agent requested are realized with the agent's *own* authority — the capsule process runs as the agent's uid with privilege-escalation off, so the kernel's DAC enforces the agent's exact file access (a path the agent can't read fails closed) — within the operator allowed-set and only what the launcher's declared mount capability supports. Cleanup is idempotent and restart-safe. The capsule's *own* workspace materials (a browser profile's cookies, scratch) are destroyed on teardown; host paths the agent mounted and persisted outputs live on the host and survive. (Per the overview, this plane starts with one cleanup reconciler and two launchers.)

## Related

`capsule.md` (what it runs), `session-service.md` (commands it), `catalog.md` (`Launcher`/`Workspace` kinds), the `work-package-manager` integration (stands up the *dependencies* a launcher needs — overview §8), `../02-provider-and-extension-model.md` (the Spawner Registry as a self-registering provider family; capsule runtime extends like any other family).
