// @gla/app · the `gla serve` DAEMON — the long-running deployable (baseline §1: "boots the :3000 process").
//
// This is what makes GLA runnable as a service in the Hermes VPS (LXD `hermes-1`, fronted by host Caddy at
// `https://203.0.113.10/`). It composes ONE shared app state (`createProvisioningBridge` with the handoff +
// completion pipeline) and binds the two transports the two-actor capsule needs (baseline §3):
//
//   • the Access Gateway — the SOLE PUBLIC entry — on `0.0.0.0:<GLA_PORT|3000>` (behind Caddy);
//   • the Agent Bridge — a LOCAL endpoint, NEVER 0.0.0.0 — a unix-domain socket by default (so the agent's
//     `gla` CLI drives the SAME shared daemon state: the running capsules/grants), `127.0.0.1:<port>` only
//     as a fallback.
//
// Handoff/enroll links are built against `--public-base-url` (`GLA_PUBLIC_BASE_URL`) so a recipient's link
// is reachable through Caddy (not `http://127.0.0.1:<port>`). On SIGINT/SIGTERM it shuts down GRACEFULLY —
// tearing down every live capsule via the SAME idempotent Cleanup Reconciler the terminal path uses (no
// orphan), then closing the connector broker, the gateway, and the bridge listener.
//
// Boundary: this file is in the composition root (`app`), but provider-family adapters are resolved through
// Provider Host provider sets. The bridge transport protocol itself lives in the edge `surfaces/cli` package
// (the CLI is the other end); here we only bind a `node:net` server and hand each accepted socket to that
// protocol.

import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import {
  type Server as NetServer,
  createServer as createIpcServer,
  createConnection as createNetConnection,
} from "node:net";
import { dirname, isAbsolute } from "node:path";
import type { AgentBridge } from "@gla/bridge";
import type { DependencyBinding } from "@gla/catalog";
import { type OperatorOps, serveBridgeConnection } from "@gla/cli";
import { parsePublicBaseUrl, publicPath } from "@gla/gateway";
import {
  AUTH_ASSURANCE_PROFILE_VALUES,
  type AuthAssuranceProfile,
  DEFAULT_AUTH_ASSURANCE_PROFILE,
  type OpaqueToken,
  type RecipientRef,
  glaError,
  isRedactionOrTemplatePlaceholder,
  parseAuthAssuranceProfile,
} from "@gla/kernel";
import {
  type AuthDeploymentRole,
  type AuthDiagnostics,
  type AuthEnrollmentMethodPolicy,
  authEnrollmentDiagnostics,
  parseAuthDeploymentRolesJson,
  parseAuthEnrollmentPolicyJson,
  withRecipientBindingDiagnostic,
} from "./auth-enrollment-policy.js";
import { redactDaemonState } from "./daemon-state.js";
import {
  type AuthProviderConfig,
  type AuthProviderKind,
  type DeliverySink,
  createProvisioningBridge,
} from "./index.js";

const BRIDGE_SOCKET_MODE = 0o600;
const BRIDGE_RUNTIME_DIR_MODE = 0o700;
const BRIDGE_ENDPOINT_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const deliveryToStdout: DeliverySink = {
  write: (line) => void process.stdout.write(`${line}\n`),
};

/** Options for {@link serve} (each has an env/flag default; see {@link parseServeArgs}). */
export interface ServeOptions {
  /** The Access Gateway bind host — the PUBLIC entry. Default `0.0.0.0` (hermes-1, behind Caddy). */
  host?: string;
  /** The Access Gateway bind port. Default `3000` (the deploy target); tests pass `0` for an ephemeral port. */
  port?: number;
  /**
   * The Agent Bridge LOCAL endpoint — a unix-domain-socket PATH (default) or a `127.0.0.1:<port>` fallback.
   * NEVER `0.0.0.0` (the bridge is LOCAL — baseline §3 single-public-entry). Defaults to {@link defaultBridgeEndpoint}.
   */
  bridgeEndpoint?: string;
  /**
   * The PUBLIC base URL handoff/enroll links are built against, e.g. `https://203.0.113.10/`. Threaded into
   * the handoff pipeline so links are reachable through Caddy (not loopback). Defaults to `http://<host>:<port>`
   * when absent (a dev convenience), but a real deploy MUST set it to the Caddy URL.
   */
  publicBaseUrl?: string;
  /**
   * Trust `X-Forwarded-Prefix` for strip-prefix reverse proxies. Enable only when the edge overwrites or strips
   * incoming client-supplied values before proxying to GLA. Prefix-preserving proxying does not need it.
   */
  trustForwardedPrefix?: boolean;
  /**
   * Opaque auth-provider id to wire behind the kernel `AuthProviderPort`. Default `"webauthn"`.
   */
  authProvider?: AuthProviderKind;
  /** Provider-owned auth config object, validated by the selected provider's Provider Host schema. */
  authProviderConfig?: AuthProviderConfig;
  /** JSON form of {@link authProviderConfig}; accepted from env/flags for deployment templates. */
  authProviderConfigJson?: string;
  /**
   * Provider-neutral assurance policy for handoff auth. Default `phishing-resistant`; set
   * `password-permitted` only when password-grade evidence is an intentional deployment policy.
   */
  authAssuranceProfile?: AuthAssuranceProfile;
  /**
   * Provider-extensible enrollment method policy descriptor, normally emitted by the identity-provider bundle after
   * verifying the active flow/stages/sources. Used for operator diagnostics; runtime enforcement still uses provider
   * evidence returned through the AuthProviderPort.
   */
  authEnrollmentPolicy?: AuthEnrollmentMethodPolicy;
  /** Provider-extensible deployment-role evidence for auth diagnostics and edge-guard orientation. */
  authDeploymentRoles?: AuthDeploymentRole[];
  /** JSON form of {@link authDeploymentRoles}; accepted from env/flags for deployment templates. */
  authDeploymentRolesJson?: string;
  /** JSON form of {@link authEnrollmentPolicy}; accepted from env/flags for deployment templates. */
  authEnrollmentPolicyJson?: string;
  /** The Relying-Party ID the passkey is bound to (no scheme/port). Default `localhost`. (WebAuthn path.) */
  rpID?: string;
  /** The human-visible RP name in the passkey UI. Default `GLA`. (WebAuthn path.) */
  rpName?: string;
  /**
   * The expected page ORIGIN(s) the WebAuthn ceremony runs on (scheme+host+port). Defaults to the public base
   * URL's origin. MUST match where the recipient's browser loads the enroll/handoff page.
   */
  expectedOrigin?: string | string[];
  /** Where the channel writes recipient-bound links (default stdout — the local/CLI fallback channel). */
  deliverySink?: DeliverySink;
  /** Force the launcher mode (default `auto`: full if Xvfb/x11vnc/websockify present, else headless). */
  launcherMode?: "auto" | "full" | "headless";
  /** Override the workspace root (where ephemeral temp profiles are created). */
  workspaceRoot?: string;
  /**
   * Structured WPM dependency binding receipts. Absent means host-touching catalog providers fail closed until
   * deployment composition supplies machine-readable WPM receipt evidence.
   */
  dependencyBindings?: DependencyBinding[];
  /** JSON form of {@link dependencyBindings}; accepted from env/flags for WPM receipt handoff. */
  dependencyBindingsJson?: string;
  /**
   * Restart-safe daemon state root. Critical state is stored outside capsule workspaces with 0700/0600 permissions.
   */
  stateRoot?: string;
  /** A logger sink for the startup banner + doctor lines (default `process.stderr`, so stdout stays clean). */
  log?: (line: string) => void;
}

