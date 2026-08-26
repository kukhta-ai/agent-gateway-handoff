// ════════════════════════════════════════════════════════════════════════════════════════════════
// GLA-076 — THE AUTHENTIK CAPSTONE: the delegated provider covers passkey AND password, end to end, COLD.
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The authentik analogue of the GLA-066 scenario-01 capstone (packages/app/src/scenario-01-e2e.test.ts). It
// drives the REAL handoff thread — real `createProvisioningBridge`, real gateway, real `launcher-process`
// headless-Chromium capsule, real `entrypoint-novnc` (a stub noVNC upstream, as the MVP gates), the local
// `acme.example` stub — to a REAL capsule, but with the DELEGATED authentik provider (`AuthAuthentikProvider`)
// instead of the in-tree WebAuthn one, and the OIDC ceremony stood in for by `FakeAuthentik` (the controllable
// OIDC double from GLA-068). The seam-table delta is ONE row (AuthProviderPort: auth-webauthn+virtual-authenticator
// → auth-authentik+FakeAuthentik); EVERY other actor is identical, and that identity is part of the proof (§3).
//
// It COMPOSES the implemented pieces (GLA-068 adapter, GLA-070 enrollment, GLA-072 dual-method) and adds NO new
// mechanism — `FakeAuthentik` doubles only the token endpoint + JWKS (no /authorize browser server), so the
// harness intercepts the redirect and SYNTHESIZES the callback: read state/nonce out of the adapter's
// authorizeUrl, stage a valid login for the chosen code with {sub:<enrolled>, amr:<chosen>, nonce:<the attempt's>},
// and drive {code,state} into the UNCHANGED /handoff/auth/verify as the opaque assertion → the existing strength
// gate → the WS proxy to the real capsule. (The sub/nonce threading is the central harness risk — §7.1; mirrored
// from adapters/auth-authentik/src/auth-authentik.test.ts.)
//
// ALREADY PROVEN AGAINST REAL AUTHENTIK: a GLA-074 rehearsal stood up real authentik 2025.10.4 and drove THIS
// exact adapter through a real OIDC round-trip → `verifyAssertion` → {ok:true, authStrength:"password"} with a
// real `amr:["pwd"]` (and an immutable hashed_user_id `sub`). This in-gate test is the deterministic
// `FakeAuthentik` version of that proof (a real heavyweight authentik stack cannot run in CI). The live
// passkey→webauthn round-trip + the real `amr`-emission / same-origin-routing confirmation are the deploy's job
// (recorded-as-deferred — GLA-075 §6, GLA-074 task-6 AC#8); this test owns the GLA-side proof (both methods, the
// seam invariant, the gating matrix, the negatives) deterministically.
//
// Rule-3 note: `bmad-qa-generate-e2e-tests` / `bmad-testarch-test-design` were attempted but are interactive —
// they block on a mandatory scope selection and cannot run unattended (the same blocker recorded in
// test-strategy.md and scenario-01-e2e.test.ts). Per AGENTS.md Rule-3 this capstone is driven from the committed
// design set (authentik-e2e-verification.md §2–§7) as the stated fallback. Blocker recorded; not silently substituted.
//
// COLD = a fresh `createProvisioningBridge(...)` per test + a fresh `FakeAuthentik` + a fresh stub upstream; the
// capsule + broker + gateway + browsers are always reaped in finally/afterAll. The full quality gate runs
// `test:e2e:preflight` before Vitest, so missing Chromium is a gate failure rather than an acceptable skipped
// authentik capstone. The skip branch remains only for the explicit non-DoD opt-out command.

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { type AddressInfo, type Socket, connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_AUTHENTIK_MODULE,
  AuthAuthentikProvider,
  type BoundSubject,
  InMemoryKv,
  type PendingAttempt,
} from "@gla/auth-authentik";
import { FakeAuthentik } from "@gla/auth-authentik/testing";
import { AUTH_WEBAUTHN_MODULE } from "@gla/auth-webauthn";
import { referenceWpmDependencyBindings } from "@gla/catalog";
import type { DeliverySink } from "@gla/channel-cli";
import { Output, type OutputStreams, run } from "@gla/cli";
import { IdentityService } from "@gla/identity";
import type { CapabilityId, OpaqueToken, RecipientRef, SessionId, TaskId } from "@gla/kernel";
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import type { ProvisioningStack } from "./index.js";
import { createProvisioningBridge } from "./index.js";

const recipient = "tg:user:123" as RecipientRef;
const wrongRecipient = "tg:user:999" as RecipientRef;
/** The IdentityService derives userId from a recipient ref as `user:<ref>` (see packages/identity). */
const userIdOf = (r: RecipientRef): string => `user:${r}`;
const discharge = "operator-discharge-grant" as OpaqueToken;
/** The stable authentik subject the recipient is enrolled against (an immutable id, as hashed_user_id would be). */
const BOUND_SUB = "sub-recipient-capstone-immutable";
const WRONG_BOUND_SUB = "sub-valid-wrong-recipient";

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

