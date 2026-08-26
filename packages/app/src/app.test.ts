// INTEGRATION test for the composition root (packages/app, Slice 2): the **real Cedar PolicyPort**
// wired into admission, exercised end-to-end through the `gla` CLI `run()`. This is the one place the
// Cedar adapter meets the kernel PolicyPort — proving the propose+admit thread works on real Cedar
// (forbid-wins) and that the boundary holds (the bridge/CLI never import policy-cedar; only app does).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { referenceWpmDependencyBindings } from "@gla/catalog";
import { run } from "@gla/cli";
import { Output, type OutputStreams } from "@gla/cli";
import { MVP_POLICY_SET, denyTemplatePolicy } from "@gla/policy-cedar";
import { describe, expect, it } from "vitest";
import { createBridge } from "./index.js";

function readyBridge(opts: Parameters<typeof createBridge>[0] = {}) {
  return createBridge({ dependencyBindings: referenceWpmDependencyBindings(), ...opts });
}

function capture(): { out: Output; stdout: () => string; stderr: () => string } {
  const o: string[] = [];
  const e: string[] = [];
  const streams: OutputStreams = {
    stdout: { write: (s) => void o.push(s), isTTY: false },
    stderr: { write: (s) => void e.push(s), isTTY: false },
  };
  return { out: new Output("json", streams), stdout: () => o.join(""), stderr: () => e.join("") };
}

const OK_ASSEMBLY = {
  apiVersion: "gla.dev/v1",
  kind: "Assembly",
  metadata: { intent: "register on acme" },
  spec: {
    template: "browser-handoff",
    recipient: "tg:user:123",
    detectors: [
      { use: "user-done" },
      { use: "url-watcher", params: { complete_on: "/dashboard" } },
    ],
  },
};

function specFile(doc: unknown): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gla-app-"));
  const path = join(dir, "assembly.json");
  writeFileSync(path, JSON.stringify(doc));
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("composition root — real Cedar admission through the CLI (Slice 2)", () => {
  it("ACCEPTS a valid browser-handoff proposal under the MVP Cedar policy (exit 0)", async () => {
    const { path, cleanup } = specFile(OK_ASSEMBLY);
    try {
      const bridge = readyBridge(); // real CedarPolicyAdapter + MVP_POLICY_SET
      const c = capture();
      const code = await run(["session", "create", "-f", path, "--dry-run"], c.out, { bridge });
      expect(code).toBe(0);
      expect(JSON.parse(c.stdout()).decision).toBe("accept");
    } finally {
      cleanup();
    }
  });

  it('#6: `{ "use": "url-watcher" }` RESOLVES through the real catalog; the old `detector-url` no longer does', async () => {
    // url-watcher (the docs/05 §6 + GLA-066 use-name) resolves and accepts.
    const ok = specFile(OK_ASSEMBLY);
    try {
      const c = capture();
      expect(
        await run(["session", "create", "-f", ok.path, "--dry-run"], c.out, {
          bridge: readyBridge(),
        }),
      ).toBe(0);
      expect(JSON.parse(c.stdout()).decision).toBe("accept");
    } finally {
      ok.cleanup();
    }
    // The pre-rename name `detector-url` is no longer the registered provider, so an override with it
    // is REJECTED (it is not in the template's compatible detector set: `url-watcher`/`user-done`).
    // The compatibility check (#4) fires first → policy.denied (exit 3). Either way the old name fails.
    const old = specFile({
      ...OK_ASSEMBLY,
      spec: {
        ...OK_ASSEMBLY.spec,
        detectors: [{ use: "detector-url", params: { complete_on: "/dashboard" } }],
      },
    });
    try {
      const c = capture();
      const code = await run(["session", "create", "-f", old.path, "--dry-run"], c.out, {
        bridge: readyBridge(),
      });
      expect(code).toBe(3);
      expect(JSON.parse(c.stderr()).error.code).toBe("policy.denied");
    } finally {
      old.cleanup();
    }
  });

  it("FORBID-WINS through real Cedar: a denied template → policy.denied → exit 3", async () => {
    const { path, cleanup } = specFile(OK_ASSEMBLY);
    try {
      // A registered template (browser-handoff) that the policy FORBIDS — proves real Cedar
      // forbid-wins drives the CLI's exit code (3), end-to-end.
      const policySet = `${MVP_POLICY_SET}\n${denyTemplatePolicy("browser-handoff")}`;
      const bridge = readyBridge({ policySet });
      const c = capture();
      const code = await run(["session", "create", "-f", path, "--dry-run"], c.out, { bridge });
      expect(code).toBe(3);
      expect(JSON.parse(c.stderr()).error.code).toBe("policy.denied");
    } finally {
      cleanup();
    }
  });

  it("real run dispatches a Session in `issued` under real Cedar (no spawn — Slice 3)", async () => {
    const { path, cleanup } = specFile(OK_ASSEMBLY);
    try {
      const bridge = readyBridge();
      const c = capture();
      const code = await run(["session", "create", "-f", path], c.out, { bridge });
      expect(code).toBe(0);
      const out = JSON.parse(c.stdout());
      expect(out.session_id).toMatch(/^sess_/);
      expect(out.state).toBe("issued");
    } finally {
      cleanup();
    }
  });

  it("createApp() records the Cedar policy adapter in the wiring", () => {
    // (Sanity: the wiring still names policy-cedar — the adapter app injects behind the PolicyPort.)
    // Imported lazily to keep this test focused; createApp is the wiring record.
    return import("./index.js").then(({ createApp }) => {
      expect(createApp().wiring.policy).toBe("@gla/policy-cedar");
    });
  });
});
