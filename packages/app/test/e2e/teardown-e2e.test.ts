// REAL teardown + cascade-revoke end-to-end test (packages/app) — the headline proof for scenario-01 Phase 15
// (Slice 7, GLA-064/065). Wires the REAL provisioning + handoff stack and exercises the REAL `gla task complete`
// terminal path against a REAL headless-Chromium capsule:
//   - provision a REAL capsule (the process launcher + temp-profile workspace + the brokered CDP connector) with a
//     MOUNTED host file (to prove persisted-survives), under a scratch workspaceRoot we can scan for the temp profile;
//   - open a handoff (mint a recipient-bound grant + program a route on the gateway) — capture the grant token;
//   - assert the LIVE state before teardown: the capsule PID is alive, the temp profile dir exists, the route is
//     mounted, the grant verifies;
//   - run `gla task complete <task>` — the REAL terminal path: tear down the session (cancel the window, STOP the
//     capsule + reap the workspace, revoke the connector) and revoke the task capability (cascade);
//   - assert NOTHING LIVE REMAINS: the capsule process is GONE (process.kill(pid,0) → ESRCH AND the launcher health
//     reads `down`), the temp profile dir is DELETED, the route is UNMOUNTED, and the grant + connector + task caps
//     NO LONGER VERIFY (auth.revoked — the lineage cascade), the session is `completed`;
//   - PERSISTED SURVIVES: the mounted host file is NOT deleted by teardown (only the ephemeral temp profile is);
//   - IDEMPOTENT: a second `gla task complete` is a clean no-op (no throw, the reconciler reports no orphan);
//   - NO ORPHAN: a process scan finds no leftover capsule process after teardown;
//   - ABORT: `gla task revoke` performs the SAME teardown to a non-success terminal state (`revoked`).
//
// GATED: skips when no cached Chromium is available; the teardown logic is proven by the unit/contract tests
// (packages/task, packages/session, packages/worker, surfaces/cli) regardless. Spawns a REAL browser — generous
// timeouts; the capsule + broker + gateway are always reaped in a finally/afterAll.

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { referenceWpmDependencyBindings } from "@gla/catalog";
import { Output, type OutputStreams, run } from "@gla/cli";
import {
  type CapabilityId,
  type OpaqueToken,
  type SessionId,
  type TaskId,
  decodeRuntimeHandle,
} from "@gla/kernel";
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import type { ProvisioningStack } from "../../src/index.js";
import { createProvisioningBridge } from "../../src/index.js";

function capture(): { out: Output; stdout: () => string; stderr: () => string } {
  const o: string[] = [];
  const e: string[] = [];
  const streams: OutputStreams = {
    stdout: { write: (s) => void o.push(s), isTTY: false },
    stderr: { write: (s) => void e.push(s), isTTY: false },
  };
  return { out: new Output("json", streams), stdout: () => o.join(""), stderr: () => e.join("") };
}

const scratchDirs: string[] = [];
function workspaceRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "gla-tdwn-ws-"));
  scratchDirs.push(dir);
  return dir;
}