const runLog: string[] = [];
function log(phase: string, line: string): void {
  runLog.push(`[${phase}] ${line}`);
}

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
  const dir = mkdtempSync(join(tmpdir(), "gla-authentik-ws-"));
  scratchDirs.push(dir);
  return dir;
}
function writeSpec(doc: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "gla-authentik-"));
  scratchDirs.push(dir);
  const path = join(dir, "assembly.json");
  writeFileSync(path, JSON.stringify(doc));
  return path;
}
function profileDirs(root: string): string[] {
  try {
    return readdirSync(root).filter((n) => n.startsWith("gla-profile-"));
  } catch {
    return [];
  }
}

const closers: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const c of closers) {
    await Promise.resolve(c()).catch(() => {});
  }
  for (const d of scratchDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  if (runLog.length > 0) {
    process.stderr.write(`\n── GLA-076 authentik capstone run-log ──\n${runLog.join("\n")}\n`);
  }
});

async function freePort(): Promise<number> {
  return new Promise<number>((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

/** The RFC-6455 Sec-WebSocket-Accept for a client key (so a raw WS upgrade completes the handshake). */
function wsAccept(key: string): string {
  return createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
}
function encodeWsTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

/** A stub WS upstream standing in for the capsule's noVNC endpoint (real noVNC needs X — gated for hermes-1). */
interface UpstreamSnapshot {
  connections: number;
  bytesToClient: number;
  bytesFromClient: number;
  helloWrites: number;
}

function startStubUpstream(): Promise<{
  endpoint: string;
  close: () => Promise<void>;
  snapshot: () => UpstreamSnapshot;
}> {
  return new Promise((resolve) => {
    const server: Server = createServer();
    const snapshot: UpstreamSnapshot = {
      connections: 0,
      bytesToClient: 0,
      bytesFromClient: 0,
      helloWrites: 0,
    };
    const writeToClient = (
      socket: { write(bytes: string | Buffer): unknown },
      bytes: string | Buffer,
    ): void => {
      snapshot.bytesToClient +=
        typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength;
      socket.write(bytes);
    };
    server.on("upgrade", (req, socket) => {
      snapshot.connections++;
      const key = (req.headers["sec-websocket-key"] as string | undefined) ?? "";
      writeToClient(
        socket,
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`,
      );
      writeToClient(socket, encodeWsTextFrame("UPSTREAM_NOVNC_HELLO"));
      snapshot.helloWrites++;
      socket.on("data", (chunk) => {
        snapshot.bytesFromClient += (chunk as Buffer).byteLength;
      });
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        endpoint: `ws://127.0.0.1:${port}/`,
        snapshot: () => ({ ...snapshot }),
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

function expectNoUpstreamTraffic(
  upstream: { snapshot: () => UpstreamSnapshot },
  before: UpstreamSnapshot,
  label: string,
): void {
  const after = upstream.snapshot();
  expect(after.connections, `${label}: upstream connection count must not increase`).toBe(
    before.connections,
  );
  expect(after.bytesToClient, `${label}: upstream bytes-to-client must not increase`).toBe(
    before.bytesToClient,
  );
  expect(after.helloWrites, `${label}: upstream hello writes must not increase`).toBe(
    before.helloWrites,
  );
}

function expectUpstreamReached(
  upstream: { snapshot: () => UpstreamSnapshot },
  before: UpstreamSnapshot,
  label: string,
): void {
  const after = upstream.snapshot();
  expect(after.connections, `${label}: upstream must receive a proxied connection`).toBeGreaterThan(
    before.connections,
  );
  expect(after.bytesToClient, `${label}: upstream must send bytes to the browser`).toBeGreaterThan(
    before.bytesToClient,
  );
  expect(after.helloWrites, `${label}: upstream hello marker must be written`).toBeGreaterThan(
    before.helloWrites,
  );
}

function maybeFailProofCanary(kind: "wrong-recipient" | "upstream-leak"): boolean {
  return process.env.GLA_E2E_PROOF_CANARY === kind;
}

/** Open a raw WS upgrade to the gateway; resolve the first bytes (101+hello if proxied, else an HTTP refusal). */
function rawUpgrade(
  origin: string,
  path: string,
  grant: string,
): Promise<{ firstChunk: string; socket: Socket }> {
  const u = new URL(origin);
  const host = u.hostname;
  const port = Number(u.port);
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host, port }, () => {
      socket.write(
        `GET ${path}?grant=${encodeURIComponent(grant)} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let first = "";
    let resolved = false;
    const done = (): void => {
      if (!resolved) {
        resolved = true;
        resolve({ firstChunk: first, socket });
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
}

/** Pull `{state, nonce}` out of an opaque `{kind:"redirect", authorizeUrl}` challenge (the harness intercept). */
function redirectParams(challenge: unknown): { state: string; nonce: string } {
  const c = challenge as { kind?: string; authorizeUrl?: string };
  if (c?.kind !== "redirect" || typeof c.authorizeUrl !== "string") {
    throw new Error("expected a {kind:'redirect', authorizeUrl} challenge");
  }
  const url = new URL(c.authorizeUrl);
  const state = url.searchParams.get("state");
  const nonce = url.searchParams.get("nonce");
  if (state === null || nonce === null) throw new Error("authorize URL missing state/nonce");
  return { state, nonce };
}

/** A captured authentik harness: the FakeAuthentik double + the provider + identity + the inspectable stores. */
interface AuthentikWiring {
  fake: FakeAuthentik;
  provider: AuthAuthentikProvider;
  identity: IdentityService;
  subjects: InMemoryKv<BoundSubject>;
  attempts: InMemoryKv<PendingAttempt>;
}

/** Build the delegated authentik provider wired to a FakeAuthentik double (no real network), + the identity. */
async function authentikWiring(): Promise<AuthentikWiring> {
  const fake = await FakeAuthentik.create();
  const subjects = new InMemoryKv<BoundSubject>();
  const attempts = new InMemoryKv<PendingAttempt>();
  const provider = new AuthAuthentikProvider({
    issuerUrl: fake.issuerUrl,
    clientId: fake.clientId,
    clientSecret: "capstone-secret",
    redirectUri: "https://gla.example/auth/callback",
    endpoints: fake.endpoints(),
    jwks: fake.jwks,
    fetch: fake.fetch,
    subjects,
    attempts,
  });
  const identity = new IdentityService({ authProvider: provider });
  return { fake, provider, identity, subjects, attempts };
}

/**
 * Enroll the recipient through authentik (the GLA-070 service path): begin → synthesize the register-leg login
 * with the bound `sub` + the attempt's nonce + UV proof → finish → bind `subjects[userId]={sub}`. The precondition for any
 * step-up. (This is the "enroll once per run" the capstone performs cold, §2.)
 */
async function enrollThroughAuthentik(
  w: AuthentikWiring,
  r: RecipientRef,
  sub: string,
): Promise<void> {
  const challenge = await w.identity.enrollmentOptions(r, discharge);
  const { state, nonce } = redirectParams(challenge);
  await w.fake.stageValidLogin(`enroll-${state}`, {
    sub,
    nonce,
    amr: ["swk"],
    userVerified: true,
  });
  await w.identity.enrollComplete(r, { code: `enroll-${state}`, state });
}

/**
 * SYNTHESIZE the OIDC callback for a handoff step-up (the load-bearing harness fact, §1/§7.1). Drives the real
 * gateway exactly as the served page's redirect-return arm would: POST /handoff/auth/options (→ the redirect
 * challenge the page would `location.assign`), read state/nonce out of the intercepted authorizeUrl, stage a valid
 * FakeAuthentik login for the chosen `code` with {sub, amr, nonce:<the attempt's>}, then POST {code,state} to the
 * UNCHANGED /handoff/auth/verify as the opaque assertion. Returns the verify HTTP response.
 */
async function synthesizeStepUp(
  origin: string,
  fake: FakeAuthentik,
  link: string,
  opts: { amr?: string[]; sub: string; codeTag?: string; userVerified?: boolean },
): Promise<Response> {
  const grant = new URL(link).searchParams.get("grant") ?? "";
  const path = new URL(link).pathname;
  const optRes = await fetch(`${origin}/handoff/auth/options`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant, path }),
  });
  if (optRes.status !== 200) {
    return optRes; // un-enrolled / grant-refused → the page never gets a redirect challenge.
  }
  const { state, nonce } = redirectParams(await optRes.json());
  const code = `${opts.codeTag ?? "code"}-${state}`;
  await fake.stageValidLogin(code, {
    sub: opts.sub,
    nonce,
    ...(opts.amr !== undefined ? { amr: opts.amr } : {}),
    ...(opts.userVerified !== undefined ? { userVerified: opts.userVerified } : {}),
  });
  return fetch(`${origin}/handoff/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant, path, assertion: { code, state } }),
  });
}

async function completeStepUpViaBrowserCallback(
  origin: string,
  fake: FakeAuthentik,
  link: string,
  opts: { amr?: string[]; sub: string; userVerified?: boolean },
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  closers.push(() => browser.close().catch(() => {}));
  const ctx = await browser.newContext();
  await ctx.route("https://idp.example/**", async (route) => {
    const authorizeUrl = new URL(route.request().url());
    const state = authorizeUrl.searchParams.get("state") ?? "";
    const nonce = authorizeUrl.searchParams.get("nonce") ?? "";
    expect(state, "OIDC authorize URL must carry state").not.toBe("");
    expect(nonce, "OIDC authorize URL must carry nonce").not.toBe("");
    const redirectUri = new URL(authorizeUrl.searchParams.get("redirect_uri") ?? "");
    expect(redirectUri.pathname).toBe("/auth/callback");
    expect(authorizeUrl.toString()).not.toContain(grantFromLink(link));
    const code = `browser-callback-${state}`;
    await fake.stageValidLogin(code, {
      sub: opts.sub,
      nonce,
      ...(opts.amr !== undefined ? { amr: opts.amr } : {}),
      ...(opts.userVerified !== undefined ? { userVerified: opts.userVerified } : {}),
    });
    await route.fulfill({
      status: 302,
      headers: { location: `${origin}/auth/callback?code=${code}&state=${state}` },
      body: "",
    });
  });
  const page = await ctx.newPage();
  await page.goto(link);
  await page.getByRole("button", { name: /verify/i }).click();
  await expect
    .poll(() => page.url(), {
      message: "browser callback flow must land on the GLA-served callback URL",
      timeout: 30_000,
    })
    .toBe(`${origin}/auth/callback`);
  await ctx.close();
}

/**
 * Build a COLD provisioning stack wired with the DELEGATED authentik provider (the fake-backed identity injected
 * as `handoff.identity`, `GLA_AUTH_PROVIDER=authentik` recorded in `authModule`), a real capsule launcher, and the
 * stub noVNC upstream. `requiredAuthStrength` gates the step-up (default webauthn). Returns the stack + origin.
 */
async function coldAuthentikStack(opts: {
  wiring: AuthentikWiring;
  requiredAuthStrength?: "password" | "webauthn";
  upstream: string;
}): Promise<{ stack: ProvisioningStack; origin: string; wsRoot: string }> {
  const gwPort = await freePort();
  const origin = `http://127.0.0.1:${gwPort}`;
  const wsRoot = workspaceRoot();
  const sink: DeliverySink = { write: () => {} };
  const stack = createProvisioningBridge({
    dependencyBindings: referenceWpmDependencyBindings(),
    launcherMode: "headless",
    workspaceRoot: wsRoot,
    startTimeoutMs: 40_000,
    handoff: {
      // Record the delegated provider in the wiring (authModule = authentik) — the composition-only swap …
      authProvider: "authentik",
      // … its OIDC config is required by buildAuthProvider, but the actual provider used is the fake-backed
      // `identity` below (h.identity wins), so this throwaway never dials a real network.
      authentik: {
        issuerUrl: opts.wiring.fake.issuerUrl,
        clientId: opts.wiring.fake.clientId,
        clientSecret: "capstone-secret",
        redirectUri: "https://gla.example/auth/callback",
      },
      identity: opts.wiring.identity,
      ...(opts.requiredAuthStrength !== undefined
        ? { requiredAuthStrength: opts.requiredAuthStrength }
        : {}),
      expectedOrigin: origin,
      publicBaseUrl: origin,
      host: "127.0.0.1",
      port: gwPort,
      deliverySink: sink,
      entrypoint: {
        async open() {
          return {
            resourceId: "entrypoint:fake-view:authentik-scenario",
            provider: "fake-view",
            client: { kind: "provider-asset", ref: "fake-viewer" },
            transport: {
              kind: "reverse-proxy" as const,
              protocol: "websocket",
              upstream: opts.upstream,
            },
          };
        },
      },
      completion: { pollMs: 100 },
    },
  });
  closers.push(() => stack.gateway?.close() ?? Promise.resolve());
  closers.push(() => stack.connector.close());
  await stack.gateway?.listen();
  return { stack, origin, wsRoot };
}

/** Provision a real capsule under a fresh task; returns its ids. (Mirrors the GLA-066 capstone's Phase 2–3.) */
async function provisionCapsule(
  stack: ProvisioningStack,
  wsRoot: string,
): Promise<{ sessionId: SessionId; taskId: TaskId }> {
  const cTask = capture();
  expect(
    await run(
      ["task", "create", "--intent", "register on acme", "--recipient", recipient],
      cTask.out,
      {
        bridge: stack.bridge,
      },
    ),
  ).toBe(0);
  const taskId = JSON.parse(cTask.stdout()).task_id as TaskId;
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
  const specPath = writeSpec(assembly);
  const cCreate = capture();
  expect(
    await run(["session", "create", "--task", taskId, "-f", specPath], cCreate.out, {
      bridge: stack.bridge,
    }),
    cCreate.stderr(),
  ).toBe(0);
  const sessionId = JSON.parse(cCreate.stdout()).session_id as SessionId;
  expect(await stack.lifecycle.health(sessionId)).toBe("up");
  expect(profileDirs(wsRoot).length).toBe(1);
  return { sessionId, taskId };
}

describe("GLA-076 AUTHENTIK CAPSTONE — delegated provider covers passkey AND password, end to end, COLD", () => {
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // AC#1/#2 — two full handoffs through authentik, each reaching the REAL capsule (passkey + password).
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it.runIf(HAVE_CHROMIUM)(
    "AC#1 PASSKEY run + AC#2 PASSWORD run each reach the real capsule via authentik (enroll → step-up → WS proxied)",
    async () => {
      const upstream = await startStubUpstream();
      closers.push(upstream.close);

      // ── RUN A — PASSKEY: amr:["swk"] + UV → webauthn → authorized on a "webauthn"-required route → WS reaches capsule.
      const wA = await authentikWiring();
      const a = await coldAuthentikStack({
        wiring: wA,
        requiredAuthStrength: "webauthn",
        upstream: upstream.endpoint,
      });
      let sessA: SessionId | undefined;
      try {
        await enrollThroughAuthentik(wA, recipient, BOUND_SUB); // Phase E (cold).
        expect(wA.identity.isEnrolled(recipient)).toBe(true);
        expect(wA.provider.getBoundSubject(userIdOf(recipient))?.sub).toBe(BOUND_SUB);
        log("A", `enrolled ${recipient} through authentik (sub=${BOUND_SUB})`);

        const prov = await provisionCapsule(a.stack, a.wsRoot);
        sessA = prov.sessionId;
        const view = await a.stack.session.openHandoff(sessA, { reason: "complete registration" });
        const grantId = grantIdOf(a.stack, view.link);
        log("A", `handoff open → ${view.handoff_id}`);

        await completeStepUpViaBrowserCallback(a.origin, wA.fake, view.link, {
          amr: ["swk"],
          sub: BOUND_SUB,
          userVerified: true,
        });
        if (grantId !== undefined) {
          await expect
            .poll(() => a.stack.gateway?.isGrantAuthorized(grantId), {
              message: "browser callback step-up must authorize the grant",
              timeout: 30_000,
            })
            .toBe(true);
        }
        // The WS upgrade is PROXIED to the REAL capsule's noVNC endpoint (101 + the hello marker).
        const beforeReachA = upstream.snapshot();
        const reached = await rawUpgrade(
          a.origin,
          new URL(view.link).pathname,
          grantFromLink(view.link),
        );
        expect(reached.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
        expectUpstreamReached(upstream, beforeReachA, "browser-callback passkey accepted path");
        reached.socket.destroy();
        log(
          "A",
          "PASSKEY run completed through the GLA-served callback page and reached the real capsule",
        );
      } finally {
        if (sessA) await a.stack.reconciler.reconcile(sessA).catch(() => {});
      }

      // ── RUN B — PASSWORD: amr:["pwd"] → password → authorized on a "password"-required route → WS reaches capsule.
      const wB = await authentikWiring();
      const b = await coldAuthentikStack({
        wiring: wB,
        requiredAuthStrength: "password",
        upstream: upstream.endpoint,
      });
      let sessB: SessionId | undefined;
      try {
        await enrollThroughAuthentik(wB, recipient, BOUND_SUB);
        const prov = await provisionCapsule(b.stack, b.wsRoot);
        sessB = prov.sessionId;
        const view = await b.stack.session.openHandoff(sessB, { reason: "complete registration" });
        const grantId = grantIdOf(b.stack, view.link);

        const res = await synthesizeStepUp(b.origin, wB.fake, view.link, {
          amr: ["pwd"],
          sub: BOUND_SUB,
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { authorized?: boolean; auth_strength?: string };
        expect(body.authorized).toBe(true);
        expect(body.auth_strength).toBe("password");
        if (grantId !== undefined) {
          expect(b.stack.gateway?.isGrantAuthorized(grantId)).toBe(true);
        }
        const beforeReachB = upstream.snapshot();
        const reached = await rawUpgrade(
          b.origin,
          new URL(view.link).pathname,
          grantFromLink(view.link),
        );
        expect(reached.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
        expectUpstreamReached(upstream, beforeReachB, "password accepted path");
        reached.socket.destroy();
        log("B", "PASSWORD run reached the real capsule (WS proxied, noVNC hello observed)");
      } finally {
        if (sessB) await b.stack.reconciler.reconcile(sessB).catch(() => {});
      }
    },
    300_000,
  );

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // AC#3 — strength-gating end to end: a "webauthn" route admits the passkey, REFUSES the password-only run
  // (403, grant NOT authorized, WS upgrade refused, capsule NOT reached).
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it.runIf(HAVE_CHROMIUM)(
    'AC#3 on a "webauthn"-required route: PASSKEY admitted + reaches capsule; PASSWORD-only REFUSED (WS refused, capsule not reached)',
    async () => {
      const upstream = await startStubUpstream();
      closers.push(upstream.close);
      const w = await authentikWiring();
      const { stack, origin, wsRoot } = await coldAuthentikStack({
        wiring: w,
        requiredAuthStrength: "webauthn",
        upstream: upstream.endpoint,
      });
      let sess: SessionId | undefined;
      try {
        await enrollThroughAuthentik(w, recipient, BOUND_SUB);

        // ── The PASSWORD-only run on the "webauthn" route → REFUSED (the human never reaches the capsule). ──
        const provP = await provisionCapsule(stack, wsRoot);
        sess = provP.sessionId;
        const viewP = await stack.session.openHandoff(sess, { reason: "password attempt" });
        const grantP = grantIdOf(stack, viewP.link);
        const resP = await synthesizeStepUp(origin, w.fake, viewP.link, {
          amr: ["pwd"],
          sub: BOUND_SUB,
        });
        expect(resP.status).toBe(403);
        expect(((await resP.json()) as { error?: { code?: string } }).error?.code).toBe(
          "auth.insufficient",
        );
        if (grantP !== undefined) {
          expect(stack.gateway?.isGrantAuthorized(grantP)).toBe(false);
        }
        // THE END-TO-END GATE: the WS upgrade is REFUSED and the capsule receives NO traffic.
        const beforeRefusedP = upstream.snapshot();
        const refused = await rawUpgrade(
          origin,
          new URL(viewP.link).pathname,
          grantFromLink(viewP.link),
        );
        expect(refused.firstChunk).toMatch(/401/);
        expect(refused.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
        expectNoUpstreamTraffic(upstream, beforeRefusedP, "password refused on webauthn route");
        refused.socket.destroy();
        log("3", 'password-only run on a "webauthn" route → 403, WS refused, capsule NOT reached');

        // Close the (refused) window so the session returns to `active` and the next window can open on the SAME capsule.
        await stack.session.cancelHandoff(viewP.handoff_id);

        // ── The PASSKEY run on the SAME "webauthn" route → ADMITTED + reaches the capsule. ──
        const viewK = await stack.session.openHandoff(sess, { reason: "passkey attempt" });
        const resK = await synthesizeStepUp(origin, w.fake, viewK.link, {
          amr: ["swk"],
          sub: BOUND_SUB,
          userVerified: true,
        });
        expect(resK.status).toBe(200);
        expect(((await resK.json()) as { authorized?: boolean }).authorized).toBe(true);
        const beforeReachedK = upstream.snapshot();
        const reachedK = await rawUpgrade(
          origin,
          new URL(viewK.link).pathname,
          grantFromLink(viewK.link),
        );
        expect(reachedK.firstChunk).toContain("UPSTREAM_NOVNC_HELLO");
        expectUpstreamReached(upstream, beforeReachedK, "passkey accepted after refused password");
        reachedK.socket.destroy();
        log(
          "3",
          'passkey run on the SAME "webauthn" route → admitted, WS proxied, capsule reached',
        );
      } finally {
        if (sess) await stack.reconciler.reconcile(sess).catch(() => {});
      }
    },
    300_000,
  );

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // AC#4 — the negatives: a recipient authentik does not vouch for never reaches the capsule (WS refused).
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it.runIf(HAVE_CHROMIUM)(
    "AC#4 negatives (un-enrolled / subject_mismatch / forwarded-link / invalid token) each fail closed at the WS layer — capsule gets no traffic",
    async () => {
      const upstream = await startStubUpstream();
      closers.push(upstream.close);
      const w = await authentikWiring();
      const { stack, origin, wsRoot } = await coldAuthentikStack({
        wiring: w,
        requiredAuthStrength: "password",
        upstream: upstream.endpoint,
      });
      let sess: SessionId | undefined;
      try {
        // ── Negative 1 — UN-ENROLLED: open a handoff for the recipient BEFORE enrolling them. ──
        // (The session is bound to `recipient`; with no bound subject, the step-up cannot succeed.)
        const prov = await provisionCapsule(stack, wsRoot);
        sess = prov.sessionId;
        const viewUn = await stack.session.openHandoff(sess, { reason: "un-enrolled" });
        const resUn = await synthesizeStepUp(origin, w.fake, viewUn.link, {
          amr: ["swk"],
          sub: BOUND_SUB,
          userVerified: true,
        });
        // /handoff/auth/options refuses an un-enrolled recipient (403) → the page never gets a redirect challenge.
        expect(resUn.status).toBe(403);
        const beforeUn = upstream.snapshot();
        const refusedUn = await rawUpgrade(
          origin,
          new URL(viewUn.link).pathname,
          grantFromLink(viewUn.link),
        );
        expect(refusedUn.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
        expectNoUpstreamTraffic(upstream, beforeUn, "un-enrolled recipient");
        refusedUn.socket.destroy();
        log("4", "un-enrolled recipient → step-up refused, WS refused, capsule not reached");
        await stack.session.cancelHandoff(viewUn.handoff_id); // reset the window for the next negative.

        // Now enroll so the remaining negatives are about WHAT authentik returns, not the precondition.
        await enrollThroughAuthentik(w, recipient, BOUND_SUB);

        // ── Negative 2 — SUBJECT_MISMATCH: a VALID FakeAuthentik token for a DIFFERENT sub than the bound one. ──
        const viewSm = await stack.session.openHandoff(sess, { reason: "subject mismatch" });
        const resSm = await synthesizeStepUp(origin, w.fake, viewSm.link, {
          amr: ["swk"],
          sub: "sub-IMPOSTOR-not-the-bound-one",
          userVerified: true,
        });
        expect(resSm.status).toBe(403); // verifyAssertion → subject_mismatch → {ok:false}.
        const grantSm = grantIdOf(stack, viewSm.link);
        if (grantSm !== undefined) expect(stack.gateway?.isGrantAuthorized(grantSm)).toBe(false);
        const beforeSm = upstream.snapshot();
        const refusedSm = await rawUpgrade(
          origin,
          new URL(viewSm.link).pathname,
          grantFromLink(viewSm.link),
        );
        expect(refusedSm.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
        expectNoUpstreamTraffic(upstream, beforeSm, "subject mismatch");
        refusedSm.socket.destroy();
        // The bound subject is unchanged (a valid login by the WRONG person bound nothing).
        expect(w.provider.getBoundSubject(userIdOf(recipient))?.sub).toBe(BOUND_SUB);
        log(
          "4",
          "subject_mismatch (valid token, wrong sub) → 403, WS refused, capsule not reached",
        );
        await stack.session.cancelHandoff(viewSm.handoff_id);

        // ── Negative 3 — INVALID id_token: a wrong-nonce token (bad signature class is unit-proven). ──
        const viewBad = await stack.session.openHandoff(sess, { reason: "bad token" });
        // Synthesize with a deliberately wrong nonce: drive /options to claim the attempt, then stage a token whose
        // nonce does NOT match the attempt's → verifyAssertion → nonce_mismatch.
        const grant = grantFromLink(viewBad.link);
        const path = new URL(viewBad.link).pathname;
        const optRes = await fetch(`${origin}/handoff/auth/options`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ grant, path }),
        });
        const { state } = redirectParams(await optRes.json());
        await w.fake.stageValidLogin(`bad-${state}`, {
          sub: BOUND_SUB,
          nonce: "WRONG-NONCE",
          amr: ["swk"],
          userVerified: true,
        });
        const resBad = await fetch(`${origin}/handoff/auth/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ grant, path, assertion: { code: `bad-${state}`, state } }),
        });
        expect(resBad.status).toBe(403);
        const beforeBad = upstream.snapshot();
        const refusedBad = await rawUpgrade(origin, path, grant);
        expect(refusedBad.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
        expectNoUpstreamTraffic(upstream, beforeBad, "invalid id_token");
        refusedBad.socket.destroy();
        log("4", "invalid id_token (nonce mismatch) → 403, WS refused, capsule not reached");
        await stack.session.cancelHandoff(viewBad.handoff_id);

        // ── Negative 4 — FORWARDED LINK (S-10 lift): a DIFFERENT valid authentik user opens the original link. ──
        // First prove the second recipient is a real provider identity: they are enrolled and can authenticate
        // successfully to authentik on their own. Then present that valid wrong subject against the original grant.
        await enrollThroughAuthentik(w, wrongRecipient, WRONG_BOUND_SUB);
        expect(w.identity.isEnrolled(wrongRecipient)).toBe(true);
        const wrongChallenge = await w.provider.challenge(userIdOf(wrongRecipient));
        const wrongParams = redirectParams(wrongChallenge);
        await w.fake.stageValidLogin(`wrong-ok-${wrongParams.state}`, {
          sub: WRONG_BOUND_SUB,
          nonce: wrongParams.nonce,
          amr: ["pwd"],
        });
        const wrongOwnLogin = await w.provider.verifyAssertion(userIdOf(wrongRecipient), {
          code: `wrong-ok-${wrongParams.state}`,
          state: wrongParams.state,
        });
        expect(wrongOwnLogin).toMatchObject({ ok: true, authStrength: "password" });

        const viewFwd = await stack.session.openHandoff(sess, { reason: "forwarded" });
        const grantFwd = grantIdOf(stack, viewFwd.link);
        const resFwd = await synthesizeStepUp(origin, w.fake, viewFwd.link, {
          amr: ["pwd"],
          sub: WRONG_BOUND_SUB,
        });
        if (maybeFailProofCanary("wrong-recipient")) {
          expect(
            resFwd.status,
            "GLA-093 wrong-recipient canary failure: a valid wrong recipient must not authorize the original grant",
          ).toBe(200);
        } else {
          expect(resFwd.status).toBe(403);
        }
        if (grantFwd !== undefined) expect(stack.gateway?.isGrantAuthorized(grantFwd)).toBe(false);
        const beforeFwd = upstream.snapshot();
        const fwd = await rawUpgrade(
          origin,
          new URL(viewFwd.link).pathname,
          grantFromLink(viewFwd.link),
        );
        expect(fwd.firstChunk).not.toContain("UPSTREAM_NOVNC_HELLO");
        if (maybeFailProofCanary("upstream-leak")) {
          expect(
            upstream.snapshot().connections,
            "GLA-093 upstream-leak canary failure: refused wrong-recipient flow must not touch upstream",
          ).toBeGreaterThan(beforeFwd.connections);
        } else {
          expectNoUpstreamTraffic(upstream, beforeFwd, "valid wrong-recipient forwarded link");
        }
        fwd.socket.destroy();
        log(
          "4",
          "forwarded grant with a valid wrong-recipient authentik login → 403, WS refused, capsule not reached",
        );
      } finally {
        if (sess) await stack.reconciler.reconcile(sess).catch(() => {});
      }
    },
    300_000,
  );
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// AC#5 — the seam invariant (composition-only swap), provable WITHOUT a real capsule (no Chromium gate).
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe("GLA-076 AC#5 — the auth seam is full-capability: provider swap is composition-only (no gateway/core change)", () => {
  /** The repo root, derived from this test's location (works under both src/ and dist/). */
  function repoRoot(): string {
    const here = fileURLToPath(import.meta.url);
    return here.replace(/\/packages\/app\/(dist|src)\/.*$/, "");
  }

  it("the SAME composition root records webauthn by default and authentik on the switch — swap = composition only", () => {
    const base = {
      expectedOrigin: "http://localhost:3000",
      publicBaseUrl: "http://localhost:3000",
      host: "127.0.0.1",
      port: 0,
      deliverySink: { write: () => {} },
    };
    // Default → in-tree WebAuthn.
    const web = createProvisioningBridge({
      dependencyBindings: referenceWpmDependencyBindings(),
      launcherMode: "headless",
      handoff: { ...base },
    });
    expect(web.authModule).toBe(AUTH_WEBAUTHN_MODULE);
    // The switch → delegated authentik. The ONLY difference is which adapter `app` constructs (the gateway,
    // session, route, capability — every other wired seam — is byte-for-byte the same).
    const atk = createProvisioningBridge({
      dependencyBindings: referenceWpmDependencyBindings(),
      launcherMode: "headless",
      handoff: {
        ...base,
        authProvider: "authentik",
        authentik: {
          issuerUrl: "https://idp.example/application/o/gla/",
          clientId: "gla",
          clientSecret: "s",
          redirectUri: "https://gla.example/auth/callback",
        },
      },
    });
    expect(atk.authModule).toBe(AUTH_AUTHENTIK_MODULE);
    // Both wired the same gateway/route/identity seams (present under either provider).
    expect(web.gateway).toBeDefined();
    expect(atk.gateway).toBeDefined();
    expect(web.route).toBeDefined();
    expect(atk.route).toBeDefined();
  });

  function deps(relFromRepoRoot: string): string[] {
    const pkg = JSON.parse(readFileSync(join(repoRoot(), relFromRepoRoot), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  }

  it("package/runtime boundaries keep provider-specific code owned by app, not gateway or core", () => {
    expect(deps("packages/gateway/package.json")).not.toContain("@gla/auth-authentik");
    expect(deps("packages/kernel/package.json")).not.toContain("@gla/auth-authentik");
    expect(deps("packages/app/package.json")).toContain("@gla/auth-authentik");
  });
});

/** The grant token embedded in a handoff link's `?grant=`. */
function grantFromLink(link: string): string {
  return new URL(link).searchParams.get("grant") ?? "";
}

/** Resolve the grant's capability id from a handoff link (so `gateway.isGrantAuthorized(grantId)` can be asserted). */
function grantIdOf(stack: ProvisioningStack, link: string): CapabilityId | undefined {
  const token = grantFromLink(link) as OpaqueToken;
  const scopePath = new URL(link).pathname;
  const v = stack.capability.verifySessionGrantToken(token, { scopePath });
  return v.ok ? (v.capability.id as CapabilityId) : undefined;
}
