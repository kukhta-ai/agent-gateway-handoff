// @gla/launcher-process — adapter ring (baseline §1, docs/03 §5/§6/§10, GLA-022/023).
// DEFAULT Launcher: local-process T2 (the reference default — baseline §5: hermes-1's nested-Docker
// storage driver is broken, so process-tier is the reliable default). Implements the kernel
// `LauncherPort` (spawn / health / stop) by running the capsule = a browser the agent and human share.
//
// TWO MODES, AUTO-DETECTED at spawn (probe for the binaries on PATH):
//   (a) FULL  — when Xvfb + x11vnc + websockify are present (the hermes-1 target, where the wpm
//       human-view bundle installs them): `Xvfb :N` → headed Chromium (DISPLAY=:N, headless:false,
//       --remote-debugging-port) → `x11vnc` on :N → `websockify`+noVNC web view. Exposes a CDP
//       endpoint (the agent connector) AND a noVNC ws endpoint (the human entrypoint).
//   (b) HEADLESS — when those binaries are ABSENT (the current dev env): headless Chromium with
//       --remote-debugging-port → CDP endpoint ONLY; the noVNC entrypoint is reported unavailable.
//
// The CONNECTOR is the raw CDP `webSocketDebuggerUrl` read from
// `http://127.0.0.1:<port>/json/version`. HEALTH = the CDP endpoint answers. STOP = kill the process
// group + reap. Binds ONLY to 127.0.0.1. The launcher declares its mount capability (file+dir, ro+rw).
//
// Boundary (adapter ring): depends ONLY on @gla/kernel (the LauncherPort + types + the neutral
// runtime-handle / spawn-context helpers) + Node builtins (child_process, net, fs, module, os, path)
// + the cached Chromium (resolved via playwright-core's executablePath, no bundled browser download).
// It does NOT import the workspace adapter (the boundary lint forbids adapter→adapter): it reads the
// realized profile dir off the kernel's neutral spawn-context side-channel (the worker sets it). It is
// injected at `app`; core never imports it.

import { type ChildProcess, spawn as spawnChild, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join as joinPath } from "node:path";
import {
  type LauncherPort,
  type MountCapability,
  type ResolvedAssemblySpec,
  type RuntimeDescriptor,
  type RuntimeHandle,
  decodeRuntimeHandle,
  encodeRuntimeHandle,
  getSpawnContext,
  glaError,
} from "@gla/kernel";

/** Stable identifier for this module (used by the `app` composition root's wiring record). */
export const LAUNCHER_PROCESS_MODULE = "@gla/launcher-process" as const;
/** Ring classification from the architecture baseline (informational). */
export const LAUNCHER_PROCESS_RING = "adapter" as const;

/** The launch mode actually used for a capsule (auto-detected at spawn). */
export type LaunchMode = "full" | "headless";

/**
 * The runtime state encoded into a {@link RuntimeHandle} so health/stop can act on a spawned capsule
 * across calls. It EXTENDS the kernel's neutral {@link RuntimeDescriptor} (the well-known fields the
 * agent-connector + human-entrypoint ports read — `mode`, `cdpWebSocketUrl`, `novncEndpoint`) with the
 * launcher's private bookkeeping (pid, ports, side-process ids). Carries no secret — addresses + pids
 * only; the agent-blind `secret_ref` is minted separately by the CapabilityService.
 */
export interface ProcessRuntime extends RuntimeDescriptor {
  /** Which mode this capsule launched in. */
  mode: LaunchMode;
  /** The Chromium process group leader pid (we spawn detached so the pid IS the group id). */
  pid: number;
  /** The CDP debugging port on 127.0.0.1 (the agent connector). */
  cdpPort: number;
  /** The raw CDP `webSocketDebuggerUrl` (the agent's handle — bound to 127.0.0.1). */
  cdpWebSocketUrl: string;
  /** The internal noVNC ws endpoint (full mode only; undefined in headless). */
  novncEndpoint?: string;
  /** The X display number (full mode only). */
  display?: number;
  /** Side-process pids to reap on stop (Xvfb, x11vnc, websockify) — full mode only. */
  sidePids?: number[];
}

/** Options for {@link LauncherProcessAdapter}. */
export interface LauncherProcessOptions {
  /**
   * Force a mode (tests / hermes-1 override). Default `"auto"`: full if Xvfb/x11vnc/websockify are on
   * PATH, else headless. `"headless"` and `"full"` force the respective path.
   */
  mode?: "auto" | "full" | "headless";
  /** Override the Chromium executable path (default: playwright-core's cached browser). */
  chromiumPath?: string;
  /** How long to wait for the CDP endpoint to come up, ms (default 20s). */
  startTimeoutMs?: number;
}

