// Integration tests for the Agent Bridge read surface + connect (packages/bridge). Proves:
//  - connect() anchors the agent and returns the allowed-ops set (GLA-015 AC#2).
//  - whoami/template/skill/catalog reads are side-effect-free — no task/session state moves
//    (GLA-015 AC#3, GLA-017 AC#4).
//  - end-to-end orientation: connect → whoami → template show → catalog list (GLA-016 AC#4).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CatalogService, defaultStoreContent } from "@gla/catalog";
import { describe, expect, it } from "vitest";
import { AgentBridge, type StateStores } from "./index.js";

/** A state-store spy that counts snapshots and lets a test compare before/after byte-for-byte. */
function spyState(): StateStores & { snapshots: number } {
  const stores = { tasks: [] as unknown[], sessions: [] as unknown[] };
  return {
    snapshots: 0,
    snapshot() {
      this.snapshots++;
      return { tasks: [...stores.tasks], sessions: [...stores.sessions] };
    },
  };
}

describe("AgentBridge.connect — agent-authority anchor (GLA-015 AC#2)", () => {
  it("issues an anchor and returns the operations it allows", async () => {
    const bridge = new AgentBridge();
    const connected = await bridge.connect();
    expect(connected.token).toBeTruthy();
    expect(connected.identity).toBe("agent:local");
    expect(connected.authority_profile).toBe("local-single-operator");
    // The agent learns what it may do — the allowed-ops caveat.
    expect(connected.allowed_ops).toEqual(expect.arrayContaining(["whoami", "session.create"]));
  });

  it("whoami over the issued anchor returns identity + allowed ops as JSON (GLA-017 AC#1)", async () => {
    const bridge = new AgentBridge();
    const { token } = await bridge.connect();
    const who = bridge.whoami(token);
    expect(JSON.parse(JSON.stringify(who))).toEqual({
      identity: "agent:local",
      authority_profile: "local-single-operator",
      allowed_ops: who.allowed_ops,
    });
  });
});

describe("orientation reads change no task/session state (GLA-015 AC#3, GLA-017 AC#4)", () => {
  it("connect + every orient read leaves the task/session stores byte-identical", async () => {
    const state = spyState();
    const bridge = new AgentBridge({ state });
    const before = bridge.stateSnapshot();

    const { token } = await bridge.connect();
    bridge.whoami(token);
    bridge.templateList();
    bridge.templateShow("browser-handoff");
    bridge.skillList();
    bridge.skillShow("browser-handoff");
    bridge.catalogList();
    bridge.catalogList({ available: true });

    const after = bridge.stateSnapshot();
    // No task/session state moved across connect + all orient reads.
    expect(after).toEqual(before);
    expect(after).toEqual({ tasks: [], sessions: [] });
  });
});

describe("end-to-end orientation (GLA-016 AC#4)", () => {
  it("connect → whoami → template show → catalog list, against the seeded install", async () => {
    const bridge = new AgentBridge();
    const { token } = await bridge.connect();

    // whoami
    expect(bridge.whoami(token).identity).toBe("agent:local");

    // template show: required parts + each backing dependency binding status
    const show = bridge.templateShow("browser-handoff");
    expect(show.requiredParts).toContain("launcher");
    const launcher = show.parts.find((p) => p.part === "launcher");
    expect(launcher?.provider).toBe("launcher-process");
    expect(launcher?.dependencies?.[0]?.status).toBe("bound");

    // catalog list: only available, system-derived
    const available = bridge.catalogList({ available: true });
    expect(available.every((e) => e.available)).toBe(true);
    expect(available.map((e) => e.name)).toContain("launcher-process");

    // template list filters to templates
    expect(bridge.templateList().map((e) => e.name)).toEqual(["browser-handoff"]);
  });

  it("template show of an unknown id throws catalog.unknown (the CLI maps to exit 5)", async () => {
    const bridge = new AgentBridge();
    expect(() => bridge.templateShow("nope")).toThrowError(/unknown template/i);
  });

  it("a system-derived unavailable part removes the template from the available view", () => {
    const catalog = new CatalogService({
      content: defaultStoreContent(),
      probes: { "launcher-process": () => "unavailable" },
    });
    const bridge = new AgentBridge({ catalog });
    const availableNames = bridge.catalogList({ available: true }).map((e) => e.name);
    expect(availableNames).not.toContain("launcher-process");
    expect(availableNames).not.toContain("browser-handoff");
  });
});

describe("import boundary: the Bridge imports no channel adapter (GLA-015 AC#4)", () => {
  it("bridge/src/index.ts has no `import ... from '@gla/channel-*'` (only `app` may)", () => {
    // vitest transforms TS in place, so import.meta.url points at this .ts test; the sibling source
    // is index.ts in the same dir.
    const indexTs = fileURLToPath(new URL("./index.ts", import.meta.url));
    const src = readFileSync(indexTs, "utf8");
    // A real import statement naming a channel adapter would violate the seam — a 2nd channel is
    // added behind the ChannelPort and injected at `app`, never imported by the edge/core.
    const importsChannelAdapter = /import[^;]*from\s*["']@gla\/channel-/.test(src);
    expect(importsChannelAdapter).toBe(false);
  });
});