/** A running daemon handle: the live addresses + a single idempotent `close()` for graceful shutdown. */
export interface DaemonHandle {
  /** The composed shared app state (the provisioning + handoff stack) all CLI calls operate on. */
  readonly bridge: AgentBridge;
  /** The Access Gateway's actually-bound `{host, port}` (the ephemeral port when 0 was requested). */
  readonly gateway: { host: string; port: number };
  /** The Agent Bridge endpoint actually bound (the uds path, or `host:port`). */
  readonly bridgeEndpoint: string;
  /** The public base URL handoff/enroll links are built against. */
  readonly publicBaseUrl: string;
  /** Is the bridge endpoint LOCAL (a uds path or a loopback host) and NOT 0.0.0.0? (The S-6 doctor assertion.) */
  readonly bridgeIsLocal: boolean;
  /**
   * The OPERATOR enrollment action against the LIVE server (docs/05 §3: operator-side, NOT the agent surface).
   * Mint a single-use operator-discharge grant bound to `recipient` + deliver the enrollment invite link (built
   * against the public base URL, so it is reachable through Caddy). The precondition for any handoff. Also
   * reachable over the bridge socket as the operator op `enrollInvite` (a documented daemon call).
   */
  enrollInvite(
    recipient: RecipientRef,
  ): Promise<{ link: string; grant: OpaqueToken; nonce: string }>;
  /** Read-only operator diagnostics for selected auth provider, enrollment method policy, and assurance fit. */
  authDiagnostics(): AuthDiagnostics;
  /**
   * The session ids of all currently-LIVE capsules (the worker's live-capsule truth). A graceful shutdown
   * tears every one of these down; after `close()` this is empty (the no-orphan assertion). Read-only.
   */
  liveSessions(): string[];
  /**
   * Graceful shutdown (idempotent): tear down every LIVE capsule via the same idempotent Cleanup Reconciler
   * the terminal path uses (no orphan), then close the connector broker + the gateway + the bridge listener.
   * Awaited so a SIGTERM handler can `await handle.close()` before exit.
   */
  close(): Promise<void>;
}

/** The default Agent Bridge LOCAL endpoint: `$XDG_RUNTIME_DIR/gla.sock` if set, else `/run/gla.sock`. */
export function defaultBridgeEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_RUNTIME_DIR;
  if (xdg !== undefined && xdg.length > 0) {
    return `${xdg.replace(/\/$/, "")}/gla.sock`;
  }
  return "/run/gla.sock";
}

/** Is an endpoint LOCAL — a uds PATH, or a loopback `127.0.0.1`/`::1`/`localhost` host:port — and NOT 0.0.0.0? */
export function endpointIsLocal(endpoint: string): boolean {
  if (BRIDGE_ENDPOINT_URL_RE.test(endpoint)) {
    return false;
  }
  const m = endpoint.match(/^(\[?[^\]]*\]?|[^:]+):(\d+)$/);
  if (m === null) {
    // No `host:port` form ⇒ a unix-domain-socket path ⇒ inherently local (filesystem-scoped, not network).
    return true;
  }
  const host = (m[1] ?? "").replace(/^\[|\]$/g, "").toLowerCase();
  // A loopback host is local; 0.0.0.0 / :: / any other interface is NOT (S-6: the bridge is never public).
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/** Does the endpoint use the trusted-local private Unix-socket profile rather than loopback TCP? */
function endpointIsUnixSocket(endpoint: string): boolean {
  return "path" in endpointToListenTarget(endpoint);
}

/** Operator-facing endpoint text, preserving repair context but redacting grant/secret-shaped material. */
function bridgeEndpointForDiagnostic(endpoint: string): string {
  return redactDaemonState(endpoint);
}

function authDiagnosticsInput(opts: {
  authProvider: AuthProviderKind | undefined;
  authAssuranceProfile: AuthAssuranceProfile | undefined;
  authEnrollmentPolicy: AuthEnrollmentMethodPolicy | undefined;
  authDeploymentRoles: AuthDeploymentRole[] | undefined;
}): {
  authProvider?: AuthProviderKind;
  authAssuranceProfile?: AuthAssuranceProfile;
  enrollmentPolicy?: AuthEnrollmentMethodPolicy;
  deploymentRoles?: AuthDeploymentRole[];
} {
  const input: {
    authProvider?: AuthProviderKind;
    authAssuranceProfile?: AuthAssuranceProfile;
    enrollmentPolicy?: AuthEnrollmentMethodPolicy;
    deploymentRoles?: AuthDeploymentRole[];
  } = {};
  if (opts.authProvider !== undefined) {
    input.authProvider = opts.authProvider;
  }
  if (opts.authAssuranceProfile !== undefined) {
    input.authAssuranceProfile = opts.authAssuranceProfile;
  }
  if (opts.authEnrollmentPolicy !== undefined) {
    input.enrollmentPolicy = opts.authEnrollmentPolicy;
  }
  if (opts.authDeploymentRoles !== undefined) {
    input.deploymentRoles = opts.authDeploymentRoles;
  }
  return input;
}

