// REAL TWO-HANDOFF end-to-end test (packages/app) — the HEADLINE proof for scenario-01 Phases 9–14 (Slice 6).
// Runs the FULL second-handoff scenario on a REAL headless-Chromium capsule + a REAL Access Gateway (WebAuthn
// step-up + WS proxy + auth-REUSE) + the REAL completion/close + agent-blind pipeline, proving most Slice-6 deltas
// in ONE flow:
//   - ENROLL the recipient (the precondition) on the REAL gateway via a CDP virtual authenticator (Phase E).
//   - PROVISION a REAL capsule; the agent drives `/register` over its BROKERED CDP connector (Phase 4, GLA-026/027).
//   - WINDOW 1: openHandoff → the agent's already-open CDP socket is SEVERED (S-2 agent-blind); the human reaches the
//     capsule via the gateway (REAL WebAuthn step-up against the enrolled credential — Phase 6) and submits agent-blind
//     (Phase 7); the REAL url-watcher fires on `/verify` → `gla handoff wait` RETURNS {submitted, next} (Phase 8); the
//     window CLOSES (route unmounted, grant revoked, session back to `active`, capsule STILL RUNNING).
//   - Phase 9 (GLA-046/047): the agent RE-ATTACHES onto the SAME brokered url and reads `/verify` (inspect after window 1).
//   - WINDOW 2 (Phase 11): RE-OPEN onto the SAME capsule (GLA-048/049 — same capsule id, no re-spawn).
//   - Phase 12 (GLA-050/051/052/053 — the NEW mechanism): the human opens the second link and AUTH IS REUSED — the
//     gateway serves the REUSED-AUTH page (NO second WebAuthn ceremony) and the step-up seam is NOT invoked the second
//     time (asserted); the reused-auth WS upgrade is PROXIED to the SAME capsule.
//   - Phase 12 cont. (GLA-054/055): the human enters the verification CODE agent-blind (the agent is severed again); the
//     code reaches the SITE, never the agent.
//   - Phase 13 (GLA-056/057/058/059): the url-watcher fires on `/dashboard` → `handoff wait` RETURNS {verified}; the
//     SECOND window CLOSES (same close path); session back to `active`, capsule lives.
//   - Phase 14 (GLA-060/061/062/063): the agent CONFIGURES the account on `/dashboard` over the RESUMED connector; the
//     session stays active for the agent.
//   - AGENT-BLIND scan: a KNOWN password + a KNOWN code typed via the human path appear in ZERO agent-readable outputs.
//
// GATED: skips when no cached Chromium; the reuse logic + completion + severance are proven by the unit/contract tests
// (packages/gateway/src/handoff.test.ts auth-reuse block, packages/completion, adapters/connector-cdp) regardless.
// Spawns REAL browsers — generous timeouts; the capsule + broker + gateway are always reaped in a finally/afterAll.

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { type AddressInfo, createServer as createNet } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthWebauthnProvider } from "@gla/auth-webauthn";
import { referenceWpmDependencyBindings } from "@gla/catalog";
import { Output, type OutputStreams, run } from "@gla/cli";
import { IdentityService } from "@gla/identity";
import {
  type AuthStrength,
  type RecipientRef,
  type SessionId,
  decodeRuntimeHandle,
} from "@gla/kernel";
import { type Browser, type CDPSession, type Page, chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import type { ProvisioningStack } from "./index.js";
import { createProvisioningBridge } from "./index.js";

/** The KNOWN secrets the "human" types via the human path — each must appear in ZERO agent-readable outputs. */
const KNOWN_PASSWORD = "S3cr3t-Passw0rd-Zx9Q-AGENTMUSTNOTSEE";
const KNOWN_CODE = "VERIFY-CODE-7Q2X-AGENTMUSTNOTSEE";
const recipient = "tg:user:123" as RecipientRef;

function chromiumAvailable(): boolean {
  try {
    const p = chromium.executablePath();
    return typeof p === "string" && p.length > 0;
  } catch {
    return false;
  }
}
const HAVE_CHROMIUM = chromiumAvailable();

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
  const dir = mkdtempSync(join(tmpdir(), "gla-2hand-ws-"));
  scratchDirs.push(dir);
  return dir;
}
function writeSpec(doc: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "gla-2hand-"));
  scratchDirs.push(dir);
  const path = join(dir, "assembly.json");
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

