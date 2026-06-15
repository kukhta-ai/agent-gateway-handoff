// UNIT tests for the Completion service (packages/completion) — GLA-042/043, S-8.
// validate(rawSignal, contract) checks the signal's shape vs the declared detector contract; normalize maps a
// VALID signal to a stable CompletionEnvelope {status, result, next?}. The HEADLINE invariant: an OUT-OF-CONTRACT
// signal is REJECTED (not normalized) — the window does NOT complete (S-8). Pure: no I/O, no clock.

import type { ConfigSchema, Iso8601, RawCompletionSignal } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { CompletionService, type DetectorContract } from "../../src/index.js";

const AT = "2026-06-03T00:00:00.000Z" as Iso8601;

function objectSchema(
  properties: NonNullable<ConfigSchema["properties"]>,
  required: string[] = [],
): ConfigSchema {
  return {
    type: "object",
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
    properties,
  };
}

/** The scenario-01 url-watcher contract: `url-intermediate` → submitted+next; `url-complete` → verified. */
function urlWatcherContract(): DetectorContract {
  return {
    detector: "url-watcher",
    statuses: {
      "url-intermediate": { status: "submitted", next: "email-verification" },
      "url-complete": { status: "verified" },
    },
    resultSchema: objectSchema({ url: { type: "string" }, match: { type: "string" } }, ["url"]),
  };
}

function signal(over: Partial<RawCompletionSignal> = {}): RawCompletionSignal {
  return {
    status: "url-complete",
    result: { url: "https://acme.example/dashboard", match: "/dashboard" },
    detector: "url-watcher",
    at: AT,
    ...over,
  };
}

describe("CompletionService.validate + normalize — in-contract signals (GLA-042)", () => {
  it("a /dashboard complete signal validates and normalizes to {status:verified}", () => {
    const svc = new CompletionService();
    const contract = urlWatcherContract();
    const sig = signal();
    expect(svc.validate(sig, contract)).toEqual({ ok: true });
    const env = svc.normalize(sig, contract);
    expect(env.status).toBe("verified");
    expect(env.detector).toBe("url-watcher");
    expect(env.result).toEqual({ url: "https://acme.example/dashboard", match: "/dashboard" });
    expect(env.at).toBe(AT);
    expect(env.next).toBeUndefined(); // the complete status carries no `next`
  });

  it("a /verify intermediate signal normalizes to {status:submitted, next:email-verification}", () => {
    const svc = new CompletionService();
    const contract = urlWatcherContract();
    const sig = signal({
      status: "url-intermediate",
      result: { url: "https://acme.example/verify", match: "/verify" },
    });
    const processed = svc.process(sig, contract);
    expect(processed.ok).toBe(true);
    if (processed.ok) {
      expect(processed.envelope.status).toBe("submitted");
      expect(processed.envelope.next).toBe("email-verification");
    }
  });

  it("the envelope shape is STABLE across detectors (a different detector, same envelope keys)", () => {
    const svc = new CompletionService();
    const userDoneContract: DetectorContract = {
      detector: "user-done",
      statuses: { done: { status: "submitted" } },
    };
    const env = svc.normalize({ status: "done", detector: "user-done", at: AT }, userDoneContract);
    // Same stable envelope keys regardless of detector (kernel-contracts.md §1.6 invariant).
    expect(Object.keys(env).sort()).toEqual(["at", "detector", "status"]);
    expect(env.status).toBe("submitted");
  });
});

describe("CompletionService — OUT-OF-CONTRACT is REJECTED, never normalized (S-8 / GLA-043)", () => {
  it("a status NOT in the contract is rejected (a spoofed 'done' cannot advance the flow)", () => {
    const svc = new CompletionService();
    const contract = urlWatcherContract();
    // A spoofed status the contract does not admit.
    const spoofed = signal({ status: "totally-done", result: { url: "x", match: "y" } });
    const v = svc.validate(spoofed, contract);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.error.code).toBe("state.conflict");
      expect(v.error.message).toContain("not in the detector contract");
    }
    // process() never yields an envelope for it.
    const processed = svc.process(spoofed, contract);
    expect(processed.ok).toBe(false);
    // normalize() defensively throws rather than fabricating an envelope for an out-of-contract status.
    expect(() => svc.normalize(spoofed, contract)).toThrowError(/out-of-contract/);
  });

  it("a signal from a DIFFERENT detector than declared is rejected", () => {
    const svc = new CompletionService();
    const contract = urlWatcherContract();
    const wrongDetector = signal({ detector: "exit-code" });
    const v = svc.validate(wrongDetector, contract);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.error.code).toBe("state.conflict");
      expect(v.error.message).toContain("does not match the declared detector");
    }
  });

  it("a signal whose RESULT shape violates the contract's resultSchema is rejected (malformed result)", () => {
    const svc = new CompletionService();
    const contract = urlWatcherContract();
    // `url` is required + must be a string; here it is missing AND an unknown field is present.
    const badResult = signal({ result: { wrong: 123 } as Record<string, unknown> });
    const v = svc.validate(badResult, contract);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.error.code).toBe("state.conflict");
      expect(v.error.message).toContain("out-of-contract");
    }
    expect(svc.process(badResult, contract).ok).toBe(false);
  });

  it("with no resultSchema declared, the result is passed through verbatim (no false rejection)", () => {
    const svc = new CompletionService();
    const contract: DetectorContract = {
      detector: "url-watcher",
      statuses: { "url-complete": { status: "verified" } },
    };
    const sig = signal({ result: { anything: { nested: true } } as Record<string, unknown> });
    const processed = svc.process(sig, contract);
    expect(processed.ok).toBe(true);
    if (processed.ok) {
      expect(processed.envelope.result).toEqual({ anything: { nested: true } });
    }
  });
});
