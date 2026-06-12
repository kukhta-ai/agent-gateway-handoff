# Investigation: GLA authentik install transcript

## Hand-off Brief

1. **What happened.** A client installation of GLA with authentik repeatedly hit source, auth-flow, proxy-prefix, lifecycle, and noVNC viewing failures during a long Hermes-assisted setup.
2. **Where the case stands.** Active; the full source transcript is available at `tmp/gla-authentik-correspondence-full.md` and will be reviewed sequentially with path-line citations.
3. **What's needed next.** Produce a transcript-grounded issue inventory for backlog planning.

## Case Info

| Field | Value |
| --- | --- |
| Ticket | N/A |
| Date opened | 2026-06-12 |
| Status | Active |
| System | Client VPS/install flow from transcript; local repo branch `feature/authentik` |
| Evidence sources | `tmp/gla-authentik-correspondence-full.md`, repository history/current installer files as needed |

## Problem Statement

The user asked for a line-by-line review of the Hermes/client installation transcript to identify every problem and bug the client faced so the project backlog can be planned from real install friction.

## Evidence Inventory

| Source | Status | Notes |
| --- | --- | --- |
| `tmp/gla-authentik-correspondence-full.md` | Available | Primary source; 10,382 lines, visible user/assistant messages, tool output mostly omitted. |
| `/tmp` execution logs | Partial | Useful corroboration, but secondary to the transcript for this pass. |
| Current repo files | Available | Used only to determine whether issues appear already addressed. |

## Investigation Backlog

| # | Path to Explore | Priority | Status | Notes |
| - | --- | --- | --- | --- |
| 1 | Read transcript sequentially and extract install-blocking incidents | High | Done | Sequential pass completed through line 10,382. |
| 2 | Correlate confirmed incidents with latest repo state | Medium | Open | Distinguish fixed, partially fixed, and backlog candidates before converting to backlog tasks. |

## Timeline of Events

| Time | Event | Source | Confidence |
| --- | --- | --- | --- |
| 2026-06-08 to 2026-06-10 | Client/Hermes GLA authentik installation attempt spans many gateway-recovery sessions. | `tmp/gla-authentik-correspondence-full.md:7` | Confirmed |

## Confirmed Findings

