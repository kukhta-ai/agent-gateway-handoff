// CONTRACT tests for the url-watcher CompletionDetector adapter (adapters/detector-url) — GLA-042/043.
//
// THE CORE PROOF — REAL url-watcher over REAL CDP (headless Chromium, runs in this dev env): spawn a capsule
// (headless Chromium with a CDP endpoint) → drive it via CDP to a STUB SITE (/register → /verify → /dashboard)
// → the url-watcher (reading the capsule's live URL off CDP `/json`) FIRES on /verify (intermediate) then
// /dashboard (complete). This is the proof the watcher observes a REAL navigation.
//
// SCRIPTED tests (no browser): an injected URL reader makes the fire sequence + the contract deterministic —
// the watcher declares its `contract`, emits at-most-once per fragment, and stops after the complete match. A
// non-firing reader → the watch yields NOTHING (the window then TTL-expires, GLA-043 AC#3).
//
// GATED: the REAL test skips when no cached Chromium is available; the scripted tests prove the watcher logic
// regardless.

import { type ChildProcess, spawn as spawnChild } from "node:child_process";
import { existsSync } from "node:fs";
import type { Iso8601, RawCompletionSignal, RuntimeHandle } from "@gla/kernel";
import { encodeRuntimeHandle } from "@gla/kernel";
import { type Browser, chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { DETECTOR_URL_NAME, DetectorUrlAdapter, URL_WATCHER_CONTRACT } from "../../src/index.js";

const AT = "2026-06-03T00:00:00.000Z" as Iso8601;

/** Collect the first `n` signals a watch emits (or all of them if the watch completes first). */
async function take(
  iter: AsyncIterable<RawCompletionSignal>,
  n: number,
): Promise<RawCompletionSignal[]> {
  const out: RawCompletionSignal[] = [];
  for await (const s of iter) {
    out.push(s);
    if (out.length >= n) {
      break;
    }
  }
  return out;
}

describe("DetectorUrlAdapter — contract + scripted URL sequence (GLA-042/043)", () => {
  it("declares its typed contract (complete_on required; intermediate optional)", () => {
    const d = new DetectorUrlAdapter();
    expect(d.contract).toBe(URL_WATCHER_CONTRACT);
    expect(d.contract.complete_on?.required).toBe(true);
    expect(d.contract.intermediate?.required).toBe(false);
  });

  it("fires on /verify (intermediate) then /dashboard (complete), then COMPLETES", async () => {
    // A scripted URL sequence: /register (no match) → /verify (intermediate) → /dashboard (complete).
    const seq = [
      "https://acme.example/register",
      "https://acme.example/verify",
      "https://acme.example/dashboard",
    ];
    let i = 0;
    const d = new DetectorUrlAdapter({
      pollMs: 1,
      now: () => AT,
      readUrl: async () => seq[Math.min(i++, seq.length - 1)],
    });
    const handle = encodeRuntimeHandle({ cdpPort: 1, mode: "headless" });
    const signals = await take(
      d.watch(handle, { complete_on: "/dashboard", intermediate: "/verify" }),
      2,
    );
    expect(signals).toHaveLength(2);
    // First the intermediate (matched /verify), carrying the mechanical status + the matched url/fragment.
    expect(signals[0]?.status).toBe("url-intermediate");
    expect(signals[0]?.detector).toBe(DETECTOR_URL_NAME);
    expect(signals[0]?.result).toEqual({ url: "https://acme.example/verify", match: "/verify" });
    // Then the complete (matched /dashboard).
    expect(signals[1]?.status).toBe("url-complete");
    expect(signals[1]?.result).toEqual({
      url: "https://acme.example/dashboard",
      match: "/dashboard",
    });
  });

  it("the capsule only EMITS — it does not decide; the raw signal carries no envelope status (GLA-043 AC#2)", async () => {
    const d = new DetectorUrlAdapter({
      pollMs: 1,
      now: () => AT,
      readUrl: async () => "https://acme.example/dashboard",
    });
    const handle = encodeRuntimeHandle({ cdpPort: 1 });
    const [sig] = await take(d.watch(handle, { complete_on: "/dashboard" }), 1);
    // The raw signal is the MECHANICAL fact ("the URL reached /dashboard"), NOT the normalized "verified"
    // envelope — that mapping is the Completion service's job. The capsule does not decide completion.
    expect(sig?.status).toBe("url-complete");
    expect(sig?.status).not.toBe("verified");
  });

  it("each fragment fires AT MOST ONCE — a stable page does not re-emit", async () => {
    // The URL transitions INTO /verify, then stays there several polls, then moves to /dashboard.
    const seq = ["/register", "/verify", "/verify", "/verify", "/dashboard"];
    let i = 0;
    const d = new DetectorUrlAdapter({
      pollMs: 1,
      readUrl: async () => `https://acme.example${seq[Math.min(i++, seq.length - 1)]}`,
    });
    const handle = encodeRuntimeHandle({ cdpPort: 1 });
    const signals = await take(
      d.watch(handle, { complete_on: "/dashboard", intermediate: "/verify" }),
      5,
    );
    // Exactly ONE intermediate (despite /verify being seen 3×) + ONE complete.
    expect(signals.filter((s) => s.status === "url-intermediate")).toHaveLength(1);
    expect(signals.filter((s) => s.status === "url-complete")).toHaveLength(1);
  });

  it("the intermediate is EDGE-triggered — a window that OPENS already at the intermediate does NOT re-fire it (the second-handoff fix)", async () => {
    // scenario-01 Phase 12/13: window 2 RE-OPENS while the capsule still shows /verify (window 1 already completed
    // on it). The watch must NOT instantly re-complete on the stale /verify — it must wait for the human to reach
    // /dashboard. The first observed URL is the BASELINE (no intermediate fire); only the /dashboard transition fires.
    const seq = ["/verify", "/verify", "/dashboard"];
    let i = 0;
    const d = new DetectorUrlAdapter({
      pollMs: 1,
      readUrl: async () => `https://acme.example${seq[Math.min(i++, seq.length - 1)]}`,
    });
    const handle = encodeRuntimeHandle({ cdpPort: 1 });
    const signals = await take(
      d.watch(handle, { complete_on: "/dashboard", intermediate: "/verify" }),
      3,
    );
    // NO intermediate fired (the page started at /verify — a baseline, not a transition); ONLY the complete.
    expect(signals.filter((s) => s.status === "url-intermediate")).toHaveLength(0);
    expect(signals.filter((s) => s.status === "url-complete")).toHaveLength(1);
    expect(signals[0]?.status).toBe("url-complete");
  });

  it("a NON-FIRING reader → the watch emits NOTHING (the window then TTL-expires; GLA-043 AC#3)", async () => {
    // The URL never reaches the target — the detector must not falsely complete.
    const d = new DetectorUrlAdapter({
      pollMs: 1,
      readUrl: async () => "https://acme.example/register",
    });
    const handle = encodeRuntimeHandle({ cdpPort: 1 });
    // Race the watch against a short deadline: it must yield nothing before we give up.
    const got = await Promise.race([
      take(d.watch(handle, { complete_on: "/dashboard", intermediate: "/verify" }), 1),
      new Promise<RawCompletionSignal[]>((r) => {
        const t = setTimeout(() => r([]), 60);
        t.unref?.();
      }),
    ]);
    expect(got).toHaveLength(0);
  });

  it("a misconfigured detector (no complete_on) emits nothing (fail-closed)", async () => {
    const d = new DetectorUrlAdapter({ pollMs: 1, readUrl: async () => "/dashboard" });
    const handle = encodeRuntimeHandle({ cdpPort: 1 });
    const got = await take(d.watch(handle, {}), 1);
    expect(got).toHaveLength(0);
  });
});

// ── REAL url-watcher over REAL CDP against a stub site ──────────────────────────────────────────────────

function chromiumExe(): string | undefined {
  if (process.env.GLA_BROWSER_E2E_MODE === "optional") {
    return undefined;
  }
  try {
    const p = chromium.executablePath();
    return typeof p === "string" && p.length > 0 && existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}
const CHROMIUM = chromiumExe();

const browsers: Browser[] = [];
const children: ChildProcess[] = [];
const closers: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const b of browsers) {
    await b.close().catch(() => {});
  }
  for (const c of children) {
    try {
      if (c.pid !== undefined) {
        process.kill(-c.pid, "SIGKILL");
      }
    } catch {
      /* already gone */
    }
    try {
      c.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  for (const c of closers) {
    await c();
  }
});

/** A free TCP port on 127.0.0.1. */
async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise<number>((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** The stub site: GET /register → a form; POST→ 302 /verify; /verify → a page; GET /dashboard → done. */
async function startStubSite(): Promise<{ base: string; close: () => Promise<void> }> {
  const { createServer } = await import("node:http");
  const port = await freePort();
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/register")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>register</title><h1>register</h1>");
    } else if (url.startsWith("/verify")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>verify</title><h1>check your email</h1>");
    } else if (url.startsWith("/dashboard")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>dashboard</title><h1>welcome</h1>");
    } else {
      res.writeHead(404);
      res.end("nope");
    }
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
      }),
  };
}

