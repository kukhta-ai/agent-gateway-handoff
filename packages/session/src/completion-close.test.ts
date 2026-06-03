// UNIT tests for the completion-driven close-window step (packages/session) — GLA-042/043/044/045, S-2/S-8.
// deliverCompletion validates a raw signal vs the window's declared detector contract (via the injected Completion
// service) and, on a validated completion, runs the CLOSE-WINDOW step (the reverse of openHandoff at the SAME
// seams): force-close the live WS, revoke the grant, unmount the route, mark the window `completed`, RESUME the
// agent connector, return the session to `active` with the capsule STILL RUNNING. An OUT-OF-CONTRACT signal is
// REJECTED — the window stays open, the session does not advance (S-8). The connector is SUSPENDED while a window
// is open (S-2 agent-blind). All over STUB seams — no real gateway/detector/completion.

import type {
  CapabilityId,
  CompletionEnvelope,
  GlaError,
  HandoffId,
  Iso8601,
  OpaqueToken,
  RawCompletionSignal,
  RecipientRef,
  ResolvedAssemblySpec,
  Route,
  RuntimeHandle,
  SessionId,
  TaskId,
} from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  type CompletionDeps,
  type CompletionPort,
  type CompletionProcessResult,
  type ConnectorControlPort,
  type HandoffCapabilityPort,
  type HandoffChannelPort,
  type HandoffDeps,
  type HandoffEntrypointPort,
  type HandoffRoutePort,
  type MintedSessionGrantRef,
  SessionService,
} from "./index.js";

const TASK = "task_1" as TaskId;
const recipient = "tg:user:123" as RecipientRef;
const ENDPOINT = "ws://127.0.0.1:6080/";
const AT = "2026-06-03T00:00:00.000Z" as Iso8601;

function resolved(): ResolvedAssemblySpec {
  return {
    apiVersion: "gla.dev/v1",
    kind: "Assembly",
    metadata: { intent: "register on acme", task: "task_1" },
    spec: {
      template: "browser-handoff",
      // biome-ignore lint/suspicious/noExplicitAny: recipient brand cast in test
      recipient: recipient as any,
      detectors: [
        { use: "url-watcher", params: { complete_on: "/dashboard", intermediate: "/verify" } },
      ],
    },
    __resolved: true,
  };
}

class StubCap implements HandoffCapabilityPort {
  minted: MintedSessionGrantRef[] = [];
  revoked: CapabilityId[] = [];
  forceClosed: CapabilityId[] = [];
  nextId = 1;
  async mintSessionGrant(req: { sessionId: string }): Promise<MintedSessionGrantRef> {
    const g: MintedSessionGrantRef = {
      grantId: `cap_g${this.nextId++}` as CapabilityId,
      token: `tok-${req.sessionId}` as OpaqueToken,
      scopePath: `/handoff/${req.sessionId}`,
    };
    this.minted.push(g);
    return g;
  }
  async revoke(id: CapabilityId): Promise<void> {
    this.revoked.push(id);
  }
  forceCloseGrant(grantId: CapabilityId): void {
    this.forceClosed.push(grantId);
  }
}

class StubRoute implements HandoffRoutePort {
  programmed: HandoffId[] = [];
  unmounted: HandoffId[] = [];
  nextId = 1;
  async program(
    window: { id: HandoffId; sessionId: SessionId },
    grantId: CapabilityId,
    capsuleEntrypoint: string,
    path?: string,
  ): Promise<Route> {
    this.programmed.push(window.id);
    return {
      id: `route_${this.nextId++}` as Route["id"],
      path: path ?? `/handoff/${window.sessionId}`,
      internalEndpoint: capsuleEntrypoint,
      boundGrantId: grantId,
    };
  }
  async unmount(windowId: HandoffId): Promise<void> {
    this.unmounted.push(windowId);
  }
}

class StubEntry implements HandoffEntrypointPort {
  async open(_r: RuntimeHandle): Promise<{ internalEndpoint: string }> {
    return { internalEndpoint: ENDPOINT };
  }
}

class StubChannel implements HandoffChannelPort {
  async deliver(_r: RecipientRef, _l: string, _d: OpaqueToken): Promise<void> {}
}