1. Gateway recovery repeatedly lost active installation context; many restart sessions began with "I don't see an unfinished user request" and required the user to restate the task (`tmp/gla-authentik-correspondence-full.md:147`, `tmp/gla-authentik-correspondence-full.md:9624`).
2. The checked-out source initially failed to build because `oidcCallbackPageHtml` was missing; Hermes patched callback page code during install (`tmp/gla-authentik-correspondence-full.md:165`).
3. Early "ready" state was declared before a real browser OIDC/authenticator round-trip had been executed (`tmp/gla-authentik-correspondence-full.md:272`).
4. The deployment used a non-root public mount `/a/`, but GLA-generated browser API calls and handoff/enrollment links initially used root-relative paths (`tmp/gla-authentik-correspondence-full.md:582`, `tmp/gla-authentik-correspondence-full.md:651`, `tmp/gla-authentik-correspondence-full.md:9700`).
5. The OIDC callback/resume contract was inconsistent: enrollment stored old state keys and the universal callback page expected handoff authorization semantics for enrollment success (`tmp/gla-authentik-correspondence-full.md:590`, `tmp/gla-authentik-correspondence-full.md:6924`).
6. Process management was fragile: duplicate/stale GLA and edge listeners survived restarts and served old code/state, causing port conflicts and misleading behavior (`tmp/gla-authentik-correspondence-full.md:619`, `tmp/gla-authentik-correspondence-full.md:9670`, `tmp/gla-authentik-correspondence-full.md:9688`).
7. Operator UX was incomplete: no stable CLI noun existed for creating enrollment invites or handoff links, so Hermes invoked internal bridge/client code directly (`tmp/gla-authentik-correspondence-full.md:635`).
8. Authentik behind `/a/` path prefix broke frontend/static/API assumptions; the SPA generated bare `/static`, `/api`, and malformed flow paths (`tmp/gla-authentik-correspondence-full.md:671`).
9. Human-view runtime dependencies were missing and sudo/root escalation was unavailable, forcing manual rootless extraction of Xvfb/x11vnc/websockify/noVNC dependencies (`tmp/gla-authentik-correspondence-full.md:2376`, `tmp/gla-authentik-correspondence-full.md:2976`, `tmp/gla-authentik-correspondence-full.md:3417`).
10. Launcher configuration forced headless mode even after human-view dependencies existed; `GLA_LAUNCHER_MODE` had to be corrected manually (`tmp/gla-authentik-correspondence-full.md:3519`).
11. Enrollment/recipient state was in-memory, so every daemon restart invalidated enrollment and forced the client through the auth flow again (`tmp/gla-authentik-correspondence-full.md:3557`, `tmp/gla-authentik-correspondence-full.md:9481`, `tmp/gla-authentik-correspondence-full.md:10363`).
12. Handoff grants expired during interactive install attempts and surfaced as generic `catalog.unknown/not found`, not an explicit expired-link state (`tmp/gla-authentik-correspondence-full.md:4282`, `tmp/gla-authentik-correspondence-full.md:9764`).
13. A predictable public shortcut (`/a/i/handoff-evg`) exposed the active bearer handoff grant; Hermes recognized this as unsafe and deleted/canceled it (`tmp/gla-authentik-correspondence-full.md:4990`).
14. Tool-output redaction blocked safe transfer of bearer URLs and also caused literal `***` to enter env/receipt values (`tmp/gla-authentik-correspondence-full.md:5651`, `tmp/gla-authentik-correspondence-full.md:7302`, `tmp/gla-authentik-correspondence-full.md:9632`).
15. GLA required `webauthn` by default, but authentik returned `authStrength: "password"`; handoff failed with `403 auth.insufficient` until Hermes added an env/flag override (`tmp/gla-authentik-correspondence-full.md:7257`, `tmp/gla-authentik-correspondence-full.md:9710`).
16. Session template/catalog and JSON output shape were unstable or under-documented; template requirements and `connector.cdp_url` location had to be discovered manually (`tmp/gla-authentik-correspondence-full.md:6326`, `tmp/gla-authentik-correspondence-full.md:9656`).
17. Shortcut artifacts were inconsistent: the edge handler read `.url` files while Hermes updated `.txt`, so old redirects persisted (`tmp/gla-authentik-correspondence-full.md:9694`).
18. Raw WebSocket success was mistaken for visible noVNC session success; the page opened a WS and showed a checkmark without starting RFB/noVNC rendering (`tmp/gla-authentik-correspondence-full.md:9201`, `tmp/gla-authentik-correspondence-full.md:9211`).
19. A noVNC CDN top-level module import broke the handoff button because the whole script failed before registering the click handler (`tmp/gla-authentik-correspondence-full.md:9301`, `tmp/gla-authentik-correspondence-full.md:9307`).
20. The CDN-based noVNC viewer failed to load, requiring same-origin/local assets instead of external CDN dependency (`tmp/gla-authentik-correspondence-full.md:9377`, `tmp/gla-authentik-correspondence-full.md:9384`).
21. Directly serving `@novnc/novnc/lib/rfb.js` failed because the served file was CommonJS, not browser-importable ESM (`tmp/gla-authentik-correspondence-full.md:9502`, `tmp/gla-authentik-correspondence-full.md:9522`).
22. noVNC package resolution was brittle under pnpm/package exports and needed repeated path fixes (`tmp/gla-authentik-correspondence-full.md:9412`, `tmp/gla-authentik-correspondence-full.md:10068`).
23. Browser test tooling was unreliable across shells/HOME: Playwright expected a missing headless shell and Chrome for Testing discovery varied (`tmp/gla-authentik-correspondence-full.md:659`, `tmp/gla-authentik-correspondence-full.md:9506`).
24. Generated inline JS contained a syntax error `.replace(/^//, "")`, preventing the button click handler from registering (`tmp/gla-authentik-correspondence-full.md:10275`, `tmp/gla-authentik-correspondence-full.md:10303`).
25. Multiple source patches were made manually during the client's install rather than arriving from a release-quality source tree (`tmp/gla-authentik-correspondence-full.md:165`, `tmp/gla-authentik-correspondence-full.md:9215`, `tmp/gla-authentik-correspondence-full.md:10313`).

