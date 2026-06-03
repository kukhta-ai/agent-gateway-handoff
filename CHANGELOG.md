# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (see
[`CONTRIBUTING.md` → Versioning & releases](./CONTRIBUTING.md#versioning--releases)).

## [Unreleased]

Building the scenario-01 MVP (a same-session browser handoff) through the BMAD SDLC, slice by slice.

### Added

- **Architecture & design set** — `docs/architecture/{baseline,kernel-contracts,dependency-strategy,test-strategy}.md`: the concrete TS/Node modular-monolith realization of the committed spec, the kernel contracts, the dependency/ownership map, and the test architecture (scenario-01 E2E harness + 10 security invariants).
- **Scaffold & quality gate** — a pnpm-workspace modular monolith (core / core-adjacent / edge / adapter / surface rings) with the import boundary enforced by both the package graph and a Biome rule; `pnpm gate` (`tsc -b` + `biome ci .` + `vitest run`) wired into pre-commit/CI/DoD, with a self-test proving a deliberate violation fails the gate.
- **Kernel** (`@gla/kernel`, zero runtime deps) — core entities + state machines (typed invalid-transition errors); the capability primitive (signing-independent port + reference HMAC signer: mint/attenuate/stateless verify, recipient-binding fail-closed, signed lineage with full-ancestor revocation, scope fail-closed); offline `AssemblySpec` validation (all defects in one pass); the typed `config_schema` validator; and the stable error→exit-code taxonomy (0–8, incl. `mount.*`).
- **`gla` CLI** (the Agent Bridge surface) — `whoami`, `template list|show`, `skill list|show`, `catalog list`, `task create|get|list`, `session create [--dry-run]`; JSON to stdout by default (human text only at a TTY), with the documented exit-code contract (0 / 2 usage / 3 policy / 4 authz / 5 not-found / 7 conflict / 8 dependency).
- **Inbound + orient (Phases 0–1)** — `channel-cli` (ChannelPort) delivering an inbound message with its recipient binding; the CapabilityService (agent-authority anchor + verify-first `whoami`); the Catalog (Store→Ingester→Index with system-derived availability; the `browser-handoff` template + provider manifests + a skill); recipient identity binding.
- **Propose + admit (Phase 2)** — the Task service (durable task root; task capability attenuated from the agent-authority); the assembly resolver (template overlay → resolved spec); the admission **mutate→validate** pipeline (offline policy / capability-scope / catalog-availability / config-schema / mount checks, minting and running nothing, so a `--dry-run` matches the real run); and the embedded **Cedar** policy engine (forbid-wins, deterministic, fail-closed) behind the policy port.
- **Provision the live capsule + agent connector (Phases 3–4)** — the worker plane (pluggable Spawner Registry + per-launcher mount capability, capsule lifecycle, workspace manager, idempotent cleanup reconciler); a real **process-tier launcher** (`launcher-process`: headless Chromium via Playwright for the CDP path, upgrading to headed Chromium + Xvfb + x11vnc + websockify/noVNC where available); the reversible provision saga; and an **agent-blind CDP connector** (`secret_ref` is a capability reference, not a raw secret) that descends from the task capability (lineage-revoke cascades) and is revoked + unbound at teardown. `gla session create` now provisions a real capsule.
- **Recipient enrollment (Phase E)** — the **Access Gateway** (the sole public entry, an HTTP server fronting enrollment) admitting only on a verified **single-use `operator-discharge` grant** (absent/forged/wrong-recipient/expired/reused refused, atomically consumed); the in-tree **WebAuthn** AuthProvider (`@simplewebauthn`) registering a passkey bound to a recipient identity (no half-bound state on failure); and the operator `enrollInvite` delivering the invite over the channel.

---

When the first release is cut, the entries above move under a dated `## [X.Y.Z] - YYYY-MM-DD` heading and a
fresh `## [Unreleased]` section takes their place — see
[`CONTRIBUTING.md` → Changelog](./CONTRIBUTING.md#changelog).
