---
id: gla-core-2
title: Build the GLA runtime and install the gla serve service
status: To Do
assignee: []
created_date: '2026-06-03 13:38'
updated_date: '2026-06-03 13:40'
labels:
  - 'kind:state'
  - 'step:setup'
dependencies:
  - gla-core-1
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The SETUP step of gla-core (kind:state, idempotent and reconciling, editable across versions). Detect first (honor gla-core-1): if a usable runtime is already present, reconcile rather than rebuild. Then make the GLA daemon real on this host and supervise it.

The exact runtime the bundle stands up is: GLA_PUBLIC_BASE_URL=https://<vps-ip>/ GLA_PORT=3000 node packages/app/bin/gla.mjs serve — run from the GLA build root, with the environment sourced from the placed env file (payload/templates/gla.env.tmpl) and supervised by the placed unit (payload/templates/gla.service.tmpl), preferably as a user-scope systemd service. The daemon binds the Access Gateway on 0.0.0.0:3000 (front it with the edge-proxy bundle's Caddy) and the Agent Bridge on a local unix socket; it refuses to bind the bridge to a public interface (fail-closed). GLA_PUBLIC_BASE_URL must be the externally reachable URL (the Caddy https URL), not the container's :3000, because handoff/enrollment links are built against it.

Honor the bundle's confirmation level; record the source-tree provenance, the env and unit files placed (with checksums), the enabled service, and the inverse op (disable + remove the unit, remove the tree if we cloned it) before this task may be Done — the Definition of Done gates it. Never touch a sibling bundle's state, and never assume an undeclared prerequisite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the GLA source tree is present at a known location on the host and its provenance (cloned/copied by us, or an adopted pre-existing tree) is recorded
- [ ] #2 the workspace dependencies are installed and the project is built, such that packages/app/bin/gla.mjs is runnable on this host
- [ ] #3 a supervised service runs 'gla serve' with GLA_PUBLIC_BASE_URL set to the operator's public URL and the gateway bound on port 3000, and it is enabled to start on boot; where no supervisor exists, an equivalent documented foreground run command is provided instead
- [ ] #4 the service environment is sourced from a placed env file whose values (public base URL, port, RP id, launcher mode) are set for this host, and the file's checksum is journaled
- [ ] #5 the daemon's public base URL is the externally reachable URL a recipient can open, not the container-internal address
- [ ] #6 what was placed or changed (source tree, env file, unit file, enabled service) is captured for the receipt with its inverse op, so the runtime can be fully removed later
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