/** A stub Completion service: maps url-watcher raw statuses to envelopes; rejects any OTHER status (S-8). */
class StubCompletion implements CompletionPort {
  calls: RawCompletionSignal[] = [];
  process(signal: RawCompletionSignal, _contract: unknown): CompletionProcessResult {
    this.calls.push(signal);
    if (signal.detector !== "url-watcher") {
      return { ok: false, error: reject(`wrong detector ${signal.detector}`) };
    }
    if (signal.status === "url-intermediate") {
      return {
        ok: true,
        envelope: env("submitted", signal, "email-verification"),
      };
    }
    if (signal.status === "url-complete") {
      return { ok: true, envelope: env("verified", signal) };
    }
    // Any other (spoofed) status is OUT-OF-CONTRACT → rejected (S-8).
    return { ok: false, error: reject(`out-of-contract status ${signal.status}`) };
  }
}

function env(status: string, signal: RawCompletionSignal, next?: string): CompletionEnvelope {
  const e: CompletionEnvelope = { status, detector: signal.detector, at: signal.at };
  if (signal.result !== undefined) {
    e.result = signal.result;
  }
  if (next !== undefined) {
    e.next = next;
  }
  return e;
}

function reject(message: string): GlaError {
  return { code: "state.conflict", message, skill: "interpret-gla-rejections", retryable: false };
}

/** A stub connector-control recording suspend/resume (the S-2 agent-blind enforcement). */
class StubConnectorControl implements ConnectorControlPort {
  suspended: SessionId[] = [];
  resumed: SessionId[] = [];
  suspend(id: SessionId): void {
    this.suspended.push(id);
  }
  resume(id: SessionId): void {
    this.resumed.push(id);
  }
}

/** A manual timer seam so TTL expiry is deterministic (fireAll() triggers the armed callback). */
class ManualTimer {
  private fns: Array<() => void> = [];
  readonly setTimer = (_ms: number, fn: () => void): { clear: () => void } => {
    this.fns.push(fn);
    return {
      clear: () => {
        this.fns = this.fns.filter((f) => f !== fn);
      },
    };
  };
  fireAll(): void {
    const toFire = [...this.fns];
    this.fns = [];
    for (const f of toFire) {
      f();
    }
  }
}

interface Built {
  svc: SessionService;
  sessionId: SessionId;
  cap: StubCap;
  route: StubRoute;
  completion: StubCompletion;
  control: StubConnectorControl;
  timer: ManualTimer;
}

/** Build a SessionService with handoff + completion wired and a LIVE session ready for a handoff. */
function build(opts: { detector?: CompletionDeps["detector"] } = {}): Built {
  const cap = new StubCap();
  const route = new StubRoute();
  const completion = new StubCompletion();
  const control = new StubConnectorControl();
  const timer = new ManualTimer();
  const handoff: HandoffDeps = {
    capability: cap,
    route,
    entrypoint: new StubEntry(),
    channel: new StubChannel(),
    buildLink: (path, token) => `http://gw.local${path}?grant=${token}`,
    setTimer: timer.setTimer,
  };
  const completionDeps: CompletionDeps = {
    completion,
    contractFor: () => ({ detector: "url-watcher" }),
    connectorControl: control,
    ...(opts.detector !== undefined ? { detector: opts.detector } : {}),
    detectorParamsFor: () => ({ complete_on: "/dashboard", intermediate: "/verify" }),
  };
  const svc = new SessionService({ handoff, completion: completionDeps });
  const s = svc.createFromAdmitted(TASK, resolved());
  const session = svc.get(s.id);
  (session as { runtime: RuntimeHandle }).runtime = "rt-1" as RuntimeHandle;
  (session as { state: string }).state = "active";
  return { svc, sessionId: s.id, cap, route, completion, control, timer };
}

function completeSignal(): RawCompletionSignal {
  return {
    status: "url-complete",
    result: { url: "https://acme.example/dashboard", match: "/dashboard" },
    detector: "url-watcher",
    at: AT,
  };
}