/** A live capsule's mutable bookkeeping the adapter keeps so it can reap children precisely. */
interface LiveProcess {
  child: ChildProcess;
  runtime: ProcessRuntime;
}

/**
 * The local-process (T2) Launcher adapter. Spawns Chromium directly via `node:child_process` (full
 * control of the process group for clean reaping and CDP-port discovery), auto-detecting full vs
 * headless. Health probes the CDP endpoint; stop kills the process group and reaps side-processes.
 */
export class LauncherProcessAdapter implements LauncherPort {
  readonly tier = "local-process" as const;
  /** Declared mount capability (docs/03 §5): the process tier realizes file + directory, ro + rw. */
  readonly mountCapability: MountCapability = {
    file: true,
    directory: true,
    modes: ["ro", "rw"],
  };

  private readonly mode: "auto" | "full" | "headless";
  private readonly chromiumPath: string | undefined;
  private readonly startTimeoutMs: number;
  /** Live processes by pid, so `stop` can reap the exact child + side-processes. */
  private readonly live = new Map<number, LiveProcess>();

  constructor(opts: LauncherProcessOptions = {}) {
    this.mode = opts.mode ?? "auto";
    this.chromiumPath = opts.chromiumPath;
    this.startTimeoutMs = opts.startTimeoutMs ?? 20_000;
  }

  /** The mode this launcher will use for a new capsule (auto resolves to full/headless at spawn). */
  resolveMode(): LaunchMode {
    if (this.mode === "full") {
      return "full";
    }
    if (this.mode === "headless") {
      return "headless";
    }
    return fullStackAvailable() ? "full" : "headless";
  }

  /**
   * Spawn the capsule (kernel `LauncherPort.spawn`). Reads the profile dir from the workspace handle
   * pinned on the resolved spec (the worker realizes the workspace first), launches Chromium with
   * `--remote-debugging-port` bound to 127.0.0.1, waits for the CDP endpoint, reads its
   * `webSocketDebuggerUrl`, and (full mode) stands up Xvfb/x11vnc/websockify+noVNC. Returns the runtime
   * handle encoding the live state. On a failure to come up it reaps any partial process and throws a
   * typed `dependency.*` error — the worker's saga then compensates (no orphan).
   *
   * @param spec   the immutable resolved spec (read-only). The worker passes the realized workspace via
   *               the kernel's `setSpawnContext` before this call; if absent, spawn fails closed before
   *               mutating host state.
   * @param asUid  the agent's uid the capsule runs as (priv-esc off; docs/04 §6). Honored when the
   *               process has the privilege to setuid; in the single-operator profile the capsule runs
   *               as the operator already, so this is the same uid.
   */
  async spawn(spec: ResolvedAssemblySpec, asUid: number): Promise<RuntimeHandle> {
    const mode = this.resolveMode();
    const profileDir = readWorkspaceProfileDir(spec);
    if (profileDir === undefined) {
      throw glaError(
        "dependency.unavailable",
        "launcher-process missing realized workspace context before spawn",
        { detail: { expected: "worker setSpawnContext with workspace profileDir" } },
      );
    }
    const cdpPort = await freePort();

    if (mode === "headless") {
      return this.spawnHeadless(profileDir, cdpPort, asUid);
    }
    return this.spawnFull(profileDir, cdpPort, asUid);
  }

  /** Headless Chromium with a CDP endpoint on 127.0.0.1 (the dev-env path; CDP behaves identically). */
  private async spawnHeadless(
    profileDir: string,
    cdpPort: number,
    asUid: number,
  ): Promise<RuntimeHandle> {
    const chromium = this.resolveChromium();
    const args = [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      // Sandbox off: the capsule already runs as the agent's own uid (priv-esc off); the OS DAC is the
      // boundary, not the chrome sandbox, on the process tier (docs/04 §6). Required to run as non-root
      // in many container envs without extra caps.
      "--no-sandbox",
      // Bind the DevTools endpoint to LOOPBACK ONLY — nothing on 0.0.0.0 (baseline §3 single public entry).
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ];
    const child = spawnDetached(chromium, args, asUid);
    const runtime = await this.awaitCdp(child, { mode: "headless", cdpPort, asUid });
    return this.track(child, runtime);
  }