const browsers: Browser[] = [];
const closers: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const b of browsers) {
    await b.close().catch(() => {});
  }
  for (const c of closers) {
    await Promise.resolve(c()).catch(() => {});
  }
  for (const d of scratchDirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

async function freePort(): Promise<number> {
  return new Promise<number>((resolve) => {
    const srv = createNet();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

/**
 * The stub site for the two-handoff flow: `/register` (a form), POST `/submit` (records the typed password, then
 * "check your email" = `/verify`), `/verify` (the page the agent reads in Phase 9), POST `/code` (records the typed
 * verification code, then the dashboard), `/dashboard`. It captures the submitted secrets so the test proves the SITE
 * received them (the human path works) while the AGENT did not (agent-blind). CI-hermetic.
 */
async function startStubSite(): Promise<{
  base: string;
  submittedPasswords: () => string[];
  submittedCodes: () => string[];
  close: () => Promise<void>;
}> {
  const port = await freePort();
  const passwords: string[] = [];
  const codes: string[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const u = new URL(url, `http://127.0.0.1:${port}`);
    if (url.startsWith("/register")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>register</title><h1>register</h1>");
    } else if (url.startsWith("/submit")) {
      passwords.push(u.searchParams.get("password") ?? "");
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>verify</title><h1>check your email</h1>");
    } else if (url.startsWith("/verify")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>verify</title><h1>enter the code from your email</h1>");
    } else if (url.startsWith("/code")) {
      codes.push(u.searchParams.get("code") ?? "");
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>dashboard</title><h1>welcome</h1>");
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
    submittedPasswords: () => [...passwords],
    submittedCodes: () => [...codes],
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** The RFC-6455 Sec-WebSocket-Accept for a client key (so a REAL browser WebSocket completes the handshake). */
function wsAccept(key: string): string {
  return createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
}
/** Encode a short text string as an unmasked RFC-6455 WS text frame (server→client frames are unmasked). */
function encodeWsTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

/**
 * A stub WS upstream standing in for the capsule's noVNC endpoint (real noVNC needs X, gated for hermes-1). It
 * completes a PROPER RFC-6455 handshake (computing Sec-WebSocket-Accept from the client's key) so a REAL browser
 * WebSocket — which strictly validates the handshake — opens; then it sends a hello marker as a WS text frame.
 */
function startStubUpstream(): Promise<{ endpoint: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.on("upgrade", (req, socket) => {
      const key = (req.headers["sec-websocket-key"] as string | undefined) ?? "";
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`,
      );
      socket.write(encodeWsTextFrame("UPSTREAM_NOVNC_HELLO"));
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        endpoint: `ws://127.0.0.1:${port}/`,
        close: () =>
          new Promise<void>((r) => {
            (server as { closeAllConnections?: () => void }).closeAllConnections?.();
            const t = setTimeout(r, 200);
            t.unref?.();
            server.close(() => r());
          }),
      });
    });
  });
}

/** Add a CTAP2 internal virtual authenticator (user-verified) to a page's context. */
async function addVirtualAuthenticator(session: CDPSession): Promise<void> {
  await session.send("WebAuthn.enable");
  await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

/** Drive the gateway ENROLLMENT page (registration) in the browser; returns the terminal status text. */
async function runEnrollment(page: Page, link: string): Promise<string> {
  await page.goto(link);
  await page.click("#go");
  await page.waitForFunction(
    `(() => { const el = document.getElementById("status"); const t = (el && el.textContent) || ""; return t.includes("Enrolled") || t.includes("try again") || t.includes("invalid"); })()`,
    undefined,
    { timeout: 30_000 },
  );
  return (await page.locator("#status").textContent()) ?? "";
}

/** Drive the gateway HANDOFF STEP-UP page (window 1): click verify; wait for the step-up outcome. */
async function runStepUp(page: Page, link: string): Promise<string> {
  await page.goto(link);
  await page.click("#go");
  await page.waitForFunction(
    `(() => { const el = document.getElementById("status"); const t = (el && el.textContent) || ""; return t.includes("Connected") || t.includes("Verified") || t.includes("try again") || t.includes("invalid") || t.includes("closed"); })()`,
    undefined,
    { timeout: 30_000 },
  );
  return (await page.locator("#status").textContent()) ?? "";
}

/**
 * A step-up-COUNTING identity wrapper: it delegates to a real {@link IdentityService} but counts the gateway-facing
 * step-up calls (`authenticationOptions` + `verifyAuthentication`) so the test can assert the SECOND window invoked
 * ZERO of them (auth reused — GLA-050/051). It also forwards the enroll seams so the same gateway can enroll. The
 * counters are the headline assertion for "the step-up was NOT invoked the second time."
 */
class CountingIdentity {
  authOptionsCalls = 0;
  verifyCalls = 0;
  constructor(private readonly inner: IdentityService) {}
  // Enroll seams (IdentityEnrollPort) — forwarded unchanged.
  enrollmentOptions(
    r: RecipientRef,
    discharge: import("@gla/kernel").OpaqueToken,
  ): Promise<unknown> {
    return this.inner.enrollmentOptions(r, discharge);
  }
  enrollComplete(r: RecipientRef, attestation: unknown): Promise<unknown> {
    return this.inner.enrollComplete(r, attestation);
  }
  // Step-up seams (IdentityStepUpPort) — COUNTED.
  isEnrolled(r: RecipientRef): boolean {
    return this.inner.isEnrolled(r);
  }
  authenticationOptions(r: RecipientRef): Promise<unknown> {
    this.authOptionsCalls++;
    return this.inner.authenticationOptions(r);
  }
  verifyAuthentication(
    r: RecipientRef,
    assertion: unknown,
  ): Promise<{ ok: boolean; authStrength: AuthStrength; userId: string }> {
    this.verifyCalls++;
    return this.inner.verifyAuthentication(r, assertion);
  }
}

/** The capsule's REAL Chromium CDP url (the non-brokered interface the "human" surrogate drives — models noVNC). */
function realCdpUrl(stack: ProvisioningStack, sessionId: SessionId): string {
  const runtime = stack.session.get(sessionId).runtime;
  const d = runtime !== undefined ? decodeRuntimeHandle(runtime) : undefined;
  const url = typeof d?.cdpWebSocketUrl === "string" ? d.cdpWebSocketUrl : "";
  if (url.length === 0) {
    throw new Error("no real CDP url on the session runtime");
  }
  return url;
}

describe("REAL two-handoff end-to-end (scenario-01 Phases 9–14; Slice 6 deltas + auth reuse)", () => {
  it.runIf(HAVE_CHROMIUM)(
    "window 1 submitted → inspect /verify → re-open SAME capsule → window 2 AUTH REUSED (no second ceremony) → code agent-blind → /dashboard verified → configure; secrets leak NOWHERE",
    async () => {
      const site = await startStubSite();
      closers.push(site.close);
      const upstream = await startStubUpstream();
      closers.push(upstream.close);

      const gwPort = await freePort();
      const origin = `http://localhost:${gwPort}`;

      // ONE shared identity (enroll + step-up against the SAME credential), wrapped to COUNT step-up calls.
      const authProvider = new AuthWebauthnProvider({
        rpID: "localhost",
        rpName: "GLA two-handoff test",
        expectedOrigin: origin,
      });
      const baseIdentity = new IdentityService({ authProvider });
      const countingIdentity = new CountingIdentity(baseIdentity);

      // The url-watcher reads the REAL capsule's active URL over CDP; here we point it at the SAME real CDP the human
      // drives, so a human navigation (over the non-brokered interface) drives completion. complete_on `/dashboard`,
      // intermediate `/verify` — the scenario-01 mapping (Phase 8 submitted on /verify; Phase 13 verified on /dashboard).
      const deliveredLinks: string[] = [];
      const assembly = {
        apiVersion: "gla.dev/v1",
        kind: "Assembly",
        metadata: { intent: "register on acme" },
        spec: {
          template: "browser-handoff",
          recipient,
          detectors: [
            { use: "url-watcher", params: { complete_on: "/dashboard", intermediate: "/verify" } },
          ],
        },
      };

      const stack = createProvisioningBridge({
        dependencyBindings: referenceWpmDependencyBindings(),
        launcherMode: "headless",
        workspaceRoot: workspaceRoot(),
        startTimeoutMs: 40_000,
        handoff: {
          rpID: "localhost",
          expectedOrigin: origin,
          publicBaseUrl: origin,
          host: "127.0.0.1",
          port: gwPort,
          // Inject the COUNTING identity (so it is BOTH the step-up seam AND the enroll seam on the gateway).
          identity: countingIdentity as unknown as IdentityService,
          deliverySink: { write: (l) => void deliveredLinks.push(l) },
          // The gateway proxies the human's WS upgrade to the stub noVNC upstream (real noVNC gated for hermes-1).
          entrypoint: {
            async open() {
              return { internalEndpoint: upstream.endpoint };
            },
          },
          completion: { pollMs: 100 }, // the REAL url-watcher reads the capsule's CDP /json active URL
        },
      });
      closers.push(() => stack.gateway?.close() ?? Promise.resolve());
      closers.push(() => stack.connector.close());

      // The provisioning bridge constructs the gateway but does not bind it — start listening so the REAL enrollment +
      // step-up + reused-auth pages + WS proxy are reachable over HTTP on the ephemeral port.
      await stack.gateway?.listen();

      // The human's browser context (a virtual authenticator) — used for enrollment + the window-1 step-up.
      const humanGwBrowser = await chromium.launch({ headless: true });
      browsers.push(humanGwBrowser);
      const hctxGw = await humanGwBrowser.newContext();
      const hpageGw = await hctxGw.newPage();
      const hcdpGw = await hctxGw.newCDPSession(hpageGw);
      await addVirtualAuthenticator(hcdpGw);

      let sessionId = "";
      try {
        // ── Phase E — ENROLL the recipient (the precondition) on the REAL gateway. ──
        const invite = await stack.enrollInvite?.(recipient);
        if (invite === undefined) {
          throw new Error("enrollInvite not wired");
        }
        const enrollLink = invite.link.replace("127.0.0.1", "localhost");
        expect(await runEnrollment(hpageGw, enrollLink)).toMatch(/Enrolled/i);
        expect(stack.identity?.isEnrolled(recipient)).toBe(true);

        // ── Phase 3/4 — PROVISION a REAL capsule; the agent drives /register over the BROKERED connector. ──
        const cCreate = capture();
        const code = await run(["session", "create", "-f", writeSpec(assembly)], cCreate.out, {
          bridge: stack.bridge,
        });
        expect(code).toBe(0);
        const created = JSON.parse(cCreate.stdout());
        sessionId = created.session_id;
        const cdpUrl: string = created.connector.cdp_url;
        expect(cdpUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//);
        const capsuleId1: string = created.capsule.id;

        const agentBrowser = await chromium.connectOverCDP(cdpUrl);
        closers.push(() => agentBrowser.close().catch(() => {}));
        const actx = agentBrowser.contexts()[0] ?? (await agentBrowser.newContext());
        const apage = actx.pages()[0] ?? (await actx.newPage());
        await apage.goto(`${site.base}/register`); // GLA-026/027: the agent drives the capsule via the connector
        expect(await apage.title()).toBe("register");

        // The "human" drives the REAL capsule over a SEPARATE non-brokered interface (models noVNC). The window-open
        // severance cuts only the AGENT's brokered sockets, leaving this intact.
        const realUrl = realCdpUrl(stack, sessionId as SessionId);
        const humanCapsuleBrowser = await chromium.connectOverCDP(realUrl);
        closers.push(() => humanCapsuleBrowser.close().catch(() => {}));
        const hcctx = humanCapsuleBrowser.contexts()[0] ?? (await humanCapsuleBrowser.newContext());
        const hcpage = hcctx.pages()[0] ?? (await hcctx.newPage());

        // ════════════════════ WINDOW 1 (Phases 5–8) ════════════════════
        const view1 = await stack.session.openHandoff(sessionId as SessionId, {
          reason: "complete registration form",
        });
        expect(view1.state).toBe("open");
        // S-2: the agent's brokered socket is severed the instant the window opens.
        expect(stack.connector.isSuspended(cdpUrl)).toBe(true);

        // The human reaches the capsule via the gateway: REAL WebAuthn step-up (Phase 6) → the grant is authorized.
        // We assert the SERVER-side outcome (the ceremony ran + verified + authorized the grant), not the brittle
        // browser WS status (which can race to "closed" after a successful verify — the documented handoff-e2e
        // posture); the proxy reach is then proven deterministically by the raw-socket upgrade below.
        await runStepUp(hpageGw, view1.link.replace("127.0.0.1", "localhost"));
        // The step-up seam WAS invoked for window 1 (the baseline against which window 2 reuses).
        expect(countingIdentity.verifyCalls).toBe(1);
        // The grant-1 was authorized server-side, and a raw WS upgrade is PROXIED to the capsule (reach proven).
        const grant1 = new URL(view1.link).searchParams.get("grant") ?? "";
        const reached1 = await rawUpgrade(origin, new URL(view1.link).pathname, grant1);
        expect(reached1).toContain("UPSTREAM_NOVNC_HELLO");

        // The human (over the non-brokered interface) submits the PASSWORD agent-blind, then reaches /verify.
        const waitPromise1 = stack.bridge.handoffWait(view1.handoff_id, 25_000);
        await hcpage.goto(`${site.base}/submit?password=${encodeURIComponent(KNOWN_PASSWORD)}`);
        await new Promise((r) => setTimeout(r, 300));
        await hcpage.goto(`${site.base}/verify`);
        const env1 = await waitPromise1;

        // Phase 8: handoff wait RETURNED {submitted, next} and the window CLOSED.
        expect(env1.status).toBe("submitted");
        expect(env1.next).toBe("email-verification");
        expect(env1.state).toBe("completed");
        expect(stack.session.get(sessionId as SessionId).state).toBe("active"); // session back to active
        expect(stack.session.get(sessionId as SessionId).runtime).toBeDefined(); // capsule LIVES
        expect(stack.connector.isSuspended(cdpUrl)).toBe(false); // connector RESUMED

        // ── Phase 9 (GLA-046/047) — the agent RE-ATTACHES and reads /verify on the still-running capsule. ──
        const cResume = capture();
        const resumeCode = await run(["session", "connector", sessionId], cResume.out, {
          bridge: stack.bridge,
        });
        expect(resumeCode).toBe(0);
        expect(JSON.parse(cResume.stdout()).connector.cdp_url).toBe(cdpUrl); // SAME brokered url, SAME capsule
        const agentBrowser2 = await chromium.connectOverCDP(cdpUrl);
        closers.push(() => agentBrowser2.close().catch(() => {}));
        const actx2 = agentBrowser2.contexts()[0] ?? (await agentBrowser2.newContext());
        const apage2 = actx2.pages()[0] ?? (await actx2.newPage());
        await apage2.goto(`${site.base}/verify`);
        expect(await apage2.title()).toBe("verify"); // GLA-047: the agent inspects /verify after window 1

        // ════════════════════ WINDOW 2 (Phases 11–13) ════════════════════
        // ── Phase 11 (GLA-048/049) — RE-OPEN onto the SAME capsule (no re-spawn). ──
        const view2 = await stack.session.openHandoff(sessionId as SessionId, {
          reason: "enter verification code",
        });
        expect(view2.state).toBe("open");
        expect(view2.handoff_id).not.toBe(view1.handoff_id); // a NEW window…
        expect(stack.session.get(sessionId as SessionId).runtime).toBeDefined(); // …on the SAME live capsule
        // The capsule id is unchanged (re-open, not re-provision) — read it back off `session connector`.
        const cReopen = capture();
        await run(["session", "connector", sessionId], cReopen.out, { bridge: stack.bridge });
        expect(JSON.parse(cReopen.stdout()).capsule.id).toBe(capsuleId1); // SAME capsule id (GLA-048/049)
        expect(stack.connector.isSuspended(cdpUrl)).toBe(true); // S-2 severs the agent again (window 2)

        // ── Phase 12 (GLA-050/051/052/053) — AUTH REUSE: the second link opens with NO fresh ceremony. ──
        // The gateway serves the REUSED-AUTH page for window 2's grant (recipient's prior step-up still valid).
        const verifyCallsBefore = countingIdentity.verifyCalls;
        const pageRes = await fetch(view2.link.replace("127.0.0.1", "localhost"));
        expect(pageRes.status).toBe(200);
        const pageHtml = await pageRes.text();
        expect(pageHtml).toContain("already verified"); // the reused-auth page (no "Verify with passkey" prompt)
        expect(pageHtml).not.toContain("Verify with passkey");
        // THE HEADLINE ASSERTION: the step-up seam was NOT invoked for window 2 (auth reused — GLA-050/051).
        expect(countingIdentity.verifyCalls).toBe(verifyCallsBefore);
        expect(countingIdentity.verifyCalls).toBe(1); // still just the ONE window-1 ceremony

        // The reused-auth WS upgrade is PROXIED to the SAME capsule (GLA-052/053 — reach on the reused-auth window).
        const grant2 = new URL(view2.link).searchParams.get("grant") ?? "";
        const reached = await rawUpgrade(origin, new URL(view2.link).pathname, grant2);
        expect(reached).toContain("UPSTREAM_NOVNC_HELLO");

        // ── Phase 12 cont. (GLA-054/055) — the human enters the CODE agent-blind; it reaches the SITE, never the agent. ──
        const waitPromise2 = stack.bridge.handoffWait(view2.handoff_id, 25_000);
        await hcpage.goto(`${site.base}/code?code=${encodeURIComponent(KNOWN_CODE)}`);
        await new Promise((r) => setTimeout(r, 300));
        await hcpage.goto(`${site.base}/dashboard`);
        const env2 = await waitPromise2;

        // ── Phase 13 (GLA-056/057/058/059) — completion 2 = verified; the second window CLOSES. ──
        expect(env2.status).toBe("verified");
        expect(env2.state).toBe("completed");
        expect(stack.session.get(sessionId as SessionId).state).toBe("active"); // back to active after 2nd close
        expect(stack.session.get(sessionId as SessionId).runtime).toBeDefined(); // capsule STILL running
        expect(stack.connector.isSuspended(cdpUrl)).toBe(false); // connector RESUMED again

        // ── Phase 14 (GLA-060/061/062/063) — the agent CONFIGURES the account on /dashboard over the resumed connector. ──
        const agentBrowser3 = await chromium.connectOverCDP(cdpUrl);
        closers.push(() => agentBrowser3.close().catch(() => {}));
        const actx3 = agentBrowser3.contexts()[0] ?? (await agentBrowser3.newContext());
        const apage3 = actx3.pages()[0] ?? (await actx3.newPage());
        await apage3.goto(`${site.base}/dashboard`);
        expect(await apage3.title()).toBe("dashboard"); // GLA-061: the agent configures on /dashboard
        // The session stays active for the agent through configuration (GLA-062/063).
        expect(stack.session.get(sessionId as SessionId).state).toBe("active");

        // ── The SITE received BOTH secrets (the human path works both windows)… ──
        expect(site.submittedPasswords()).toContain(KNOWN_PASSWORD);
        expect(site.submittedCodes()).toContain(KNOWN_CODE);

        // ── …but the AGENT saw NEITHER (the S-2 invariant across BOTH windows): scan EVERY agent-readable output. ──
        const agentReadable = [
          cCreate.stdout(),
          cCreate.stderr(),
          cResume.stdout(),
          cReopen.stdout(),
          JSON.stringify(env1),
          JSON.stringify(env2),
          JSON.stringify(stack.bridge.handoffGet(view1.handoff_id)),
          JSON.stringify(stack.bridge.handoffGet(view2.handoff_id)),
          JSON.stringify(stack.bridge.handoffList({ session: sessionId })),
          deliveredLinks.join("\n"),
        ].join("\n");
        expect(agentReadable.split(KNOWN_PASSWORD).length - 1).toBe(0);
        expect(agentReadable.split(KNOWN_CODE).length - 1).toBe(0);
      } finally {
        if (sessionId.length > 0) {
          await stack.reconciler.reconcile(sessionId).catch(() => {});
        }
        await hctxGw.close().catch(() => {});
      }
    },
    180_000,
  );

  it.skipIf(HAVE_CHROMIUM)("REAL two-handoff E2E SKIPPED — no cached Chromium", () => {
    expect(HAVE_CHROMIUM).toBe(false);
  });
});

/** Open a raw WS upgrade to the gateway and return the first bytes (101+hello if proxied, else a refusal line). */
function rawUpgrade(origin: string, path: string, grant: string): Promise<string> {
  const u = new URL(origin);
  const host = u.hostname;
  const port = Number(u.port);
  return new Promise((resolve, reject) => {
    void import("node:net").then(({ connect }) => {
      const socket = connect({ host, port }, () => {
        socket.write(
          `GET ${path}?grant=${encodeURIComponent(grant)} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
      });
      let first = "";
      let resolved = false;
      const done = (): void => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(first);
        }
      };
      socket.on("data", (c) => {
        first += (c as Buffer).toString("utf8");
        done();
      });
      socket.on("close", done);
      socket.on("error", (e) => {
        if (!resolved) reject(e);
      });
    });
  });
}
