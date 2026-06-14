// GLA-077 full human-view proof: a verified recipient page loads the real noVNC/RFB client from the
// gateway, connects through the grant-protected route to the full Xvfb/x11vnc/websockify stack, and sends
// keyboard/pointer input into the live capsule browser.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { referenceWpmDependencyBindings } from "@gla/catalog";
import { Output, type OutputStreams, run } from "@gla/cli";
import { type RecipientRef, type SessionId, decodeRuntimeHandle } from "@gla/kernel";
import { fullStackAvailable } from "@gla/launcher-process";
import { type Browser, type CDPSession, type Page, chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import type { ProvisioningStack } from "./index.js";
import { createProvisioningBridge } from "./index.js";

const recipient = "tg:user:123" as RecipientRef;
const REAL_NOVNC_CANARY = "real-novnc-secret-agent-must-not-see";

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

const HAVE_FULL_NOVNC = chromiumAvailable() && fullStackAvailable();
const browsers: Browser[] = [];
const closers: Array<() => Promise<void> | void> = [];
const scratchDirs: string[] = [];
const browserDiagnostics: string[] = [];

afterAll(async () => {
  for (const browser of browsers) {
    await browser.close().catch(() => {});
  }
  for (const closer of closers.reverse()) {
    await Promise.resolve(closer()).catch(() => {});
  }
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function capture(): { out: Output; stdout: () => string; stderr: () => string } {
  const o: string[] = [];
  const e: string[] = [];
  const streams: OutputStreams = {
    stdout: { write: (s) => void o.push(s), isTTY: false },
    stderr: { write: (s) => void e.push(s), isTTY: false },
  };
  return { out: new Output("json", streams), stdout: () => o.join(""), stderr: () => e.join("") };
}

function expectNoCanary(label: string, value: unknown): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  expect(text.includes(REAL_NOVNC_CANARY), `${label} must not expose the noVNC canary`).toBe(false);
}

async function freePort(): Promise<number> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function workspaceRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "gla-real-novnc-ws-"));
  scratchDirs.push(dir);
  return dir;
}

function writeSpec(doc: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "gla-real-novnc-"));
  scratchDirs.push(dir);
  const path = join(dir, "assembly.json");
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

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

async function runEnrollment(page: Page, link: string): Promise<string> {
  await page.goto(link);
  await page.click("#go");
  await page.waitForFunction(
    `(() => {
      const text = document.getElementById("status")?.textContent || "";
      return text.includes("Enrolled") || text.includes("try again") || text.includes("invalid");
    })()`,
    undefined,
    { timeout: 30_000 },
  );
  return (await page.locator("#status").textContent()) ?? "";
}

async function stepUpAndWaitForNovnc(page: Page, link: string): Promise<void> {
  await page.goto(link);
  await page.click("#go");
  try {
    await page.waitForFunction(
      `(() => {
        const text = document.getElementById("status")?.textContent || "";
        return text.includes("Connected to the live browser");
      })()`,
      undefined,
      { timeout: 45_000 },
    );
  } catch (e) {
    const diagnostics = await page
      .evaluate(`(() => {
        const resources = performance
          .getEntriesByType("resource")
          .map((entry) => ({
            name: entry.name,
            duration: entry.duration,
            transferSize: entry.transferSize,
          }))
          .filter((entry) => /handoff|novnc|rfb|websock|core/i.test(entry.name));
        return {
          status: document.getElementById("status")?.textContent || "",
          viewer: document.getElementById("viewer")?.textContent || "",
          resources,
        };
      })()`)
      .catch(() => ({ status: "", viewer: "", resources: [] }));
    throw new Error(
      `noVNC viewer did not connect; diagnostics=${JSON.stringify(diagnostics)}; cause=${
        e instanceof Error ? e.message : String(e)
      }; browserDiagnostics=${JSON.stringify(browserDiagnostics.slice(-30))}`,
    );
  }
  await page.waitForFunction(
    `(() => {
      const viewer = document.getElementById("viewer");
      const canvas = viewer?.querySelector("canvas");
      const rect = viewer?.getBoundingClientRect();
      const canvasRect = canvas?.getBoundingClientRect();
      return Boolean(viewer && !viewer.hidden && rect && rect.width > 100 && rect.height > 100 &&
        canvas && canvas.width > 100 && canvas.height > 100 &&
        canvasRect && canvasRect.width > 100 && canvasRect.height > 100);
    })()`,
    undefined,
    { timeout: 45_000 },
  );
}

function realCdpUrl(stack: ProvisioningStack, sessionId: SessionId): string {
  const runtime = stack.session.get(sessionId).runtime;
  const decoded = runtime !== undefined ? decodeRuntimeHandle(runtime) : undefined;
  const url = typeof decoded?.cdpWebSocketUrl === "string" ? decoded.cdpWebSocketUrl : "";
  if (url.length === 0) {
    throw new Error("no real CDP url on the session runtime");
  }
  return url;
}

