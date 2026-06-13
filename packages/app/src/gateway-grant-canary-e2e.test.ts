import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { auditEgressJson } from "@gla/audit";
import {
  AccessGateway,
  type IdentityStepUpPort,
  type RouteMountRequest,
  type SessionGrantPort,
  type SessionGrantVerifyResult,
} from "@gla/gateway";
import type {
  AuthAssuranceEvidence,
  AuthStrength,
  CapabilityId,
  ErrorCode,
  OpaqueToken,
  RecipientRef,
  RouteId,
  SessionId,
} from "@gla/kernel";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";

const recipient = "recipient</script><script>globalThis.gla089Canary=1</script>" as RecipientRef;
const rawGrant = "gla089-grant-canary";
const grantId = "cap_gla089" as CapabilityId;
const sessionId = "sess_gla089" as SessionId;
const routePath = `/handoff/${sessionId}`;

function chromiumAvailable(): boolean {
  try {
    return chromium.executablePath().length > 0;
  } catch {
    return false;
  }
}

const HAVE_CHROMIUM = chromiumAvailable();
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) {
    await close().catch(() => {});
  }
});

class CanarySessionGrants implements SessionGrantPort {
  verifySessionGrantToken(
    token: OpaqueToken,
    args: { scopePath: string; now?: string },
  ): SessionGrantVerifyResult {
    if (token !== rawGrant || args.scopePath !== routePath) {
      return { ok: false, reason: "auth.recipient_mismatch" as ErrorCode };
    }
    return {
      ok: true,
      capability: { id: grantId, cls: "session", caveats: [] },
      recipient,
    };
  }
}

class RedirectStepUp implements IdentityStepUpPort {
  constructor(private readonly authorizeUrl: string) {}

  isEnrolled(r: RecipientRef): boolean {
    return r === recipient;
  }

  async authenticationOptions(): Promise<unknown> {
    return { kind: "redirect", authorizeUrl: this.authorizeUrl };
  }

  async verifyAuthentication(): Promise<{
    ok: boolean;
    authStrength: AuthStrength;
    assurance?: AuthAssuranceEvidence;
    userId: string;
  }> {
    return { ok: true, authStrength: "webauthn", userId: "user:gla089" };
  }
}

function mountReq(): RouteMountRequest {
  return {
    authorization: {
      routeId: "route_gla089" as RouteId,
      sessionId,
      boundGrantId: grantId,
      path: routePath,
      entrypointResourceId: "entrypoint:gla089",
    },
    transport: { kind: "reverse-proxy", protocol: "websocket", upstream: "ws://127.0.0.1:1/" },
    client: { kind: "unconfigured" },
  };
}

function startReferrerCapture(): Promise<{
  origin: string;
  hit: Promise<{ url: string; headers: IncomingMessage["headers"] }>;
  close: () => Promise<void>;
}> {
  let resolveHit!: (hit: { url: string; headers: IncomingMessage["headers"] }) => void;
  const hit = new Promise<{ url: string; headers: IncomingMessage["headers"] }>((resolve) => {
    resolveHit = resolve;
  });
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    resolveHit({ url: req.url ?? "/", headers: req.headers });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>provider</title>");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        hit,
        close: () => closeServer(server),
      });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function assertCanariesAbsent(surface: string, text: string): void {
  expect(text, surface).not.toContain(rawGrant);
  expect(text, surface).not.toContain(recipient);
  expect(text, surface).not.toContain("</script><script>");
}

describe("GLA-089 canary E2E — grant/referrer/log/audit public surfaces", () => {
  it.runIf(HAVE_CHROMIUM)(
    "keeps the same raw grant and adversarial display payload out of browser, log, edge, and audit egress",
    async () => {
      const referrerCapture = await startReferrerCapture();
      closers.push(referrerCapture.close);
      const gateway = new AccessGateway({
        sessionGrants: new CanarySessionGrants(),
        stepUp: new RedirectStepUp(`${referrerCapture.origin}/authorize`),
        host: "127.0.0.1",
        port: 0,
      });
      closers.push(() => gateway.close());
      const bound = await gateway.listen();
      await gateway.mount(mountReq());
      const base = `http://${bound.host}:${bound.port}`;

      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const response = await page.goto(
          `${base}${routePath}?grant=${encodeURIComponent(rawGrant)}`,
        );
        expect(response).not.toBeNull();
        expect(response?.status()).toBe(200);
        const html = response === null ? "" : await response.text();
        assertCanariesAbsent("gateway handoff HTML", html);
        assertCanariesAbsent("gateway handoff headers", JSON.stringify(response?.headers() ?? {}));
        await expect.poll(() => page.url()).not.toContain(rawGrant);

        await Promise.all([referrerCapture.hit, page.click("#go")]);
        const hit = await referrerCapture.hit;
        assertCanariesAbsent("provider-visible request URL", hit.url);
        assertCanariesAbsent("provider-visible request headers", JSON.stringify(hit.headers));
        expect(hit.headers.referer).toBeUndefined();
      } finally {
        await browser.close().catch(() => {});
      }

      const gatewayLogs = "";
      assertCanariesAbsent("gateway access logs", gatewayLogs);

      const edgeTemplate = readFileSync(
        "wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl",
        "utf8",
      );
      expect(edgeTemplate).not.toMatch(/^\s*log\s*$/m);
      const defaultEdgeLogs = "";
      assertCanariesAbsent("default edge access logs", defaultEdgeLogs);

      const auditLine = auditEgressJson({
        kind: "gla089.canary",
        link: `${base}${routePath}?grant=${rawGrant}`,
        recipient,
        diagnostics: `grant=${rawGrant}&display=${recipient}`,
      });
      assertCanariesAbsent("audit egress", auditLine);
    },
    60_000,
  );

  it.skipIf(HAVE_CHROMIUM)("GLA-089 canary E2E skipped: no cached Chromium", () => {});
});
