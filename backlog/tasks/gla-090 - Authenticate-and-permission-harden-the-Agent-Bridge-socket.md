---
id: GLA-090
title: Verify local Agent Bridge isolation and socket hygiene
status: To Do
assignee: []
created_date: '2026-06-12 22:59'
updated_date: '2026-06-12 23:09'
labels:
  - security
  - bridge
  - cli
  - daemon
  - local-socket
  - hardening
dependencies:
  - GLA-066
references:
  - docs/components/agent-bridge.md
  - docs/architecture/baseline.md
  - packages/app/src/daemon.ts
  - surfaces/cli/src/transport.ts
priority: high
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: independent security review found that the local Agent Bridge endpoint is security-bearing control-plane surface, but the project docs intentionally keep agent authentication off in the trusted-local reference profile. The proportional fix is to verify local isolation and socket hygiene, not to add a default login, bearer token, mTLS, or per-agent identity ceremony to the internal agent experience.

Architectural context: in the reference profile, the agent and GLA daemon are co-deployed for one operator on one host. The Bridge is private and local; Identity + Auth handles real agent authentication only for profiles that need it, such as remote bridge, multi-agent, multi-tenant, or per-agent attribution/revocation. This task hardens the OS boundary that the trusted-local profile already relies on.

Boundaries: this task does not add an AuthProvider for agents, does not require a token or certificate for the default local CLI/MCP path, and does not try to defend against a compromised same-UID process. It does ensure GLA does not accidentally expose the bridge to other local users, stale or replaced sockets, unsafe runtime directories, or public network interfaces.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The trusted-local default bridge remains usable by the same-user agent and CLI without a login prompt, bearer token, mTLS certificate, or per-call credential ceremony.
- [ ] #2 The default Unix-domain bridge endpoint is usable only when its runtime directory and socket path are owned and permissioned so other local users cannot open, replace, or pre-create the endpoint.
- [ ] #3 Unsafe bridge endpoint paths, including symlinks, regular files, directories, wrong-owner paths, unsafe parent directories, or replaced sockets, fail before security-bearing operations are served and produce actionable diagnostics.
- [ ] #4 Non-local bridge endpoints are refused; loopback TCP, if supported, is explicitly identified as a development or advanced mode and is not presented as equivalent to a private Unix-domain socket for cross-user isolation.
- [ ] #5 Trusted-local documentation states that same-UID compromise is out of scope and points remote, multi-agent, multi-tenant, per-agent attribution, and revocation needs to a separate authenticated-agent profile.
- [ ] #6 Bridge and CLI diagnostics for refused endpoints do not disclose raw grants, secret values, local sensitive paths beyond what is needed for repair, or request bodies.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created from independent security review. Evidence: packages/app/src/daemon.ts currently creates and uses the bridge socket around daemon startup/control handling; surfaces/cli/src/transport.ts connects by path and exchanges control traffic. Review concern: path possession alone should not authorize security-bearing control-plane operations.

User scoping clarification: avoid over-hardening the internal agent path. Default GLA should not add a bridge login/token/mTLS ceremony for the trusted-local profile. The task is about verified local isolation and socket hygiene; real agent authentication belongs to a separate remote/multi-agent/multi-tenant profile.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
- [ ] #7 A security note documents the trusted-local bridge profile, local attacker model, OS isolation boundary, Unix-socket permission expectations, loopback limitations, and when a separate authenticated-agent profile is required.
- [ ] #8 Tests cover unsafe runtime directories, stale sockets, symlink or replaced endpoints, wrong-owner paths, non-local endpoint refusal, loopback development-mode behavior if supported, and redaction of refused bridge diagnostics.
<!-- DOD:END -->
