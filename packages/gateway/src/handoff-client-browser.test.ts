// Browser-level client-rendering test for GLA-077. This uses a fake RFB-compatible module served from the
// gateway's same-origin client-asset path, so it proves the handoff page loads provider assets and renders an
// interactive viewport without requiring the host Xvfb/x11vnc/websockify stack in CI.

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Page, chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { handoffReusedPageHtml } from "./handoff-page.js";

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

function fakeRfbModule(): string {
  return `
export default class FakeRFB extends EventTarget {
  constructor(target, url, options) {
    super();
    window.__glaRfb = { url, options, events: [] };
    const frame = document.createElement("section");
    frame.setAttribute("role", "application");
    frame.setAttribute("aria-label", "Fake live capsule browser");
    const input = document.createElement("input");
    input.id = "remote-secret-field";
    input.placeholder = "remote field";
    input.addEventListener("input", () => { window.__glaRfb.inputValue = input.value; });
    frame.append(input);
    target.append(frame);
    setTimeout(() => {
      window.__glaRfb.events.push("connect");
      this.dispatchEvent(new CustomEvent("connect"));
    }, 0);
  }
  set scaleViewport(value) { window.__glaRfb.scaleViewport = value; }
  set resizeSession(value) { window.__glaRfb.resizeSession = value; }
  set viewOnly(value) { window.__glaRfb.viewOnly = value; }
  set focusOnClick(value) { window.__glaRfb.focusOnClick = value; }
}
	`;
}

function failingRfbModule(): string {
  return `
export default class FailingRFB extends EventTarget {
  constructor(target, url, options) {
    super();
    window.__glaRfb = { url, options, events: [] };
    const frame = document.createElement("section");
    frame.textContent = "refused remote browser";
    target.append(frame);
    setTimeout(() => {
      window.__glaRfb.events.push("securityfailure");
      this.dispatchEvent(new CustomEvent("securityfailure"));
    }, 0);
  }
  set scaleViewport(value) { window.__glaRfb.scaleViewport = value; }
  set resizeSession(value) { window.__glaRfb.resizeSession = value; }
  set viewOnly(value) { window.__glaRfb.viewOnly = value; }
}
`;
}

async function serveClientPage(
  opts: { module?: string; bootstrapModule?: string } = {},
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.url === "/handoff") {
      const html = handoffReusedPageHtml(
        "grant-token",
        "/handoff/sess_browser",
        "recipient",
        "/handoff/sess_browser",
        {
          kind: "rfb-web-client",
          ref: "fake-rfb",
          bootstrap: {
            module: opts.bootstrapModule ?? "core/rfb.js",
            scaleViewport: true,
            resizeSession: false,
          },
        },
        "/handoff/client-assets",
      );
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.url === "/handoff/client-assets/fake-rfb/core/rfb.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(opts.module ?? fakeRfbModule());
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function withBrowserPage<T>(
  server: { origin: string; close: () => Promise<void> },
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await run(page);
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

describe("handoff page RFB browser client", () => {
  it("GLA-092 canary proves browser-backed E2E failures fail the full gate when requested", async () => {
    if (process.env.GLA_BROWSER_E2E_CANARY_FAIL !== "1") {
      return;
    }
    expect(HAVE_CHROMIUM).toBe(true);
    const server = await serveClientPage();
    await withBrowserPage(server, async (page) => {
      await page.goto(`${server.origin}/handoff`);
      await page.waitForSelector("#remote-secret-field", { timeout: 30_000 });
      expect("GLA-092 browser E2E canary failure").toBe("not-triggered");
    });
  });

  it.runIf(HAVE_CHROMIUM)(
    "renders an interactive viewport from same-origin provider assets instead of opening a raw socket",
    async () => {
      const server = await serveClientPage();
      await withBrowserPage(server, async (page) => {
        await page.goto(`${server.origin}/handoff`);
        await page.waitForSelector("#remote-secret-field", { timeout: 30_000 });
        await expect.poll(() => page.locator("#status").textContent()).toMatch(/Connected/);
        await page.fill("#remote-secret-field", "typed-through-client");
        const state = await page.evaluate("window.__glaRfb");
        expect(state).toMatchObject({
          url: `ws://127.0.0.1:${new URL(server.origin).port}/handoff/sess_browser`,
          inputValue: "typed-through-client",
          scaleViewport: true,
          resizeSession: false,
          viewOnly: false,
          focusOnClick: true,
        });
        const html = await page.content();
        expect(html).not.toContain("new WebSocket");
        expect(html).not.toContain("?grant=grant-token");
      });
    },
    60_000,
  );

  it.runIf(HAVE_CHROMIUM)(
    "reports unavailable instead of connected when provider client assets cannot be imported",
    async () => {
      const server = await serveClientPage({ bootstrapModule: "missing/rfb.js" });
      await withBrowserPage(server, async (page) => {
        await page.goto(`${server.origin}/handoff`);
        await expect.poll(() => page.locator("#status").textContent()).toMatch(/unavailable/i);
        await expect.poll(() => page.locator("#status").textContent()).not.toMatch(/Connected/i);
        expect(await page.evaluate("window.__glaRfb")).toBeUndefined();
      });
    },
    60_000,
  );

  it.runIf(HAVE_CHROMIUM)(
    "reports refusal instead of connected when the RFB client rejects the capsule endpoint",
    async () => {
      const server = await serveClientPage({ module: failingRfbModule() });
      await withBrowserPage(server, async (page) => {
        await page.goto(`${server.origin}/handoff`);
        await expect.poll(() => page.locator("#status").textContent()).toMatch(/refused/i);
        await expect.poll(() => page.locator("#status").textContent()).not.toMatch(/Connected/i);
        const state = await page.evaluate("window.__glaRfb");
        expect(state).toMatchObject({ events: ["securityfailure"] });
      });
    },
    60_000,
  );

  it.skipIf(HAVE_CHROMIUM)("RFB browser-client rendering skipped: no cached Chromium", () => {
    expect(HAVE_CHROMIUM).toBe(false);
  });
});
