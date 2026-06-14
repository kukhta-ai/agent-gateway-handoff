import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthAuthentikProvider,
  type BoundSubject,
  type OidcRandomness,
  type PendingAttempt,
  type RedirectChallenge,
} from "@gla/auth-authentik";
import { CapabilityService } from "@gla/capability";
import { referenceWpmDependencyBindings } from "@gla/catalog";
import { type EnrollmentRecord, IdentityService } from "@gla/identity";
import type {
  AuthChallenge,
  AuthProviderEnrollmentResult,
  AuthProviderPort,
  AuthProviderVerificationResult,
  EnrollmentChallenge,
  LauncherPort,
  MountCapability,
  MountSpec,
  OpaqueToken,
  PartRef,
  RecipientRef,
  ResolvedAssemblySpec,
  RuntimeHandle,
  TaskId,
  UserIdentity,
  WorkspaceHandle,
  WorkspacePort,
} from "@gla/kernel";
import { HmacCapabilitySigner } from "@gla/kernel";
import {
  type CapsuleWorkerPort,
  type ConnectorCapabilityPort,
  type HandoffDeps,
  type SessionConnectorPort,
  SessionService,
  type SessionServiceSnapshot,
} from "@gla/session";
import { TaskService, type TaskServiceSnapshot } from "@gla/task";
import {
  CapsuleLifecycleManager,
  type CapsuleRecord,
  SpawnerRegistry,
  WorkspaceManager,
} from "@gla/worker";
import { afterEach, describe, expect, it } from "vitest";
import { FakeAuthentik } from "../../../../adapters/auth-authentik/test/fixtures/fake-authentik.js";
import {
  DAEMON_PERSISTED_RECORDS,
  DaemonStateError,
  DaemonStateRoot,
  redactDaemonState,
} from "../../src/daemon-state.js";
import { createProvisioningBridge } from "../../src/index.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `gla-${label}-`));
  roots.push(root);
  return root;
}

class FakeAuthProvider implements AuthProviderPort {
  async beginEnrollment(
    _userId: UserIdentity["id"],
    _discharge: OpaqueToken,
  ): Promise<EnrollmentChallenge> {
    return { challenge: "fake" } as EnrollmentChallenge;
  }

  async finishEnrollment(
    userId: UserIdentity["id"],
    _assertion: unknown,
  ): Promise<AuthProviderEnrollmentResult> {
    return {
      credentialId: `cred:${userId}`,
      authStrength: "webauthn",
      assurance: {
        authStrength: "webauthn",
        level: "phishing-resistant",
        userVerified: true,
        recipientBound: true,
        replayResistant: true,
      },
    };
  }

  async challenge(_userId: UserIdentity["id"]): Promise<AuthChallenge> {
    return { challenge: "step-up" } as AuthChallenge;
  }

  async verifyAssertion(
    _userId: UserIdentity["id"],
    _assertion: unknown,
  ): Promise<AuthProviderVerificationResult> {
    return {
      ok: true,
      authStrength: "webauthn",
      assurance: {
        authStrength: "webauthn",
        level: "phishing-resistant",
        userVerified: true,
        recipientBound: true,
        replayResistant: true,
      },
    };
  }
}

function resolvedSpec(): ResolvedAssemblySpec {
  return {
    apiVersion: "gla.dev/v1",
    kind: "Assembly",
    metadata: { intent: "restart", task: "task_1" },
    spec: {
      template: "browser-handoff",
      recipient: "tg:user:123" as RecipientRef,
      launcher: { use: "launcher-process" },
      workspace: { use: "browser-profile-temp" },
    },
    __resolved: true,
  };
}

class StubLauncher implements LauncherPort {
  readonly tier = "local-process" as const;
  readonly mountCapability: MountCapability = { file: true, directory: true, modes: ["ro", "rw"] };
  failNextStop = false;
  stopped: RuntimeHandle[] = [];

