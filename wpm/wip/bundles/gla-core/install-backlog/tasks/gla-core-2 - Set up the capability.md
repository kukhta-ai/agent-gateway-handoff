---
id: gla-core-2
title: Build the GLA runtime and install the gla serve service
status: To Do
assignee: []
created_date: '2026-01-01 00:00'
updated_date: '2026-06-08 15:35'
labels:
  - 'kind:state'
  - 'step:setup'
milestone: 0.1.0
dependencies:
  - GLA-CORE-1
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The SETUP step of gla-core (kind:state, idempotent and reconciling, editable across versions). Detect first (honor gla-core-1): if a usable runtime is already present, reconcile rather than rebuild. Then make the GLA daemon real on this host and supervise it.

The exact runtime the bundle stands up is: GLA_PUBLIC_BASE_URL=https://<vps-ip>/ GLA_PORT=3000 GLA_RP_ID=<public-host> GLA_LAUNCHER_MODE=auto node packages/app/bin/gla.mjs serve — run from the GLA build root, with the environment sourced from the placed env file (payload/templates/gla.env.tmpl) and supervised by the placed unit (payload/templates/gla.service.tmpl), preferably as a user-scope systemd service. The daemon binds the Access Gateway on 0.0.0.0:3000 (front it with the edge-proxy bundle's Caddy) and the Agent Bridge on a local unix socket; it refuses to bind the bridge to a public interface (fail-closed). GLA_PUBLIC_BASE_URL must be the externally reachable URL, not the container's :3000, because handoff/enrollment links are built against it. With a TLS proxy in front (the edge-proxy bundle), that is the proxy's https URL; with gla-core standalone and no proxy yet, use the host's own reachable address and port (e.g. http://<public-ip>:3000/) and update it when a proxy is later added — so gla-core stands up on its own without requiring edge-proxy first. GLA_RP_ID must match the host in that URL (the identity-provider bundle owns it, but its default is set here; note passkeys ultimately require https or localhost).

The validated build path on a clean Debian/Ubuntu host, to adapt rather than copy verbatim: ensure Node 22+ (NodeSource `setup_22.x` then the distro nodejs package if absent — else adopt the present Node), enable pnpm from the corepack that ships with Node (`corepack enable && corepack prepare pnpm@<pinned> --activate`), obtain the GLA source into the build root (clone or copy), then `pnpm install --frozen-lockfile` followed by `pnpm build` (a TypeScript project build, `tsc -b`). The result must leave packages/app/bin/gla.mjs runnable. A host that already has a usable Node/pnpm/build tree adopts them; only the missing pieces are installed. (These are the steps proven on the hermes-1 reference host — they are guidance, not a script: inspect the actual machine and choose the path that fits it.)

Honor the bundle's confirmation level; record the source-tree provenance, the env and unit files placed (with checksums), the enabled service (and, for a user unit, whether lingering was enabled so it survives logout), and the inverse op (disable + remove the unit, remove the tree if we cloned it) before this task may be Done — the Definition of Done gates it. Never touch a sibling bundle's state, and never assume an undeclared prerequisite.
<!-- SECTION:DESCRIPTION:END -->


## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Effect verified against the task acceptance criteria (verify before record)
- [ ] #2 Files placed or modified are recorded via --ref and their checksum journaled in the notes
- [ ] #3 Ownership recorded in the notes: installed by us vs adopted from the user's machine
- [ ] #4 Inverse op recorded in the notes: the uninstall step plus the condition under which it runs
- [ ] #5 Decisions and their rationale recorded (notes, or --final for a pinned decision)
- [ ] #6 Non-file effects recorded in the notes: services started, registrations made, artifacts built
<!-- DOD:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the GLA source tree is present at a known location on the host and its provenance (cloned/copied by us, or an adopted pre-existing tree) is recorded
- [ ] #2 the workspace dependencies are installed and the project is built, such that packages/app/bin/gla.mjs is runnable on this host
- [ ] #3 a supervised service runs 'gla serve' with GLA_PUBLIC_BASE_URL set to the operator's public URL and the gateway bound on port 3000, and it is enabled to start on boot; where no supervisor exists, an equivalent documented foreground run command is provided instead
- [ ] #4 the service environment is sourced from a placed env file whose values (public base URL, port, RP id, launcher mode) are set for this host, and the file's checksum is journaled
- [ ] #5 the daemon's public base URL is an externally reachable URL a recipient can open, not the container-internal address — the fronting proxy's https URL where one is present, otherwise the host's own reachable address and port, to be updated if a proxy is added later
- [ ] #6 what was placed or changed (source tree, env file, unit file, enabled service) is captured for the receipt with its inverse op, so the runtime can be fully removed later
<!-- AC:END -->
