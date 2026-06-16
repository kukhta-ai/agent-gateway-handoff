// AC#4 — AssemblySpec offline validation: a well-formed spec passes, and EACH distinct defect is
// reported with its JSON path/location in a SINGLE pass (collect-all, not fail-fast). Includes
// the mounts shape (§3.1).
import { describe, expect, it } from "vitest";
import type { AssemblySpec } from "../../src/assembly.js";
import { validateAssembly } from "../../src/assembly.js";

const WELL_FORMED: AssemblySpec = {
  apiVersion: "gla.dev/v1",
  kind: "Assembly",
  metadata: { intent: "register on acme.example", task: "T" },
  spec: {
    template: "browser-handoff",
    recipient: "tg:user:123" as never,
    detectors: [{ use: "url-watcher", params: { complete_on: "/dashboard" } }],
    mounts: [
      { host: "/home/op/proj/draft.md", target: "/work/draft.md", mode: "rw" },
      { host: "/opt/style-guides", target: "/work/refs", mode: "ro" },
    ],
  },
};

describe("validateAssembly — happy path", () => {
  it("accepts a well-formed minimal spec (with mounts)", () => {
    const r = validateAssembly(WELL_FORMED);
    expect(r.ok).toBe(true);
  });
});

describe("validateAssembly — collects EVERY defect in one pass, each with a JSON path", () => {
  it("reports multiple distinct defects at once (single pass, not fail-fast)", () => {
    const bad = {
      apiVersion: "gla.dev/v2", // wrong version
      kind: "NotAssembly", // wrong kind
      metadata: { intent: "" }, // empty intent
      spec: {
        // template missing
        recipient: "", // empty recipient
        entrypoints: [{ notUse: true }], // PartRef missing `use`
        mounts: [
          { host: "relative/path", mode: "rwx" }, // not absolute + bad mode
          { host: "/a/../b", target: "/work/x" }, // ".." escape
          { host: "/c", target: "/work/x" }, // duplicate target -> conflict
        ],
      },
    };
    const r = validateAssembly(bad);
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    const paths = r.defects.map((d) => d.path);
    // proves single-pass collection: many independent defects surface together
    expect(paths).toContain("apiVersion");
    expect(paths).toContain("kind");
    expect(paths).toContain("metadata.intent");
    expect(paths).toContain("spec.template");
    expect(paths).toContain("spec.recipient");
    expect(paths).toContain("spec.entrypoints[0].use");
    // mount-specific, located by index+field (§3.1)
    expect(paths).toContain("spec.mounts[0].host"); // not absolute
    expect(paths).toContain("spec.mounts[0].mode"); // bad mode
    expect(paths).toContain("spec.mounts[1].host"); // ".." escape
    expect(paths).toContain("spec.mounts[2].target"); // duplicate-target conflict
    expect(r.defects.length).toBeGreaterThanOrEqual(9);
  });

  it("a duplicate mount target carries the mount.conflict code", () => {
    const r = validateAssembly({
      apiVersion: "gla.dev/v1",
      kind: "Assembly",
      metadata: { intent: "x" },
      spec: {
        template: "t",
        recipient: "tg:user:1",
        mounts: [
          { host: "/a", target: "/work/same" },
          { host: "/b", target: "/work/same" },
        ],
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const conflict = r.defects.find((d) => d.path === "spec.mounts[1].target");
      expect(conflict?.code).toBe("mount.conflict");
    }
  });

  it("rejects app infrastructure provider selections from the assembly spec", () => {
    const r = validateAssembly({
      ...WELL_FORMED,
      spec: {
        ...WELL_FORMED.spec,
        auth: { use: "authentik" },
        authProvider: { use: "authentik" },
        channel: { use: "channel-cli" },
        secretStore: { use: "secret-store-reference" },
      },
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.defects.map((d) => d.path)).toEqual(
        expect.arrayContaining([
          "spec.auth",
          "spec.authProvider",
          "spec.channel",
          "spec.secretStore",
        ]),
      );
    }
  });

  it("rejects a non-object input with a $-rooted defect", () => {
    const r = validateAssembly(null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.defects[0]?.path).toBe("$");
    }
  });
});