  async spawn(_spec: ResolvedAssemblySpec, _uid: number): Promise<RuntimeHandle> {
    return JSON.stringify({
      launchMode: "headless",
      cdpWebSocketUrl: "ws://127.0.0.1:777/devtools",
      endpoints: [
        {
          resourceId: "connector:daemon-state",
          family: "agent-connector",
          provider: "fake-cdp",
          transport: "websocket",
          address: "ws://127.0.0.1:777/devtools",
        },
      ],
      pid: 777,
    }) as RuntimeHandle;
  }

  async health(_handle: RuntimeHandle): Promise<"up" | "down"> {
    return "up";
  }

  async stop(handle: RuntimeHandle): Promise<void> {
    if (this.failNextStop) {
      this.failNextStop = false;
      throw new Error("stop failed");
    }
    this.stopped.push(handle);
  }
}

class StubWorkspace implements WorkspacePort {
  failNextReap = false;
  reaped: WorkspaceHandle[] = [];

  async realize(
    _strategy: PartRef,
    _mounts: MountSpec[],
    _asUid: number,
  ): Promise<WorkspaceHandle> {
    return JSON.stringify({ profileDir: "/tmp/gla-profile" }) as WorkspaceHandle;
  }

  async reap(handle: WorkspaceHandle): Promise<void> {
    if (this.failNextReap) {
      this.failNextReap = false;
      throw new Error("reap failed");
    }
    this.reaped.push(handle);
  }
}

function fileStore<T>(
  state: DaemonStateRoot,
  kind: string,
  fallback: T,
): { load(): T; save(value: T): void } {
  const file = state.file<T>(kind, fallback);
  return { load: () => file.read(), save: (value) => file.write(value) };
}

function fixedOidc(state: string, nonce: string): OidcRandomness {
  return {
    pkce: async () => ({ verifier: `verifier-${state}`, challenge: `challenge-${state}` }),
    randomState: () => state,
    randomNonce: () => nonce,
  };
}

describe("DaemonStateRoot", () => {
  it("encrypts/authenticates record files and keeps root/file permissions least-privilege", () => {
    const root = tempRoot("state");
    const state = DaemonStateRoot.open({ root });
    const kv = state.kv<{ codeVerifier: string; token: string }>("provider.authentik.attempts");

    kv.set("state-secret", {
      codeVerifier: "verifier-secret",
      token: "grant-bearer-secret",
    });

    const recordPath = state.recordPath("provider.authentik.attempts");
    const rootMode = lstatSync(root).mode & 0o777;
    const fileMode = lstatSync(recordPath).mode & 0o777;
    const raw = readFileSync(recordPath, "utf8");

    expect(rootMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
    expect(raw).not.toContain("verifier-secret");
    expect(raw).not.toContain("grant-bearer-secret");
    expect(kv.get("state-secret")).toEqual({
      codeVerifier: "verifier-secret",
      token: "grant-bearer-secret",
    });
  });

  it("fails closed when an encrypted state record is tampered", () => {
    const root = tempRoot("tamper");
    const state = DaemonStateRoot.open({ root });
    state.kv<{ sub: string }>("provider.authentik.subjects").set("user:1", { sub: "sub-1" });

    const path = state.recordPath("provider.authentik.subjects");
    const envelope = JSON.parse(readFileSync(path, "utf8")) as { ciphertext: string };
    envelope.ciphertext = "AA";
    writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);

    const reopened = DaemonStateRoot.open({ root });
    expect(() => reopened.kv<{ sub: string }>("provider.authentik.subjects").get("user:1")).toThrow(
      /integrity/i,
    );
  });

  it("refuses group/world-readable state directories, records, stale locks, and symlink roots", () => {
    const root = tempRoot("unsafe");
    const state = DaemonStateRoot.open({ root });
    state.kv<{ sub: string }>("provider.authentik.subjects").set("user:1", { sub: "sub-1" });
    chmodSync(state.recordPath("provider.authentik.subjects"), 0o644);

    const reopened = DaemonStateRoot.open({ root });
    expect(() => reopened.kv<{ sub: string }>("provider.authentik.subjects").get("user:1")).toThrow(
      DaemonStateError,
    );

    const unsafeDir = tempRoot("unsafe-dir");
    chmodSync(unsafeDir, 0o755);
    expect(() => DaemonStateRoot.open({ root: unsafeDir })).toThrow(/0700|group\/world/i);
    chmodSync(unsafeDir, 0o700);

    const locked = tempRoot("locked");
    writeFileSync(join(locked, "daemon.lock"), "owned\n", { mode: 0o600 });
    expect(() => DaemonStateRoot.open({ root: locked })).toThrow(/locked|owned/i);

    const target = tempRoot("target");
    const link = `${target}-link`;
    roots.push(link);
    symlinkSync(target, link);
    expect(() => DaemonStateRoot.open({ root: link })).toThrow(/symlink/i);
  });

  it("redacts critical values in diagnostic output", () => {
    const redacted = redactDaemonState(
      'https://gla.example/handoff/sess_secret?grant=grant-canary grant=abc123&code=oidc-code&state=oidc-state {"client_secret":"s3","codeVerifier":"v","token":"t"}',
    );

    expect(redacted).not.toContain("sess_secret");
    expect(redacted).not.toContain("grant-canary");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("oidc-code");
    expect(redacted).not.toContain("oidc-state");
    expect(redacted).not.toContain("s3");
    expect(redacted).not.toContain('"v"');
    expect(redacted).toContain("<redacted-url>");
    expect(redacted).toContain("<redacted>");
  });

  it("classifies every persisted record kind with lifecycle metadata", () => {
    expect(DAEMON_PERSISTED_RECORDS.length).toBeGreaterThan(0);
    for (const record of DAEMON_PERSISTED_RECORDS) {
      expect(record.kind).toMatch(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i);
      expect(record.owner.length).toBeGreaterThan(0);
      expect(record.recovery.length).toBeGreaterThan(0);
      expect(record.retention.length).toBeGreaterThan(0);
      expect(record.disposal.length).toBeGreaterThan(0);
    }
  });
});

