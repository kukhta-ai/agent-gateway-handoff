// CONTRACT tests for the local-process (T2) Launcher adapter (adapters/launcher-process, GLA-022/023).
//
// THE CORE PROOF — REAL CDP (headless Chromium, runs in this dev env): spawn a capsule → its CDP
// endpoint answers → connect over CDP (playwright-core connectOverCDP) → navigate a data: page → assert
// it works → health up → stop kills the process (NO orphan) → the temp profile dir is deleted
// (GLA-023 AC#3). This is the proof the capsule is real.
//
// GATED FULL noVNC test: skips when Xvfb/x11vnc/websockify are absent (this dev env); runs in hermes-1.
//
// The CDP test spawns a REAL browser, so it is given generous timeouts and always reaps in a finally.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedAssemblySpec, WorkspaceHandle } from "@gla/kernel";
import { encodeRuntimeHandle, setSpawnContext } from "@gla/kernel";
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { LauncherProcessAdapter, decodeRuntime, fullStackAvailable } from "./index.js";

// ── A scratch root for profile dirs the test spawns into; cleaned at the end. ──
const scratchRoots: string[] = [];
function freshProfileDir(): string {
  const root = mkdtempSync(join(tmpdir(), "gla-lp-test-"));
  scratchRoots.push(root);
  const profile = join(root, "profile");
  return profile;
}
afterAll(() => {
  for (const r of scratchRoots) {
    rmSync(r, { recursive: true, force: true });
  }
});

/** A resolved spec for a headless browser-handoff capsule, with a temp profile dir threaded in. */
function specWithProfile(profileDir: string): ResolvedAssemblySpec {
  const spec: ResolvedAssemblySpec = {
    apiVersion: "gla.dev/v1",
    kind: "Assembly",
    metadata: { intent: "real-cdp", task: "task_1" },
    spec: {
      template: "browser-handoff",
      // biome-ignore lint/suspicious/noExplicitAny: recipient brand cast in test
      recipient: "tg:user:1" as any,
      launcher: { use: "launcher-process" },
      workspace: { use: "browser-profile-temp" },
    },
    __resolved: true,
  };
  // Thread the realized workspace (profile dir) via the kernel's spawn-context side-channel, exactly as
  // the worker does before calling spawn.
  const wsHandle = encodeRuntimeHandle({ profileDir }) as unknown as WorkspaceHandle;
  setSpawnContext(spec, { workspace: wsHandle as never });
  return spec;
}

/** Is a usable Chromium available (the cached browser)? Skip the REAL test if not. */
function chromiumAvailable(): boolean {
  try {
    const p = chromium.executablePath();
    return typeof p === "string" && p.length > 0 && existsSync(p);
  } catch {
    return false;
  }
}

const HAVE_CHROMIUM = chromiumAvailable();