/** Operator-facing diagnostic for whether the selected provider can satisfy the selected assurance profile. */
export function authAssuranceProviderDiagnostic(opts: {
  authProvider?: AuthProviderKind;
  authAssuranceProfile?: AuthAssuranceProfile;
  authEnrollmentPolicy?: AuthEnrollmentMethodPolicy;
  authDeploymentRoles?: AuthDeploymentRole[];
}): string {
  const d = authEnrollmentDiagnostics(
    authDiagnosticsInput({
      authProvider: opts.authProvider,
      authAssuranceProfile: opts.authAssuranceProfile,
      authEnrollmentPolicy: opts.authEnrollmentPolicy,
      authDeploymentRoles: opts.authDeploymentRoles,
    }),
  );
  if (d.concerns.length > 0) {
    return `${d.summary}; concerns: ${d.concerns.join("; ")}`;
  }
  return `${d.summary}; satisfies the selected policy`;
}

function authDiagnosticsForRequest(
  base: AuthDiagnostics,
  identity: { getCredential(recipient: RecipientRef): unknown } | undefined,
  arg: unknown,
): AuthDiagnostics {
  const recipient = recipientDiagnosticArg(arg);
  if (recipient === undefined) {
    return base;
  }
  const record = identity?.getCredential(recipient as RecipientRef);
  if (record !== undefined && !authEnrollmentRecordLike(record)) {
    throw new Error("identity enrollment record has an unexpected diagnostic shape");
  }
  return withRecipientBindingDiagnostic(base, recipient, record);
}

function recipientDiagnosticArg(arg: unknown): string | undefined {
  if (arg === undefined) {
    return undefined;
  }
  if (typeof arg === "string" && arg.length > 0) {
    return arg;
  }
  if (typeof arg === "object" && arg !== null && !Array.isArray(arg)) {
    const recipient = (arg as { recipient?: unknown }).recipient;
    if (typeof recipient === "string" && recipient.length > 0) {
      return recipient;
    }
  }
  throw glaError(
    "usage.bad_argument",
    "auth diagnostics recipient must be a non-empty recipient ref",
  );
}

function authEnrollmentRecordLike(record: unknown): record is {
  userId: string;
  authStrength: "none" | "password" | "webauthn";
  authAssurance?: { level?: "none" | "password" | "phishing-resistant" };
} {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return false;
  }
  const candidate = record as { userId?: unknown; authStrength?: unknown; authAssurance?: unknown };
  if (typeof candidate.userId !== "string") {
    return false;
  }
  if (
    candidate.authStrength !== "none" &&
    candidate.authStrength !== "password" &&
    candidate.authStrength !== "webauthn"
  ) {
    return false;
  }
  if (candidate.authAssurance === undefined) {
    return true;
  }
  if (
    typeof candidate.authAssurance !== "object" ||
    candidate.authAssurance === null ||
    Array.isArray(candidate.authAssurance)
  ) {
    return false;
  }
  const level = (candidate.authAssurance as { level?: unknown }).level;
  return (
    level === undefined ||
    level === "none" ||
    level === "password" ||
    level === "phishing-resistant"
  );
}

/**
 * Boot the `gla serve` daemon: compose ONE shared provisioning+handoff app state, bind the Access Gateway on
 * the PUBLIC `host:port`, bind the Agent Bridge on a LOCAL endpoint, print the startup banner + the S-6 doctor
 * line, and return a {@link DaemonHandle} (whose `close()` is the graceful shutdown). The process stays alive
 * because both listeners hold the event loop open; the caller wires SIGINT/SIGTERM → `handle.close()`.
 */