  /**
   * Full mode: Xvfb :N → headed Chromium (DISPLAY=:N, headless:false, --remote-debugging-port) →
   * x11vnc on :N → websockify+noVNC. Exposes BOTH a CDP endpoint (agent) and a noVNC ws endpoint
   * (human). Runs in hermes-1 where the wpm human-view bundle provides Xvfb/x11vnc/websockify. The CDP
   * bring-up is identical to headless; the side-processes add the human view.
   */
  private async spawnFull(
    profileDir: string,
    cdpPort: number,
    asUid: number,
  ): Promise<RuntimeHandle> {
    const chromium = this.resolveChromium();
    const display = pickDisplay();
    const vncPort = await freePort();
    const novncPort = await freePort();
    const sidePids: number[] = [];

    // Xvfb :N — the virtual display the headed browser renders to.
    const xvfb = spawnDetached("Xvfb", [`:${display}`, "-screen", "0", "1280x800x24"], asUid);
    if (xvfb.pid !== undefined) {
      sidePids.push(xvfb.pid);
    }
    await delay(400); // give Xvfb a beat to create the display socket.

    // Headed Chromium on DISPLAY=:N with the CDP endpoint on loopback.
    const args = [
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      "--start-maximized",
      "about:blank",
    ];
    const child = spawnDetached(chromium, args, asUid, { DISPLAY: `:${display}` });

    // x11vnc serving the display, then websockify bridging VNC→ws for noVNC. Both bound to loopback.
    const x11vnc = spawnDetached(
      "x11vnc",
      [
        "-display",
        `:${display}`,
        "-rfbport",
        String(vncPort),
        "-localhost",
        "-forever",
        "-nopw",
        "-quiet",
      ],
      asUid,
    );
    if (x11vnc.pid !== undefined) {
      sidePids.push(x11vnc.pid);
    }
    const websockify = spawnDetached(
      "websockify",
      [`127.0.0.1:${novncPort}`, `127.0.0.1:${vncPort}`],
      asUid,
    );
    if (websockify.pid !== undefined) {
      sidePids.push(websockify.pid);
    }

    const novncEndpoint = `ws://127.0.0.1:${novncPort}/`;
    const runtime = await this.awaitCdp(child, {
      mode: "full",
      cdpPort,
      asUid,
      display,
      novncEndpoint,
      sidePids,
    });
    // Merge the side-process info onto the runtime the CDP probe built.
    runtime.display = display;
    runtime.novncEndpoint = novncEndpoint;
    runtime.sidePids = sidePids;
    return this.track(child, runtime);
  }

  /**
   * Wait for the CDP endpoint to answer `/json/version`, read its `webSocketDebuggerUrl`, and build the
   * {@link ProcessRuntime}. Polls `http://127.0.0.1:<port>/json/version` until it returns or the start
   * timeout elapses. On timeout (or an early child exit) it reaps the child + sides and throws a typed
   * `dependency.probe_failed` — so the worker's saga compensates and leaves no orphan.
   */
  private async awaitCdp(
    child: ChildProcess,
    base: {
      mode: LaunchMode;
      cdpPort: number;
      asUid: number;
      display?: number;
      novncEndpoint?: string;
      sidePids?: number[];
    },
  ): Promise<ProcessRuntime> {
    const deadline = Date.now() + this.startTimeoutMs;
    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    while (Date.now() < deadline) {
      if (exited) {
        reapPids(collectPids(child, base.sidePids));
        throw glaError("dependency.probe_failed", "capsule browser exited before CDP came up", {
          detail: { mode: base.mode, cdpPort: base.cdpPort },
        });
      }
      const ws = await cdpWebSocketUrl(base.cdpPort);
      if (ws !== undefined) {
        const pid = child.pid ?? -1;
        const runtime: ProcessRuntime = {
          launchMode: base.mode,
          mode: base.mode,
          pid,
          cdpPort: base.cdpPort,
          cdpWebSocketUrl: ws,
          endpoints: [
            {
              resourceId: `agent-connector:launcher-process:${base.cdpPort}`,
              family: "agent-connector",
              provider: "cdp",
              transport: "websocket",
              address: ws,
              metadata: { port: base.cdpPort },
            },
          ],
        };
        if (base.novncEndpoint !== undefined) {
          runtime.endpoints?.push({
            resourceId: `human-entrypoint:launcher-process:${base.novncEndpoint}`,
            family: "human-entrypoint",
            provider: "novnc",
            transport: "websocket",
            address: base.novncEndpoint,
            client: { kind: "gateway-page", ref: "handoff" },
            metadata: { mode: base.mode },
          });
        }
        return runtime;
      }
      await delay(150);
    }
    // Timed out — reap the partial capsule and fail closed.
    reapPids(collectPids(child, base.sidePids));
    throw glaError("dependency.probe_failed", "capsule CDP endpoint did not come up in time", {
      detail: { mode: base.mode, cdpPort: base.cdpPort, timeoutMs: this.startTimeoutMs },
    });
  }

