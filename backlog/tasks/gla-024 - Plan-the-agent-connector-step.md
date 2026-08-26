---
id: GLA-024
title: Plan the agent-connector step
status: Done
assignee: []
created_date: '2026-06-03 03:31'
updated_date: '2026-06-03 09:17'
labels:
  - plan
  - architecture
  - row
  - connector
dependencies:
  - GLA-002
documentation:
  - docs/components/capsule.md
  - docs/components/capability-service.md
  - docs/05-cli-and-entities.md
priority: medium
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the agent needs an agent-blind handle to drive the capsule; this fixes the connector capability and its surface. Produces architecture and the build plan; no code. Use the architect skills and research control-protocol brokering on the internet. Depends on the contracts plan. Out of scope: the agent's actual driving; implementing the step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Capability service's part is specified: how an agent-connector capability is minted as an agent-blind reference, never a raw secret.
- [x] #2 The Session service's part is specified: how the session returns the connector reference to the agent after provisioning.
- [x] #3 The Capsule's part is specified: the continuously-attached agent connector as a surface distinct from any human entrypoint.
- [x] #4 The operating experience is designed: how the agent obtains and uses the connector without it ever exposing operator secrets.
- [x] #5 An implementation plan for the build task exists, with how an attached, agent-blind connector is observed.
- [x] #6 Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog.
- [x] #7 The connector seam is specified at full capability so a non-browser connector type is added with no seam change.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: docs/architecture/slice-3-provision-connector.md §connector. Agent-connector capability minted as an agent-blind reference (a cap id/secret_ref, never a raw secret); session returns the connector ref post-provision; capsule's continuously-attached connector as a surface distinct from any human entrypoint; operating experience (obtain+use without exposing operator secrets); build plan; connector seam full-capability (a non-browser connector type adds with no seam change). Rule-3 docs-driven fallback. Implemented+tested in GLA-025.
<!-- SECTION:NOTES:END -->