/** Spawn a headless Chromium with a CDP endpoint on 127.0.0.1, return its CDP port + `webSocketDebuggerUrl`. */
async function spawnChromiumWithCdp(): Promise<{
  cdpPort: number;
  cdpWebSocketUrl: string;
  child: ChildProcess;
}> {
  const exe = CHROMIUM as string;
  const cdpPort = await freePort();
  const child = spawnChild(
    exe,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--no-sandbox",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${cdpPort}`,
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  children.push(child);
  // Poll the CDP endpoint for its webSocketDebuggerUrl.
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (res.ok) {
        const body = (await res.json()) as { webSocketDebuggerUrl?: string };
        if (typeof body.webSocketDebuggerUrl === "string") {
          return { cdpPort, cdpWebSocketUrl: body.webSocketDebuggerUrl, child };
        }
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("CDP endpoint did not come up");
}

describe("DetectorUrlAdapter — REAL url-watcher over REAL CDP against a stub site (the core proof; GLA-042/043)", () => {
  it.runIf(CHROMIUM !== undefined)(
    "drive a capsule /register → /verify → /dashboard; the url-watcher FIRES on /verify then /dashboard for REAL",
    async () => {
      const site = await startStubSite();
      closers.push(site.close);
      const cdp = await spawnChromiumWithCdp();

      // The runtime handle the detector reads the CDP endpoint off (exactly as the launcher encodes it).
      const handle = encodeRuntimeHandle({
        mode: "headless",
        cdpWebSocketUrl: cdp.cdpWebSocketUrl,
        cdpPort: cdp.cdpPort,
      }) as RuntimeHandle;

      // Connect a Playwright client over CDP to DRIVE the capsule's page (the agent's work channel).
      const browser = await chromium.connectOverCDP(cdp.cdpWebSocketUrl);
      browsers.push(browser);
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(`${site.base}/register`);

      // Start the REAL url-watcher (it reads the active target's URL off the capsule's CDP `/json`).
      const detector = new DetectorUrlAdapter({ pollMs: 100 });
      const collected: RawCompletionSignal[] = [];
      const watchDone = (async () => {
        for await (const sig of detector.watch(handle, {
          complete_on: "/dashboard",
          intermediate: "/verify",
        })) {
          collected.push(sig);
          if (sig.status === "url-complete") {
            return;
          }
        }
      })();

      // Drive the navigation: /register → /verify → /dashboard, giving the watcher time to observe each.
      await new Promise((r) => setTimeout(r, 250));
      await page.goto(`${site.base}/verify`);
      await new Promise((r) => setTimeout(r, 350));
      await page.goto(`${site.base}/dashboard`);

      // The watch resolves once it sees the complete URL.
      await Promise.race([
        watchDone,
        new Promise((_r, rej) => {
          const t = setTimeout(() => rej(new Error("watch did not complete in time")), 20_000);
          t.unref?.();
        }),
      ]);

      // The url-watcher FIRED for real: an intermediate on /verify, then the complete on /dashboard.
      const intermediate = collected.find((s) => s.status === "url-intermediate");
      const complete = collected.find((s) => s.status === "url-complete");
      expect(intermediate, "url-watcher should fire on /verify").toBeDefined();
      expect(String(intermediate?.result?.url)).toContain("/verify");
      expect(complete, "url-watcher should fire on /dashboard").toBeDefined();
      expect(String(complete?.result?.url)).toContain("/dashboard");
      expect(complete?.detector).toBe(DETECTOR_URL_NAME);

      await ctx.close().catch(() => {});
    },
    90_000,
  );

  it.skipIf(CHROMIUM !== undefined)("REAL url-watcher SKIPPED — no cached Chromium", () => {
    expect(CHROMIUM).toBeUndefined();
  });
});
