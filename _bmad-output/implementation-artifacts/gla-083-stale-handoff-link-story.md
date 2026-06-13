# GLA-083 Story Context: Stale Public Handoff Links

Status: reviewed-clean

BMAD workflow evidence: `bmad-create-story` was invoked through the persistent worker (`Dirac`). The project has no `_bmad-output/implementation-artifacts/sprint-status.yaml`, so the literal sprint-status path could not run; this artifact is the recorded docs-driven fallback seeded from `backlog task GLA-083 --plain` and the referenced design/code files.

## Story Contract

Stale public handoff links must fail closed with typed handoff/auth outcomes, never as `catalog.unknown`, while unrelated unknown public paths stay generic not-found.

Acceptance scope:

- Valid open handoff links still serve the normal handoff page and only reach the capsule after authorization.
- Expired, revoked, completed, cancelled, or torn-down handoff links return machine-readable handoff/auth refusals.
- Browser follow-up calls from stale pages (`/handoff/auth/options`, `/handoff/auth/verify`) return the same refusal family, not generic unknown-route usage errors.
- WebSocket upgrades using stale links are rejected before any upstream capsule connection is opened or retained.
- Random unknown public paths still return generic not-found and expose no route-history API.

## Current Behavior Model

The gateway already verifies grants correctly for mounted routes and WebSocket upgrades. The stale-link gap is route absence after close/unmount: a former route path falls through to `catalog.unknown`, and stale follow-up POST bodies with the old `path` are classified as `usage.bad_argument`.

The session service owns the lifecycle truth (open, completed, expired, cancelled, terminal teardown). The gateway only needs enough bounded edge memory to classify recently-unmounted GLA-issued paths as stale; it must not resurrect routes or trust route shape alone.

## Implementation Guardrails

- Keep the fix in the gateway/route seam; do not weaken grant verification or authorization.
- Use the existing `auth.*` typed refusal family unless a new public error code is unavoidable.
- Bound any stale-route memory and keep it non-enumerable.
- Unknown paths that were never mounted remain generic `catalog.unknown`.
- A stale WebSocket path must not dial the upstream capsule endpoint and must not leave tracked sockets.

## Test Plan

- Update gateway handoff tests for expired/revoked GETs to assert machine-readable `auth.*` JSON and not `catalog.unknown`.
- Update unmount/stale-route tests to assert stale GET, auth-options, auth-verify, and WS upgrade all fail with typed auth refusal.
- Preserve a separate unknown-path assertion that still returns `catalog.unknown`.
- Run `pnpm vitest run packages/gateway/src/handoff.test.ts`, then the full `pnpm gate`.

## Implementation Record

- Added bounded retired-route memory in `AccessGateway` so recently unmounted handoff paths can be classified without remounting or exposing arbitrary route history.
- Added `CapabilityService.proveStaleSessionGrantRoute()` as a non-authorizing route-bound proof used only for typed stale-link classification after normal verification has already refused a stale token.
- Added gateway and capability tests for valid stale links, missing/garbage grants, cross-route expired/revoked tokens, stale browser follow-up calls, stale WS upgrades, and unrelated unknown paths.

## Review Record

- `Dirac` ran the story/dev path using the BMAD docs-driven fallback and implemented the change.
- `Helmholtz` found a route-oracle blocker for expired/revoked cross-route tokens; the fix requires route-bound stale proof before typed stale refusals.
- `Helmholtz` re-reviewed the route-proof fix and reported no remaining security findings.
- `Wegener` re-reviewed the current diff and approved closing `GLA-083`; residual gap is only split coverage between gateway behavior and capability route-proof tests.
- `pnpm gate` passed after the fix: 57 files, 618 tests passed, 12 skipped; only the known broken `wpm/CLAUDE.md` symlink warning remained.