## Deduced Conclusions

The installation did not fail from a single defect. It exposed a readiness gap across release packaging, public mount support, auth policy negotiation, durable lifecycle state, human-view runtime packaging, edge-process supervision, and browser-level handoff verification. Several fixes Hermes applied may be valid prototypes, but they should be reviewed as architecture decisions rather than accepted automatically.

## Hypothesized Paths

1. Treat `/a/` non-root public mounting as a first-class supported deployment mode or explicitly reject it in preflight.
2. Replace manual tmux/nohup/background processes with supervised units and strict port/PID ownership checks.
3. Persist enrollment/recipient state or make restart behavior explicit and recoverable.
4. Replace false-positive "connected" smoke checks with browser E2E assertions that a noVNC viewport/canvas/iframe is visible and interactive.
5. Make handoff/auth errors typed and user-actionable (`expired`, `not_enrolled`, `insufficient_auth_strength`) rather than generic catalog errors.

## Missing Evidence

| Gap | Impact | How to Obtain |
| --- | --- | --- |
| Raw tool output is mostly omitted from transcript. | Some root causes may be assistant-reported rather than independently observable. | Correlate with `/tmp` logs or repo commits when needed. |

## Source Code Trace

Transcript points to at least these code areas for follow-up: OIDC callback page generation, enrollment/handoff URL builders, handoff grant lifecycle, edge shortcut handler, operator CLI bridge, launcher mode/config parsing, noVNC asset routing and handoff page generation, session template/catalog definitions, and machine-readable CLI output schemas.

## Conclusion

**Confidence:** Medium-high

The transcript was read sequentially through EOF and the findings above are directly grounded in user-visible or assistant-reported transcript lines. Confidence is not "high" because raw command outputs and diffs are mostly omitted from the exported transcript.

## Recommended Next Steps

### Fix direction

Convert the confirmed findings into backlog candidates only after checking which Hermes patches already landed in the current branch and whether they match the intended architecture. Prioritize source-ready install, prefix-safe URL generation, durable auth/enrollment lifecycle, typed handoff errors, supervised runtime, and noVNC browser E2E coverage.

### Diagnostic

Correlate each candidate with current tests and files, then add regression tests before changing behavior. The transcript shows several "fixed" states that were later revealed as false positives.

## Current Branch / Architecture Comparison

Branch checked: `feature/authentik` at `262dfbf` (`wpm(gla-core): pin the source clone to the current branch (feature/authentik)`). The committed design set was read before this comparison; the backlog is fully Done and the SDLC state says Phase 7 handoff is pending. This section compares the 25 transcript findings against the current branch and the architecture docs.

### High-level conformance

- Provider selection mostly matches the architecture: authentik is opt-in behind `AuthProviderPort`, the gateway step-up path remains provider-agnostic, and the adapter maps `amr`/`acr` to `password` vs `webauthn` without up-mapping.
- The long-running daemon is now real and shared-state within one process, so the original one-shot CLI state-loss problem is partly solved.
- The installer/WPM direction matches the docs: GLA runs on the process tier, Caddy is the edge, authentik is Local-External or Remote-External, and `GLA_LAUNCHER_MODE=auto` is the template default.

### Major remaining gaps

