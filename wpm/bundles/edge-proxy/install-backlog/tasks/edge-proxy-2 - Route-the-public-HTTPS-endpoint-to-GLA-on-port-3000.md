---
id: edge-proxy-2
title: Route the public HTTPS endpoint to GLA on port 3000
status: To Do
assignee: []
created_date: '2026-06-03 13:39'
updated_date: '2026-06-03 13:41'
labels:
  - 'kind:state'
  - 'step:setup'
dependencies:
  - edge-proxy-1
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SETUP step (kind:state), confirmation-level dangerous because it edits the host reverse proxy. Caddy must serve the operator's public HTTPS URL and reverse-proxy it to the address that reaches GLA's gateway on :3000, forwarding WebSocket upgrades (the human-view session and verified upgrades depend on it). For a host-fronting-container topology, target the host-to-container forward (hermes-1: host:13000 to container:3000), and record the topology. Surface the routing change and get consent first; reload an existing Caddy rather than replacing it. Record the placed/modified proxy config with its checksum and inverse op; record an adopted Caddy as adopted so uninstall leaves it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Caddy serves the operator's public HTTPS URL and reverse-proxies it to the address that reaches GLA's gateway on port 3000, so a recipient opening a handoff link is proxied to the daemon
- [ ] #2 the proxy forwards WebSocket upgrades to the gateway, since the human-view session and the gateway's verified upgrades depend on it
- [ ] #3 for a topology where the proxy runs on a host fronting a container, the configured upstream targets the host-to-container forward (for this deployment, the host:13000 to container:3000 mapping) rather than the container address directly, and this topology is recorded
- [ ] #4 because editing the host reverse proxy is a dangerous action, the routing change is surfaced and consent obtained before it is applied, and an existing Caddy is reloaded rather than replaced
- [ ] #5 the placed or modified proxy configuration is captured for the receipt with its checksum and the inverse op, and an adopted pre-existing Caddy is recorded as adopted so it is not removed on uninstall
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
