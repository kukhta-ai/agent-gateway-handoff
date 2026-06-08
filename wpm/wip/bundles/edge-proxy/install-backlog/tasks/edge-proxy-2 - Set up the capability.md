---
id: edge-proxy-2
title: Route the public HTTPS endpoint to GLA on port 3000
status: To Do
assignee: []
created_date: '2026-01-01 00:00'
updated_date: '2026-06-08 15:42'
labels:
  - 'kind:state'
  - 'step:setup'
milestone: 0.1.0
dependencies:
  - EDGE-PROXY-1
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SETUP step (kind:state), confirmation-level dangerous because it edits the host reverse proxy. Caddy must serve the operator's public HTTPS URL and reverse-proxy it to the address that reaches GLA's gateway on :3000, forwarding WebSocket upgrades (the human-view session and verified upgrades depend on it). For a host-fronting-container topology, target the host-to-container forward (hermes-1: host:13000 to container:3000), and record the topology.

The bundle ships a real starting point at payload/templates/Caddyfile.tmpl — a parameterized site block with the upstream-selection guidance baked in (same-host 127.0.0.1:3000 vs the host-side forward 127.0.0.1:13000 for the host-fronts-container case), transparent WebSocket proxying (Caddy v2 forwards the upgrade as-is), and the bare-IP `tls internal` note. Fill its ⟨…⟩ placeholders for this host and either install it as the Caddyfile or merge its site block into the existing one; record the placed file via --ref so the receipt owns it.

Surface the routing change and get consent first; reload an existing Caddy rather than replacing it. Record the placed/modified proxy config with its checksum and inverse op; record an adopted Caddy as adopted so uninstall leaves it.
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
- [ ] #1 Caddy serves the operator's public HTTPS URL and reverse-proxies it to the address that reaches GLA's gateway on port 3000, so a recipient opening a handoff link is proxied to the daemon
- [ ] #2 the proxy forwards WebSocket upgrades to the gateway, since the human-view session and the gateway's verified upgrades depend on it
- [ ] #3 for a topology where the proxy runs on a host fronting a container, the configured upstream targets the host-to-container forward (for this deployment, the host:13000 to container:3000 mapping) rather than the container address directly, and this topology is recorded
- [ ] #4 because editing the host reverse proxy is a dangerous action, the routing change is surfaced and consent obtained before it is applied, and an existing Caddy is reloaded rather than replaced
- [ ] #5 the placed or modified proxy configuration is captured for the receipt with its checksum and the inverse op, and an adopted pre-existing Caddy is recorded as adopted so it is not removed on uninstall
<!-- AC:END -->