- The handoff page still opens a raw `WebSocket` and reports "Connected"; it does not load a noVNC/RFB client or render/control the remote browser. This conflicts with the architecture's "human Playwright client connects via noVNC" and the human-view WPM verification contract.
- The architecture says deployments may set `requiredAuthStrength:"password"` to permit password fallback, but `gla serve` has no flag/env for it and the WPM env template has no setting. Real deployments still default to `webauthn`, so authentik password fallback can still fail with `auth.insufficient`.
- Authentik enrollment and session/handoff state are still process-local by default: the adapter exposes injectable stores, but app/daemon composition uses in-memory defaults; `SessionService` also keeps sessions, handoffs, timers, and provision state in `Map`s. A daemon restart still loses enrollment/pending OIDC/session state.
- The docs/WPM snippet describe a same-origin `/auth/callback` path served by GLA, but the gateway has no `/auth/callback` route. The current page implements redirect return on the handoff/enroll page itself (`?code&state`), while WPM tells authentik to return to `/auth/callback`, which would route to `catalog.unknown` unless rewritten to an existing page.
- Catalog/provider manifests still seed `browser-runtime` and `human-view` as `bound`, so orientation can report the noVNC path available before WPM has proven browser-native assets and a real view path.

### Per-finding status matrix

| # | Transcript issue | Current branch status | Backlog implication |
| --- | --- | --- | --- |
| 1 | Gateway restart lost active install context. | Partly fixed: `gla serve` shares daemon state across CLI calls, but not across process restart. | Add durable daemon state or explicit restart-loss recovery semantics. |
| 2 | Missing `oidcCallbackPageHtml` build failure. | Specific build issue fixed/obsolete; current callback model differs. | Resolve `/auth/callback` architecture/WPM/code mismatch. |
| 3 | Install marked ready before real browser OIDC/noVNC round-trip. | Not fully fixed: tests prove fake-authentik and raw WS/CDP surrogate, not a rendered noVNC browser session. | Add installer gate that proves real browser-visible noVNC plus OIDC path before recording ready. |
| 4 | Non-root `/a/` mount broke URL/API paths. | Not supported by current docs/code; pages use root absolute `/handoff/*` and `/enroll/*`. | Either declare path-prefix unsupported in preflight or implement base-path aware URLs. |
| 5 | Callback/resume semantics mixed enrollment and handoff. | Improved in pages via separate storage keys/routes, but `/auth/callback` remains unresolved. | Define one callback contract and test both enrollment and handoff through it. |
| 6 | Duplicate/stale processes and listeners. | Improved: daemon has local bridge guard, stale UDS cleanup, graceful close. Crash/orphan adoption remains limited by in-memory state. | Add supervisor/orphan reconciliation proof for ungraceful restarts. |
| 7 | No stable operator CLI for enrollment/handoff. | Handoff CLI exists; enrollment invite is a daemon handle/operator bridge op, not a stable human CLI noun. | Add/document operator-side enrollment command without exposing it to agent workflow. |
| 8 | Authentik under `/a/` path prefix broke static/API paths. | Architecture now favors separate authentik origin and root GLA origin. Prefix remains unsupported. | Same as #4: reject or support prefix explicitly. |
| 9 | Human-view deps missing/no sudo/rootless hacks. | WPM human-view tasks exist, but runtime still only checks binaries and does not serve noVNC client assets. | Make WPM and launcher prove/install the complete view stack, including browser assets. |
| 10 | Launcher forced headless after deps existed. | Fixed: env template and launcher default are `auto`. | Keep regression test/preflight for full vs headless mode. |
| 11 | Enrollment/recipient state in-memory and restart-invalidated. | Still present for real daemon composition. | Persist identity/enrollment/authentik subjects and session/handoff state, or define restart invalidation as intended behavior. |
| 12 | Expired handoff surfaced as `catalog.unknown`. | Partly fixed for `handoff wait` exit 6, but an unmounted/stale public route still falls to `catalog.unknown`. | Preserve typed expired/revoked public refusal after route unmount, or keep tombstones through TTL grace. |
| 13 | Public shortcut exposed bearer grant. | Not seen in repo source; likely deployment artifact risk. | Add installer guard/receipt rules forbidding public shortcut artifacts containing grants. |
| 14 | Redaction caused unsafe/invalid secret and grant handling. | Secrets are not logged in authentik startup errors, but no general bearer URL redaction/placeholder validation layer was found. | Add redaction and placeholder validation for env, receipts, logs, and operator output. |
| 15 | Auth strength mismatch password vs default `webauthn`. | Gating code is correct, tests can set it, but `gla serve` and WPM env cannot. | Add `GLA_REQUIRED_AUTH_STRENGTH` or equivalent CLI/env wiring and template field. |
| 16 | Session template/catalog JSON shape unstable. | Mostly improved, but catalog still reports required dependencies as bound from seed manifests. | Derive availability from real WPM bindings/probes, not seeded bound manifests. |
| 17 | Shortcut `.url` vs `.txt` mismatch. | Not present in current repo source. | If shortcuts remain in deployment tooling, standardize artifact schema and cleanup. |
| 18 | Raw WS success mistaken for noVNC success. | Still present: page opens raw WebSocket and tests assert `UPSTREAM_NOVNC_HELLO`. | Replace with real noVNC client rendering/control and browser assertions. |
| 19 | CDN noVNC import broke button. | CDN path removed, but no working replacement exists. | Serve local noVNC assets or bundle a supported client module. |
| 20 | External CDN noVNC dependency failed. | Avoided, but unresolved because local assets are absent. | Same as #19. |
| 21 | `@novnc/novnc/lib/rfb.js` CommonJS/browser import issue. | Avoided by not importing noVNC, but no rendered client exists. | Add tested browser-compatible noVNC bundling/serving path. |
| 22 | noVNC package path brittle under pnpm exports. | Avoided, not solved. | Use a deterministic build/copy step or package-supported entrypoint for noVNC assets. |
| 23 | Browser tooling mismatch Playwright/Chrome. | Mostly addressed by Node 22/pnpm and Playwright-core cached Chromium assumptions. | Keep WPM browser-runtime verification strict on the actual service user. |
| 24 | Inline JS syntax error `.replace(/^//,"")`. | Fixed/obsolete; no such code found in current handoff page. | Add browser-page smoke test that fails if inline script cannot register handlers. |
| 25 | Manual live patches during install. | Partly addressed by WPM tasks and current tests, but install still has deploy-only deferrals and no real noVNC UI proof. | Add release-readiness install rehearsal that must pass from clean source before handoff. |

