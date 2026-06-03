---
id: edge-proxy-1
title: Detect the Caddy edge and the path to the GLA port
status: To Do
assignee: []
created_date: '2026-06-03 13:39'
updated_date: '2026-06-03 13:41'
labels:
  - 'kind:state'
  - 'step:detect'
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DETECT step (kind:state, idempotent / Repair). edge-proxy fronts GLA with Caddy as the reverse proxy: it terminates inbound TLS, and the gateway verifies the grant and proxies the authorized WebSocket upgrade to the capsule (docs/03 §3). Inspect whether a manageable Caddy is present (adoptable vs none); determine the network path from the public edge to GLA's :3000, including any host-to-container port forward between the proxy and the daemon; and assess existing host/TLS config so setup completes only the missing routing. requires gla-core. Topology note (hermes-1): Caddy runs on the HOST (not in the container), and an LXD forkproxy maps host:13000 to container:3000 — so the proxy's upstream is the host-side forward, not the container address. Record findings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 whether a Caddy reverse proxy is present and manageable in this environment is determined by inspection, distinguishing an adoptable existing Caddy from none
- [ ] #2 the network path from the public edge to GLA's gateway port is determined for this topology, including any host-to-container port forward that sits between the proxy and the daemon, so the proxy is pointed at an address that actually reaches the daemon
- [ ] #3 whether the public hostname and TLS the proxy will serve are already configured is assessed, so setup completes only the missing routing rather than disturbing unrelated proxy configuration
- [ ] #4 the findings (Caddy present or absent and where it runs, the reachable upstream address for :3000, existing TLS/host config) are recorded for the receipt before setup runs
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
