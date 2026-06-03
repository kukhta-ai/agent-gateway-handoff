---
id: edge-proxy-3
title: Verify the public URL reaches GLA over TLS
status: To Do
assignee: []
created_date: '2026-06-03 13:39'
updated_date: '2026-06-03 13:41'
labels:
  - 'kind:state'
  - 'step:verify'
dependencies:
  - edge-proxy-2
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
VERIFY step (kind:state). Prove the edge reaches the daemon end to end: a request to the operator's public HTTPS URL is served over valid TLS and proxied through to the GLA gateway; a WebSocket upgrade through the public URL reaches the gateway (not silently downgraded); and the public base URL the daemon builds links against resolves, through this proxy, back to the same daemon — so a delivered handoff link is openable by a recipient. Re-read and confirm the setup receipt entries (proxy config and checksum, topology, inverse op).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a request to the operator's public HTTPS URL is served over valid TLS and is proxied through to the GLA gateway, demonstrating the edge reaches the daemon end to end
- [ ] #2 a WebSocket upgrade through the public URL reaches the gateway, confirming the live-view and verified-upgrade path works and is not silently downgraded
- [ ] #3 the public base URL the GLA daemon builds handoff links against resolves, through this proxy, back to the same daemon, so a delivered link is openable by a recipient
- [ ] #4 the receipt entries written during setup (proxy config and checksum, the topology, the inverse op) are re-read and confirmed present and accurate
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
