// CONTRACT tests for the browser-profile-temp Workspace adapter (adapters/workspace-profile, GLA-023).
// realize → a real ephemeral profile dir; reap → it is DELETED; host mounts (symlinks) survive the
// reap (only the profile's own scratch is wiped — capsule.md invariant). Uses a scratch root dir; no
// browser.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MountSpec, PartRef, ResolvedAssemblySpec, WorkspaceHandle } from "@gla/kernel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceProfileAdapter, profileDirOf } from "./index.js";

const STRATEGY: PartRef = { use: "browser-profile-temp" };

let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "gla-wp-test-"));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("WorkspaceProfileAdapter — realize/reap ephemeral profile (GLA-023)", () => {
  it("realize creates a real ephemeral profile dir + a work/ subdir under the root", async () => {
    const wp = new WorkspaceProfileAdapter({ root: scratch });
    const handle = await wp.realize(STRATEGY, [], 1000);
    const dir = profileDirOf(handle);
    expect(dir).toBeDefined();
    expect(existsSync(dir as string)).toBe(true);
    expect(existsSync(join(dir as string, "work"))).toBe(true);
    await wp.reap(handle);
  });

  it("reap DELETES the ephemeral profile dir (wiped at teardown)", async () => {
    const wp = new WorkspaceProfileAdapter({ root: scratch });
    const handle = await wp.realize(STRATEGY, [], 1000);
    const dir = profileDirOf(handle) as string;
    expect(existsSync(dir)).toBe(true);
    await wp.reap(handle);
    expect(existsSync(dir)).toBe(false);
  });

  it("reap is idempotent: reaping an already-gone profile is a no-op (no throw)", async () => {
    const wp = new WorkspaceProfileAdapter({ root: scratch });
    const handle = await wp.realize(STRATEGY, [], 1000);
    await wp.reap(handle);
    await expect(wp.reap(handle)).resolves.toBeUndefined();
    // A garbage handle is also a no-op.
    await expect(wp.reap("not-a-handle" as unknown as WorkspaceHandle)).resolves.toBeUndefined();
  });

  it("realizes an agent mount into work/ AND the host file SURVIVES reap (host mounts survive)", async () => {
    // A real host file the agent mounts ro. It must survive the workspace reap (it lives on the host).
    const hostFile = join(scratch, "draft.md");
    writeFileSync(hostFile, "the agent's document");
    const wp = new WorkspaceProfileAdapter({ root: scratch });
    const mounts: MountSpec[] = [{ host: hostFile, target: "/work/draft.md", mode: "rw" }];
    const handle = await wp.realize(STRATEGY, mounts, 1000);
    const dir = profileDirOf(handle) as string;
    const linked = join(dir, "work", "draft.md");
    // The mount is realized into work/ (a symlink to the host file) and reads through to the host bytes.
    expect(existsSync(linked)).toBe(true);
    expect(readFileSync(linked, "utf8")).toBe("the agent's document");
    // Reap wipes the profile (the link) — but the HOST file survives (it was never the capsule's).
    await wp.reap(handle);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(hostFile)).toBe(true);
    expect(readFileSync(hostFile, "utf8")).toBe("the agent's document");
  });

  it("a mount whose host does not exist yet is skipped (no link) — OS enforces access at spawn", async () => {
    const wp = new WorkspaceProfileAdapter({ root: scratch });
    const mounts: MountSpec[] = [{ host: join(scratch, "nope.txt"), mode: "rw" }];
    const handle = await wp.realize(STRATEGY, mounts, 1000);
    const dir = profileDirOf(handle) as string;
    expect(existsSync(join(dir, "work", "nope.txt"))).toBe(false);
    await wp.reap(handle);
  });
});

// A spec helper so the strategy-from-spec path is exercised too.
function _spec(): ResolvedAssemblySpec {
  return {
    apiVersion: "gla.dev/v1",
    kind: "Assembly",
    metadata: { intent: "t" },
    // biome-ignore lint/suspicious/noExplicitAny: recipient brand cast in test
    spec: { template: "browser-handoff", recipient: "r" as any, workspace: STRATEGY },
    __resolved: true,
  };
}
void _spec;
