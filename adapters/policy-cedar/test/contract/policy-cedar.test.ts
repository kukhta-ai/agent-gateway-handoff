// CONTRACT test for the Cedar PolicyPort (adapters/policy-cedar, GLA-006).
// The guarantees under contract (kernel-contracts.md §6, test-strategy.md §1.2): the port is pure,
// total, **order-independent**, **deterministic**, **forbid-wins**, and **fails CLOSED** on a policy
// authoring/load error. Negatives covered hard. The real Cedar engine runs here (no mock).

import type { ResolvedAssemblySpec } from "@gla/kernel";
import { HmacCapabilitySigner } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  CedarPolicyAdapter,
  CedarPolicyLoadError,
  MVP_POLICY_SET,
  denyTemplatePolicy,
} from "../../src/index.js";

// A resolved spec factory — only the fields the policy decides over matter here.
function spec(overrides: Partial<ResolvedAssemblySpec["spec"]> = {}): ResolvedAssemblySpec {
  return {
    apiVersion: "gla.dev/v1",
    kind: "Assembly",
    metadata: { intent: "register on acme" },
    spec: {
      template: "browser-handoff",
      // biome-ignore lint/suspicious/noExplicitAny: brand cast for a test recipient ref
      recipient: "tg:user:123" as any,
      ...overrides,
    },
    __resolved: true,
  };
}

// A real (signed) capability principal so the contract test uses no hand-faked principal.
async function principal() {
  const signer = new HmacCapabilitySigner();
  const { capability } = await signer.mint({
    cls: "agent-authority",
    caveats: [{ kind: "authority-profile", profile: "local-single-operator" }],
  });
  return capability;
}

describe("CedarPolicyAdapter — PolicyPort guarantee (GLA-006)", () => {
  it("permits the browser-handoff assembly under the MVP policy set (the local profile base allow, AC#3)", async () => {
    const adapter = new CedarPolicyAdapter();
    const res = adapter.evaluate({
      principal: await principal(),
      action: "admit",
      resource: spec({ template: "browser-handoff" }),
      context: {},
    });
    expect(res.decision).toBe("permit");
    expect(res.reasons).toEqual([]);
  });

  it("FORBID-WINS: a deny policy denies the assembly regardless of a matching permit (AC#2)", async () => {
    const adapter = new CedarPolicyAdapter();
    const res = adapter.evaluate({
      principal: await principal(),
      action: "admit",
      resource: spec({ template: "denied-template" }),
      context: {},
    });
    // Even though `permit(principal, action=="admit", resource)` matches, the forbid wins.
    expect(res.decision).toBe("forbid");
    expect(res.reasons).toContain("policy.denied");
  });

  it("FORBID-WINS is order-independent: the permit listed AFTER the forbid still loses", async () => {
    // Put the forbid first, then the base permit — Cedar forbid-wins is independent of rule order.
    const reordered = [
      denyTemplatePolicy("denied-template"),
      "",
      'permit(principal, action == Action::"admit", resource);',
    ].join("\n");
    const adapter = new CedarPolicyAdapter({ policySet: reordered });
    const denied = adapter.evaluate({
      principal: await principal(),
      action: "admit",
      resource: spec({ template: "denied-template" }),
      context: {},
    });
    const permitted = adapter.evaluate({
      principal: await principal(),
      action: "admit",
      resource: spec({ template: "browser-handoff" }),
      context: {},
    });
    expect(denied.decision).toBe("forbid");
    expect(permitted.decision).toBe("permit");
  });

  it("DETERMINISTIC: identical inputs yield the identical decision twice (AC: same inputs → same decision)", async () => {
    const adapter = new CedarPolicyAdapter();
    const p = await principal();
    const r = spec({ template: "browser-handoff" });
    const a = adapter.evaluate({ principal: p, action: "admit", resource: r, context: {} });
    const b = adapter.evaluate({ principal: p, action: "admit", resource: r, context: {} });
    expect(a).toEqual(b);

    const adapter2 = new CedarPolicyAdapter();
    const p2 = await principal();
    const c = adapter2.evaluate({ principal: p2, action: "admit", resource: r, context: {} });
    const d = adapter2.evaluate({
      principal: p2,
      action: "admit",
      resource: spec({ template: "denied-template" }),
      context: {},
    });
    expect(c.decision).toBe("permit");
    expect(d.decision).toBe("forbid");
  });

  it("the catastrophic rw-mount seatbelt forbids a rw mount on the catastrophic template (docs/04 §6)", async () => {
    const adapter = new CedarPolicyAdapter();
    const res = adapter.evaluate({
      principal: await principal(),
      action: "admit",
      resource: spec({
        template: "catastrophic-rw",
        mounts: [{ host: "/var/run/docker.sock", mode: "rw" }],
      }),
      context: {},
    });
    expect(res.decision).toBe("forbid");
  });

  describe("FAIL-CLOSED on a policy authoring/load error (AC: never fail-open)", () => {
    it("throws CedarPolicyLoadError when the policy set is malformed (default throwOnLoadError)", () => {
      expect(() => new CedarPolicyAdapter({ policySet: "this is not cedar (((" })).toThrowError(
        CedarPolicyLoadError,
      );
    });

    it("arms permanent DENY-ALL when a malformed policy is loaded with throwOnLoadError:false", async () => {
      const adapter = new CedarPolicyAdapter({
        policySet: "permit(this is broken",
        throwOnLoadError: false,
      });
      // A malformed policy set NEVER yields permit — every request is forbidden (fail-closed).
      const res = adapter.evaluate({
        principal: await principal(),
        action: "admit",
        resource: spec({ template: "browser-handoff" }),
        context: {},
      });
      expect(res.decision).toBe("forbid");
      expect(res.reasons).toContain("policy.denied");
    });

    it("an EMPTY policy set forbids by default (no permit → Cedar denies; fail-closed)", async () => {
      const adapter = new CedarPolicyAdapter({ policySet: "// no rules" });
      const res = adapter.evaluate({
        principal: await principal(),
        action: "admit",
        resource: spec(),
        context: {},
      });
      // Cedar's default with no matching permit is deny — which we map to forbid.
      expect(res.decision).toBe("forbid");
    });
  });

  it("adding a deny policy (a NEW rule) changes the decision without changing the port contract (AC#5/#8)", async () => {
    // Same adapter type, same evaluate signature — only the policy STRING differs. Proves a policy
    // swap is an internal substitution that changes no caller.
    const base = new CedarPolicyAdapter({ policySet: MVP_POLICY_SET });
    const withExtraDeny = new CedarPolicyAdapter({
      policySet: `${MVP_POLICY_SET}\n${denyTemplatePolicy("browser-handoff")}`,
    });
    const p = await principal();
    const r = spec({ template: "browser-handoff" });
    expect(
      base.evaluate({ principal: p, action: "admit", resource: r, context: {} }).decision,
    ).toBe("permit");
    expect(
      withExtraDeny.evaluate({ principal: p, action: "admit", resource: r, context: {} }).decision,
    ).toBe("forbid");
  });
});