describe("restart-safe security state wiring", () => {
  it("restores the capability signing key, revocations, and spent enrollment nonces across stack recreation", async () => {
    const root = tempRoot("capability");
    const recipient = "tg:user:123" as RecipientRef;

    const first = createProvisioningBridge({
      dependencyBindings: referenceWpmDependencyBindings(),
      stateRoot: root,
    });
    const minted = await first.capability.mintEnrollmentGrant(recipient);
    expect(first.capability.verifyEnrollmentGrantToken(minted.token).ok).toBe(true);

    const second = createProvisioningBridge({
      dependencyBindings: referenceWpmDependencyBindings(),
      stateRoot: root,
    });
    const afterRestart = second.capability.verifyEnrollmentGrantToken(minted.token);
    expect(afterRestart.ok).toBe(true);
    if (!afterRestart.ok) {
      throw new Error("expected restored signer key to verify the pre-restart grant");
    }

    await second.capability.revoke(afterRestart.capability.id);
    const third = createProvisioningBridge({
      dependencyBindings: referenceWpmDependencyBindings(),
      stateRoot: root,
    });
    expect(third.capability.verifyEnrollmentGrantToken(minted.token)).toEqual({
      ok: false,
      reason: "auth.revoked",
    });

    const spent = await third.capability.mintEnrollmentGrant(recipient);
    expect(third.capability.tryConsumeEnrollmentGrantToken(spent.token).ok).toBe(true);
    const fourth = createProvisioningBridge({
      dependencyBindings: referenceWpmDependencyBindings(),
      stateRoot: root,
    });
    expect(fourth.capability.verifyEnrollmentGrantToken(spent.token)).toEqual({
      ok: false,
      reason: "auth.revoked",
    });
  });

  it("releases the state-root owner lock on clean stack shutdown", async () => {
    const root = tempRoot("lock-release");

    const first = createProvisioningBridge({
      dependencyBindings: referenceWpmDependencyBindings(),
      stateRoot: root,
    });
    await first.ready;
    expect(existsSync(join(root, "daemon.lock"))).toBe(true);

    await first.close();
    expect(existsSync(join(root, "daemon.lock"))).toBe(false);

    const second = createProvisioningBridge({
      dependencyBindings: referenceWpmDependencyBindings(),
      stateRoot: root,
    });
    await second.ready;
    await second.close();
  });

  it("restores identity enrollment facts through the identity-owned store seam", async () => {
    const root = tempRoot("identity");
    const state = DaemonStateRoot.open({ root });
    const recipient = "tg:user:42" as RecipientRef;
    const store = state.kv<EnrollmentRecord>("identity.enrollments");

    const first = new IdentityService({ authProvider: new FakeAuthProvider(), enrollments: store });
    await first.enrollComplete(recipient, { ok: true });
    expect(first.isEnrolled(recipient)).toBe(true);

    const reopened = DaemonStateRoot.open({ root });
    const second = new IdentityService({
      authProvider: new FakeAuthProvider(),
      enrollments: reopened.kv<EnrollmentRecord>("identity.enrollments"),
    });
    expect(second.isEnrolled(recipient)).toBe(true);
    await expect(second.authenticationOptions(recipient)).resolves.toEqual({
      challenge: "step-up",
    });
  });

  it("keeps authentik pending attempts and subject bindings in durable provider stores", async () => {
    const root = tempRoot("authentik");
    const state = DaemonStateRoot.open({ root });
    const attempts = state.kv<PendingAttempt>("provider.authentik.attempts");
    const subjects = state.kv<{ sub: string }>("provider.authentik.subjects");
    const userId = "user:tg:user:7" as UserIdentity["id"];

    const provider = new AuthAuthentikProvider({
      issuerUrl: "https://idp.example/application/o/gla/",
      clientId: "gla",
      clientSecret: "client-secret",
      redirectUri: "https://gla.example/auth/callback",
      endpoints: {
        authorizationEndpoint: "https://idp.example/authorize",
        tokenEndpoint: "https://idp.example/token",
        jwksUri: "https://idp.example/jwks",
      },
      subjects,
      attempts,
      randomness: {
        pkce: async () => ({ verifier: "verifier-secret", challenge: "challenge-public" }),
        randomState: () => "oidc-state",
        randomNonce: () => "oidc-nonce",
      },
    });

    subjects.set(userId, { sub: "authentik-sub" });
    await provider.challenge(userId);

    const reopened = DaemonStateRoot.open({ root });
    expect(reopened.kv<{ sub: string }>("provider.authentik.subjects").get(userId)).toEqual({
      sub: "authentik-sub",
    });
    expect(
      reopened.kv<PendingAttempt>("provider.authentik.attempts").get("oidc-state"),
    ).toMatchObject({
      userId,
      state: "oidc-state",
      nonce: "oidc-nonce",
      codeVerifier: "verifier-secret",
      kind: "authenticate",
    });
  });

  it("completes authentik enrollment and step-up attempts that began before restart, while replay and wrong-recipient callbacks fail", async () => {
    const root = tempRoot("authentik-roundtrip");
    const fake = await FakeAuthentik.create();
    const userId = "user:tg:user:8" as UserIdentity["id"];
    const otherUserId = "user:tg:user:9" as UserIdentity["id"];

    const provider = (state: DaemonStateRoot, randomness: OidcRandomness): AuthAuthentikProvider =>
      new AuthAuthentikProvider({
        issuerUrl: fake.issuerUrl,
        clientId: fake.clientId,
        clientSecret: "client-secret",
        redirectUri: "https://gla.example/auth/callback",
        endpoints: fake.endpoints(),
        jwks: fake.jwks,
        fetch: fake.fetch,
        subjects: state.kv<BoundSubject>("provider.authentik.subjects"),
        attempts: state.kv<PendingAttempt>("provider.authentik.attempts"),
        randomness,
      });

    const beforeEnrollmentRestart = provider(
      DaemonStateRoot.open({ root }),
      fixedOidc("state-enroll", "nonce-enroll"),
    );
    const enrollmentRedirect = (await beforeEnrollmentRestart.beginEnrollment(
      userId,
      "operator-discharge" as OpaqueToken,
    )) as RedirectChallenge;
    expect(new URL(enrollmentRedirect.authorizeUrl).searchParams.get("state")).toBe("state-enroll");

    await fake.stageValidLogin("code-enroll", {
      sub: "authentik-sub",
      nonce: "nonce-enroll",
      amr: ["pwd"],
    });
    const afterEnrollmentRestart = provider(
      DaemonStateRoot.open({ root }),
      fixedOidc("unused", "unused"),
    );
    await expect(
      afterEnrollmentRestart.finishEnrollment(userId, {
        code: "code-enroll",
        state: "state-enroll",
      }),
    ).resolves.toMatchObject({ credentialId: "authentik-sub", authStrength: "password" });

    const beforeStepUpRestart = provider(
      DaemonStateRoot.open({ root }),
      fixedOidc("state-step", "nonce-step"),
    );
    await beforeStepUpRestart.challenge(userId);
    await fake.stageValidLogin("code-step", {
      sub: "authentik-sub",
      nonce: "nonce-step",
      amr: ["swk"],
      userVerified: true,
    });

    const afterStepUpRestart = provider(DaemonStateRoot.open({ root }), fixedOidc("x", "y"));
    await expect(
      afterStepUpRestart.verifyAssertion(userId, { code: "code-step", state: "state-step" }),
    ).resolves.toMatchObject({ ok: true, authStrength: "webauthn" });

    await expect(
      afterStepUpRestart.verifyAssertion(userId, { code: "code-step", state: "state-step" }),
    ).resolves.toEqual({ ok: false, authStrength: "none" });

    const wrongRecipientAttempt = provider(
      DaemonStateRoot.open({ root }),
      fixedOidc("state-wrong-user", "nonce-wrong-user"),
    );
    await wrongRecipientAttempt.challenge(userId);
    await fake.stageValidLogin("code-wrong-user", {
      sub: "authentik-sub",
      nonce: "nonce-wrong-user",
      amr: ["swk"],
    });
    await expect(
      provider(DaemonStateRoot.open({ root }), fixedOidc("z", "z")).verifyAssertion(otherUserId, {
        code: "code-wrong-user",
        state: "state-wrong-user",
      }),
    ).resolves.toEqual({ ok: false, authStrength: "none" });
  });

  it("restores task aggregates and held task-capability tokens through the task store seam", async () => {
    const root = tempRoot("task");
    const state = DaemonStateRoot.open({ root });
    const signer = new HmacCapabilitySigner();
    const capability = new CapabilityService(signer);
    const taskStore = fileStore<TaskServiceSnapshot>(state, "task.state", {
      tasks: [],
      tokens: [],
    });

    const first = new TaskService({
      capability: signer,
      store: taskStore,
      newTaskId: () => "task_restart" as TaskId,
      teardown: { teardownSession: async () => undefined },
    });
    const anchor = await capability.mintAgentAuthority({
      profile: "local-single-operator",
      identity: "agent:local",
      allowedOps: ["session.create", "handoff.open", "handoff.wait", "task.complete"],
    });
    const created = await first.create({ recipient: "tg:user:123" as RecipientRef }, anchor.token);
    first.attachSession(created.task.id, "sess_restart");

    const second = new TaskService({
      capability: signer,
      store: taskStore,
      teardown: { teardownSession: async () => undefined },
    });

    expect(second.get("task_restart" as TaskId).sessions).toEqual(["sess_restart"]);
    expect(second.capabilityToken("task_restart" as TaskId)).toBe(created.taskCapabilityToken);
  });

  it("restores sessions/provision records and safe-closes recovered open handoff windows", async () => {
    const root = tempRoot("session");
    const state = DaemonStateRoot.open({ root });
    const sessionStore = fileStore<SessionServiceSnapshot>(state, "session.state", {
      sessions: [],
      provisioned: [],
      handoffs: [],
      completions: [],
    });
    let connectorRevoked = false;
    let handoffGrantRevoked = false;
    let handoffGrantForceClosed = false;
    let handoffRouteUnmounted = false;
    const provision: {
      worker: CapsuleWorkerPort;
      capability: ConnectorCapabilityPort;
      connector: SessionConnectorPort;
    } = {
      worker: {
        spawn: async () => ({
          runtime: JSON.stringify({
            launchMode: "headless",
            cdpWebSocketUrl: "ws://127.0.0.1:777/devtools",
            endpoints: [
              {
                resourceId: "connector:daemon-restart",
                family: "agent-connector",
                provider: "fake-cdp",
                transport: "websocket",
                address: "ws://127.0.0.1:777/devtools",
              },
            ],
          }) as RuntimeHandle,
          launcherName: "launcher-process",
        }),
        teardown: async () => undefined,
        hasLive: () => true,
        runtimeOf: () =>
          JSON.stringify({
            launchMode: "headless",
            endpoints: [
              {
                resourceId: "connector:daemon-restart",
                family: "agent-connector",
                provider: "fake-cdp",
                transport: "websocket",
                address: "ws://127.0.0.1:777/devtools",
              },
            ],
          }) as RuntimeHandle,
      },
      capability: {
        mintConnector: async () => ({
          capabilityId: "cap_connector" as never,
          secretRef: "cap_connector" as never,
        }),
        revoke: async () => {
          connectorRevoked = true;
        },
      },
      connector: {
        attach: async () => ({
          type: "fake-cdp",
          provider: "fake-cdp",
          resourceId: "connector:daemon-restart",
          cdp_url: "ws://127.0.0.1:777/devtools",
          secret_ref: "cap_connector" as never,
        }),
        bindSecretRef: () => undefined,
        unbindSecretRef: () => undefined,
      },
    };
    const handoff: HandoffDeps = {
      capability: {
        mintSessionGrant: async () => ({
          grantId: "cap_handoff" as never,
          token: "grant-token" as OpaqueToken,
          scopePath: "/handoff/sess_restart",
        }),
        revoke: async () => {
          handoffGrantRevoked = true;
        },
        forceCloseGrant: () => {
          handoffGrantForceClosed = true;
        },
      },
      route: {
        program: async (_window, grantId, entrypoint, path) => ({
          id: "route_restart" as never,
          path: path ?? "/handoff/sess_restart",
          entrypointResourceId: entrypoint.resourceId,
          client: entrypoint.client,
          transport: entrypoint.transport,
          boundGrantId: grantId,
        }),
        unmount: async () => {
          handoffRouteUnmounted = true;
        },
      },
      entrypoint: {
        open: async () => ({
          resourceId: "entrypoint:daemon-restart",
          provider: "fake-view",
          client: { kind: "provider-asset", ref: "fake-viewer" },
          transport: {
            kind: "reverse-proxy" as const,
            protocol: "websocket",
            upstream: "ws://127.0.0.1:5901",
          },
        }),
      },
      channel: {
        deliver: async () => undefined,
      },
      buildLink: (path, token) => `http://gla.example${path}?grant=${token}`,
      newHandoffId: () => "hand_restart" as never,
    };

    const first = new SessionService({
      store: sessionStore,
      provision,
      handoff,
      newSessionId: () => "sess_restart" as never,
    });
    first.createFromAdmitted("task_restart" as TaskId, resolvedSpec());
    await first.provision("sess_restart" as never);
    await first.openHandoff("sess_restart" as never);

    const failedRecovery = new SessionService({
      store: sessionStore,
      provision,
      handoff: {
        ...handoff,
        capability: {
          ...handoff.capability,
          revoke: async () => {
            throw new Error("revocation unavailable");
          },
        },
      },
    });
    await expect(failedRecovery.recoveryComplete()).rejects.toThrow(/recovered open handoffs/i);

    const preserved = new SessionService({
      store: sessionStore,
      provision,
      handoff,
      recoverOpenHandoffs: "preserve",
    });
    expect(preserved.handoffGet("hand_restart" as never).state).toBe("open");

    const secondRef: { svc?: SessionService } = {};
    const second = new SessionService({
      store: sessionStore,
      provision,
      handoff,
      teardown: {
        reconcile: async (sessionId) => {
          const info = secondRef.svc?.connectorTeardownInfo(sessionId);
          if (info !== undefined) {
            await provision.capability.revoke(info.connectorCapId);
            secondRef.svc?.clearProvisioned(sessionId);
          }
        },
      },
    });
    secondRef.svc = second;
    await second.recoveryComplete();
    expect(second.get("sess_restart" as never).state).toBe("active");
    expect(second.handoffGet("hand_restart" as never).state).toBe("expired");
    expect(handoffGrantForceClosed).toBe(true);
    expect(handoffGrantRevoked).toBe(true);
    expect(handoffRouteUnmounted).toBe(true);
    expect(second.connectorTeardownInfo("sess_restart" as never)).toEqual({
      connectorCapId: "cap_connector",
      connectorResourceId: "connector:daemon-restart",
    });

    await second.teardownSession("sess_restart" as never);
    expect(connectorRevoked).toBe(true);
    const third = new SessionService({ store: sessionStore, provision, handoff });
    expect(third.get("sess_restart" as never).state).toBe("completed");
    expect(third.connectorTeardownInfo("sess_restart" as never)).toBeUndefined();
  });

  it("restores worker live-capsule records so cleanup can stop and reap after restart", async () => {
    const root = tempRoot("worker");
    const state = DaemonStateRoot.open({ root });
    const lifecycleStore = fileStore<CapsuleRecord[]>(state, "worker.lifecycle", []);
    const launcher = new StubLauncher();
    const workspacePort = new StubWorkspace();
    const registry = new SpawnerRegistry().register("launcher-process", launcher, {
      default: true,
    });
    const workspace = new WorkspaceManager(workspacePort);

    const first = new CapsuleLifecycleManager({
      registry,
      workspace,
      store: lifecycleStore,
    });
    await first.spawn("sess_restart", resolvedSpec());

    const second = new CapsuleLifecycleManager({
      registry,
      workspace,
      store: lifecycleStore,
    });
    expect(second.liveSessions()).toEqual(["sess_restart"]);

    await second.teardown("sess_restart");
    expect(launcher.stopped.length).toBe(1);
    expect(workspacePort.reaped.length).toBe(1);

    const third = new CapsuleLifecycleManager({
      registry,
      workspace,
      store: lifecycleStore,
    });
    expect(third.liveSessions()).toEqual([]);
  });

  it("keeps worker live-capsule records after failed teardown so restart cleanup can retry", async () => {
    const root = tempRoot("worker-retry");
    const state = DaemonStateRoot.open({ root });
    const lifecycleStore = fileStore<CapsuleRecord[]>(state, "worker.lifecycle", []);
    const launcher = new StubLauncher();
    const workspacePort = new StubWorkspace();
    const registry = new SpawnerRegistry().register("launcher-process", launcher, {
      default: true,
    });
    const workspace = new WorkspaceManager(workspacePort);

    const first = new CapsuleLifecycleManager({
      registry,
      workspace,
      store: lifecycleStore,
    });
    await first.spawn("sess_retry", resolvedSpec());

    launcher.failNextStop = true;
    workspacePort.failNextReap = true;
    const failedCleanup = new CapsuleLifecycleManager({
      registry,
      workspace,
      store: lifecycleStore,
    });
    await failedCleanup.teardown("sess_retry");
    expect(failedCleanup.liveSessions()).toEqual(["sess_retry"]);

    const retry = new CapsuleLifecycleManager({
      registry,
      workspace,
      store: lifecycleStore,
    });
    expect(retry.liveSessions()).toEqual(["sess_retry"]);
    await retry.teardown("sess_retry");
    expect(launcher.stopped.length).toBe(1);
    expect(workspacePort.reaped.length).toBe(1);

    const converged = new CapsuleLifecycleManager({
      registry,
      workspace,
      store: lifecycleStore,
    });
    expect(converged.liveSessions()).toEqual([]);
  });
});
