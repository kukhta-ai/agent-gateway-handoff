---
id: gla-core-3
title: Verify the gateway answers and the bridge socket is live
status: To Do
assignee: []
created_date: '2026-06-03 13:38'
updated_date: '2026-06-03 13:40'
labels:
  - 'kind:state'
  - 'step:verify'
dependencies:
  - gla-core-2
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The VERIFY step that closes gla-core's loop (kind:state). The Definition of Done gates recording; this task confirms it. A task is not done because the serve command ran — it is done because the runtime is genuinely answering.

Prove the daemon is live on both doors: the public Access Gateway answers HTTP on port 3000 (a real response, not a connection refusal), and the local Agent Bridge socket exists and a gla control command issued over it succeeds — and the bridge endpoint is local-only (a unix socket or loopback), never public (the daemon's own S-6 guard refuses otherwise). Confirm durability: the service comes back after its supervisor restarts (or the documented run command relaunches cleanly), so the runtime is not a one-shot. Then re-read the receipt entries gla-core-2 wrote (provenance, env/unit files and checksums, the enabled service, the inverse op) and confirm they are present and accurate.

If verification fails, return to setup rather than marking Done; on a step that needs the operator, mark the task Blocked, note what is awaited, and resume from the record. Contain any failure to this bundle, and leave the sibling bundles intact.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the Access Gateway answers HTTP on port 3000 on the host (a request receives a well-formed response rather than a connection refusal)
- [ ] #2 the local Agent Bridge endpoint exists as a unix socket and a gla control command issued over it succeeds, confirming the agent door is reachable
- [ ] #3 the bridge endpoint is local-only (a unix socket or loopback), never bound to a public interface
- [ ] #4 the service survives a restart of its supervisor (or the documented run command relaunches cleanly), demonstrating the runtime is durable rather than a one-shot process
- [ ] #5 the receipt entries written during setup (source provenance, env/unit files and checksums, the enabled service, the inverse op) are re-read and confirmed present and accurate
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