export async function serve(opts: ServeOptions = {}): Promise<DaemonHandle> {
  validateServeOptions(opts);
  const log = opts.log ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const host = opts.host ?? "0.0.0.0";
  const port = opts.port ?? 3000;
  const bridgeEndpoint = opts.bridgeEndpoint ?? defaultBridgeEndpoint();
  // The public base URL: explicit wins; else derive from the gateway host:port (a dev convenience — a real
  // deploy sets it to the Caddy URL so links are reachable). 0.0.0.0 is not dialable, so loopback-ize it.
  const configuredPublicBaseUrl =
    opts.publicBaseUrl ?? `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;
  const publicBase = parsePublicBaseUrl(configuredPublicBaseUrl);
  const publicBaseUrl = publicBase.href;
  const expectedOrigin = opts.expectedOrigin ?? publicBase.origin;

  // ── S-6 guard: the bridge endpoint must NEVER be 0.0.0.0 (the agent surface is LOCAL — baseline §3). A
  //    config that asks to bind the bridge publicly is REFUSED before anything binds (fail closed, loud).
  if (!endpointIsLocal(bridgeEndpoint)) {
    throw new Error(
      `refusing to bind the Agent Bridge on a non-local endpoint "${bridgeEndpointForDiagnostic(
        bridgeEndpoint,
      )}" — the bridge is LOCAL-only (baseline §3 single-public-entry). Use a unix socket or 127.0.0.1:<port>.`,
    );
  }

  // ── Provider selection: default is WebAuthn. Provider-owned config and WPM dependency evidence are parsed
  //    generically, then Provider Host performs provider-specific schema/dependency validation.
  const authProviderConfig = resolveAuthProviderConfig(opts, publicBase);
  const dependencyBindings = resolveDependencyBindings(opts);
  const authEnrollmentPolicy =
    opts.authEnrollmentPolicy ??
    (opts.authEnrollmentPolicyJson !== undefined
      ? parseAuthEnrollmentPolicyJson(
          opts.authEnrollmentPolicyJson,
          opts.authProvider ?? "webauthn",
        )
      : undefined);
  const authDeploymentRoles =
    opts.authDeploymentRoles ??
    (opts.authDeploymentRolesJson !== undefined
      ? parseAuthDeploymentRolesJson(opts.authDeploymentRolesJson)
      : undefined);
  const authDiagnostics = authEnrollmentDiagnostics(
    authDiagnosticsInput({
      authProvider: opts.authProvider,
      authAssuranceProfile: opts.authAssuranceProfile,
      authEnrollmentPolicy,
      authDeploymentRoles,
    }),
  );

  // ── Compose ONE shared app state: the provisioning bridge + the handoff + completion pipeline. Every CLI
  //    call over the bridge socket runs against THIS bridge (the live capsules/grants — shared state).
  const stack = createProvisioningBridge({
    ...(dependencyBindings !== undefined ? { dependencyBindings } : {}),
    ...(opts.launcherMode !== undefined ? { launcherMode: opts.launcherMode } : {}),
    ...(opts.workspaceRoot !== undefined ? { workspaceRoot: opts.workspaceRoot } : {}),
    ...(opts.stateRoot !== undefined ? { stateRoot: opts.stateRoot } : {}),
    handoff: {
      ...(opts.authProvider !== undefined ? { authProvider: opts.authProvider } : {}),
      ...(opts.authAssuranceProfile !== undefined
        ? { authAssuranceProfile: opts.authAssuranceProfile }
        : {}),
      ...(authProviderConfig !== undefined ? { authProviderConfig } : {}),
      rpID: opts.rpID ?? "localhost",
      rpName: opts.rpName ?? "GLA",
      expectedOrigin,
      publicBaseUrl,
      trustForwardedPrefix: opts.trustForwardedPrefix ?? false,
      host,
      port,
      deliverySink: opts.deliverySink ?? deliveryToStdout,
      // The url-watcher completion pipeline (so a handoff window CLOSES on the human's validated done-signal).
      completion: {},
    },
  });
  try {
    await stack.ready;
  } catch (error) {
    await stack.close().catch(() => {});
    throw error;
  }

  // ── Bind the Access Gateway on the PUBLIC host:port (the sole public entry, behind Caddy). The provisioning
  //    bridge constructed it but did not bind it — listen here so enrollment + step-up + the WS proxy are
  //    reachable. The actual bound port is read back (ephemeral when 0 was requested, for tests).
  if (stack.gateway === undefined) {
    await stack.close().catch(() => {});
    throw new Error(
      "internal: handoff gateway was not wired (createProvisioningBridge handoff missing)",
    );
  }
  const bound = await stack.gateway.listen();

  // ── The OPERATOR enrollment action (operator-side, NOT the agent door — docs/05 §3): exposed BOTH on the
  //    handle and as the bridge-socket operator op `enrollInvite`, so a recipient can be enrolled against the
  //    LIVE server. `createProvisioningBridge` wired it onto the stack (the same gateway + credential store the
  //    step-up verifies against). It is the precondition for any handoff.
  if (stack.enrollInvite === undefined) {
    throw new Error(
      "internal: enrollInvite was not wired (createProvisioningBridge handoff missing)",
    );
  }
  const enrollInvite = stack.enrollInvite;
  const operators: OperatorOps = {
    enrollInvite: (...args: unknown[]) => enrollInvite(args[0] as RecipientRef),
    authDiagnostics: (...args: unknown[]) =>
      authDiagnosticsForRequest(authDiagnostics, stack.identity, args[0]),
  };

  // ── Bind the Agent Bridge on the LOCAL endpoint: a node:net server that hands each accepted socket to the
  //    line-delimited JSON-RPC protocol (surfaces/cli), dispatching every op onto the SHARED bridge above (+
  //    the operator ops). The agent surface and the operator op share the LOCAL socket (both operator-trusted).
  let ipc: NetServer;
  try {
    ipc = await bindBridgeServer(bridgeEndpoint, stack.bridge, operators);
  } catch (error) {
    await stack.close().catch(() => {});
    throw error;
  }

  const bridgeIsLocal = endpointIsLocal(bridgeEndpoint);
  const bridgeProfile = endpointIsUnixSocket(bridgeEndpoint)
    ? "private Unix socket (trusted-local profile)"
    : "loopback TCP (development/advanced; not equivalent to a private Unix socket for cross-user isolation)";

  // ── Startup banner + the S-6 doctor line (so an operator can SEE the bridge is not public). ──
  log("── gla serve ──");
  log(
    `  gateway (PUBLIC) : http://${bound.host}:${bound.port}  (front with Caddy → ${publicBaseUrl})`,
  );
  log(`  bridge  (LOCAL)  : ${bridgeEndpointForDiagnostic(bridgeEndpoint)}`);
  log(`  bridge profile   : ${bridgeProfile}`);
  const authIssuer =
    typeof authProviderConfig?.issuerUrl === "string" ? authProviderConfig.issuerUrl : undefined;
  log(
    `  auth provider    : ${stack.authModule}${authIssuer !== undefined ? `  (issuer ${authIssuer})` : ""}`,
  );
  log(`  auth assurance   : ${opts.authAssuranceProfile ?? DEFAULT_AUTH_ASSURANCE_PROFILE}`);
  log(`  auth enrollment  : ${authDiagnostics.summary}`);
  log(`  auth edge guard  : ${authDiagnostics.edgeGuard.summary}`);
  for (const concern of authDiagnostics.concerns) {
    log(`  auth concern     : ${concern}`);
  }
  for (const action of authDiagnostics.actions) {
    log(`  auth action      : ${action}`);
  }
  log(`  public base url  : ${publicBaseUrl}  (handoff/enroll links use this)`);
  log(
    `  doctor           : bridge endpoint is ${bridgeIsLocal ? "LOCAL ✓ (not 0.0.0.0)" : "NON-LOCAL ✗ — REFUSED"} (S-6 single-public-entry)`,
  );
  log("  ready — SIGINT/SIGTERM for graceful shutdown (tears down live capsules, no orphan).");

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    // (1) Close runtime resources owned by the provisioning stack: live capsules, connector broker,
    //     public gateway, and daemon state-root owner lock.
    await stack.close().catch(() => {});
    // (2) Close the LOCAL bridge listener + remove the uds path so a restart can re-bind cleanly.
    await closeBridgeServer(ipc, bridgeEndpoint).catch(() => {});
  };

  return {
    bridge: stack.bridge,
    gateway: { host: bound.host, port: bound.port },
    bridgeEndpoint,
    publicBaseUrl,
    bridgeIsLocal,
    enrollInvite,
    authDiagnostics: () => authDiagnostics,
    liveSessions: () => stack.lifecycle.liveSessions(),
    close,
  };
}

