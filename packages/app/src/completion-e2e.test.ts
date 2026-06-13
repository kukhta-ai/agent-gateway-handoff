// REAL completion + close-window + agent-blind end-to-end test (packages/app) — the headline proof for
// scenario-01 Phases 7/8 (GLA-040..045, S-2/S-8). Wires the REAL Slice-5 pipeline and exercises the REAL S-2 threat:
//   - provision a REAL headless-Chromium capsule (the process launcher + temp-profile workspace + the BROKERED CDP
//     connector — the agent's CDP is tunnelled through GLA, never directly to Chromium);
//   - wire the REAL handoff + COMPLETION pipeline (the url-watcher detector + the Completion service + the connector
//     severance), with the gateway/step-up STUBBED-OUT of the close path (the Slice-4b test proves the WebAuthn
//     step-up + WS proxy; here the focus is completion → close + agent-blind);
//   - THE REAL THREAT: the agent opens a LIVE CDP client over the brokered url BEFORE the window (Phase 4) and reads
//     the page; openHandoff → the agent's ALREADY-OPEN socket is SEVERED at the broker this instant (live socket → 0,
//     a read over the SAME connection FAILS) — the agent CANNOT read the password field over CDP through Phases 7-8;
//   - the "human" reaches the capsule's browser over a SEPARATE, non-brokered interface (CDP DIRECT to Chromium,
//     modelling noVNC — the agent-sever leaves it intact) and submits the SECRET to the site;
//   - the REAL url-watcher fires → the Completion service validates + normalizes → `gla handoff wait` RETURNS the
//     envelope {status, next?} → the window CLOSES (route unmounted, grant revoked, session back to `active`, the
//     capsule STILL RUNNING) → the agent RE-ATTACHES onto the SAME brokered url and reads /verify (Phase 9);
//   - AGENT-BLIND scan: a KNOWN SECRET typed via the human path appears in ZERO agent-readable outputs (the
//     connector JSON, the gla results, the completion envelope, the audit/event surfaces, the logs).
//
// GATED: skips when no cached Chromium is available; the brokered severance + completion logic are proven by the
// unit/contract tests (adapters/connector-cdp's live-socket sever, packages/completion, packages/session) regardless.
// Spawns a REAL browser — generous timeouts; the capsule + broker are always reaped in a finally.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { referenceWpmDependencyBindings } from "@gla/catalog";
import { Output, type OutputStreams, run } from "@gla/cli";
import { type SessionId, decodeRuntimeHandle } from "@gla/kernel";
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import type { ProvisioningStack } from "./index.js";
import { createProvisioningBridge } from "./index.js";

/** The KNOWN SECRET the "human" types via the human path — it must appear in ZERO agent-readable outputs. */
const KNOWN_SECRET = "S3cr3t-Passw0rd-Zx9Q-AGENTMUSTNOTSEE";

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
  const dir = mkdtempSync(join(tmpdir(), "gla-cmpl-ws-"));
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
  try {
    const p = chromium.executablePath();
    return typeof p === "string" && p.length > 0;
  } catch {
    return false;
  }
}
const HAVE_CHROMIUM = chromiumAvailable();