  /**
   * Health (kernel `LauncherPort.health`): the CDP endpoint answers ⇒ `up`, else `down`. A handle that
   * does not decode, or a process that has gone, is `down`.
   */
  async health(handle: RuntimeHandle): Promise<"up" | "down"> {
    const runtime = decodeRuntime(handle);
    if (runtime === undefined) {
      return "down";
    }
    // Liveness is the CDP endpoint answering — the definition of a working capsule for this slice.
    const ws = await cdpWebSocketUrl(runtime.cdpPort);
    return ws !== undefined ? "up" : "down";
  }

  /**
   * Stop (kernel `LauncherPort.stop`): kill the process GROUP (we spawned detached, so the negative pid
   * is the group) and reap the side-processes (Xvfb/x11vnc/websockify). Idempotent + restart-safe: a
   * pid that is already gone is swallowed. After this the capsule's browser PID is gone (no orphan —
   * GLA-023 AC#3; the temp profile is wiped by the WorkspacePort.reap the worker calls alongside).
   */
  async stop(handle: RuntimeHandle): Promise<void> {
    const runtime = decodeRuntime(handle);
    if (runtime === undefined) {
      return;
    }
    const tracked = this.live.get(runtime.pid);
    const pids = tracked
      ? collectPids(tracked.child, runtime.sidePids)
      : [runtime.pid, ...(runtime.sidePids ?? [])];
    reapPids(pids);
    this.live.delete(runtime.pid);
    // Give the OS a moment to deliver SIGKILL and release the CDP port (so a health re-probe reads down).
    await delay(150);
  }

  /** Resolve the Chromium executable: an explicit override, else playwright-core's cached browser. */
  private resolveChromium(): string {
    if (this.chromiumPath !== undefined) {
      return this.chromiumPath;
    }
    const resolved = resolveCachedChromium();
    if (resolved === undefined) {
      throw glaError(
        "dependency.unavailable",
        "no Chromium executable found (install the browser-runtime: `npx playwright install chromium`)",
        {},
      );
    }
    return resolved;
  }

  /** Track a live process by pid and return its encoded runtime handle. */
  private track(child: ChildProcess, runtime: ProcessRuntime): RuntimeHandle {
    this.live.set(runtime.pid, { child, runtime });
    return encodeRuntime(runtime);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace handle threading — the worker realizes the workspace, then spawns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the profile dir for a spec's realized workspace, or undefined. The worker associates the
 * realized workspace handle with the (frozen) resolved-spec instance via the kernel's neutral
 * `setSpawnContext` BEFORE calling spawn; the launcher reads it here via `getSpawnContext` and decodes
 * the `profileDir` field with the kernel's neutral codec — so neither the worker nor the launcher
 * imports the workspace adapter (the boundary lint holds).
 */
function readWorkspaceProfileDir(spec: ResolvedAssemblySpec): string | undefined {
  const ctx = getSpawnContext(spec);
  if (ctx === undefined) {
    return undefined;
  }
  const d = decodeRuntimeHandle(
    ctx.workspace as unknown as Parameters<typeof decodeRuntimeHandle>[0],
  );
  return typeof d?.profileDir === "string" ? d.profileDir : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Process + CDP helpers (Node builtins only)
// ─────────────────────────────────────────────────────────────────────────────

/** Spawn a detached child (its own process group) so we can kill the whole group at stop. */
function spawnDetached(
  cmd: string,
  args: string[],
  asUid: number,
  extraEnv: Record<string, string> = {},
): ChildProcess {
  const opts: Parameters<typeof spawnChild>[2] = {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...extraEnv },
  };
  // Honor the agent uid when the process can setuid (root) AND the target differs; in the
  // single-operator profile the capsule already runs as the operator, so this is a no-op there.
  if (canSetUid(asUid)) {
    (opts as { uid?: number }).uid = asUid;
  }
  return spawnChild(cmd, args, opts);
}

/** Can we actually run the child as `asUid`? Only when we are root and the target differs from us. */
function canSetUid(asUid: number): boolean {
  const cur = typeof process.getuid === "function" ? process.getuid() : -1;
  return cur === 0 && asUid >= 0 && asUid !== 0;
}

/** All pids to reap for a capsule: the main child's group + any tracked side pids. */
function collectPids(child: ChildProcess, sidePids: number[] | undefined): number[] {
  const pids: number[] = [];
  if (child.pid !== undefined) {
    pids.push(child.pid);
  }
  for (const p of sidePids ?? []) {
    pids.push(p);
  }
  return pids;
}

/** Kill each pid's process GROUP (negative pid), then the pid itself; swallow ESRCH (already gone). */
function reapPids(pids: number[]): void {
  for (const pid of pids) {
    if (pid <= 0) {
      continue;
    }
    // Kill the whole group first (we spawned detached, so -pid targets the group), then the leader.
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // group already gone / not a group leader — fall through to the direct kill.
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already reaped — idempotent.
    }
  }
}

/**
 * Fetch the CDP `webSocketDebuggerUrl` from `http://127.0.0.1:<port>/json/version`, or undefined if the
 * endpoint is not (yet) answering. The raw `webSocketDebuggerUrl` is the agent connector (docs/03 §7).
 */
async function cdpWebSocketUrl(port: number): Promise<string | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!res.ok) {
      return undefined;
    }
    const body = (await res.json()) as { webSocketDebuggerUrl?: string };
    return typeof body.webSocketDebuggerUrl === "string" ? body.webSocketDebuggerUrl : undefined;
  } catch {
    return undefined;
  }
}

