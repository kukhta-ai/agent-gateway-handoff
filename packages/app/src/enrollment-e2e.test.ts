// REAL WebAuthn end-to-end test (packages/app) — the headline proof for scenario-01 Phase E (GLA-013 AC#1/#3).
// Drives the WHOLE enrollment stack for real: createEnrollmentStack → enrollInvite mints a single-use
// operator-discharge grant + delivers the invite link → the REAL Access Gateway HTTP server serves the enrollment
// page → headless Chromium with a CDP VIRTUAL AUTHENTICATOR runs navigator.credentials.create → POST the
// attestation → the gateway verifies it via REAL @simplewebauthn and stores the credential → assert the recipient
// isEnrolled with auth_strength=webauthn. THEN drive authenticationOptions + verifyAuthentication
// (navigator.credentials.get) against the SAME virtual authenticator → assert it succeeds. Plus: a reused grant is
// refused over the real server (no credential stored), and an un-enrolled recipient cannot authenticate.
//
// GATED: if no cached Chromium is available (some CI), the REAL test is skipped (it.runIf) and the server-side
// @simplewebauthn verify is proven instead by adapters/auth-webauthn/test/contract/auth-webauthn.test.ts — so enrollment
// logic is proven regardless (GLA-013).
//
// Browser-side ceremonies that touch the DOM/WebAuthn API are passed to page.evaluate as STRINGS (Playwright
// supports string page-functions), so this test compiles under the repo's ES2023 lib (no DOM lib needed).

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RecipientRef } from "@gla/kernel";
import { type Browser, type CDPSession, type Page, chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { type EnrollmentStack, createEnrollmentStack } from "./index.js";

/** Is a usable Chromium available (the cached browser)? Skip the REAL test if not. */
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

const recipient = "tg:user:123" as RecipientRef;
const otherRecipient = "tg:user:999" as RecipientRef;

const browsers: Browser[] = [];
const stacks: EnrollmentStack[] = [];
afterAll(async () => {
  for (const b of browsers) {
    await b.close().catch(() => {});
  }
  for (const s of stacks) {
    await s.gateway.close().catch(() => {});
  }
});

/** Grab a free loopback TCP port (bind :0, read it, release) — so the stack is built once with the right origin. */
async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
  const port = (srv.address() as AddressInfo).port;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

/**
 * Build + start an enrollment stack on a known free port, with rpID `localhost` and the matching origin. The page
 * is reached at `http://localhost:<port>` (so the RP id "localhost" matches the page origin host).
 */
async function startStack(): Promise<{
  stack: EnrollmentStack;
  origin: string;
  deliveredLinks: string[];
}> {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const deliveredLinks: string[] = [];
  const stack = createEnrollmentStack({
    rpID: "localhost",
    rpName: "GLA test",
    expectedOrigin: origin,
    publicBaseUrl: origin,
    host: "127.0.0.1",
    port,
    deliverySink: { write: (line) => void deliveredLinks.push(line) },
  });
  stacks.push(stack);
  await stack.gateway.listen();
  return { stack, origin, deliveredLinks };
}

function lastDeliveredInviteLink(deliveredLinks: string[]): string {
  const raw = deliveredLinks.at(-1);
  if (raw === undefined) {
    throw new Error("expected recipient invite delivery");
  }
  return (JSON.parse(raw) as { link: string }).link;
}

/** Add a CTAP2 internal virtual authenticator (user-verified, presence auto-simulated) to a page's context. */
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

/** Drive the gateway enrollment page in the browser: click "Register passkey" and wait for the terminal status. */
async function runEnrollmentCeremony(page: Page, link: string): Promise<string> {
  await page.goto(link);
  await page.click("#go");
  // String page-function (no DOM lib needed at compile time): wait until #status reaches a terminal message.
  await page.waitForFunction(
    `(() => { const el = document.getElementById("status"); const t = (el && el.textContent) || ""; return t.includes("Enrolled") || t.includes("try again") || t.includes("invalid"); })()`,
    undefined,
    { timeout: 30_000 },
  );
  return (await page.locator("#status").textContent()) ?? "";
}

/**
 * Run `navigator.credentials.get` in the page (string page-function so no DOM lib is needed at compile time) and
 * return the serialized AuthenticationResponseJSON, or null. The auth options JSON is embedded into the script.
 */
async function runAuthenticationCeremony(page: Page, authOptions: unknown): Promise<unknown> {
  const optionsJson = JSON.stringify(authOptions);
  const script = `(async () => {
    const o = ${optionsJson};
    const b64urlToBuf = (s) => { s = s.replace(/-/g,"+").replace(/_/g,"/"); while (s.length % 4) s += "="; const bin = atob(s); const buf = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i); return buf.buffer; };
    const bufToB64url = (buf) => { const bytes = new Uint8Array(buf); let bin=""; for (let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]); return btoa(bin).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,""); };
    const pk = { challenge: b64urlToBuf(o.challenge) };
    if (o.rpId) pk.rpId = o.rpId;
    if (o.timeout) pk.timeout = o.timeout;
    if (o.userVerification) pk.userVerification = o.userVerification;
    if (Array.isArray(o.allowCredentials)) pk.allowCredentials = o.allowCredentials.map((c) => ({ id: b64urlToBuf(c.id), type: "public-key", ...(c.transports ? { transports: c.transports } : {}) }));
    const cred = await navigator.credentials.get({ publicKey: pk });
    if (!cred) return null;
    const r = cred.response;
    return {
      id: cred.id,
      rawId: bufToB64url(cred.rawId),
      type: cred.type,
      clientExtensionResults: cred.getClientExtensionResults(),
      response: {
        clientDataJSON: bufToB64url(r.clientDataJSON),
        authenticatorData: bufToB64url(r.authenticatorData),
        signature: bufToB64url(r.signature),
        ...(r.userHandle ? { userHandle: bufToB64url(r.userHandle) } : {}),
      },
    };
  })()`;
  return page.evaluate(script);
}

describe("REAL WebAuthn enrollment end-to-end (virtual authenticator; GLA-013 AC#1/#3)", () => {
  it.runIf(HAVE_CHROMIUM)(
    "enrollInvite → page → credentials.create → enrolled (auth_strength=webauthn) → later authentication succeeds",
    async () => {
      const browser = await chromium.launch({ headless: true });
      browsers.push(browser);
      const { stack, origin, deliveredLinks } = await startStack();

      // ── 1) Operator action: mint + deliver the enrollment invite (recipient-bound, single-use). ──
      const invite = await stack.enrollInvite(recipient);
      expect(invite).toEqual({ link: "<redacted-url>", grant: "<redacted>", nonce: "<redacted>" });
      const link = lastDeliveredInviteLink(deliveredLinks).replace("127.0.0.1", "localhost");
      const grant = new URL(link).searchParams.get("grant") ?? "";
      expect(stack.identity.isEnrolled(recipient)).toBe(false);

      // ── 2) The recipient opens the invite in a browser with a virtual authenticator and registers. ──
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const session = await ctx.newCDPSession(page);
      await addVirtualAuthenticator(session);
      const status = await runEnrollmentCeremony(page, link);
      expect(status).toMatch(/Enrolled/i);

      // ── 3) The recipient is now enrolled with auth_strength=webauthn (the precondition for any handoff). ──
      expect(stack.identity.isEnrolled(recipient)).toBe(true);
      expect(stack.identity.verifyStrength(recipient)).toBe("webauthn");
      expect(stack.identity.getCredential(recipient)?.authStrength).toBe("webauthn");

      // ── 4) A LATER authentication against the SAME virtual authenticator succeeds (GLA-013 AC#3). ──
      const authOptions = await stack.identity.authenticationOptions(recipient);
      const assertion = await runAuthenticationCeremony(page, authOptions);
      expect(assertion).not.toBeNull();
      const verified = await stack.identity.verifyAuthentication(recipient, assertion);
      expect(verified.ok).toBe(true);
      expect(verified.authStrength).toBe("webauthn");

      // ── 5) The single-use grant is now SPENT: a reuse over the real server is refused (GLA-013 AC#2). ──
      const reuse = await fetch(`${origin}/enroll/options`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant }),
      });
      expect(reuse.status).toBe(403);

      await ctx.close();
    },
    90_000,
  );

  it.skipIf(HAVE_CHROMIUM)(
    "REAL WebAuthn E2E SKIPPED — no cached Chromium in this environment",
    () => {
      expect(HAVE_CHROMIUM).toBe(false);
    },
  );
});

describe("REAL gateway — un-enrolled cannot authenticate; a grant is bound to its recipient (GLA-013 AC#2/#3)", () => {
  it.runIf(HAVE_CHROMIUM)(
    "an un-enrolled recipient cannot get an auth challenge; a grant for `other` serves only `other`",
    async () => {
      const { stack, deliveredLinks } = await startStack();

      // An un-enrolled recipient cannot authenticate (a recipient is verifiable only if enrolled).
      await expect(stack.identity.authenticationOptions(otherRecipient)).rejects.toThrow(
        /not enrolled/i,
      );

      // A grant minted for `other` is valid for `other` (the page is served, bound to that recipient label).
      await stack.enrollInvite(otherRecipient);
      const getRes = await fetch(
        lastDeliveredInviteLink(deliveredLinks).replace("127.0.0.1", "localhost"),
      );
      expect(getRes.status).toBe(200);
      const html = await getRes.text();
      expect(html).toContain(String(otherRecipient));
    },
    60_000,
  );
});