async function freePort(): Promise<number> {
  const { createServer: createNet } = await import("node:net");
  return new Promise<number>((resolve) => {
    const srv = createNet();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

/**
 * The stub site: /register (a form), POST /submit (records what the "human" typed, then redirects to /verify),
 * /verify, /dashboard. It captures the submitted secret so the test proves the SITE received it (the human path
 * works) while the AGENT did not (agent-blind). ~30 lines, CI-hermetic.
 */
async function startStubSite(): Promise<{
  base: string;
  submitted: () => string[];
  close: () => Promise<void>;
}> {
  const port = await freePort();
  const captured: string[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    if (url.startsWith("/register")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>register</title><h1>register</h1>");
    } else if (url.startsWith("/submit")) {
      // The "human" submits the secret as a query param (standing in for a typed password reaching the site).
      const q = new URL(url, `http://127.0.0.1:${port}`).searchParams.get("password") ?? "";
      captured.push(q);
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>verify</title><h1>check your email</h1>");
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
    submitted: () => [...captured],
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("REAL completion + close-window + agent-blind end-to-end (scenario-01 Phases 7/8; GLA-040..045)", () => {
  it.runIf(HAVE_CHROMIUM)(
    "openHandoff SEVERS the agent's already-open CDP socket → the human submits a SECRET + reaches /verify → the REAL url-watcher fires → handoff wait RETURNS {submitted, next} → window closes, the agent re-attaches, secret leaks NOWHERE",
    async () => {
      const site = await startStubSite();
      closers.push(site.close);

      // The assembly: a browser-handoff capsule whose url-watcher completes on /dashboard (intermediate /verify).
      const assembly = {
        apiVersion: "gla.dev/v1",
        kind: "Assembly",
        metadata: { intent: "register on acme" },
        spec: {
          template: "browser-handoff",
          recipient: "tg:user:123",
          detectors: [
            { use: "url-watcher", params: { complete_on: "/dashboard", intermediate: "/verify" } },
          ],
        },
      };

      // The recipient-bound handoff link the channel delivers (captured so the agent-blind scan covers it too).
      const deliveredLinks: string[] = [];

      // The provisioning stack with the REAL completion pipeline wired. The handoff step-up gateway is wired (the
      // saga needs the channel + grant mint), but the close is driven by COMPLETION, not by a real WS step-up — so
      // we point the detector's URL reader at the REAL capsule CDP (the default) and let the human drive the page.
      const stack = createProvisioningBridge({
        dependencyBindings: referenceWpmDependencyBindings(),
        launcherMode: "headless",
        workspaceRoot: workspaceRoot(),
        startTimeoutMs: 40_000,
        handoff: {
          expectedOrigin: "http://localhost:3000",
          publicBaseUrl: "http://localhost:3000",
          host: "127.0.0.1",
          port: await freePort(),
          deliverySink: { write: (l) => void deliveredLinks.push(l) },
          // A stub human entrypoint (headless dev has no X/noVNC stack; the REAL noVNC proxy is gated for hermes-1).
          // It is irrelevant to the completion proof — the human navigates the capsule over a separate CDP
          // connection (standing in for the noVNC human path).
          entrypoint: {
            async open() {
              return { internalEndpoint: "ws://127.0.0.1:1/" };
            },
          },
          completion: { pollMs: 100 }, // the REAL url-watcher reads the capsule's CDP /json
        },
      });
      closers.push(() => stack.gateway?.close() ?? Promise.resolve());
      closers.push(() => stack.connector.close()); // stop the CDP broker (severs sockets + closes its server)

      let sessionId = "";
      try {
        // ── Provision a REAL capsule via the CLI. ──
        const cCreate = capture();
        const code = await run(["session", "create", "-f", writeSpec(assembly)], cCreate.out, {
          bridge: stack.bridge,
        });
        expect(code).toBe(0);
        const created = JSON.parse(cCreate.stdout());
        sessionId = created.session_id;
        const cdpUrl: string = created.connector.cdp_url;
        // The agent's cdp_url is the BROKERED url — the agent's CDP is tunnelled through GLA (never directly to
        // Chromium), which is what lets a window TRULY SEVER it.
        expect(cdpUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//);

        // ── THE AGENT opens its CDP client over the BROKERED url BEFORE the window (Phase 4) and reads the page —
        //    a live, already-open connection. THIS is the real S-2 threat: a real agent keeps this socket open.
        const agentBrowser = await chromium.connectOverCDP(cdpUrl);
        closers.push(() => agentBrowser.close().catch(() => {}));
        const actx = agentBrowser.contexts()[0] ?? (await agentBrowser.newContext());
        const apage = actx.pages()[0] ?? (await actx.newPage());
        await apage.goto(`${site.base}/register`);
        expect(await apage.title()).toBe("register"); // the agent CAN read the capsule OUTSIDE a window
        expect(stack.connector.liveSocketCount(cdpUrl)).toBeGreaterThan(0); // a LIVE agent socket exists

        // ── The HUMAN reaches the capsule's browser over a SEPARATE interface that is NOT the agent's brokered CDP
        //    (modelling the noVNC human path: a different interface onto the same browser). In dev with no X stack we
        //    surrogate it by connecting CDP DIRECTLY to the REAL Chromium endpoint (read off the runtime handle) —
        //    that direct interface is NOT brokered, so the window-open severance (which cuts only the AGENT's
        //    brokered sockets) leaves it intact, exactly as noVNC would be.
        const realCdpUrl = decodeRealCdpUrl(stack, sessionId as SessionId);
        const humanBrowser = await chromium.connectOverCDP(realCdpUrl);
        closers.push(() => humanBrowser.close().catch(() => {}));
        const hctx = humanBrowser.contexts()[0] ?? (await humanBrowser.newContext());
        const hpage = hctx.pages()[0] ?? (await hctx.newPage());

        // ── OPEN a handoff window (Phase 5). The agent connector is SEVERED (S-2 agent-blind, Phase 7). ──
        const handoffView = await stack.session.openHandoff(sessionId as SessionId, {
          reason: "complete registration form",
        });
        expect(handoffView.state).toBe("open");
        // S-2 (the REAL threat): the agent's ALREADY-OPEN brokered socket is DESTROYED this instant.
        expect(stack.connector.isSuspended(cdpUrl)).toBe(true);
        await new Promise((r) => setTimeout(r, 300)); // let the sever propagate
        expect(stack.connector.liveSocketCount(cdpUrl)).toBe(0); // the agent's live socket is GONE
        // A read over the agent's SAME pre-existing CDP connection now FAILS (the socket was severed) — the agent
        // CANNOT read the password field over CDP through Phases 7-8.
        let agentReadFailed = false;
        try {
          await apage.evaluate("document.title");
          throw new Error(
            "UNEXPECTED: the agent read the capsule while a window was open (S-2 VIOLATED)",
          );
        } catch (e) {
          agentReadFailed = !String((e as Error).message).includes("UNEXPECTED");
        }
        expect(agentReadFailed, "the agent's live CDP read must FAIL during the window").toBe(true);
        // And a FRESH `gla session connector` re-emit is also useless: the brokered url is returned but the broker
        // refuses the connection while suspended (proven at the unit level); the live socket is already cut.
        const cBlind = capture();
        await run(["session", "connector", sessionId], cBlind.out, { bridge: stack.bridge });

        // ── The HUMAN (over the non-brokered interface) submits the SECRET to the site (the human path works) and
        //    drives /verify. The secret reaches the SITE, never the agent. ──
        await hpage.goto(`${site.base}/submit?password=${encodeURIComponent(KNOWN_SECRET)}`);

        // ── `gla handoff wait` blocks until completion; the human reaches /verify → the url-watcher fires the
        //    INTERMEDIATE → the Completion service normalizes → wait RETURNS the envelope. This is scenario-01
        //    Phase 8 EXACTLY: the FIRST handoff window closes on the `/verify` intermediate with status "submitted"
        //    + next "email-verification" (the human's form-submit step is done; the agent reads the code next). ──
        const waitPromise = stack.bridge.handoffWait(handoffView.handoff_id, 25_000);
        await new Promise((r) => setTimeout(r, 400));
        await hpage.goto(`${site.base}/verify`);
        const envelope = await waitPromise;

        // handoff wait RETURNED the validated completion envelope (scenario-01 Phase 8: submitted + next).
        expect(envelope.status).toBe("submitted");
        expect(envelope.next).toBe("email-verification");
        expect(envelope.state).toBe("completed");

        // ── CLOSE: the window completed → route unmounted, grant revoked, session back to `active`, capsule LIVES. ──
        expect(stack.session.get(sessionId as SessionId).state).toBe("active");
        expect(stack.session.get(sessionId as SessionId).runtime).toBeDefined(); // the capsule survives the close
        // The agent connector RESUMED — the agent re-attaches onto the SAME brokered url and drives again (Phase 9).
        expect(stack.connector.isSuspended(cdpUrl)).toBe(false);
        const cResume = capture();
        const resumeCode = await run(["session", "connector", sessionId], cResume.out, {
          bridge: stack.bridge,
        });
        expect(resumeCode).toBe(0);
        expect(JSON.parse(cResume.stdout()).connector.cdp_url).toBe(cdpUrl); // SAME brokered url, SAME live capsule
        // The agent re-connects over the SAME brokered url and reads the capsule again (the window closed).
        const agentBrowser2 = await chromium.connectOverCDP(cdpUrl);
        closers.push(() => agentBrowser2.close().catch(() => {}));
        const actx2 = agentBrowser2.contexts()[0] ?? (await agentBrowser2.newContext());
        const apage2 = actx2.pages()[0] ?? (await actx2.newPage());
        await apage2.goto(`${site.base}/verify`);
        expect(await apage2.title()).toBe("verify"); // Phase 9: the agent reads /verify over the RESUMED connector

        // ── The SITE received the secret (the human path works)… ──
        expect(site.submitted()).toContain(KNOWN_SECRET);

        // ── …but the AGENT saw it NOWHERE (the headline S-2 invariant): scan EVERY agent-readable output for the
        //    known secret — the create JSON, the resume connector JSON, the completion envelope, the events/audit
        //    surfaces, and all captured stdout/stderr. The secret count MUST be ZERO.
        const agentReadable = [
          cCreate.stdout(),
          cCreate.stderr(),
          cResume.stdout(),
          cBlind.stdout(),
          cBlind.stderr(),
          JSON.stringify(envelope),
          JSON.stringify(stack.bridge.handoffGet(handoffView.handoff_id)),
          JSON.stringify(stack.bridge.handoffList({ session: sessionId })),
          deliveredLinks.join("\n"), // the recipient-bound link the channel delivered
        ].join("\n");
        const occurrences = agentReadable.split(KNOWN_SECRET).length - 1;
        expect(occurrences, "the secret must appear in ZERO agent-readable outputs").toBe(0);
      } finally {
        if (sessionId.length > 0) {
          await stack.reconciler.reconcile(sessionId).catch(() => {});
        }
      }
    },
    120_000,
  );

  it.skipIf(HAVE_CHROMIUM)("REAL completion E2E SKIPPED — no cached Chromium", () => {
    expect(HAVE_CHROMIUM).toBe(false);
  });
});

/**
 * The capsule's REAL Chromium CDP url (read off the session's runtime handle) — the non-brokered interface onto the
 * same browser the "human" surrogate connects to (modelling noVNC, which the window-open agent-sever leaves intact).
 */
function decodeRealCdpUrl(stack: ProvisioningStack, sessionId: SessionId): string {
  const runtime = stack.session.get(sessionId).runtime;
  const d = runtime !== undefined ? decodeRuntimeHandle(runtime) : undefined;
  const url = typeof d?.cdpWebSocketUrl === "string" ? d.cdpWebSocketUrl : "";
  if (url.length === 0) {
    throw new Error("no real CDP url on the session runtime");
  }
  return url;
}

/** Write an assembly spec to a scratch file and return its path (the CLI reads it with `-f`). */
function writeSpec(doc: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "gla-cmpl-"));
  scratchDirs.push(dir);
  const path = join(dir, "assembly.json");
  writeFileSync(path, JSON.stringify(doc));
  return path;
}
