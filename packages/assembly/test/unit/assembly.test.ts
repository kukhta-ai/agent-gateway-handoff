// UNIT tests for the AssemblySpec resolver (packages/assembly, GLA-019).
// Covers the MUTATE half of admission (docs/04 §4): template-defaults injection, mount
// canonicalization (default target/mode, `..` collapse), and the load-bearing negative — a malformed
// proposal is rejected at SUBMISSION with a typed error BEFORE admission (GLA-019 AC#4). Pure/offline.

import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecipientRef } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  type AssemblyProposal,
  type TemplateDefaults,
  canonicalizeMountHost,
  resolveAssembly,
  resolveAssemblyOrThrow,
} from "../../src/index.js";

// The browser-handoff template's structural defaults (as admission derives them from the catalog).
const DEFAULTS: TemplateDefaults = {
  template: "browser-handoff",
  launcher: { use: "launcher-process" },
  entrypoints: [{ use: "entrypoint-novnc" }],
  connector: { use: "connector-cdp" },
  workspace: { use: "workspace-profile" },
  detectors: [{ use: "user-done" }],
  ttl: "1h",
};

function proposal(overrides: Partial<AssemblyProposal> = {}): AssemblyProposal {
  return {
    intent: "register on acme",
    template: "browser-handoff",
    recipient: "tg:user:123" as RecipientRef,
    ...overrides,
  };
}

describe("resolveAssembly — MUTATE: template-defaults injection (docs/04 §4)", () => {
  it("fills the structural holes from the template when the agent supplies only {template, recipient}", () => {
    const r = resolveAssembly(proposal(), DEFAULTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.resolved.spec;
    expect(s.launcher).toEqual({ use: "launcher-process" });
    expect(s.entrypoints).toEqual([{ use: "entrypoint-novnc" }]);
    expect(s.connector).toEqual({ use: "connector-cdp" });
    expect(s.workspace).toEqual({ use: "workspace-profile" });
    expect(s.detectors).toEqual([{ use: "user-done" }]);
    expect(s.ttl).toBe("1h"); // template default TTL injected
    expect(r.resolved.__resolved).toBe(true);
  });

  it("the agent's overrides WIN on open parts (a different compatible detector set, a tighter ttl)", () => {
    const r = resolveAssembly(
      proposal({
        ttl: "30m",
        detectors: [
          { use: "user-done" },
          { use: "url-watcher", params: { complete_on: "/dashboard" } },
        ],
      }),
      DEFAULTS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resolved.spec.ttl).toBe("30m");
    expect(r.resolved.spec.detectors).toEqual([
      { use: "user-done" },
      { use: "url-watcher", params: { complete_on: "/dashboard" } },
    ]);
  });

  it("carries the intent + explicit task into metadata; recipient passes through unchanged", () => {
    const r = resolveAssembly(proposal({ task: "task_abc" }), DEFAULTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resolved.metadata).toEqual({ intent: "register on acme", task: "task_abc" });
    expect(r.resolved.spec.recipient).toBe("tg:user:123");
  });
});

describe("resolveAssembly — mount canonicalization (kernel-contracts.md §3.1)", () => {
  it("collapses `..`/`.` to the real absolute path, defaults target=/work/<basename> and mode=ro", () => {
    const r = resolveAssembly(
      proposal({ mounts: [{ host: "/home/op/proj/../proj/draft.md" }] }),
      DEFAULTS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resolved.spec.mounts).toEqual([
      { host: "/home/op/proj/draft.md", target: "/work/draft.md", mode: "ro" },
    ]);
  });

  it("preserves an explicit target + rw mode", () => {
    const r = resolveAssembly(
      proposal({ mounts: [{ host: "/opt/refs", target: "/work/refs", mode: "rw" }] }),
      DEFAULTS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resolved.spec.mounts).toEqual([
      { host: "/opt/refs", target: "/work/refs", mode: "rw" },
    ]);
  });

  it("canonicalizeMountHost collapses traversal segments (unit; non-existent path → lexical)", () => {
    // These paths do not exist, so realpath falls back to the lexical normalize.
    expect(canonicalizeMountHost("/a/b/../c")).toBe("/a/c");
    expect(canonicalizeMountHost("/a/./b")).toBe("/a/b");
    expect(canonicalizeMountHost("/a//b")).toBe("/a/b");
  });

  it("RESOLVES SYMLINKS to the real target (#2): a symlink host canonicalizes to its realpath", () => {
    const dir = mkdtempSync(join(tmpdir(), "gla-asm-"));
    try {
      // realtarget exists; link → realtarget. realpath(link) === realpath(realtarget).
      const target = join(dir, "realtarget");
      writeFileSync(target, "x");
      const link = join(dir, "link");
      symlinkSync(target, link);
      // canonicalizeMountHost(link) must resolve the symlink to the REAL target (not keep the alias),
      // so the downstream allowed-set/denylist check runs on the real path.
      expect(canonicalizeMountHost(link)).toBe(realpathSync(target));

      // And through the resolver: the resolved mount host is the real target.
      const r = resolveAssembly(proposal({ mounts: [{ host: link, mode: "ro" }] }), DEFAULTS);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.resolved.spec.mounts?.[0]?.host).toBe(realpathSync(target));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a symlink to a NON-EXISTENT target falls back to the lexical path (existence is OS-enforced at spawn)", () => {
    const dir = mkdtempSync(join(tmpdir(), "gla-asm-"));
    try {
      const link = join(dir, "dangling");
      symlinkSync(join(dir, "does-not-exist"), link);
      // realpath throws on a dangling symlink → fall back to the lexical (already-absolute) path.
      expect(canonicalizeMountHost(link)).toBe(link);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveAssembly — malformed proposal rejected at SUBMISSION (GLA-019 AC#4)", () => {
  it("a proposal with an EMPTY part `use` is rejected with a typed catalog.unknown, BEFORE admission", () => {
    const r = resolveAssembly(proposal({ detectors: [{ use: "" }] }), DEFAULTS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("catalog.unknown");
    // It carries the offending JSON path (single-pass collect-all).
    expect(r.error.detail).toBeDefined();
  });

  it("a mount whose host is a `..`-escape is rejected as mount.denied (a typed pre-admission error)", () => {
    // After canonicalization a still-relative or escaping host is rejected by the structural validator.
    const r = resolveAssembly(proposal({ mounts: [{ host: "../../etc/shadow" }] }), DEFAULTS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(["mount.denied", "mount.not_found"]).toContain(r.error.code);
  });

  it("a missing required recipient is rejected (policy.denied) — never invented", () => {
    // Force an empty recipient (the channel binding is required, narrow-only).
    const bad = proposal({ recipient: "" as RecipientRef });
    const r = resolveAssembly(bad, DEFAULTS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("policy.denied");
  });

  it("resolveAssemblyOrThrow throws the typed GlaError on a malformed proposal", () => {
    expect(() => resolveAssemblyOrThrow(proposal({ detectors: [{ use: "" }] }), DEFAULTS)).toThrow(
      /register|provider|use/i,
    );
  });
});