const closers: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const c of closers) {
    await c();
  }
  for (const d of scratchDirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

function chromiumAvailable(): boolean {
  if (process.env.GLA_BROWSER_E2E_MODE === "optional") {
    return false;
  }
  try {
    const p = chromium.executablePath();
    return typeof p === "string" && p.length > 0 && existsSync(p);
  } catch {
    return false;
  }
}
const HAVE_CHROMIUM = chromiumAvailable();

/** Is a pid still alive? `process.kill(pid, 0)` throws ESRCH when the process is gone. */
function pidAlive(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH = no such process (gone). EPERM = exists but not ours (still "alive" for our purposes).
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Count the `gla-profile-*` temp-profile dirs under a workspace root (the capsule's OWN ephemeral state). */
function profileDirs(root: string): string[] {
  try {
    return readdirSync(root).filter((n) => n.startsWith("gla-profile-"));
  } catch {
    return [];
  }
}

/** Write an assembly spec to a scratch file and return its path (the CLI reads it with `-f`). */
function writeSpec(doc: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "gla-tdwn-"));
  scratchDirs.push(dir);
  const path = join(dir, "assembly.json");
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

/**
 * Provision a REAL capsule via the CLI (with a mounted host file), open a handoff, and return all the handles the
 * teardown assertions need: the session/task ids, the capsule pid, the profile-scan, the grant token + the
 * connector cap id, the gateway/route, and the host mount path.
 */
async function provisionAndOpen(stack: ProvisioningStack): Promise<{
  sessionId: SessionId;
  taskId: TaskId;
  pid: number;
  wsRoot: string;
  grantToken: OpaqueToken;
  scopePath: string;
  connectorCapId: CapabilityId;
  hostMountFile: string;
}> {
  const wsRoot = (stack as unknown as { __wsRoot: string }).__wsRoot;
  // A PERSISTED host file to mount rw — it must SURVIVE teardown (only the ephemeral profile is wiped).
  const mountDir = mkdtempSync(join(tmpdir(), "gla-tdwn-host-"));
  scratchDirs.push(mountDir);
  const hostMountFile = join(mountDir, "draft.md");
  writeFileSync(hostMountFile, "PERSISTED OUTPUT — survives teardown");

  const assembly = {
    apiVersion: "gla.dev/v1",
    kind: "Assembly",
    metadata: { intent: "register on acme" },
    spec: {
      template: "browser-handoff",
      recipient: "tg:user:123",
      mounts: [{ host: hostMountFile, target: "/work/draft.md", mode: "rw" }],
      detectors: [
        { use: "url-watcher", params: { complete_on: "/dashboard", intermediate: "/verify" } },
      ],
    },
  };

  const cCreate = capture();
  const code = await run(["session", "create", "-f", writeSpec(assembly)], cCreate.out, {
    bridge: stack.bridge,
  });
  expect(code, cCreate.stderr()).toBe(0);
  const created = JSON.parse(cCreate.stdout());
  const sessionId = created.session_id as SessionId;
  const taskId = created.task_id as TaskId;

  // Decode the REAL runtime handle → the capsule's process-group leader pid (we assert it dies on teardown).
  const runtime = stack.session.get(sessionId).runtime;
  const d = runtime !== undefined ? decodeRuntimeHandle(runtime) : undefined;
  const pid = typeof d?.pid === "number" ? d.pid : -1;
  expect(pid).toBeGreaterThan(0);

  // Open a handoff (mint a recipient-bound grant + program a route on the gateway). Capture the grant token.
  const view = await stack.session.openHandoff(sessionId, { reason: "complete registration form" });
  const grantToken = new URL(view.link).searchParams.get("grant") as OpaqueToken;
  const scopePath = new URL(view.link).pathname;
  expect(grantToken).toBeTruthy();

  // The connector cap id (the agent-blind connector descends from the task cap; it must stop verifying too).
  const lineage = stack.session.connectorLineage(sessionId);
  expect(lineage?.connectorCapId).toBeTruthy();
  const connectorCapId = lineage?.connectorCapId as CapabilityId;

  return { sessionId, taskId, pid, wsRoot, grantToken, scopePath, connectorCapId, hostMountFile };
}

/** Build the provisioning stack with the handoff pipeline wired (stub noVNC entrypoint — headless dev). */
function buildStack(): ProvisioningStack {
  const wsRoot = workspaceRoot();
  const stack = createProvisioningBridge({
    dependencyBindings: referenceWpmDependencyBindings(),
    launcherMode: "headless",
    workspaceRoot: wsRoot,
    startTimeoutMs: 40_000,
    handoff: {
      expectedOrigin: "http://localhost:3000",
      publicBaseUrl: "http://localhost:3000",
      host: "127.0.0.1",
      port: 0, // ephemeral port
      // Swallow the delivered handoff link (keep the test's stdout clean — the link is not under test here).
      deliverySink: { write: () => {} },
      // A stub human entrypoint (headless dev has no X/noVNC stack; the REAL noVNC proxy is gated for hermes-1).
      entrypoint: {
        async open() {
          return {
            resourceId: "entrypoint:fake-view:teardown-e2e",
            provider: "fake-view",
            client: { kind: "provider-asset", ref: "fake-viewer" },
            transport: {
              kind: "reverse-proxy" as const,
              protocol: "websocket",
              upstream: "ws://127.0.0.1:1/",
            },
          };
        },
      },
    },
  });
  // Stash the workspace root so the assertions can scan it for the temp profile (the capsule's ephemeral state).
  (stack as unknown as { __wsRoot: string }).__wsRoot = wsRoot;
  closers.push(() => stack.gateway?.close() ?? Promise.resolve());
  closers.push(() => stack.connector.close());
  return stack;
}

describe("REAL teardown + cascade-revoke end-to-end (scenario-01 Phase 15; GLA-064/065)", () => {
  it.runIf(HAVE_CHROMIUM)(
    "gla task complete: the capsule process is GONE, the temp profile is DELETED, the route is UNMOUNTED, the grant+connector+task caps NO LONGER VERIFY, the session is completed — and the mounted host file SURVIVES; the re-run is idempotent",
    async () => {
      const stack = buildStack();
      const p = await provisionAndOpen(stack);

      // ── BEFORE teardown: the live state is genuinely live. ──
      expect(pidAlive(p.pid), "the capsule process is alive before teardown").toBe(true);
      expect(profileDirs(p.wsRoot).length, "the temp profile dir exists before teardown").toBe(1);
      expect(await stack.lifecycle.health(p.sessionId)).toBe("up"); // the launcher health = up
      // The route is mounted on the gateway, and the grant verifies (it is live).
      const routeId = stack.session.get(p.sessionId).route?.id;
      expect(routeId).toBeTruthy();
      expect(stack.gateway?.mountedRouteIds().has(routeId as never)).toBe(true);
      const grantBefore = stack.capability.verifySessionGrantToken(p.grantToken, {
        scopePath: p.scopePath,
      });
      expect(grantBefore.ok, "the grant verifies before teardown").toBe(true);
      const taskCapId = stack.task.get(p.taskId).taskCapabilityRef as unknown as CapabilityId;
      expect(stack.capability.revocationSnapshot().has(taskCapId)).toBe(false);

      // ── RUN `gla task complete <task>` — the REAL terminal teardown path. ──
      const cComplete = capture();
      const code = await run(["task", "complete", p.taskId], cComplete.out, {
        bridge: stack.bridge,
      });
      expect(code, cComplete.stderr()).toBe(0);
      expect(JSON.parse(cComplete.stdout()).state).toBe("completed"); // the CLI prints the terminal state

      // Give the OS a beat to deliver SIGKILL to the process group + release the CDP port.
      await new Promise((r) => setTimeout(r, 400));

      // ── AFTER teardown: NOTHING LIVE REMAINS. ──
      // (1) the capsule PROCESS is gone (the launcher's stop killed the process group).
      expect(pidAlive(p.pid), "the capsule process is GONE after teardown").toBe(false);
      // (2) the launcher health reads `down` (no live capsule).
      expect(await stack.lifecycle.health(p.sessionId)).toBe("down");
      expect(stack.lifecycle.hasLive(p.sessionId)).toBe(false);
      // (3) the temp profile dir is DELETED (the capsule's OWN ephemeral state — wiped at reap).
      expect(profileDirs(p.wsRoot).length, "the temp profile dir is deleted after teardown").toBe(
        0,
      );
      // (4) the route is UNMOUNTED (no live route remains — GLA-065 AC#3).
      expect(stack.gateway?.mountedRouteIds().has(routeId as never)).toBe(false);
      // (5) the grant + connector + TASK caps NO LONGER VERIFY — the lineage cascade (GLA-065 AC#2).
      const grantAfter = stack.capability.verifySessionGrantToken(p.grantToken, {
        scopePath: p.scopePath,
      });
      expect(grantAfter.ok, "the grant no longer verifies after teardown").toBe(false);
      if (!grantAfter.ok) {
        expect(grantAfter.reason).toBe("auth.revoked");
      }
      const snap = stack.capability.revocationSnapshot();
      expect(snap.has(taskCapId), "the task cap is revoked").toBe(true);
      expect(snap.has(p.connectorCapId), "the connector cap is revoked (cascade)").toBe(true);
      // (6) the session is `completed`, with no live runtime/grant/route.
      expect(stack.session.get(p.sessionId).state).toBe("completed");
      expect(stack.session.hasRuntime(p.sessionId)).toBe(false);
      expect(stack.session.get(p.sessionId).grantTokenRef).toBeUndefined();
      expect(stack.session.get(p.sessionId).route).toBeUndefined();

      // ── PERSISTED SURVIVES: the mounted host file is NOT deleted (only the ephemeral temp profile is). ──
      expect(
        existsSync(p.hostMountFile),
        "the mounted host file survives teardown (only the ephemeral profile is wiped)",
      ).toBe(true);

      // ── NO ORPHAN: the reconciler's orphan scan finds no leftover capsule for this session. ──
      const orphans = await stack.reconciler.reconcileOrphans([]);
      expect(orphans).not.toContain(p.sessionId);
      expect(stack.lifecycle.liveSessions()).not.toContain(p.sessionId);

      // ── IDEMPOTENT: a second `gla task complete` is a clean no-op (no throw; the task stays completed). ──
      const cAgain = capture();
      const codeAgain = await run(["task", "complete", p.taskId], cAgain.out, {
        bridge: stack.bridge,
      });
      expect(codeAgain, cAgain.stderr()).toBe(0);
      expect(JSON.parse(cAgain.stdout()).state).toBe("completed");
      // Still no orphan + the host file still survives the idempotent re-run.
      expect(pidAlive(p.pid)).toBe(false);
      expect(existsSync(p.hostMountFile)).toBe(true);
    },
    120_000,
  );

  it.runIf(HAVE_CHROMIUM)(
    "gla task revoke (abort): the SAME teardown to a non-success terminal state — capsule gone, caps revoked, session revoked (GLA-065 AC#6)",
    async () => {
      const stack = buildStack();
      const p = await provisionAndOpen(stack);
      expect(pidAlive(p.pid)).toBe(true);

      // ── ABORT via `gla task revoke` — the same teardown, to a non-success terminal state. ──
      const cRevoke = capture();
      const code = await run(["task", "revoke", p.taskId], cRevoke.out, { bridge: stack.bridge });
      expect(code, cRevoke.stderr()).toBe(0);
      expect(JSON.parse(cRevoke.stdout()).state).toBe("revoked"); // a NON-success terminal state

      await new Promise((r) => setTimeout(r, 400));

      // The same teardown ran: the capsule is gone, the profile is wiped, the caps are revoked.
      expect(pidAlive(p.pid), "the capsule process is GONE after abort").toBe(false);
      expect(profileDirs(p.wsRoot).length).toBe(0);
      const taskCapId = stack.task.get(p.taskId).taskCapabilityRef as unknown as CapabilityId;
      expect(stack.capability.revocationSnapshot().has(taskCapId)).toBe(true);
      const grantAfter = stack.capability.verifySessionGrantToken(p.grantToken, {
        scopePath: p.scopePath,
      });
      expect(grantAfter.ok).toBe(false);
      // The session + task are in the `revoked` terminal state (the abort path).
      expect(stack.session.get(p.sessionId).state).toBe("revoked");
      expect(stack.task.get(p.taskId).state).toBe("revoked");
    },
    120_000,
  );

  it.skipIf(HAVE_CHROMIUM)("REAL teardown E2E SKIPPED — no cached Chromium", () => {
    expect(HAVE_CHROMIUM).toBe(false);
  });
});
