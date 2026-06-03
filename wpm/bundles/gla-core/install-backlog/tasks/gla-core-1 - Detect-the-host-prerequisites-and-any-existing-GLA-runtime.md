---
id: gla-core-1
title: Detect the host prerequisites and any existing GLA runtime
status: To Do
assignee: []
created_date: '2026-06-03 13:38'
updated_date: '2026-06-03 13:40'
labels:
  - 'kind:state'
  - 'step:detect'
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The DETECT step of gla-core's uniform loop (detect → setup → verify), a kind:state task — idempotent, so re-running it is Repair. gla-core stands up the GLA runtime: the long-running daemon that binds the Access Gateway (the sole public entry, port 3000) and the local Agent Bridge socket (the agent's door). Before setup builds or places anything, establish what the host already provides so setup adapts to the machine rather than guessing.

Reason about each prerequisite by inspection (do not run setup): Node >= 20 (GLA's workspace declares engines.node >= 22; a newer Node already present is adopted, not replaced); pnpm (GLA is a pnpm workspace built with pnpm install + pnpm build; record how it would be obtained if absent rather than installing here); a service supervisor (prefer user-scope systemd for least privilege — the bridge socket then lands at /run/user/<uid>/gla.sock; system-scope systemd is the alternative; a documented foreground run command is the fallback when neither is usable); and any existing GLA runtime (a prior build tree or an enabled gla service must be reconciled, not duplicated).

Deployment context (hermes-1): an Ubuntu 24.04 LXD container with Node 22 and systemd, reached from outside through the host's Caddy at https://<vps-ip>/ (a host-to-container forkproxy maps host:13000 to container:3000). Detection still inspects rather than assumes — another host may differ. A pure-detection pass that places nothing has no reversible effect; anything it adopts or marks, it records. Never reach into another bundle's state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 whether a Node.js runtime of major version 20 or newer is available is determined by inspection, and an older or absent Node is reported as a blocker rather than assumed present
- [ ] #2 whether the pnpm package manager is available is determined, and its absence is reported as a resolvable prerequisite rather than a silent failure
- [ ] #3 whether a process supervisor (systemd user or system scope) is available to run a long-lived service is determined, and its absence is recorded so the bundle can fall back to a documented foreground run command
- [ ] #4 whether a GLA runtime is already present (a build tree and/or an installed gla service) is determined, and any existing one's location and service state are recorded so setup reconciles rather than duplicates it
- [ ] #5 each prerequisite's presence and version, and whether it was already on the host, are recorded for the receipt before setup runs
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Effect verified against the task acceptance criteria (verify before record)
- [ ] #2 Files placed or modified are recorded via --ref and their checksum journaled in the notes
- [ ] #3 Ownership recorded in the notes: installed by us vs adopted from the user's machine
- [ ] #4 Inverse op recorded in the notes: the uninstall step plus the condition under which it runs
- [ ] #5 Decisions and their rationale recorded (notes, or --final for a pinned decision)
- [ ] #6 Non-file effects recorded in the notes: services started, registrations made, artifacts built
<!-- DOD:END -->
