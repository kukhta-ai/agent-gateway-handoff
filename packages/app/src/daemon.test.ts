// DAEMON (gla serve) end-to-end test (packages/app) — the proof that GLA is deployable as a long-running
// service (the prerequisite for the Hermes VPS). It boots the REAL `serve()` daemon on an ephemeral gateway
// port + a temp unix socket and drives it the way the deploy does:
//   • daemon round-trip + SHARED STATE: a `gla` command over the bridge socket operates on the DAEMON's
//     shared app state; a SECOND call sees what the first created (the running capsules/grants are shared).
//   • gateway reachable: the daemon's gateway port answers an HTTP request (unknown path → 404), proving it
//     is bound + serving (the sole PUBLIC entry behind Caddy).
//   • public-base-url: a link minted through the daemon (enrollInvite) uses the configured PUBLIC base URL,
//     not loopback — so a recipient's link is reachable through Caddy.
//   • bridge NOT public: a doctor/probe assertion that the bridge endpoint is a LOCAL socket / 127.0.0.1,
//     never 0.0.0.0 (S-6 single-public-entry) — and the daemon REFUSES a 0.0.0.0 bridge config.
//   • graceful shutdown: SIGTERM-style `close()` closes BOTH listeners (gateway + bridge), idempotently.
//   • (Chromium-gated) graceful shutdown tears down a LIVE capsule provisioned through the daemon — no orphan
//     (pid gone, temp profile wiped) — the same teardown the terminal path uses, reused on shutdown.
//
// The non-Chromium cases RUN in `pnpm gate`; the live-capsule teardown is gated (like the other E2Es) because
// it spawns a real browser — but the no-orphan teardown logic is ALSO proven by teardown-e2e + the worker
// unit tests, so the property holds regardless.

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { type Socket, connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { referenceWpmDependencyBindings } from "@gla/catalog";
import { DaemonBridgeClient, Output, type OutputStreams, run } from "@gla/cli";
import type { RecipientRef } from "@gla/kernel";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { type DaemonHandle, endpointIsLocal, parseServeArgs, serve } from "./daemon.js";

const recipient = "tg:user:123" as RecipientRef;
const AUTHENTIK_ENROLLMENT_POLICY_JSON = JSON.stringify({
  provider: "authentik",
  declared: true,
  enrollmentFlow: "gla-invitation-enrollment",
  authenticationFlow: "gla-login-passkey-or-password",
  invitationStage: "gla-invitation-stage",
  userWriteStage: "gla-user-write-stage",
  userLoginStage: "gla-user-login-stage",
  credentialSetupStages: [
    {
      method: "password",
      stage: "gla-password-prompt",
      authStrength: "password",
      assuranceLevel: "password",
      choiceGroup: "primary-credential",
      providerEvidence: { amr: ["pwd"] },
    },
    {
      method: "webauthn-passkey",
      stage: "gla-webauthn-setup",
      authStrength: "webauthn",
      assuranceLevel: "phishing-resistant",
      choiceGroup: "primary-credential",
      providerEvidence: { amr: ["swk"] },
    },
  ],
  externalSources: [
    {
      kind: "oauth",
      name: "github",
      source: "github-oauth",
      choiceGroup: "primary-credential",
      assuranceLevel: "password",
    },
  ],
  mfaRecoveryMethods: [{ method: "totp", stage: "gla-totp-setup", purpose: "mfa" }],
  optionalRecipientChoices: [
    { id: "primary-credential", choices: ["password", "webauthn-passkey", "oauth:github"] },
  ],
});
const AUTHENTIK_EDGE_GUARD_ROLES_JSON = JSON.stringify([
  {
    role: "authentik-forward-auth",
    provider: "authentik",
    mode: "forward-auth",
    label: "authentik outpost in front of GLA",
    optional: true,
    publicSurface: "https://gla.example/team-a/",
    providerEvidence: { outpost: "embedded", access_token: "EDGE_TOKEN_CANARY_087" },
  },
  {
    role: "gla-oidc-provider",
    provider: "authentik",
    mode: "oidc-provider",
    label: "GLA handoff step-up provider",
  },
]);

function chromiumAvailable(): boolean {
  try {
    const p = chromium.executablePath();
    return typeof p === "string" && p.length > 0;
  } catch {
    return false;
  }
}
const HAVE_CHROMIUM = chromiumAvailable();

const scratchDirs: string[] = [];
const liveHandles: DaemonHandle[] = [];
afterEach(async () => {
  for (const h of liveHandles.splice(0)) {
    await h.close().catch(() => {});
  }
  for (const d of scratchDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

/** A scratch dir for the bridge socket / workspace root, auto-cleaned after each test. */
function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

/** Capture an `Output` so a `run()` over the daemon socket can be asserted (stdout JSON + exit code). */
function capture(): { out: Output; stdout: () => string; stderr: () => string } {
  const o: string[] = [];
  const e: string[] = [];
  const streams: OutputStreams = {
    stdout: { write: (s) => void o.push(s), isTTY: false },
    stderr: { write: (s) => void e.push(s), isTTY: false },
  };
  return { out: new Output("json", streams), stdout: () => o.join(""), stderr: () => e.join("") };
}

/** Run one `gla` command over the daemon at `endpoint` (a fresh client per call — the CLI is one-shot). */
async function cliOverDaemon(
  endpoint: string,
  argv: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const client = await DaemonBridgeClient.connect(endpoint);
  const c = capture();
  try {
    const code = await run(argv, c.out, { bridge: client });
    return { code, stdout: c.stdout(), stderr: c.stderr() };
  } finally {
    client.close();
  }
}

/** Boot a daemon on an ephemeral gateway port + a temp uds, with the given public base URL. */
async function startDaemon(opts: {
  publicBaseUrl: string;
  workspaceRoot?: string;
  deliverySink?: { write(line: string): void };
}): Promise<DaemonHandle> {
  const sock = join(scratch("gla-daemon-sock-"), "gla.sock");
  const handle = await serve({
    host: "127.0.0.1",
    port: 0, // ephemeral gateway port (a real deploy binds 0.0.0.0:3000).
    bridgeEndpoint: sock,
    publicBaseUrl: opts.publicBaseUrl,
    dependencyBindings: referenceWpmDependencyBindings(),
    rpID: "localhost",
    expectedOrigin: opts.publicBaseUrl,
    launcherMode: "headless",
    ...(opts.workspaceRoot !== undefined ? { workspaceRoot: opts.workspaceRoot } : {}),
    deliverySink: opts.deliverySink ?? { write: () => {} }, // quiet by default; tests may capture recipient links.
    log: () => {}, // quiet in tests.
  });
  liveHandles.push(handle);
  return handle;
}

/** GET a path on the gateway and resolve its status code (proves the gateway is bound + serving). */
function gatewayStatus(host: string, port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host, port, path, method: "GET" }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

/** Try to connect a raw socket to an endpoint; resolve true if it connects, false if it refuses/errors. */
function canConnect(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const target = endpoint.includes("/")
      ? { path: endpoint }
      : (() => {
          const [h, p] = endpoint.split(":");
          return { host: h ?? "127.0.0.1", port: Number(p) };
        })();
    const socket: Socket = netConnect(target as never);
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

describe("gla serve daemon — deployable long-running service (round-trip, gateway, public base, shutdown)", () => {
  it("daemon round-trip + SHARED STATE: a 2nd CLI call sees the task the 1st created (whoami, task create, session create --dry-run)", async () => {
    const handle = await startDaemon({ publicBaseUrl: "https://203.0.113.10/" });
    const ep = handle.bridgeEndpoint;

    // whoami over the socket → the daemon's shared bridge resolves identity + allowed ops.
    const who = await cliOverDaemon(ep, ["whoami"]);
    expect(who.code, who.stderr).toBe(0);
    const whoJson = JSON.parse(who.stdout);
    expect(whoJson.allowed_ops).toContain("session.create");

    // task create MUTATES the daemon's shared state.
    const created = await cliOverDaemon(ep, [
      "task",
      "create",
      "--intent",
      "register on acme",
      "--recipient",
      recipient,
    ]);
    expect(created.code, created.stderr).toBe(0);
    const taskId = JSON.parse(created.stdout).task_id as string;
    expect(taskId).toMatch(/^task_/);

    // A SEPARATE CLI call (fresh client) sees the task the first created — proof of shared daemon state.
    const listed = await cliOverDaemon(ep, ["task", "list"]);
    expect(listed.code, listed.stderr).toBe(0);
    const tasks = JSON.parse(listed.stdout) as Array<{ task_id: string }>;
    expect(tasks.map((t) => t.task_id)).toContain(taskId);

    // session create --dry-run is ADMITTED over the daemon (admission only, nothing provisioned) — exit 0.
    const dry = await cliOverDaemon(ep, [
      "session",
      "create",
      "--task",
      taskId,
      "--template",
      "browser-handoff",
      "--recipient",
      recipient,
      "--detector",
      "url-watcher",
      "--dry-run",
    ]);
    // The compose form lacks the url-watcher's complete_on param → a deterministic policy reject (exit 3),
    // which STILL proves the admit pipeline ran on the daemon (a stable code, not a crash). Either accept (0)
    // or the documented policy reject (3) is fine for the round-trip proof; assert it is one of the two.
    expect([0, 3]).toContain(dry.code);
    if (dry.code === 3) {
      expect(JSON.parse(dry.stderr).error.code).toBe("policy.denied");
    }
  });

  it("gateway reachable: the daemon's gateway port answers HTTP (unknown path → 404 from the bound gateway)", async () => {
    const handle = await startDaemon({ publicBaseUrl: "https://203.0.113.10/" });
    const status = await gatewayStatus(handle.gateway.host, handle.gateway.port, "/no-such-path");
    expect(status).toBe(404); // the gateway is bound + serving (its 404 for an unknown public path).
  });

  it("public-base-url: a link minted through the daemon (enrollInvite) uses the PUBLIC base, not loopback", async () => {
    const publicBase = "https://203.0.113.10/";
    const delivered: string[] = [];
    const handle = await startDaemon({
      publicBaseUrl: publicBase,
      deliverySink: { write: (line) => void delivered.push(line) },
    });
    expect(handle.publicBaseUrl).toBe(publicBase);
    // The operator enrollment action returns only a redacted read model.
    const invite = await handle.enrollInvite(recipient);
    expect(invite.link).toBe("<redacted-url>");
    expect(invite.grant).toBe("<redacted>");
    expect(invite.nonce).toBe("<redacted>");
    const deliveredInvite = JSON.parse(delivered[0] ?? "{}") as {
      recipient?: string;
      link?: string;
    };
    expect(deliveredInvite.recipient).toBe(recipient);
    expect(deliveredInvite.link?.startsWith(publicBase)).toBe(true);
    expect(deliveredInvite.link).toContain("/enroll");
    expect(deliveredInvite.link).toContain("grant=");
    // It must NOT be a loopback link (the bug this guards: links pointing at 127.0.0.1:<port>).
    expect(deliveredInvite.link).not.toContain("127.0.0.1");
    expect(deliveredInvite.link).not.toContain("localhost");
  });

  it("public-base-url with a path prefix mints links under that configured public base", async () => {
    const publicBase = "https://gla.example/team-a/";
    const delivered: string[] = [];
    const handle = await startDaemon({
      publicBaseUrl: publicBase,
      deliverySink: { write: (line) => void delivered.push(line) },
    });
    expect(handle.publicBaseUrl).toBe(publicBase);
    const invite = await handle.enrollInvite(recipient);
    expect(invite.link).toBe("<redacted-url>");
    const deliveredInvite = JSON.parse(delivered[0] ?? "{}") as { link?: string };
    expect(deliveredInvite.link).toMatch(/^https:\/\/gla\.example\/team-a\/enroll\?grant=/);
  });

  it("public-base-url over the socket: the operator `enrollInvite` daemon op redacts readback", async () => {
    const publicBase = "https://203.0.113.10/";
    const delivered: string[] = [];
    const handle = await startDaemon({
      publicBaseUrl: publicBase,
      deliverySink: { write: (line) => void delivered.push(line) },
    });
    const client = await DaemonBridgeClient.connect(handle.bridgeEndpoint);
    try {
      // The operator op is reachable over the LOCAL bridge socket (a documented daemon call), distinct from
      // the agent surface — `request()` is the public arbitrary-op send.
      const res = await client.request<{ link: string; grant: string; nonce: string }>(
        "enrollInvite",
        [recipient],
      );
      expect(res).toEqual({ link: "<redacted-url>", grant: "<redacted>", nonce: "<redacted>" });
      const deliveredInvite = JSON.parse(delivered[0] ?? "{}") as { link?: string };
      expect(deliveredInvite.link?.startsWith(publicBase)).toBe(true);
      expect(deliveredInvite.link).toContain("/enroll");
      expect(deliveredInvite.link).toContain("grant=");
    } finally {
      client.close();
    }
  });

  it("bridge NOT public (S-6): the bridge endpoint is LOCAL (a uds path), never 0.0.0.0; a 0.0.0.0 bridge is REFUSED", async () => {
    const handle = await startDaemon({ publicBaseUrl: "https://203.0.113.10/" });
    // The doctor assertion: the bound bridge endpoint is local.
    expect(handle.bridgeIsLocal).toBe(true);
    expect(endpointIsLocal(handle.bridgeEndpoint)).toBe(true);

    // The classifier holds the line: loopback host:port is local; 0.0.0.0 / any interface is NOT.
    expect(endpointIsLocal("/run/gla.sock")).toBe(true);
    expect(endpointIsLocal("127.0.0.1:7423")).toBe(true);
    expect(endpointIsLocal("0.0.0.0:7423")).toBe(false);
    expect(endpointIsLocal("0.0.0.0:3000")).toBe(false);

    // The daemon REFUSES to bind the bridge on 0.0.0.0 (fail closed, loud) — nothing public on the agent door.
    await expect(
      serve({
        host: "127.0.0.1",
        port: 0,
        bridgeEndpoint: "0.0.0.0:0",
        publicBaseUrl: "https://203.0.113.10/",
        log: () => {},
      }),
    ).rejects.toThrow(/local-only|0\.0\.0\.0|LOCAL/i);
  });

  it("invalid public base values fail before serving starts with actionable errors", async () => {
    for (const publicBaseUrl of [
      "gla.example/a",
      "https:///a",
      "https://gla.example/a?x=1",
      "https://gla.example/a#frag",
      "https://gla.example/a/../b",
    ]) {
      await expect(
        serve({
          host: "127.0.0.1",
          port: 0,
          bridgeEndpoint: join(scratch("gla-invalid-base-"), "gla.sock"),
          publicBaseUrl,
          log: () => {},
        }),
        publicBaseUrl,
      ).rejects.toThrow(/GLA_PUBLIC_BASE_URL|query|fragment|dot-segment/i);
    }
  });

  it("authentik redirect URI must land on the configured GLA gateway callback path", async () => {
    const common = {
      host: "127.0.0.1",
      port: 0,
      bridgeEndpoint: join(scratch("gla-authentik-base-"), "gla.sock"),
      publicBaseUrl: "https://gla.example/team-a/",
      authProvider: "authentik" as const,
      authentikIssuerUrl: "https://idp.example/application/o/gla/",
      authentikClientId: "gla-client",
      authentikClientSecret: "secret",
      log: () => {},
    };
    await expect(
      serve({ ...common, authentikRedirectUri: "https://other.example/team-a/auth/callback" }),
    ).rejects.toThrow(/same origin/i);
    await expect(
      serve({ ...common, authentikRedirectUri: "https://gla.example/auth/callback" }),
    ).rejects.toThrow(/path prefix/i);
    await expect(
      serve({ ...common, authentikRedirectUri: "https://gla.example/team-a/outpost/callback" }),
    ).rejects.toThrow(/GLA gateway callback path \/team-a\/auth\/callback/i);
    await expect(
      serve({
        ...common,
        publicBaseUrl: "https://gla.example/",
        authentikRedirectUri: "https://gla.example/outpost.goauthentik.io/callback",
      }),
    ).rejects.toThrow(/GLA gateway callback path \/auth\/callback/i);

    const ok = await serve({
      ...common,
      bridgeEndpoint: join(scratch("gla-authentik-base-ok-"), "gla.sock"),
      authentikRedirectUri: "https://gla.example/team-a/auth/callback",
    });
    liveHandles.push(ok);
    expect(ok.publicBaseUrl).toBe("https://gla.example/team-a/");
  });

  it("authentik startup diagnostics expose repairable public config but never the client secret", async () => {
    const logs: string[] = [];
    const secret = "CLIENT_SECRET_CANARY_084";
    const handle = await serve({
      host: "127.0.0.1",
      port: 0,
      bridgeEndpoint: join(scratch("gla-authentik-redaction-"), "gla.sock"),
      publicBaseUrl: "https://gla.example/team-a/",
      authProvider: "authentik",
      authentikIssuerUrl: "https://idp.example/application/o/gla/",
      authentikClientId: "gla-client-canary",
      authentikClientSecret: secret,
      authentikRedirectUri: "https://gla.example/team-a/auth/callback",
      authDeploymentRolesJson: AUTHENTIK_EDGE_GUARD_ROLES_JSON,
      dependencyBindings: referenceWpmDependencyBindings(),
      deliverySink: { write: () => {} },
      log: (line) => void logs.push(line),
    });
    liveHandles.push(handle);

    const text = logs.join("\n");
    expect(text).toContain("https://gla.example/team-a/");
    expect(text).toContain("https://idp.example/application/o/gla/");
    expect(text).toContain("phishing-resistant");
    expect(text).toMatch(/auth edge guard.*authentik.*outer guard/i);
    expect(text).toContain("GLA still verifies handoff/enrollment grants");
    expect(text).toContain("proxy session alone cannot bypass");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("EDGE_TOKEN_CANARY_087");
    expect(text).not.toContain("grant=");
  });

  it("auth diagnostics over the local daemon socket expose the declared authentik enrollment policy and edge guards", async () => {
    const secret = "CLIENT_SECRET_CANARY_085";
    const handle = await serve({
      host: "127.0.0.1",
      port: 0,
      bridgeEndpoint: join(scratch("gla-auth-diagnostics-"), "gla.sock"),
      publicBaseUrl: "https://gla.example/team-a/",
      authProvider: "authentik",
      authAssuranceProfile: "phishing-resistant",
      authentikIssuerUrl: "https://idp.example/application/o/gla/",
      authentikClientId: "gla-client-canary",
      authentikClientSecret: secret,
      authentikRedirectUri: "https://gla.example/team-a/auth/callback",
      authEnrollmentPolicyJson: AUTHENTIK_ENROLLMENT_POLICY_JSON,
      authDeploymentRolesJson: AUTHENTIK_EDGE_GUARD_ROLES_JSON,
      dependencyBindings: referenceWpmDependencyBindings(),
      deliverySink: { write: () => {} },
      log: () => {},
    });
    liveHandles.push(handle);

    const diag = await cliOverDaemon(handle.bridgeEndpoint, ["auth", "diagnostics"]);
    expect(diag.code, diag.stderr).toBe(0);
    const body = JSON.parse(diag.stdout) as {
      authProvider?: string;
      concerns?: string[];
      enrollmentPolicy?: {
        enrollmentFlow?: string;
        credentialSetupStages?: Array<{ method: string }>;
        externalSources?: Array<{ kind: string; name: string }>;
        optionalRecipientChoices?: Array<{ choices: string[] }>;
      };
      deploymentRoles?: Array<{
        role?: string;
        recognizedRole?: string;
        providerEvidence?: unknown;
      }>;
      edgeGuard?: { summary?: string };
      bindingSemantics?: { providerAccount?: string; glaBinding?: string };
    };
    expect(body.authProvider).toBe("authentik");
    expect(body.concerns).toEqual([]);
    expect(body.enrollmentPolicy?.enrollmentFlow).toBe("gla-invitation-enrollment");
    expect(body.enrollmentPolicy?.credentialSetupStages?.map((s) => s.method)).toEqual([
      "password",
      "webauthn-passkey",
    ]);
    expect(body.enrollmentPolicy?.externalSources?.map((s) => `${s.kind}:${s.name}`)).toEqual([
      "oauth:github",
    ]);
    expect(body.enrollmentPolicy?.optionalRecipientChoices?.[0]?.choices).toContain(
      "webauthn-passkey",
    );
    expect(body.bindingSemantics?.providerAccount).toMatch(/not a GLA enrollment/i);
    expect(body.deploymentRoles?.map((r) => r.role)).toEqual([
      "authentik-forward-auth",
      "gla-oidc-provider",
    ]);
    expect(body.deploymentRoles?.[0]?.recognizedRole).toBe("authentik-forward-auth");
    expect(body.edgeGuard?.summary).toMatch(/GLA OIDC provider selected/i);
    expect(diag.stdout).toContain("GLA still verifies handoff/enrollment grants");
    expect(diag.stdout).not.toContain(secret);
    expect(diag.stdout).not.toContain("EDGE_TOKEN_CANARY_087");

    const scoped = await cliOverDaemon(handle.bridgeEndpoint, [
      "auth",
      "diagnostics",
      "--recipient",
      recipient,
    ]);
    expect(scoped.code, scoped.stderr).toBe(0);
    const scopedBody = JSON.parse(scoped.stdout) as {
      recipientBinding?: {
        recipient?: string;
        glaEnrolled?: boolean;
        authStrength?: string;
        subjectBinding?: string;
        providerAccount?: string;
        handoffPrecondition?: string;
      };
    };
    expect(scopedBody.recipientBinding).toMatchObject({
      recipient,
      glaEnrolled: false,
      authStrength: "none",
      subjectBinding: "absent",
      handoffPrecondition: "missing-gla-binding",
    });
    expect(scopedBody.recipientBinding?.providerAccount).toMatch(
      /does not make this recipient enrolled/i,
    );
    expect(scoped.stdout).not.toContain(secret);
  });

  it("auth diagnostics make proxy-only authentik deployments actionable without exposing secrets", async () => {
    const handle = await serve({
      host: "127.0.0.1",
      port: 0,
      bridgeEndpoint: join(scratch("gla-auth-proxy-only-"), "gla.sock"),
      publicBaseUrl: "https://gla.example/team-a/",
      authProvider: "webauthn",
      authDeploymentRolesJson: AUTHENTIK_EDGE_GUARD_ROLES_JSON,
      dependencyBindings: referenceWpmDependencyBindings(),
      deliverySink: { write: () => {} },
      log: () => {},
    });
    liveHandles.push(handle);

    const diag = await cliOverDaemon(handle.bridgeEndpoint, ["auth", "diagnostics"]);
    expect(diag.code, diag.stderr).toBe(0);
    expect(diag.stdout).toMatch(/outer proxy.*does not perform GLA handoff step-up/i);
    expect(diag.stdout).toContain("GLA_AUTH_PROVIDER=authentik");
    expect(diag.stdout).toContain("GLA_AUTHENTIK_ISSUER_URL");
    expect(diag.stdout).toContain("GLA_AUTHENTIK_REDIRECT_URI");
    expect(diag.stdout).toMatch(/intentionally.*WebAuthn/i);
    expect(diag.stdout).not.toContain("EDGE_TOKEN_CANARY_087");
  });

  it("graceful shutdown closes BOTH listeners (gateway HTTP + bridge socket) and is idempotent", async () => {
    const handle = await startDaemon({ publicBaseUrl: "https://203.0.113.10/" });
    const { host, port } = handle.gateway;
    const ep = handle.bridgeEndpoint;

    // Before shutdown: both are reachable.
    expect(await gatewayStatus(host, port, "/x")).toBe(404);
    expect(await canConnect(ep)).toBe(true);

    await handle.close();
    await handle.close(); // idempotent — a second close is a clean no-op.

    // After shutdown: the gateway no longer answers and the bridge socket no longer accepts connections.
    await expect(gatewayStatus(host, port, "/x")).rejects.toBeTruthy();
    expect(await canConnect(ep)).toBe(false);
  });

  it.runIf(HAVE_CHROMIUM)(
    "graceful shutdown tears down a LIVE capsule provisioned through the daemon — no orphan (liveSessions empty, profile wiped)",
    async () => {
      const wsRoot = scratch("gla-daemon-ws-");
      const handle = await startDaemon({
        publicBaseUrl: "https://203.0.113.10/",
        workspaceRoot: wsRoot,
      });
      const ep = handle.bridgeEndpoint;

      // Provision a REAL capsule through the daemon (shared state): task create → session create (-f spec, so
      // the url-watcher's complete_on param is carried — the same assembly the scenario-01 capstone uses).
      const t = await cliOverDaemon(ep, [
        "task",
        "create",
        "--intent",
        "register",
        "--recipient",
        recipient,
      ]);
      const taskId = JSON.parse(t.stdout).task_id as string;
      const spec = join(scratch("gla-daemon-spec-"), "assembly.json");
      writeFileSync(
        spec,
        JSON.stringify({
          apiVersion: "gla.dev/v1",
          kind: "Assembly",
          metadata: { intent: "register", task: taskId },
          spec: {
            template: "browser-handoff",
            recipient,
            detectors: [{ use: "url-watcher", params: { complete_on: "/dashboard" } }],
          },
        }),
      );
      const s = await cliOverDaemon(ep, ["session", "create", "--task", taskId, "-f", spec]);
      expect(s.code, s.stderr).toBe(0);
      const sessionId = JSON.parse(s.stdout).session_id as string;
      expect(sessionId).toBeTruthy();

      // The capsule is LIVE: the daemon reports it in liveSessions() + one temp profile dir under the root.
      expect(handle.liveSessions()).toContain(sessionId);
      expect(profileDirs(wsRoot).length).toBe(1);

      // SIGTERM-style graceful shutdown: tears down the live capsule via the SAME reconciler the terminal path
      // uses — no orphan. After close(): no live session remains and the temp profile is wiped.
      await handle.close();
      await new Promise((r) => setTimeout(r, 500)); // let SIGKILL reach the process group + reap the profile.
      expect(
        handle.liveSessions(),
        "no live capsule remains after graceful shutdown",
      ).not.toContain(sessionId);
      expect(handle.liveSessions().length).toBe(0);
      expect(profileDirs(wsRoot).length, "the temp profile is wiped after shutdown").toBe(0);
    },
    180_000,
  );

  it.skipIf(HAVE_CHROMIUM)(
    "graceful-shutdown capsule teardown SKIPPED — no cached Chromium (proven by teardown-e2e + worker unit tests)",
    () => {
      expect(HAVE_CHROMIUM).toBe(false);
    },
  );
});

describe("gla serve — argument parsing (flags layer over env; flags win)", () => {
  it("parses --port/--host/--endpoint/--public-base-url/--trust-forwarded-prefix/--launcher", () => {
    const parsed = parseServeArgs(
      [
        "--port",
        "3000",
        "--host",
        "0.0.0.0",
        "--endpoint",
        "/run/gla.sock",
        "--public-base-url",
        "https://203.0.113.10/",
        "--trust-forwarded-prefix",
        "true",
        "--launcher",
        "headless",
      ],
      {} as NodeJS.ProcessEnv,
    );
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.port).toBe(3000);
      expect(parsed.options.host).toBe("0.0.0.0");
      expect(parsed.options.bridgeEndpoint).toBe("/run/gla.sock");
      expect(parsed.options.publicBaseUrl).toBe("https://203.0.113.10/");
      expect(parsed.options.trustForwardedPrefix).toBe(true);
      expect(parsed.options.launcherMode).toBe("headless");
    }
  });

  it("falls back to env (GLA_PORT/GLA_PUBLIC_BASE_URL/…) when a flag is absent; a flag overrides env", () => {
    const env = {
      GLA_PORT: "3000",
      GLA_PUBLIC_BASE_URL: "https://from-env/",
      GLA_TRUST_FORWARDED_PREFIX: "1",
      GLA_HOST: "0.0.0.0",
    } as NodeJS.ProcessEnv;
    const parsed = parseServeArgs(
      ["--public-base-url", "https://from-flag/", "--trust-forwarded-prefix", "false"],
      env,
    );
    expect(parsed.help).toBe(false);
    if (!parsed.help) {
      expect(parsed.options.port).toBe(3000); // from env
      expect(parsed.options.host).toBe("0.0.0.0"); // from env
      expect(parsed.options.publicBaseUrl).toBe("https://from-flag/"); // flag wins
      expect(parsed.options.trustForwardedPrefix).toBe(false); // flag wins
    }
  });

  it("parses auth deployment roles from env and flags for auth diagnostics", () => {
    const envParsed = parseServeArgs([], {
      GLA_AUTH_DEPLOYMENT_ROLES_JSON: AUTHENTIK_EDGE_GUARD_ROLES_JSON,
    } as NodeJS.ProcessEnv);
    expect(envParsed.help).toBe(false);
    if (!envParsed.help) {
      expect(envParsed.options.authDeploymentRoles?.map((r) => r.role)).toEqual([
        "authentik-forward-auth",
        "gla-oidc-provider",
      ]);
    }

    const flagParsed = parseServeArgs(
      ["--auth-edge-guard-roles-json", AUTHENTIK_EDGE_GUARD_ROLES_JSON],
      {} as NodeJS.ProcessEnv,
    );
    expect(flagParsed.help).toBe(false);
    if (!flagParsed.help) {
      expect(flagParsed.options.authDeploymentRoles?.[0]?.mode).toBe("forward-auth");
    }
  });

  it("--help returns help; an invalid --port / --launcher throws a stable error", () => {
    expect(parseServeArgs(["--help"], {} as NodeJS.ProcessEnv)).toEqual({ help: true });
    expect(() => parseServeArgs(["--port", "notnum"], {} as NodeJS.ProcessEnv)).toThrow(/port/i);
    expect(() => parseServeArgs(["--launcher", "weird"], {} as NodeJS.ProcessEnv)).toThrow(
      /launcher/i,
    );
    expect(() =>
      parseServeArgs(["--trust-forwarded-prefix", "maybe"], {} as NodeJS.ProcessEnv),
    ).toThrow(/trust-forwarded-prefix/i);
  });

  it("rejects redaction and unresolved template placeholders from flags and env", () => {
    expect(() =>
      parseServeArgs(["--authentik-client-secret", "***"], {} as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/i);
    expect(() =>
      parseServeArgs(["--public-base-url", "<redacted>"], {} as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/i);
    expect(() => parseServeArgs(["--rp-id", "<rp-id>"], {} as NodeJS.ProcessEnv)).toThrow(
      /placeholder/i,
    );
    expect(() =>
      parseServeArgs(["--authentik-client-id", "⟨client-id⟩"], {} as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/i);
    expect(() =>
      parseServeArgs([], {
        GLA_PUBLIC_BASE_URL: "⟨https://your-public-host/⟩",
      } as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/i);
    expect(() =>
      parseServeArgs([], {
        GLA_AUTHENTIK_ISSUER_URL: "<issuer-url>",
      } as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/i);
    expect(() =>
      parseServeArgs([], {
        GLA_AUTHENTIK_CLIENT_SECRET: "<secret>",
      } as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/i);
  });

  it("rejects redaction and unresolved template placeholders from direct serve options before binding", async () => {
    const endpoint = join(scratch("gla-direct-placeholder-"), "gla.sock");

    await expect(
      serve({
        host: "127.0.0.1",
        port: 0,
        bridgeEndpoint: endpoint,
        publicBaseUrl: "https://gla.example/",
        authProvider: "authentik",
        authentikIssuerUrl: "https://idp.example/application/o/gla/",
        authentikClientId: "gla-client",
        authentikClientSecret: "***",
        authentikRedirectUri: "https://gla.example/auth/callback",
        log: () => {},
      }),
    ).rejects.toThrow(/placeholder/i);
    expect(await canConnect(endpoint)).toBe(false);

    await expect(
      serve({
        host: "127.0.0.1",
        port: 0,
        bridgeEndpoint: join(scratch("gla-direct-public-placeholder-"), "gla.sock"),
        publicBaseUrl: "⟨https://your-public-host/⟩",
        log: () => {},
      }),
    ).rejects.toThrow(/placeholder/i);
  });
});

describe("deployment templates — public base path guidance", () => {
  it("documents root and subpath edge-proxy shapes plus separate authentik issuer/callback roles", () => {
    const edge = readFileSync(
      "wpm/wip/bundles/edge-proxy/payload/templates/Caddyfile.tmpl",
      "utf8",
    );
    const env = readFileSync("wpm/wip/bundles/gla-core/payload/templates/gla.env.tmpl", "utf8");
    const edgeAdvisor = readFileSync(
      "wpm/wip/installer-skills/edge-proxy-advisor/SKILL.md",
      "utf8",
    );
    const coreAdvisor = readFileSync("wpm/wip/installer-skills/gla-core-advisor/SKILL.md", "utf8");
    const identityAdvisor = readFileSync(
      "wpm/wip/installer-skills/identity-provider-advisor/SKILL.md",
      "utf8",
    );
    const callback = readFileSync(
      "wpm/wip/bundles/identity-provider/payload/templates/caddy-authentik-callback.snippet",
      "utf8",
    );
    const standup = readFileSync("docs/architecture/authentik-service-standup.md", "utf8");
    const integration = readFileSync("docs/architecture/authentik-integration.md", "utf8");
    const combined = `${edge}\n${env}\n${edgeAdvisor}\n${coreAdvisor}\n${identityAdvisor}\n${callback}\n${standup}\n${integration}`;

    expect(combined).toMatch(/GLA_PUBLIC_BASE_URL=https:\/\/gla\.example\//);
    expect(combined).toMatch(/GLA_PUBLIC_BASE_URL=https:\/\/gla\.example\/team-a\//);
    expect(combined).toMatch(/X-Forwarded-Prefix/i);
    expect(combined).toMatch(/GLA_TRUST_FORWARDED_PREFIX=true/i);
    expect(combined).toMatch(/sanitize|overwrites/i);
    expect(combined).toMatch(/WebSocket/i);
    expect(combined).toMatch(/GLA_AUTHENTIK_ISSUER_URL=https:\/\/idp\.example/i);
    expect(combined).toMatch(
      /GLA_AUTHENTIK_REDIRECT_URI=https:\/\/gla\.example\/team-a\/auth\/callback/i,
    );
    expect(combined).toMatch(/forward_auth/i);
    expect(combined).toMatch(/\/outpost\.goauthentik\.io\/\*/i);
    expect(combined).toMatch(/defense-in-depth/i);
    expect(combined).toMatch(/not (a )?GLA grant/i);
    expect(combined).toMatch(/GLA_AUTH_PROVIDER=authentik/i);
    expect(combined).toMatch(/Agent Bridge[\s\S]*Never expose|bridge remains local-only/i);
    expect(edge).toMatch(/Access logs are intentionally not enabled/i);
    expect(edge).toMatch(/query strings[\s\S]*Sec-WebSocket-Protocol[\s\S]*(omitted|redacted)/i);
    expect(edge).not.toMatch(/^\s*log\s*$/m);
  });
});

/** Count the `gla-profile-*` temp-profile dirs under a workspace root (the capsule's OWN ephemeral state). */
function profileDirs(root: string): string[] {
  try {
    return readdirSync(root).filter((n) => n.startsWith("gla-profile-"));
  } catch {
    return [];
  }
}