/** Bind the node:net bridge server at `endpoint` (a uds path or `host:port`), serving the JSON-RPC protocol. */
async function bindBridgeServer(
  endpoint: string,
  bridge: AgentBridge,
  operators: OperatorOps,
): Promise<NetServer> {
  let verifiedLocalBoundary = false;
  const server = createIpcServer((socket) => {
    if (!verifiedLocalBoundary) {
      socket.destroy();
      return;
    }
    serveBridgeConnection(socket, bridge, operators);
  });
  const target = endpointToListenTarget(endpoint);
  if ("path" in target) {
    await prepareUdsPath(target.path);
  }
  const listeningServer = await new Promise<NetServer>((resolve, reject) => {
    const onErr = (e: Error): void => {
      server.removeAllListeners("listening");
      reject(e);
    };
    server.once("error", onErr);
    server.listen(target as never, () => {
      server.removeListener("error", onErr);
      resolve(server);
    });
  });
  try {
    if ("path" in target) {
      secureBoundUdsPath(target.path);
    }
  } catch (error) {
    await closeBridgeServer(listeningServer, endpoint).catch(() => {});
    throw error;
  }
  verifiedLocalBoundary = true;
  return listeningServer;
}

/** Close the bridge server + remove the uds path (idempotent) so a restart re-binds cleanly. */
function closeBridgeServer(server: NetServer, endpoint: string): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => {
      const target = endpointToListenTarget(endpoint);
      if ("path" in target && existsSync(target.path)) {
        try {
          unlinkOwnedSocket(target.path);
        } catch {
          // best-effort — startup validates before reusing or removing any leftover path.
        }
      }
      resolve();
    });
  });
}

/** Parse a bridge endpoint into the node:net LISTEN target (`{path}` for a uds, `{host,port}` for tcp). */
function endpointToListenTarget(
  endpoint: string,
): { path: string } | { host: string; port: number } {
  const m = endpoint.match(/^(\[?[^\]]*\]?|[^:]+):(\d+)$/);
  if (m !== null) {
    const host = (m[1] ?? "127.0.0.1").replace(/^\[|\]$/g, "");
    const port = Number(m[2]);
    if (Number.isInteger(port) && port >= 0) {
      return { host, port };
    }
  }
  return { path: endpoint };
}

/** Ensure a uds path is safe before listening; only verified stale socket files may be removed. */
async function prepareUdsPath(path: string): Promise<void> {
  if (!isAbsolute(path)) {
    throw new Error(
      `refusing Agent Bridge socket path "${bridgeEndpointForDiagnostic(
        path,
      )}" — Unix-domain bridge endpoints must be absolute paths.`,
    );
  }
  const dir = dirname(path);
  assertExistingRuntimeAncestorChain(dir, path);
  if (dir.length > 0 && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: BRIDGE_RUNTIME_DIR_MODE });
    chmodSync(dir, BRIDGE_RUNTIME_DIR_MODE);
  }
  assertSecureRuntimeDir(dir, path);
  if (!existsSync(path)) {
    return;
  }

  const st = lstatSync(path);
  assertOwnedByCurrentUid(
    st.uid,
    `Agent Bridge socket path "${bridgeEndpointForDiagnostic(path)}"`,
  );
  if (st.isSymbolicLink()) {
    throw new Error(
      `refusing Agent Bridge socket path "${bridgeEndpointForDiagnostic(
        path,
      )}" — endpoint must not be a symlink.`,
    );
  }
  if (st.isDirectory()) {
    throw new Error(
      `refusing Agent Bridge socket path "${bridgeEndpointForDiagnostic(
        path,
      )}" — endpoint is a directory, not a Unix socket.`,
    );
  }
  if (!st.isSocket()) {
    throw new Error(
      `refusing Agent Bridge socket path "${bridgeEndpointForDiagnostic(
        path,
      )}" — endpoint is not a Unix socket; remove or move the regular file first.`,
    );
  }
  if (await socketAcceptsConnections(path)) {
    throw new Error(
      `refusing Agent Bridge socket path "${bridgeEndpointForDiagnostic(
        path,
      )}" — a bridge socket already accepts connections there; stop the owning daemon first.`,
    );
  }
  unlinkSync(path);
}

/** Lock down and verify the freshly bound Unix socket before any bridge operation can be accepted. */
function secureBoundUdsPath(path: string): void {
  chmodSync(path, BRIDGE_SOCKET_MODE);
  const st = lstatSync(path);
  assertOwnedByCurrentUid(
    st.uid,
    `Agent Bridge socket path "${bridgeEndpointForDiagnostic(path)}"`,
  );
  if (st.isSymbolicLink() || !st.isSocket()) {
    throw new Error(
      `refusing Agent Bridge socket path "${bridgeEndpointForDiagnostic(
        path,
      )}" — bound endpoint was replaced before verification.`,
    );
  }
  if ((st.mode & 0o077) !== 0) {
    throw new Error(
      `refusing Agent Bridge socket path "${bridgeEndpointForDiagnostic(
        path,
      )}" — bound socket is group/other accessible.`,
    );
  }
}