### Priority backlog candidates

1. Implement a real noVNC browser client path: local assets, RFB initialization, visible viewport/control assertions, and WPM proof that assets plus websockify work for the GLA service user.
2. Wire deployment auth-strength policy: `gla serve` flag/env, WPM env template, validation, docs, and tests proving password fallback can be permitted on a real daemon.
3. Resolve the OIDC callback contract: either make `/auth/callback` a real GLA-served return page or change WPM/authentik redirect URI generation to target the existing handoff/enroll page return path.
4. Add durable state or a documented recovery model for enrollment, authentik subject bindings, pending attempts, sessions, handoffs, routes, and cleanup reconciliation across daemon restart.
5. Replace seeded dependency availability with recorded WPM `DependencyBinding` probes so catalog/template orientation reflects the actual host.
6. Decide path-prefix support: explicitly fail preflight for non-root public base paths, or implement base-path aware page fetches, callback paths, and link generation.
7. Add typed stale-link handling so expired/revoked/unmounted handoff URLs return an auth/window error instead of `catalog.unknown`.
8. Add installer safety checks for bearer URL redaction, secret placeholder validation, and prohibition of public shortcut files containing grants.

## Reproduction Plan

Use a clean host or container configured with a non-root public prefix (`/a/`), no sudo path, and authentik returning password-strength auth. Run the installer from source, then perform real browser enrollment and handoff. The run must assert rendered noVNC visibility, not only HTTP/WS success.

## Side Findings

The transcript contains many terse assistant planning fragments such as "Need patch routes" and "Need run tests". This is not a product bug by itself, but it shows the install-assistant experience was noisy and may have contributed to confusing operator communication.
