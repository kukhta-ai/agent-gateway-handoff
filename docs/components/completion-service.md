# Completion service

**Zone:** Control plane
**Kind:** GLA component (traditional code)
**Scenario-01 lane:** Completion svc

> Turns a capsule's raw done-signal into a trustworthy, normalized completion: it validates the signal against the declared detector contract, normalizes it to an envelope, and delivers it to the agent.

## Role

When a capsule signals that a step is finished, that signal cannot be trusted as-is — it must match what the session declared it would accept. The Completion service is that checkpoint: it subscribes to runtime completion signals, validates each against the `CompletionDetector` contract the assembly declared, normalizes the valid ones into a stable envelope, and hands them to the Bridge so the agent can resume. For risky paths it also gates the agent's verification.

## Responsibilities (owns)

- Subscribe to runtime completion signals from capsules.
- Validate signal shape against the declared `CompletionDetector` contract.
- Normalize to a stable completion envelope.
- Deliver completion to the Bridge; gate agent verification on risky paths.

## Interfaces

**Receives** — from the capsule: raw completion signals (`user-done`, `url-watcher` match, etc.); the detector contract from the session spec.
**Produces** — to the Session service: validated completion (which closes the window); to the Bridge: the normalized envelope.

## What it does NOT do

It does **not** judge *semantic* success — "did registration really work" is the agent's cognition, made by inspecting the page over the connector. The Completion service only confirms a *mechanical* signal matches its declared contract. It does **not** itself close routes or revoke grants (it informs the Session service, which orchestrates that).

## Entities & data

`CompletionDetector` (contract), the completion envelope, `Session.completion`.

## In scenario 01

Phase 8 — validates `user-done` / `url-watcher (/verify)`, normalizes, delivers completion-1 (status submitted, next email-verification). Phase 13 — validates `url-watcher (/dashboard)`, delivers completion-2 (verified).

## Failure modes

A signal that does not match the declared contract is rejected, not trusted (a malformed or spoofed "done" cannot advance the flow). A detector that never fires → the window TTL-expires and the agent is notified.

## Invariants

An out-of-contract signal is rejected. The envelope shape is stable across detectors. Detection is mechanical; interpretation belongs to the agent.

## Related

`capsule.md` (signal source), `session-service.md` (closes the window on completion), `agent-bridge.md` (delivery target), `catalog.md` (`CompletionDetector` kind).