const assembly = {
  apiVersion: "gla.dev/v1",
  kind: "Assembly",
  metadata: { intent: "real noVNC recipient viewport" },
  spec: {
    template: "browser-handoff",
    recipient,
    detectors: [{ use: "user-done" }],
  },
};

describe("REAL noVNC handoff browser client (GLA-077)", () => {
  it.runIf(HAVE_FULL_NOVNC)(
    "verified recipient sees a live noVNC viewport and keyboard/pointer input reaches the capsule browser",
    async () => {
      const port = await freePort();
      const origin = `http://localhost:${port}`;
      const deliveredLinks: string[] = [];
      const stack = createProvisioningBridge({
        dependencyBindings: referenceWpmDependencyBindings(),
        launcherMode: "full",
        workspaceRoot: workspaceRoot(),
        startTimeoutMs: 40_000,
        handoff: {
          expectedOrigin: origin,
          publicBaseUrl: origin,
          host: "127.0.0.1",
          port,
          deliverySink: { write: (line) => deliveredLinks.push(line) },
          completion: { pollMs: 100 },
        },
      });
      closers.push(() => stack.close());
      await stack.gateway?.listen();

      const humanBrowser = await chromium.launch({ headless: true });
      browsers.push(humanBrowser);
      const humanContext = await humanBrowser.newContext();
      const humanPage = await humanContext.newPage();
      humanPage.on("console", (msg) => {
        browserDiagnostics.push(`console:${msg.type()}:${msg.text()}`);
      });
      humanPage.on("pageerror", (err) => {
        browserDiagnostics.push(`pageerror:${err.message}`);
      });
      humanPage.on("websocket", (ws) => {
        browserDiagnostics.push(`ws:${ws.url()}:open`);
        ws.on("close", () => {
          browserDiagnostics.push(`ws:${ws.url()}:close`);
        });
        ws.on("socketerror", (err) => {
          browserDiagnostics.push(`ws:${ws.url()}:error:${String(err)}`);
        });
      });
      const gatewayResponses: Array<{ url: string; body: string }> = [];
      const gatewayResponseReads: Promise<void>[] = [];
      humanPage.on("response", (response) => {
        const url = response.url();
        if (!url.startsWith(origin)) {
          return;
        }
        const contentType = response.headers()["content-type"] ?? "";
        if (!/(html|json|javascript|css|text)/i.test(contentType)) {
          return;
        }
        const read = response
          .text()
          .then((body) => {
            gatewayResponses.push({ url, body });
          })
          .catch(() => {});
        gatewayResponseReads.push(read);
      });
      await addVirtualAuthenticator(await humanContext.newCDPSession(humanPage));

      let sessionId = "" as SessionId;
      try {
        const invite = await stack.enrollInvite?.(recipient);
        if (invite === undefined) {
          throw new Error("enrollInvite not wired");
        }
        const deliveredInvite = JSON.parse(deliveredLinks.at(-1) ?? "{}") as { link?: string };
        const enrollLink = (deliveredInvite.link ?? invite.link).replace("127.0.0.1", "localhost");
        expect(await runEnrollment(humanPage, enrollLink)).toMatch(/Enrolled/i);
        expect(stack.identity?.isEnrolled(recipient)).toBe(true);

        const createdOut = capture();
        const code = await run(["session", "create", "-f", writeSpec(assembly)], createdOut.out, {
          bridge: stack.bridge,
        });
        expect(code, createdOut.stderr()).toBe(0);
        const created = JSON.parse(createdOut.stdout()) as {
          session_id: SessionId;
          connector?: { cdp_url?: string };
        };
        sessionId = created.session_id;
        const brokeredCdpUrl = created.connector?.cdp_url;

        const controlBrowser = await chromium.connectOverCDP(realCdpUrl(stack, sessionId));
        browsers.push(controlBrowser);
        const controlContext = controlBrowser.contexts()[0] ?? (await controlBrowser.newContext());
        const controlPage = controlContext.pages()[0] ?? (await controlContext.newPage());
        await controlPage.goto(
          `data:text/html,${encodeURIComponent(`<!doctype html>
            <html>
              <head><title>real-novnc-target</title></head>
              <body style="margin:0">
                <input id="remote-secret-field" autofocus
                  style="box-sizing:border-box;width:100vw;height:100vh;font-size:64px;padding:48px"
                  placeholder="type here" />
              </body>
            </html>`)}`,
        );
        await expect
          .poll(() =>
            controlPage.evaluate(
              `document.activeElement === document.getElementById("remote-secret-field")`,
            ),
          )
          .toBe(true);
        await controlPage.evaluate(`document.getElementById("remote-secret-field")?.blur()`);
        await expect
          .poll(() =>
            controlPage.evaluate(
              `document.activeElement === document.getElementById("remote-secret-field")`,
            ),
          )
          .toBe(false);

        const handoff = await stack.session.openHandoff(sessionId, { reason: "real noVNC proof" });
        const handoffLink = handoff.link.replace("127.0.0.1", "localhost");
        await stepUpAndWaitForNovnc(humanPage, handoffLink);

        const canvas = humanPage.locator("#viewer canvas").first();
        await expect
          .poll(() =>
            canvas.evaluate((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 100 && rect.height > 100;
            }),
          )
          .toBe(true);

        const box = await canvas.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        });
        await humanPage.mouse.click(box.x + Math.min(400, box.width / 2), box.y + box.height / 2);
        await expect
          .poll(() =>
            controlPage.evaluate(
              `document.activeElement === document.getElementById("remote-secret-field")`,
            ),
          )
          .toBe(true);
        await canvas.evaluate((el) => {
          el.focus();
        });
        await humanPage.keyboard.type(REAL_NOVNC_CANARY);

        await expect
          .poll(
            async () => {
              const value = await controlPage.locator("#remote-secret-field").inputValue();
              return value.includes(REAL_NOVNC_CANARY);
            },
            {
              timeout: 30_000,
            },
          )
          .toBe(true);
        const connectorOut = capture();
        expect(
          await run(["session", "connector", sessionId], connectorOut.out, {
            bridge: stack.bridge,
          }),
          connectorOut.stderr(),
        ).toBe(0);
        const sessionGetOut = capture();
        expect(
          await run(["session", "get", sessionId], sessionGetOut.out, { bridge: stack.bridge }),
          sessionGetOut.stderr(),
        ).toBe(0);
        const sessionListOut = capture();
        expect(
          await run(["session", "list"], sessionListOut.out, { bridge: stack.bridge }),
          sessionListOut.stderr(),
        ).toBe(0);
        const handoffGetOut = capture();
        expect(
          await run(["handoff", "get", handoff.handoff_id], handoffGetOut.out, {
            bridge: stack.bridge,
          }),
          handoffGetOut.stderr(),
        ).toBe(0);
        const handoffListOut = capture();
        expect(
          await run(["handoff", "list", "--session", sessionId], handoffListOut.out, {
            bridge: stack.bridge,
          }),
          handoffListOut.stderr(),
        ).toBe(0);
        await Promise.allSettled(gatewayResponseReads);
        if (brokeredCdpUrl !== undefined) {
          expect(stack.connector.isSuspended(brokeredCdpUrl)).toBe(true);
        }

        expectNoCanary("recipient page HTML", await humanPage.content());
        expectNoCanary("session create stdout", createdOut.stdout());
        expectNoCanary("session create stderr", createdOut.stderr());
        expectNoCanary("session connector stdout", connectorOut.stdout());
        expectNoCanary("session connector stderr", connectorOut.stderr());
        expectNoCanary("session get stdout", sessionGetOut.stdout());
        expectNoCanary("session get stderr", sessionGetOut.stderr());
        expectNoCanary("session list stdout", sessionListOut.stdout());
        expectNoCanary("session list stderr", sessionListOut.stderr());
        expectNoCanary("handoff get stdout", handoffGetOut.stdout());
        expectNoCanary("handoff get stderr", handoffGetOut.stderr());
        expectNoCanary("handoff list stdout", handoffListOut.stdout());
        expectNoCanary("handoff list stderr", handoffListOut.stderr());
        expectNoCanary("delivered channel links", deliveredLinks);
        expectNoCanary("gateway text/json/script responses", gatewayResponses);
        expectNoCanary("session service read model", stack.session.get(sessionId));
        expectNoCanary("handoff service read model", stack.session.handoffGet(handoff.handoff_id));
        expectNoCanary("handoff service list", stack.session.handoffList({ session: sessionId }));
        expectNoCanary("bridge session read model", stack.bridge.sessionGet(sessionId));
        expectNoCanary("bridge handoff read model", stack.bridge.handoffGet(handoff.handoff_id));
        expectNoCanary("bridge handoff list", stack.bridge.handoffList({ session: sessionId }));
        expectNoCanary("session completion data", stack.session.get(sessionId).completion ?? null);
        expectNoCanary(
          "handoff completion data",
          stack.session.handoffGet(handoff.handoff_id).completion ?? null,
        );
      } finally {
        if (sessionId.length > 0) {
          await stack.reconciler.reconcile(sessionId).catch(() => {});
        }
      }
    },
    180_000,
  );

  it.skipIf(HAVE_FULL_NOVNC)(
    "REAL noVNC recipient viewport skipped: full stack unavailable or browser E2E optional",
    () => {
      expect(HAVE_FULL_NOVNC).toBe(false);
    },
  );
});