describe("SessionService.deliverCompletion — completion CLOSES the window (reverse-of-open; GLA-044/045)", () => {
  it("a validated /dashboard completion: route unmounted, grant revoked, WS force-closed, session back to `active`", async () => {
    const { svc, sessionId, cap, route } = build();
    const view = await svc.openHandoff(sessionId, { reason: "complete form" });
    expect(svc.get(sessionId).state).toBe("opened");
    const grantId = cap.minted[0]?.grantId;

    const res = await svc.deliverCompletion(view.handoff_id, completeSignal());
    expect(res.ok).toBe(true);
    if (res.ok) {
      // handoff wait RETURNS this envelope: {status:"verified", result, …}.
      expect(res.view.state).toBe("completed");
      expect(res.view.completion?.status).toBe("verified");
    }
    // The close = the reverse of open at the SAME seams (GLA-044/045 AC#2/#3):
    expect(cap.forceClosed).toContain(grantId); // the live WS force-closed
    expect(cap.revoked).toContain(grantId); //     the grant revoked (no longer verifies)
    expect(route.unmounted).toContain(view.handoff_id); // the route unmounted (no longer resolves)
    // The session returned to `active` — the capsule is STILL RUNNING (only teardown stops it).
    expect(svc.get(sessionId).state).toBe("active");
    expect(svc.get(sessionId).runtime).toBeDefined(); // the capsule survives the window close
    // The window's grant/route are cleared off the session.
    expect(svc.get(sessionId).grantTokenRef).toBeUndefined();
    expect(svc.get(sessionId).route).toBeUndefined();
  });

  it("the completion envelope is stored on the session + window (handoff wait reads it)", async () => {
    const { svc, sessionId } = build();
    const view = await svc.openHandoff(sessionId);
    await svc.deliverCompletion(view.handoff_id, completeSignal());
    // The window view carries the envelope...
    expect(svc.handoffGet(view.handoff_id).completion?.status).toBe("verified");
    // ...and so does the session aggregate (Session.completion).
    expect(svc.get(sessionId).completion?.status).toBe("verified");
  });

  it("re-open onto the SAME capsule still works after a completion close (the capsule survives)", async () => {
    const { svc, sessionId, cap } = build();
    const h1 = await svc.openHandoff(sessionId);
    await svc.deliverCompletion(h1.handoff_id, completeSignal());
    expect(svc.get(sessionId).state).toBe("active");
    // The SECOND handoff (scenario-01 Phase 11) reuses the SAME capsule — same runtime, new grant + window.
    const h2 = await svc.openHandoff(sessionId, { reason: "enter verification code" });
    expect(h2.handoff_id).not.toBe(h1.handoff_id);
    expect(svc.get(sessionId).state).toBe("opened");
    expect(cap.minted).toHaveLength(2);
  });
});

describe("SessionService.deliverCompletion — OUT-OF-CONTRACT is REJECTED, the window stays open (S-8 / GLA-043)", () => {
  it("a spoofed status is rejected: the window does NOT complete, the session stays `opened`", async () => {
    const { svc, sessionId, cap, route } = build();
    const view = await svc.openHandoff(sessionId);
    const spoofed: RawCompletionSignal = {
      status: "totally-done",
      detector: "url-watcher",
      at: AT,
    };
    const res = await svc.deliverCompletion(view.handoff_id, spoofed);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("state.conflict");
    }
    // The window is STILL open; nothing was revoked/unmounted; the session did NOT advance to completed.
    expect(svc.handoffGet(view.handoff_id).state).toBe("open");
    expect(svc.get(sessionId).state).toBe("opened");
    expect(cap.revoked).toHaveLength(0);
    expect(route.unmounted).toHaveLength(0);
  });

  it("a signal from a DIFFERENT detector is rejected (does not advance the flow)", async () => {
    const { svc, sessionId } = build();
    const view = await svc.openHandoff(sessionId);
    const wrong: RawCompletionSignal = { status: "done", detector: "exit-code", at: AT };
    const res = await svc.deliverCompletion(view.handoff_id, wrong);
    expect(res.ok).toBe(false);
    expect(svc.handoffGet(view.handoff_id).state).toBe("open");
  });
});

