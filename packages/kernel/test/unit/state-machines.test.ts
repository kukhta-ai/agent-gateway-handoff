// AC#1 — core entities have state machines; an INVALID transition throws a typed,
// machine-distinguishable error (a discriminated `state.conflict` with a stable `code`), never a
// bare Error. Covers Task, Session (the canonical 8-state chain), and Handoff machines.
import { describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../src/errors.js";
import { GlaErrorException } from "../../src/errors.js";
import {
  assertCompletionInContract,
  canSessionTransition,
  handoffTransition,
  sessionTransition,
  taskTransition,
} from "../../src/state-machines.js";

describe("Task state machine (§1.1)", () => {
  it("allows active → completed | revoked | failed", () => {
    expect(taskTransition("active", "completed")).toBe("completed");
    expect(taskTransition("active", "revoked")).toBe("revoked");
    expect(taskTransition("active", "failed")).toBe("failed");
  });

  it("throws a typed state.conflict (not a bare Error) leaving a terminal state", () => {
    try {
      taskTransition("completed", "active");
      throw new Error("expected throw");
    } catch (e) {
      // machine-distinguishable: it is OUR typed error, with a stable namespaced code
      expect(e).toBeInstanceOf(GlaErrorException);
      const err = e as GlaErrorException;
      expect(err.code).toBe("state.conflict");
      expect(err.constructor).toBe(GlaErrorException); // NOT a bare Error
      expect(err.detail).toMatchObject({ machine: "task", from: "completed", to: "active" });
      // and the code maps to the documented exit code 7
      expect(exitCodeFor(err.code)).toBe(ExitCode.CONFLICT);
    }
  });
});

describe("Session state machine (§1.2 canonical chain)", () => {
  it("walks proposed → issued → opened → active → completed", () => {
    expect(sessionTransition("proposed", "issued")).toBe("issued");
    expect(sessionTransition("issued", "opened")).toBe("opened");
    // a window closing returns opened → active (does NOT kill the capsule)
    expect(sessionTransition("opened", "active")).toBe("active");
    // active may re-open a window (scenario-01's second handoff = same capsule)
    expect(sessionTransition("active", "opened")).toBe("opened");
    expect(sessionTransition("active", "completed")).toBe("completed");
  });

  it("permits revoked|expired|failed from any live state", () => {
    expect(sessionTransition("issued", "revoked")).toBe("revoked");
    expect(sessionTransition("opened", "expired")).toBe("expired");
    expect(sessionTransition("active", "failed")).toBe("failed");
  });

  it("rejects an illegal jump (proposed → completed) with a typed code", () => {
    expect(() => sessionTransition("proposed", "completed")).toThrowError(GlaErrorException);
    expect(canSessionTransition("proposed", "completed")).toBe(false);
    try {
      sessionTransition("proposed", "active");
    } catch (e) {
      expect((e as GlaErrorException).code).toBe("state.conflict");
    }
  });
});

describe("Handoff window state machine (§1.3)", () => {
  it("allows open → completed | expired | cancelled", () => {
    expect(handoffTransition("open", "completed")).toBe("completed");
    expect(handoffTransition("open", "expired")).toBe("expired");
    expect(handoffTransition("open", "cancelled")).toBe("cancelled");
  });

  it("rejects a transition out of a terminal handoff state", () => {
    expect(() => handoffTransition("completed", "open")).toThrowError(GlaErrorException);
  });
});

describe("Completion signal admission (§1.6)", () => {
  it("rejects an out-of-contract (spoofed) done signal — fail closed", () => {
    // empty contract admits nothing
    expect(() => assertCompletionInContract("submitted", [])).toThrowError(GlaErrorException);
    // a status not in the contract is rejected
    expect(() => assertCompletionInContract("hacked", ["submitted", "verified"])).toThrow();
    // an in-contract status passes
    expect(() => assertCompletionInContract("verified", ["submitted", "verified"])).not.toThrow();
  });
});