/** Verify the runtime dir can protect the socket from other local users replacing or pre-creating it. */
function assertSecureRuntimeDir(dir: string, socketPath: string): void {
  assertExistingRuntimeAncestorChain(dir, socketPath);
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(
      `refusing Agent Bridge runtime directory for "${bridgeEndpointForDiagnostic(
        socketPath,
      )}" — parent must be a real directory, not a symlink or file.`,
    );
  }
  assertOwnedByCurrentUid(
    st.uid,
    `Agent Bridge runtime directory for "${bridgeEndpointForDiagnostic(socketPath)}"`,
  );
  if ((st.mode & 0o022) !== 0) {
    throw new Error(
      `refusing Agent Bridge runtime directory for "${bridgeEndpointForDiagnostic(
        socketPath,
      )}" — group/other write permissions would let another local user pre-create or replace the socket.`,
    );
  }
}

function assertExistingRuntimeAncestorChain(dir: string, socketPath: string): void {
  if (!isAbsolute(dir)) {
    return;
  }
  const parts = dir.split("/").filter((part) => part.length > 0);
  let current = "/";
  for (const part of parts) {
    current = current === "/" ? `/${part}` : `${current}/${part}`;
    if (!existsSync(current)) {
      assertAncestorNotReplaceable(dirname(current), socketPath);
      return;
    }
    const st = lstatSync(current);
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new Error(
        `refusing Agent Bridge runtime directory for "${bridgeEndpointForDiagnostic(
          socketPath,
        )}" — parent path component "${bridgeEndpointForDiagnostic(
          current,
        )}" must be a real directory, not a symlink or file.`,
      );
    }
    if (current !== dir) {
      assertAncestorNotReplaceable(current, socketPath);
    }
  }
}

function assertAncestorNotReplaceable(dir: string, socketPath: string): void {
  const st = lstatSync(dir);
  if ((st.mode & 0o022) !== 0 && (st.mode & 0o1000) === 0) {
    throw new Error(
      `refusing Agent Bridge runtime directory for "${bridgeEndpointForDiagnostic(
        socketPath,
      )}" — writable ancestor "${bridgeEndpointForDiagnostic(
        dir,
      )}" is not sticky and could replace the socket directory.`,
    );
  }
}

function assertOwnedByCurrentUid(ownerUid: number, label: string): void {
  const getuid = process.getuid;
  if (typeof getuid !== "function") {
    return;
  }
  const uid = getuid.call(process);
  if (ownerUid !== uid) {
    throw new Error(`${label} is owned by uid ${ownerUid}, not the daemon uid ${uid}.`);
  }
}

