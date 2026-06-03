---
id: GLA-076
title: Verify the delegated provider covers passkey and password end to end
status: To Do
assignee: []
created_date: '2026-06-03 15:42'
labels:
  - authentik
  - impl
dependencies:
  - GLA-070
  - GLA-072
  - GLA-074
priority: medium
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the capstone for the authentik integration — proves both methods work through a real handoff behind the unchanged auth seam. Composes the implemented pieces; adds no new mechanism. Depends on enrollment, the dual-method step-up, and the installer. Out of scope: any new provider behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A handoff completes with the edge step-up satisfied by a passkey via the delegated provider, reaching the capsule.
- [ ] #2 A handoff completes with the edge step-up satisfied by a password via the delegated provider, reaching the capsule.
- [ ] #3 A handoff step that requires the stronger method admits the passkey run and refuses the password-only run.
- [ ] #4 A recipient the provider does not vouch for, an expired session, or a forwarded link for a different recipient does not reach the capsule.
- [ ] #5 Switching between the in-tree and the delegated provider changes no gateway or core code; only the wiring differs.
<!-- AC:END -->
