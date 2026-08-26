// surfaces/cli · transport unit tests — the daemon bridge protocol in isolation (no real socket needed for
// the pure parts). Proves: (1) the in-process `AgentBridge` still satisfies the `BridgeLike` seam (so the
// dispatcher runs unchanged); (2) `dispatchBridgeRequest` runs an op on a shared bridge, serializes a typed
// GlaError to the wire (keeping its `code`), and rejects an unknown op; (3) the operator-op surface dispatches
// distinctly; (4) endpoint/local classification parses both uds paths and host:port.

import { AgentBridge } from "@gla/bridge";
import { glaError, isGlaError } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import type { BridgeLike, OperatorOps } from "./transport.js";
import {
  DaemonBridgeClient,
  type DaemonRequest,
  dispatchBridgeRequest,
  endpointIsLocalBridgeEndpoint,
  endpointToConnectTarget,
  errorToWire,
  resolveClientEndpoint,
  throwFromWire,
} from "./transport.js";

describe("transport — BridgeLike seam + wire dispatch (no socket)", () => {
  it("the in-process AgentBridge satisfies BridgeLike (the dispatcher runs over either, unchanged)", () => {
    // A compile-time + runtime check: AgentBridge is assignable to BridgeLike (structural), and its read ops
    // return values the dispatcher can `await` (a sync value is an already-resolved await).
    const bridge: BridgeLike = new AgentBridge();
    expect(typeof bridge.whoami).toBe("function");
    expect(typeof bridge.sessionCreate).toBe("function");
    expect(typeof bridge.handoffWait).toBe("function");
  });

  it("dispatchBridgeRequest runs an op on the SHARED bridge and returns ok+result", async () => {
    const bridge = new AgentBridge();
    const req: DaemonRequest = { id: 1, op: "templateList", args: [] };
    const res = await dispatchBridgeRequest(bridge, req);
    expect(res.id).toBe(1);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.result)).toBe(true);
  });

  it("shared state: a taskCreate then a taskList on the SAME bridge sees the created task", async () => {
    const bridge = new AgentBridge();
    const created = await dispatchBridgeRequest(bridge, {
      id: 1,
      op: "taskCreate",
      args: [{ intent: "x", recipient: "tg:user:1" }],
    });
    expect(created.ok).toBe(true);
    const taskId = (created.result as { task_id: string }).task_id;
    const listed = await dispatchBridgeRequest(bridge, { id: 2, op: "taskList", args: [] });
    const ids = (listed.result as Array<{ task_id: string }>).map((t) => t.task_id);
    expect(ids).toContain(taskId);
  });

  it("a typed GlaError from an op is serialized to a `gla` WireError keeping its code (so the CLI maps the same exit)", async () => {
    const bridge = new AgentBridge();
    // `taskGet` on an unknown id throws state.not_found (→ exit 5).
    const res = await dispatchBridgeRequest(bridge, { id: 7, op: "taskGet", args: ["task_nope"] });
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe("gla");
    expect(res.error?.code).toBe("state.not_found");
  });

  it("an unknown op is a stable usage.unknown_command error, never a crash", async () => {
    const bridge = new AgentBridge();
    const res = await dispatchBridgeRequest(bridge, { id: 9, op: "nuke", args: [] });
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe("gla");
    expect(res.error?.code).toBe("usage.unknown_command");
  });

  it("an OPERATOR op dispatches distinctly from the agent surface", async () => {
    const bridge = new AgentBridge();
    const operators: OperatorOps = {
      enrollInvite: (r) => ({ link: `https://host/enroll?for=${String(r)}` }),
    };
    const res = await dispatchBridgeRequest(
      bridge,
      { id: 3, op: "enrollInvite", args: ["tg:user:1"] },
      operators,
    );
    expect(res.ok).toBe(true);
    expect((res.result as { link: string }).link).toContain("/enroll");
  });

  it("errorToWire / throwFromWire round-trips a typed GlaError (code + detail preserved)", () => {
    const original = glaError("policy.denied", "nope", { detail: { dependency: "vault" } });
    const wire = errorToWire(original);
    expect(wire.kind).toBe("gla");
    expect(wire.code).toBe("policy.denied");
    expect(wire.detail).toEqual({ dependency: "vault" });
    try {
      throwFromWire(wire);
      expect.unreachable("throwFromWire must throw");
    } catch (e) {
      expect(isGlaError(e)).toBe(true);
      if (isGlaError(e)) {
        expect(e.code).toBe("policy.denied");
        expect(e.detail).toEqual({ dependency: "vault" });
      }
    }
  });

  it("a non-coded error serializes to an internal WireError and throws a bare Error", () => {
    const wire = errorToWire(new Error("boom"));
    expect(wire.kind).toBe("internal");
    expect(() => throwFromWire(wire)).toThrow("boom");
  });

  it("endpointToConnectTarget parses a uds PATH vs a host:port", () => {
    expect(endpointToConnectTarget("/run/gla.sock")).toEqual({ path: "/run/gla.sock" });
    expect(endpointToConnectTarget("127.0.0.1:7423")).toEqual({ host: "127.0.0.1", port: 7423 });
    // A bare path with no port stays a path.
    expect(endpointToConnectTarget("/tmp/x/gla.sock")).toEqual({ path: "/tmp/x/gla.sock" });
  });

  it("endpointIsLocalBridgeEndpoint allows Unix sockets and loopback TCP, and refuses URLs/public hosts", () => {
    expect(endpointIsLocalBridgeEndpoint("/run/gla.sock")).toBe(true);
    expect(endpointIsLocalBridgeEndpoint("127.0.0.1:7423")).toBe(true);
    expect(endpointIsLocalBridgeEndpoint("[::1]:7423")).toBe(true);
    expect(endpointIsLocalBridgeEndpoint("localhost:7423")).toBe(true);
    expect(endpointIsLocalBridgeEndpoint("0.0.0.0:7423")).toBe(false);
    expect(endpointIsLocalBridgeEndpoint("10.0.0.8:7423")).toBe(false);
    expect(endpointIsLocalBridgeEndpoint("https://gla.example/bridge")).toBe(false);
  });

  it("DaemonBridgeClient refuses non-local endpoints before connecting and redacts secret-shaped diagnostics", async () => {
    const endpoint =
      "https://gla.example/handoff/sess_1?grant=BRIDGE_GRANT_CANARY_090&secret=RAW_SECRET_CANARY_090";
    await expect(DaemonBridgeClient.connect(endpoint)).rejects.toMatchObject({
      code: "usage.bad_argument",
    });
    await expect(DaemonBridgeClient.connect(endpoint)).rejects.not.toThrow(
      /BRIDGE_GRANT_CANARY_090|RAW_SECRET_CANARY_090/,
    );
    await expect(DaemonBridgeClient.connect("10.0.0.8:7423")).rejects.toMatchObject({
      code: "usage.bad_argument",
    });
  });

  it("resolveClientEndpoint reads GLA_ENDPOINT (set) else undefined", () => {
    expect(resolveClientEndpoint({ GLA_ENDPOINT: "/run/gla.sock" } as NodeJS.ProcessEnv)).toBe(
      "/run/gla.sock",
    );
    expect(resolveClientEndpoint({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resolveClientEndpoint({ GLA_ENDPOINT: "" } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