/** Find a free TCP port on 127.0.0.1 by binding :0 and reading the assigned port. */
async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** A monotonic-ish X display number picker (full mode). Starts high to avoid a real :0. */
let displayCounter = 90;
function pickDisplay(): number {
  displayCounter += 1;
  return displayCounter;
}

/** A small async delay. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Availability probes (the headless-vs-full auto-detect) ──────────────────────────────────────────

/** Is the full human-view stack available (Xvfb + x11vnc + websockify all on PATH)? */
export function fullStackAvailable(): boolean {
  return binaryOnPath("Xvfb") && binaryOnPath("x11vnc") && binaryOnPath("websockify");
}

/** Is a binary resolvable on PATH? Uses `command -v` (POSIX) via a cheap spawnSync. */
function binaryOnPath(bin: string): boolean {
  try {
    const r = spawnSync("command", ["-v", bin], { shell: true, stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

// ── Chromium resolution (playwright-core's cached browser; no bundled download) ─────────────────────

/**
 * Resolve the cached Chromium executable. Prefers playwright-core's `chromium.executablePath()` (the
 * browser the ms-playwright cache already holds); falls back to scanning the cache directory directly
 * if playwright-core is not importable. Returns undefined when no browser is found.
 */
function resolveCachedChromium(): string | undefined {
  // Try playwright-core's resolver first (it knows the exact cached build). Use createRequire so this
  // works in the ESM dist (where bare `require` is undefined) AND under vitest — and so a missing
  // playwright-core degrades gracefully to the cache scan.
  try {
    const req = createRequire(import.meta.url);
    const pw = req("playwright-core") as { chromium?: { executablePath?: () => string } };
    const p = pw.chromium?.executablePath?.();
    if (typeof p === "string" && p.length > 0 && existsSync(p)) {
      return p;
    }
  } catch {
    // playwright-core not present / no browser — fall through to the direct cache scan.
  }
  return scanMsPlaywrightCache();
}

/** Scan the ms-playwright cache (`chromium-<build>/chrome-linux/chrome`) for a usable Chromium, newest first. */
function scanMsPlaywrightCache(): string | undefined {
  try {
    const home = process.env.HOME ?? "";
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? joinPath(home, ".cache", "ms-playwright");
    if (!existsSync(cache)) {
      return undefined;
    }
    const dirs = readdirSync(cache)
      .filter((d) => d.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const d of dirs) {
      const candidate = joinPath(cache, d, "chrome-linux", "chrome");
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ── RuntimeHandle codec — over the kernel's neutral codec, so health/stop act across calls ──────────

/** Encode a {@link ProcessRuntime} into an opaque kernel {@link RuntimeHandle} (the shared codec). */
export function encodeRuntime(r: ProcessRuntime): RuntimeHandle {
  return encodeRuntimeHandle(r);
}

/** Decode a {@link RuntimeHandle} back into a {@link ProcessRuntime}, or undefined if it lacks a CDP url. */
export function decodeRuntime(h: RuntimeHandle): ProcessRuntime | undefined {
  const d = decodeRuntimeHandle(h);
  if (
    d !== undefined &&
    typeof d.cdpWebSocketUrl === "string" &&
    typeof (d as { cdpPort?: unknown }).cdpPort === "number"
  ) {
    return d as ProcessRuntime;
  }
  return undefined;
}

export type { LauncherPort, MountCapability, RuntimeHandle };