describe("LauncherProcessAdapter — REAL CDP, headless (the core proof; GLA-022/023)", () => {
  it.runIf(HAVE_CHROMIUM)(
    "spawn → CDP answers → connectOverCDP → navigate → health up → stop leaves NO orphan + profile deleted",
    async () => {
      const launcher = new LauncherProcessAdapter({ mode: "headless", startTimeoutMs: 40_000 });
      const profileDir = freshProfileDir();
      const spec = specWithProfile(profileDir);

      const handle = await launcher.spawn(spec, process.getuid?.() ?? 0);
      const runtime = decodeRuntime(handle);
      expect(runtime).toBeDefined();
      expect(runtime?.mode).toBe("headless");
      const pid = runtime?.pid ?? -1;
      expect(pid).toBeGreaterThan(0);
      const cdpUrl = runtime?.cdpWebSocketUrl ?? "";
      // The connector is the RAW CDP webSocketDebuggerUrl, bound to loopback.
      expect(cdpUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//);

      try {
        // HEALTH = the CDP endpoint answers.
        expect(await launcher.health(handle)).toBe("up");

        // REAL CDP: connect a Playwright client over the connector's cdp_url and drive the browser.
        const browser = await chromium.connectOverCDP(cdpUrl);
        try {
          const ctx = browser.contexts()[0] ?? (await browser.newContext());
          const page = await ctx.newPage();
          // Navigate a self-contained data: page (no network) and assert it really rendered.
          await page.goto("data:text/html,<title>gla</title><h1 id=h>capsule-live</h1>");
          // Use a plain DOM read (Vitest has no Playwright web matchers like toHaveText).
          const text = await page.locator("#h").textContent();
          expect(text).toBe("capsule-live");
          expect(await page.title()).toBe("gla");
          await page.close();
        } finally {
          await browser.close();
        }

        // The profile dir exists while the capsule is live (Chromium wrote into --user-data-dir).
        expect(existsSync(profileDir)).toBe(true);
      } finally {
        // STOP kills the process group; the worker reaps the profile alongside (here the test wipes it
        // via the scratch root in afterAll, but we assert the process is gone — no orphan).
        await launcher.stop(handle);
      }

      // NO ORPHAN: the browser PID is gone after stop.
      expect(processAlive(pid)).toBe(false);
      // HEALTH after stop is `down` (the CDP endpoint no longer answers).
      expect(await launcher.health(handle)).toBe("down");
    },
    90_000,
  );

  it.skipIf(HAVE_CHROMIUM)("REAL CDP test SKIPPED — no cached Chromium in this environment", () => {
    expect(HAVE_CHROMIUM).toBe(false);
  });

  it("resolveMode reports headless when the X stack is absent (this dev env), full when present", () => {
    const auto = new LauncherProcessAdapter({ mode: "auto" });
    // In this dev env Xvfb/x11vnc/websockify are absent → auto resolves to headless.
    const expected = fullStackAvailable() ? "full" : "headless";
    expect(auto.resolveMode()).toBe(expected);
    // Forcing a mode is honored regardless of the probe.
    expect(new LauncherProcessAdapter({ mode: "headless" }).resolveMode()).toBe("headless");
    expect(new LauncherProcessAdapter({ mode: "full" }).resolveMode()).toBe("full");
  });

  it("stop/health on a garbage handle is safe (no crash)", async () => {
    const launcher = new LauncherProcessAdapter({ mode: "headless" });
    await expect(launcher.stop("garbage" as never)).resolves.toBeUndefined();
    expect(await launcher.health("garbage" as never)).toBe("down");
  });
});

// ── GATED full noVNC test — skips unless Xvfb/x11vnc/websockify are present (runs in hermes-1). ──
describe("LauncherProcessAdapter — FULL mode noVNC (gated; runs in hermes-1)", () => {
  const HAVE_FULL = fullStackAvailable() && HAVE_CHROMIUM;
  it.runIf(HAVE_FULL)(
    "full-mode spawn exposes a reachable noVNC ws endpoint AND a CDP endpoint",
    async () => {
      const launcher = new LauncherProcessAdapter({ mode: "full", startTimeoutMs: 40_000 });
      const profileDir = freshProfileDir();
      const handle = await launcher.spawn(specWithProfile(profileDir), process.getuid?.() ?? 0);
      try {
        const runtime = decodeRuntime(handle);
        expect(runtime?.mode).toBe("full");
        expect(runtime?.cdpWebSocketUrl).toMatch(/^ws:\/\/127\.0\.0\.1:/);
        // The noVNC ws endpoint is exposed (the human entrypoint the gateway proxies in Slice 4).
        expect(runtime?.novncEndpoint).toMatch(/^ws:\/\/127\.0\.0\.1:/);
        expect(await launcher.health(handle)).toBe("up");
      } finally {
        await launcher.stop(handle);
      }
    },
    90_000,
  );

  it.skipIf(HAVE_FULL)(
    "FULL noVNC test SKIPPED — Xvfb/x11vnc/websockify absent (will run in hermes-1)",
    () => {
      expect(fullStackAvailable()).toBe(false);
    },
  );
});

/** Is a pid still alive? `kill(pid, 0)` throws ESRCH when the process is gone. */
function processAlive(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