function socketAcceptsConnections(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createNetConnection({ path });
    const finish = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function unlinkOwnedSocket(path: string): void {
  const st = lstatSync(path);
  if (st.isSocket()) {
    assertOwnedByCurrentUid(
      st.uid,
      `Agent Bridge socket path "${bridgeEndpointForDiagnostic(path)}"`,
    );
    unlinkSync(path);
  }
}

function parseJsonRecord(json: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  assertUsableServeOption(label, value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function parseDependencyBindingsJson(json: string): DependencyBinding[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("dependency bindings JSON is not valid JSON");
  }
  assertUsableServeOption("dependency bindings JSON", value);
  if (!Array.isArray(value)) {
    throw new Error("dependency bindings JSON must be an array of WPM DependencyBinding records");
  }
  return value as DependencyBinding[];
}

function resolveDependencyBindings(opts: ServeOptions): DependencyBinding[] | undefined {
  if (opts.dependencyBindings !== undefined) {
    return opts.dependencyBindings;
  }
  if (opts.dependencyBindingsJson !== undefined) {
    return parseDependencyBindingsJson(opts.dependencyBindingsJson);
  }
  return undefined;
}

function resolveAuthProviderConfig(
  opts: ServeOptions,
  publicBase: ReturnType<typeof parsePublicBaseUrl>,
): AuthProviderConfig | undefined {
  const config =
    opts.authProviderConfig ??
    (opts.authProviderConfigJson !== undefined
      ? parseJsonRecord(opts.authProviderConfigJson, "auth provider config JSON")
      : undefined);
  if (config === undefined) {
    return undefined;
  }
  validateProviderRedirectUri(config, publicBase);
  return config;
}

function validateProviderRedirectUri(
  config: AuthProviderConfig,
  publicBase: ReturnType<typeof parsePublicBaseUrl>,
): void {
  const redirectUri = config.redirectUri;
  if (typeof redirectUri !== "string") {
    return;
  }
  const redirectBase = parsePublicBaseUrl(redirectUri);
  if (redirectBase.origin !== publicBase.origin) {
    throw new Error(
      'auth provider config field "redirectUri" must use the same origin as GLA_PUBLIC_BASE_URL so the callback lands on GLA\'s same-origin gateway page',
    );
  }
  if (
    publicBase.pathPrefix.length > 0 &&
    redirectBase.pathPrefix !== publicBase.pathPrefix &&
    !redirectBase.pathPrefix.startsWith(`${publicBase.pathPrefix}/`)
  ) {
    throw new Error(
      'auth provider config field "redirectUri" must be under GLA_PUBLIC_BASE_URL\'s path prefix so code/state return to GLA without leaking grants to the auth provider',
    );
  }
  const expectedCallbackPath = publicPath(publicBase, "/auth/callback");
  if (redirectBase.pathPrefix !== expectedCallbackPath) {
    throw new Error(
      `auth provider config field "redirectUri" must land on the GLA gateway callback path ${expectedCallbackPath}; provider proxy/outpost paths or arbitrary same-origin callbacks cannot complete grant-verified step-up/enrollment.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// `gla serve` — the runnable command (arg parsing + signal-wired lifetime).
// ─────────────────────────────────────────────────────────────────────────────

/** Usage text for `gla serve` (printed for `--help`). */
const SERVE_USAGE = `gla serve — run the long-running GLA daemon (the :3000 deployable)

Usage:
  gla serve [--port <n>] [--host <h>] [--endpoint <path|host:port>] [--public-base-url <url>]
            [--trust-forwarded-prefix <true|false>]
            [--rp-id <id>] [--rp-name <name>] [--launcher <auto|full|headless>] [--workspace-root <dir>]
            [--state-root <dir>]
            [--auth-provider <provider-id>] [--auth-provider-config-json <json>]
            [--auth-assurance-policy <phishing-resistant|password-permitted>]
            [--auth-enrollment-policy-json <json>] [--auth-deployment-roles-json <json>]
            [--dependency-bindings-json <json>]

Binds:
  • the Access Gateway (PUBLIC) on  host:port           default 0.0.0.0:3000   (front with Caddy)
  • the Agent Bridge   (LOCAL)  on  a unix socket        default $XDG_RUNTIME_DIR/gla.sock or /run/gla.sock
                                    (or 127.0.0.1:<port>; NEVER 0.0.0.0)

Auth provider (--auth-provider, default webauthn): provider ids are resolved through Provider Host. Provider-owned
  config is supplied as JSON via --auth-provider-config-json / GLA_AUTH_PROVIDER_CONFIG_JSON and validated against
  the selected provider's schema. Secret-bearing values are redacted from diagnostics.

Auth assurance (--auth-assurance-policy, default phishing-resistant): unset demands passkey/phishing-resistant
  evidence; password-permitted is the explicit policy that admits password-grade evidence.

Env (flags win): GLA_PORT, GLA_HOST, GLA_ENDPOINT, GLA_PUBLIC_BASE_URL, GLA_TRUST_FORWARDED_PREFIX,
  GLA_RP_ID, GLA_RP_NAME, GLA_LAUNCHER_MODE, GLA_WORKSPACE_ROOT, GLA_STATE_ROOT,
  GLA_AUTH_PROVIDER, GLA_AUTH_PROVIDER_CONFIG_JSON, GLA_AUTH_ASSURANCE_POLICY, GLA_AUTH_ENROLLMENT_POLICY_JSON,
  GLA_AUTH_DEPLOYMENT_ROLES_JSON, GLA_AUTH_EDGE_GUARD_ROLES_JSON,
  GLA_DEPENDENCY_BINDINGS_JSON.

Then drive it from another shell with the daemon's bridge endpoint:
  GLA_ENDPOINT=<endpoint> gla whoami
  GLA_ENDPOINT=<endpoint> gla task create --intent "…" --recipient "…"
`;

/**
 * Parse `gla serve` argv (after the `serve` token) into {@link ServeOptions}, layering flags over env defaults
 * (flags win). `--help`/`-h` returns `{ help: true }`. Recognized flags: `--port`, `--host`, `--endpoint`,
 * `--public-base-url`, `--trust-forwarded-prefix`, `--rp-id`, `--rp-name`, `--launcher`, `--workspace-root`,
 * `--state-root`.
 * Unknown flags are ignored (forward-compatible), an invalid `--port`/`--launcher`/boolean flag is a stable error
 * the caller surfaces.
 */
export function parseServeArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): { help: true } | { help: false; options: ServeOptions } {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) {
      continue;
    }
    if (a === "-h" || a === "--help") {
      return { help: true };
    }
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags.set(name, next);
        i++;
      } else {
        flags.set(name, true);
      }
    }
  }
  const str = (flag: string, envVar: string): string | undefined => {
    const v = flags.get(flag);
    if (typeof v === "string") {
      return usableConfigValue(`--${flag}`, v);
    }
    const e = env[envVar];
    return e !== undefined && e.length > 0 ? usableConfigValue(envVar, e) : undefined;
  };
  const bool = (flag: string, envVar: string): boolean | undefined => {
    const v = flags.get(flag);
    if (v === true) {
      return true;
    }
    const raw = typeof v === "string" ? v : env[envVar];
    if (raw === undefined || raw.length === 0) {
      return undefined;
    }
    if (/^(1|true|yes|on)$/i.test(raw)) {
      return true;
    }
    if (/^(0|false|no|off)$/i.test(raw)) {
      return false;
    }
    throw new Error(`invalid --${flag} "${raw}" (expected true|false)`);
  };

  const options: ServeOptions = {};
  const host = str("host", "GLA_HOST");
  if (host !== undefined) {
    options.host = host;
  }
  const portStr = str("port", "GLA_PORT");
  if (portStr !== undefined) {
    const p = Number(portStr);
    if (!Number.isInteger(p) || p < 0 || p > 65535) {
      throw new Error(`invalid --port "${portStr}" (expected 0..65535)`);
    }
    options.port = p;
  }
  const endpoint = str("endpoint", "GLA_ENDPOINT");
  if (endpoint !== undefined) {
    options.bridgeEndpoint = endpoint;
  }
  const publicBaseUrl = str("public-base-url", "GLA_PUBLIC_BASE_URL");
  if (publicBaseUrl !== undefined) {
    options.publicBaseUrl = publicBaseUrl;
  }
  const trustForwardedPrefix = bool("trust-forwarded-prefix", "GLA_TRUST_FORWARDED_PREFIX");
  if (trustForwardedPrefix !== undefined) {
    options.trustForwardedPrefix = trustForwardedPrefix;
  }
  const rpID = str("rp-id", "GLA_RP_ID");
  if (rpID !== undefined) {
    options.rpID = rpID;
  }
  const rpName = str("rp-name", "GLA_RP_NAME");
  if (rpName !== undefined) {
    options.rpName = rpName;
  }
  // ── Provider selection (§7): keep the id opaque. Unknown providers are diagnosed by Provider Host at
  //    composition time instead of being rejected by an app-local enum.
  const authProvider = str("auth-provider", "GLA_AUTH_PROVIDER");
  if (authProvider !== undefined) {
    options.authProvider = authProvider;
  }
  const authProviderConfigJson = str("auth-provider-config-json", "GLA_AUTH_PROVIDER_CONFIG_JSON");
  if (authProviderConfigJson !== undefined) {
    options.authProviderConfigJson = authProviderConfigJson;
    options.authProviderConfig = parseJsonRecord(
      authProviderConfigJson,
      "auth provider config JSON",
    );
  }
  const authAssurancePolicy = str("auth-assurance-policy", "GLA_AUTH_ASSURANCE_POLICY");
  if (authAssurancePolicy !== undefined) {
    const parsed = parseAuthAssuranceProfile(authAssurancePolicy);
    if (!parsed.ok) {
      throw new Error(
        `invalid --auth-assurance-policy "${parsed.value}" (expected ${AUTH_ASSURANCE_PROFILE_VALUES.join("|")})`,
      );
    }
    options.authAssuranceProfile = parsed.profile;
  }
  const authEnrollmentPolicyJson = str(
    "auth-enrollment-policy-json",
    "GLA_AUTH_ENROLLMENT_POLICY_JSON",
  );
  if (authEnrollmentPolicyJson !== undefined) {
    options.authEnrollmentPolicyJson = authEnrollmentPolicyJson;
    options.authEnrollmentPolicy = parseAuthEnrollmentPolicyJson(
      authEnrollmentPolicyJson,
      options.authProvider ?? "webauthn",
    );
  }
  const authDeploymentRolesJson =
    str("auth-deployment-roles-json", "GLA_AUTH_DEPLOYMENT_ROLES_JSON") ??
    str("auth-edge-guard-roles-json", "GLA_AUTH_EDGE_GUARD_ROLES_JSON");
  if (authDeploymentRolesJson !== undefined) {
    options.authDeploymentRolesJson = authDeploymentRolesJson;
    options.authDeploymentRoles = parseAuthDeploymentRolesJson(authDeploymentRolesJson);
  }
  const dependencyBindingsJson = str("dependency-bindings-json", "GLA_DEPENDENCY_BINDINGS_JSON");
  if (dependencyBindingsJson !== undefined) {
    options.dependencyBindingsJson = dependencyBindingsJson;
    options.dependencyBindings = parseDependencyBindingsJson(dependencyBindingsJson);
  }
  const launcher = str("launcher", "GLA_LAUNCHER_MODE");
  if (launcher !== undefined) {
    if (launcher !== "auto" && launcher !== "full" && launcher !== "headless") {
      throw new Error(`invalid --launcher "${launcher}" (expected auto|full|headless)`);
    }
    options.launcherMode = launcher;
  }
  const workspaceRoot = str("workspace-root", "GLA_WORKSPACE_ROOT");
  if (workspaceRoot !== undefined) {
    options.workspaceRoot = workspaceRoot;
  }
  const stateRoot = str("state-root", "GLA_STATE_ROOT");
  if (stateRoot !== undefined) {
    options.stateRoot = stateRoot;
  }
  return { help: false, options };
}

function usableConfigValue(name: string, value: string): string {
  if (isRedactionOrTemplatePlaceholder(value)) {
    throw new Error(
      `${name} contains a redaction/template placeholder; provide a real value or unset it`,
    );
  }
  return value;
}

function assertUsableServeOption(name: string, value: unknown): void {
  if (typeof value === "string") {
    usableConfigValue(name, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertUsableServeOption(`${name}[${index}]`, item);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      assertUsableServeOption(`${name}.${key}`, entry);
    }
  }
}

function validateServeOptions(opts: ServeOptions): void {
  assertUsableServeOption("host", opts.host);
  assertUsableServeOption("bridgeEndpoint", opts.bridgeEndpoint);
  assertUsableServeOption("publicBaseUrl", opts.publicBaseUrl);
  assertUsableServeOption("authProvider", opts.authProvider);
  assertUsableServeOption("authProviderConfig", opts.authProviderConfig);
  assertUsableServeOption("authProviderConfigJson", opts.authProviderConfigJson);
  assertUsableServeOption("authEnrollmentPolicyJson", opts.authEnrollmentPolicyJson);
  assertUsableServeOption("authDeploymentRolesJson", opts.authDeploymentRolesJson);
  assertUsableServeOption("authDeploymentRoles", opts.authDeploymentRoles);
  assertUsableServeOption("dependencyBindings", opts.dependencyBindings);
  assertUsableServeOption("dependencyBindingsJson", opts.dependencyBindingsJson);
  assertUsableServeOption("rpID", opts.rpID);
  assertUsableServeOption("rpName", opts.rpName);
  assertUsableServeOption("expectedOrigin", opts.expectedOrigin);
  assertUsableServeOption("launcherMode", opts.launcherMode);
  assertUsableServeOption("workspaceRoot", opts.workspaceRoot);
  assertUsableServeOption("stateRoot", opts.stateRoot);
}

/**
 * Run the `gla serve` command end to end: parse argv, {@link serve} the daemon, and wire SIGINT/SIGTERM to a
 * graceful `handle.close()` then process exit. Resolves when the daemon has shut down (after a signal) — so a
 * `bin` shim can `await runServe(argv)` and let the process end cleanly. A parse/bind failure prints a stable
 * error to stderr and resolves (the shim sets a non-zero exit code via the returned status).
 *
 * @returns the process exit code (0 on a clean shutdown; 1 on a startup/bind failure).
 */
export async function runServe(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const log = (line: string): void => void process.stderr.write(`${line}\n`);
  let parsed: { help: true } | { help: false; options: ServeOptions };
  try {
    parsed = parseServeArgs(argv, env);
  } catch (e) {
    log(`error: ${redactDaemonState(e instanceof Error ? e.message : String(e))}`);
    log(SERVE_USAGE);
    return 1;
  }
  if (parsed.help) {
    process.stdout.write(SERVE_USAGE);
    return 0;
  }

  let handle: DaemonHandle;
  try {
    handle = await serve({ ...parsed.options, log });
  } catch (e) {
    log(
      `error: failed to start gla serve: ${redactDaemonState(e instanceof Error ? e.message : String(e))}`,
    );
    return 1;
  }

  // Stay alive until a termination signal, then shut down gracefully (tear down live capsules, close listeners).
  return await new Promise<number>((resolve) => {
    let shuttingDown = false;
    const onSignal = (sig: NodeJS.Signals): void => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      log(`\n${sig} received — shutting down gracefully (tearing down live capsules)…`);
      handle
        .close()
        .then(() => {
          log("shutdown complete — no orphan capsule remains.");
          resolve(0);
        })
        .catch((e) => {
          log(`shutdown error: ${redactDaemonState(e instanceof Error ? e.message : String(e))}`);
          resolve(1);
        });
    };
    process.once("SIGINT", () => onSignal("SIGINT"));
    process.once("SIGTERM", () => onSignal("SIGTERM"));
  });
}
