# Investigation: noVNC Readiness Failure

## Hand-off Brief

1. **What happened.** The final integration gate failed because the real noVNC handoff page loaded its client assets but could not establish a usable WebSocket/RFB stream through the gateway.
2. **Where the case stands.** Root cause is confirmed at the launcher sidecar boundary: x11vnc exited before binding the VNC port when MIT-SHM allocation failed, and the gateway also had a post-upgrade error path that could inject HTTP refusal bytes into an already-upgraded WebSocket stream.
3. **What's needed next.** Keep x11vnc loopback-only but run it with `-forever -shared -noshm`, preserve the gateway's transparent post-upgrade close behavior, and verify with real noVNC E2E plus launcher WebSocket banner coverage.

## Case Info

| Field | Value |
| ----- | ----- |
| Ticket | epic-gate-fix for GLA-077..GLA-094 |
| Date opened | 2026-06-14 |
| Status | Concluded |
| System | Current workspace; Node 22; Xvfb/x11vnc/websockify available on PATH |
| Evidence sources | Vitest noVNC E2E output, launcher/gateway source, direct sidecar repro, x11vnc local help |

## Problem Statement

After GLA-077..GLA-094 were merged to `feature/authentik`, `pnpm run gate` failed in `packages/app/src/novnc-handoff-client-e2e.test.ts`. The recipient page reached WebAuthn verification and loaded noVNC client assets, but the live browser viewer never reached "Connected to the live browser."

## Evidence Inventory

| Source | Status | Notes |
| ------ | ------ | ----- |
| `packages/app/src/novnc-handoff-client-e2e.test.ts` | Available | Real browser E2E reproduces the failed recipient noVNC connection. |
| Browser diagnostics from focused E2E | Available | First observed `Invalid frame header`; after gateway error-path fix, websockify reported `1011 Failed to connect to downstream server`. |
| `adapters/launcher-process/src/index.ts` | Available | Full mode starts Xvfb, Chromium, x11vnc, and websockify. |
| `packages/gateway/src/index.ts` | Available | Raw WebSocket proxy writes HTTP 502 on upstream errors before the fix. |
| Minimal sidecar repro | Available | x11vnc exited before binding VNC; log ended with `shmget: No space left on device`. |
| `x11vnc -help` | Available | Confirms default non-shared behavior and documents `-shared`, `-forever`, and `-noshm`. |

## Confirmed Findings

### Finding 1: x11vnc could exit before exposing the VNC endpoint

**Evidence:** Local sidecar repro showed no listener on the chosen VNC port while websockify listened; x11vnc log ended with `shmget: No space left on device`.

**Detail:** The launcher treated the noVNC endpoint as structurally present if processes were spawned, but x11vnc could fail after spawn and before a usable VNC service existed. The original full-mode launcher test only asserted the endpoint string existed, not that the WebSocket path delivered an RFB banner.

### Finding 2: the gateway could write HTTP refusal bytes after WebSocket proxying started

**Evidence:** `packages/gateway/src/index.ts` routed every upstream socket `error` through `refuseUpgrade(clientSocket, 502)` before the fix.

**Detail:** That is correct before a WebSocket upgrade is handed off, but after the upstream 101/piping phase begins the client socket is an upgraded WebSocket stream. Writing an HTTP response there can surface as browser `Invalid frame header`.

### Finding 3: the direct noVNC endpoint is valid with `-noshm`

**Evidence:** Direct sidecar probe with `x11vnc -forever -shared -noshm` opened a WebSocket through websockify and received `RFB 003.008`.

**Detail:** This proves the human-view stack itself can work in the current environment when x11vnc avoids MIT-SHM and allows the readiness probe and later client connection.

## Deduced Conclusions

### Deduction 1: the noVNC gate failure was a sidecar readiness defect, not an auth or route authorization defect

**Based on:** Findings 1 and 3, plus the E2E diagnostics showing auth options/verify and noVNC client assets all loaded successfully.

**Reasoning:** The recipient was authorized and reached the route. The remaining failure was the stream endpoint closing or emitting invalid data before RFB connection. Direct endpoint proof after x11vnc option changes isolates the broken layer to launcher sidecar startup/readiness.

**Conclusion:** Fix belongs at the launcher human-view sidecar boundary, with a defensive gateway stream cleanup improvement.

## Source Code Trace

| Element | Detail |
| ------- | ------ |
| Error origin | noVNC browser client WebSocket/RFB connection in `packages/app/src/novnc-handoff-client-e2e.test.ts` |
| Trigger | Full-mode capsule starts Xvfb/x11vnc/websockify, then recipient page opens the authorized gateway stream |
| Condition | x11vnc cannot allocate MIT-SHM or readiness probe/client connection races with non-shared defaults |
| Related files | `adapters/launcher-process/src/index.ts`, `packages/gateway/src/index.ts`, `adapters/launcher-process/src/launcher-process.test.ts` |

## Conclusion

**Confidence:** High

The failure is confirmed as a human-view sidecar readiness issue, with a secondary gateway protocol-hardening issue. Running x11vnc with `-noshm` avoids constrained shared-memory failures; `-shared` prevents readiness probes and real clients from evicting/blocking each other; the gateway must not write HTTP refusal bytes after WebSocket proxying starts.

## Recommended Next Steps

### Fix direction

Apply the launcher x11vnc option changes, keep RFB/websockify readiness probes, add a direct WebSocket/RFB banner assertion to the launcher full-mode test, and keep the real noVNC E2E required in the gate.

### Diagnostic

Use focused verification first:

```bash
GLA_BROWSER_E2E_MODE=required pnpm exec vitest run adapters/launcher-process/src/launcher-process.test.ts --reporter=verbose
GLA_BROWSER_E2E_MODE=required pnpm exec vitest run packages/app/src/novnc-handoff-client-e2e.test.ts --reporter=verbose
```

Then run the full project gate.

## Reproduction Plan

1. Run the full noVNC browser E2E with `GLA_BROWSER_E2E_MODE=required`.
2. Without the x11vnc `-noshm` option in constrained environments, the test can fail before the viewer connects.
3. With `-forever -shared -noshm` and the gateway post-upgrade error guard, the direct launcher probe receives the RFB banner and the real noVNC browser E2E passes.