describe("SessionService — close-on-EXPIRY releases route + grant the same way (GLA-044/045)", () => {
  it("a window that TTL-EXPIRES without completion closes the same way (route+grant released), NO envelope", async () => {
    const { svc, sessionId, cap, route, timer } = build();
    const view = await svc.openHandoff(sessionId, { ttl: "15m" });
    // Fire the TTL timer (deterministic): the window EXPIRES via the same closeHandoff path (disposition `expired`).
    timer.fireAll();
    await new Promise((r) => setImmediate(r));

    expect(svc.handoffGet(view.handoff_id).state).toBe("expired");
    const grantId = cap.minted[0]?.grantId;
    expect(cap.forceClosed).toContain(grantId); // the live WS force-closed (same as the completion close)
    expect(cap.revoked).toContain(grantId); //     the grant revoked
    expect(route.unmounted).toContain(view.handoff_id); // the route unmounted
    expect(svc.get(sessionId).state).toBe("active"); // the session back to `active`, the capsule still running
    expect(svc.get(sessionId).runtime).toBeDefined();
    // A cancel/expiry close carries NO completion envelope (handoff wait returns exit 6, not an envelope).
    expect(svc.handoffGet(view.handoff_id).completion).toBeUndefined();
  });
});

describe("SessionService — S-2 agent-blind: the connector is SUSPENDED while a window is open, RESUMED on close (GLA-040/041)", () => {
  it("openHandoff SUSPENDS the agent connector; the completion close RESUMES it", async () => {
    const { svc, sessionId, control } = build();
    const view = await svc.openHandoff(sessionId);
    // While the recipient-bound window is open, the agent connector is suspended (the agent cannot read mid-entry).
    expect(control.suspended).toContain(sessionId);
    expect(control.resumed).not.toContain(sessionId);
    // On the completion close the connector resumes (the agent learns the step completed + itself resumes).
    await svc.deliverCompletion(view.handoff_id, completeSignal());
    expect(control.resumed).toContain(sessionId);
  });

  it("a cancel/expiry close ALSO resumes the connector (the agent resumes regardless of disposition)", async () => {
    const { svc, sessionId, control } = build();
    const view = await svc.openHandoff(sessionId);
    expect(control.suspended).toContain(sessionId);
    await svc.cancelHandoff(view.handoff_id);
    expect(control.resumed).toContain(sessionId);
  });
});

describe("SessionService — a wired DETECTOR drives the close automatically (GLA-042/043)", () => {
  it("the detector's emitted /dashboard signal closes the window without an explicit deliverCompletion", async () => {
    // A scripted detector that emits a single in-contract /dashboard complete signal.
    const detector = {
      async *watch(): AsyncIterable<RawCompletionSignal> {
        yield completeSignal();
      },
    };
    const { svc, sessionId } = build({ detector });
    const view = await svc.openHandoff(sessionId);
    // Give the fire-and-forget watch a beat to deliver the signal + close the window.
    await new Promise((r) => setTimeout(r, 30));
    expect(svc.handoffGet(view.handoff_id).state).toBe("completed");
    expect(svc.handoffGet(view.handoff_id).completion?.status).toBe("verified");
    expect(svc.get(sessionId).state).toBe("active");
  });

  it("a NON-FIRING detector does NOT complete the window (it stays open until TTL; GLA-043 AC#3)", async () => {
    // A detector that never emits — `watch` returns an async iterable that yields nothing then completes.
    const detector = {
      watch(): AsyncIterable<RawCompletionSignal> {
        return {
          [Symbol.asyncIterator](): AsyncIterator<RawCompletionSignal> {
            return { next: () => Promise.resolve({ done: true, value: undefined }) };
          },
        };
      },
    };
    const { svc, sessionId } = build({ detector });
    const view = await svc.openHandoff(sessionId);
    await new Promise((r) => setTimeout(r, 30));
    // No false completion — the window is still open (it would TTL-expire, returning exit 6 at the wait surface).
    expect(svc.handoffGet(view.handoff_id).state).toBe("open");
    expect(svc.get(sessionId).state).toBe("opened");
  });
});
