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
// Boundary: this file is in the composition root (`app`) — the ONE package that may import adapters and wire
// them to ports. The bridge transport protocol itself lives in the edge `surfaces/cli` package (the CLI is
// the other end); here we only bind a `node:net` server and hand each accepted socket to that protocol.

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { type Server as NetServer, createServer as createIpcServer } from "node:net";
import { dirname } from "node:path";
import type { AgentBridge } from "@gla/bridge";
import type { DependencyBinding } from "@gla/catalog";
import { type DeliverySink, deliveryToStdout } from "@gla/channel-cli";
import { type OperatorOps, serveBridgeConnection } from "@gla/cli";
import { parsePublicBaseUrl } from "@gla/gateway";
import {
  AUTH_ASSURANCE_PROFILE_VALUES,
  type AuthAssuranceProfile,
  DEFAULT_AUTH_ASSURANCE_PROFILE,
  type OpaqueToken,
  type RecipientRef,
  parseAuthAssuranceProfile,
} from "@gla/kernel";
import { type AuthentikConfig, createProvisioningBridge } from "./index.js";

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
   * The auth provider to wire behind the kernel `AuthProviderPort` (authentik-integration.md §7). Default
   * `"webauthn"` (the in-tree default — the default boot path is byte-for-byte unchanged). Set `"authentik"`
   * to opt into the delegated OIDC provider; then the `authentik*` OIDC config below is required.
   */
  authProvider?: "webauthn" | "authentik";
  /**
   * Provider-neutral assurance policy for handoff auth. Default `phishing-resistant`; set
   * `password-permitted` only when password-grade evidence is an intentional deployment policy.
   */
  authAssuranceProfile?: AuthAssuranceProfile;
  /** The authentik OIDC issuer (only when `authProvider=authentik`), e.g. `https://idp.example/application/o/gla/`. */
  authentikIssuerUrl?: string;
  /** The authentik OIDC client/application id (the id_token audience). */
  authentikClientId?: string;
  /** The authentik confidential-client secret (`sensitive` — never logged). */
  authentikClientSecret?: string;
  /** The adapter callback URL (the OIDC `redirect_uri`), fronted by the same host Caddy. */
  authentikRedirectUri?: string;
  /** Optional OIDC scopes (space-separated). Default `openid profile`. */
  authentikScopes?: string;
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
  const m = endpoint.match(/^(\[?[^\]]*\]?|[^:]+):(\d+)$/);
  if (m === null) {
    // No `host:port` form ⇒ a unix-domain-socket path ⇒ inherently local (filesystem-scoped, not network).
    return true;
  }
  const host = (m[1] ?? "").replace(/^\[|\]$/g, "").toLowerCase();
  // A loopback host is local; 0.0.0.0 / :: / any other interface is NOT (S-6: the bridge is never public).
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/** Operator-facing diagnostic for whether the selected provider can satisfy the selected assurance profile. */
export function authAssuranceProviderDiagnostic(opts: {
  authProvider?: "webauthn" | "authentik";
  authAssuranceProfile?: AuthAssuranceProfile;
}): string {
  const provider = opts.authProvider ?? "webauthn";
  const profile = opts.authAssuranceProfile ?? DEFAULT_AUTH_ASSURANCE_PROFILE;
  if (provider === "webauthn") {
    return profile === "password-permitted"
      ? "webauthn reports phishing-resistant assurance, which satisfies password-permitted; no password fallback is available from this provider"
      : "webauthn reports phishing-resistant assurance and satisfies the selected policy";
  }
  return profile === "password-permitted"
    ? "authentik can satisfy password-permitted when OIDC amr/acr maps to password or phishing-resistant evidence; installer/doctor must verify the mapping"
    : "authentik can satisfy phishing-resistant only when OIDC amr/acr maps to passkey-grade evidence; installer/doctor must verify the mapping";
}

/**
 * Boot the `gla serve` daemon: compose ONE shared provisioning+handoff app state, bind the Access Gateway on
 * the PUBLIC `host:port`, bind the Agent Bridge on a LOCAL endpoint, print the startup banner + the S-6 doctor
 * line, and return a {@link DaemonHandle} (whose `close()` is the graceful shutdown). The process stays alive
 * because both listeners hold the event loop open; the caller wires SIGINT/SIGTERM → `handle.close()`.
 */
export async function serve(opts: ServeOptions = {}): Promise<DaemonHandle> {
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
      `refusing to bind the Agent Bridge on a non-local endpoint "${bridgeEndpoint}" — the bridge is LOCAL-only (baseline §3 single-public-entry). Use a unix socket or 127.0.0.1:<port>.`,
    );
  }

  // ── Provider selection (authentik-integration.md §7): the default is the in-tree WebAuthn provider; setting
  //    `GLA_AUTH_PROVIDER=authentik` opts into the delegated OIDC adapter, which needs its OIDC config. Build
  //    the authentik config object only when selected (its secret is `sensitive` — passed inward, never logged).
  const authentikConfig =
    opts.authProvider === "authentik" ? buildAuthentikConfig(opts, publicBase) : undefined;

  // ── Compose ONE shared app state: the provisioning bridge + the handoff + completion pipeline. Every CLI
  //    call over the bridge socket runs against THIS bridge (the live capsules/grants — shared state).
  const stack = createProvisioningBridge({
    ...(opts.dependencyBindings !== undefined
      ? { dependencyBindings: opts.dependencyBindings }
      : {}),
    ...(opts.launcherMode !== undefined ? { launcherMode: opts.launcherMode } : {}),
    ...(opts.workspaceRoot !== undefined ? { workspaceRoot: opts.workspaceRoot } : {}),
    ...(opts.stateRoot !== undefined ? { stateRoot: opts.stateRoot } : {}),
    handoff: {
      ...(opts.authProvider !== undefined ? { authProvider: opts.authProvider } : {}),
      ...(opts.authAssuranceProfile !== undefined
        ? { authAssuranceProfile: opts.authAssuranceProfile }
        : {}),
      ...(authentikConfig !== undefined ? { authentik: authentikConfig } : {}),
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
  };

  // ── Bind the Agent Bridge on the LOCAL endpoint: a node:net server that hands each accepted socket to the
  //    line-delimited JSON-RPC protocol (surfaces/cli), dispatching every op onto the SHARED bridge above (+
  //    the operator ops). The agent surface and the operator op share the LOCAL socket (both operator-trusted).
  const ipc = await bindBridgeServer(bridgeEndpoint, stack.bridge, operators);

  const bridgeIsLocal = endpointIsLocal(bridgeEndpoint);

  // ── Startup banner + the S-6 doctor line (so an operator can SEE the bridge is not public). ──
  log("── gla serve ──");
  log(
    `  gateway (PUBLIC) : http://${bound.host}:${bound.port}  (front with Caddy → ${publicBaseUrl})`,
  );
  log(`  bridge  (LOCAL)  : ${bridgeEndpoint}`);
  log(
    `  auth provider    : ${stack.authModule}${
      authentikConfig !== undefined ? `  (issuer ${authentikConfig.issuerUrl})` : ""
    }`,
  );
  log(`  auth assurance   : ${opts.authAssuranceProfile ?? DEFAULT_AUTH_ASSURANCE_PROFILE}`);
  log(`  auth capability  : ${authAssuranceProviderDiagnostic(opts)}`);
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
    liveSessions: () => stack.lifecycle.liveSessions(),
    close,
  };
}

/** Bind the node:net bridge server at `endpoint` (a uds path or `host:port`), serving the JSON-RPC protocol. */
function bindBridgeServer(
  endpoint: string,
  bridge: AgentBridge,
  operators: OperatorOps,
): Promise<NetServer> {
  const server = createIpcServer((socket) => {
    serveBridgeConnection(socket, bridge, operators);
  });
  const target = endpointToListenTarget(endpoint);
  if ("path" in target) {
    // A stale socket file from a previous (crashed) run blocks `listen` with EADDRINUSE — remove it first.
    prepareUdsPath(target.path);
  }
  return new Promise<NetServer>((resolve, reject) => {
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
}

/** Close the bridge server + remove the uds path (idempotent) so a restart re-binds cleanly. */
function closeBridgeServer(server: NetServer, endpoint: string): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => {
      const target = endpointToListenTarget(endpoint);
      if ("path" in target && existsSync(target.path)) {
        try {
          unlinkSync(target.path);
        } catch {
          // best-effort — a leftover socket file is harmless (the next bind removes it).
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

/** Ensure a uds path's directory exists and any stale socket file is removed (so `listen` can bind). */
function prepareUdsPath(path: string): void {
  const dir = dirname(path);
  if (dir.length > 0 && !existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // If the dir cannot be created, `listen` will surface the real error — don't mask it here.
    }
  }
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // A leftover that cannot be removed will surface as EADDRINUSE on listen — let that be the error.
    }
  }
}

/**
 * Assemble the authentik OIDC config from the daemon options (only called when `GLA_AUTH_PROVIDER=authentik`,
 * authentik-integration.md §7). The issuer / client id / client secret / redirect uri are all required —
 * a missing one is a fail-loud startup error (never a silent fallback to the default provider). The secret is
 * `sensitive`: it is carried inward to the adapter and never echoed in the banner or an error message.
 */
function buildAuthentikConfig(
  opts: ServeOptions,
  publicBase: ReturnType<typeof parsePublicBaseUrl>,
): AuthentikConfig {
  const missing: string[] = [];
  if (opts.authentikIssuerUrl === undefined) {
    missing.push("GLA_AUTHENTIK_ISSUER_URL");
  }
  if (opts.authentikClientId === undefined) {
    missing.push("GLA_AUTHENTIK_CLIENT_ID");
  }
  if (opts.authentikClientSecret === undefined) {
    missing.push("GLA_AUTHENTIK_CLIENT_SECRET");
  }
  if (opts.authentikRedirectUri === undefined) {
    missing.push("GLA_AUTHENTIK_REDIRECT_URI");
  }
  if (
    opts.authentikIssuerUrl === undefined ||
    opts.authentikClientId === undefined ||
    opts.authentikClientSecret === undefined ||
    opts.authentikRedirectUri === undefined
  ) {
    throw new Error(
      `GLA_AUTH_PROVIDER=authentik requires the authentik OIDC config — missing: ${missing.join(", ")}`,
    );
  }
  const redirectBase = parsePublicBaseUrl(opts.authentikRedirectUri);
  if (redirectBase.origin !== publicBase.origin) {
    throw new Error(
      "GLA_AUTHENTIK_REDIRECT_URI must use the same origin as GLA_PUBLIC_BASE_URL so the callback lands on GLA's same-origin gateway page",
    );
  }
  if (
    publicBase.pathPrefix.length > 0 &&
    redirectBase.pathPrefix !== publicBase.pathPrefix &&
    !redirectBase.pathPrefix.startsWith(`${publicBase.pathPrefix}/`)
  ) {
    throw new Error(
      "GLA_AUTHENTIK_REDIRECT_URI must be under GLA_PUBLIC_BASE_URL's path prefix so code/state return to GLA without leaking grants to authentik",
    );
  }
  return {
    issuerUrl: opts.authentikIssuerUrl,
    clientId: opts.authentikClientId,
    clientSecret: opts.authentikClientSecret,
    redirectUri: opts.authentikRedirectUri,
    ...(opts.authentikScopes !== undefined ? { scopes: opts.authentikScopes } : {}),
  };
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
            [--auth-provider <webauthn|authentik>] [--auth-assurance-policy <phishing-resistant|password-permitted>]
            [--authentik-issuer-url <url>] [--authentik-client-id <id>]
            [--authentik-client-secret <secret>] [--authentik-redirect-uri <url>] [--authentik-scopes <s>]

Binds:
  • the Access Gateway (PUBLIC) on  host:port           default 0.0.0.0:3000   (front with Caddy)
  • the Agent Bridge   (LOCAL)  on  a unix socket        default $XDG_RUNTIME_DIR/gla.sock or /run/gla.sock
                                    (or 127.0.0.1:<port>; NEVER 0.0.0.0)

Auth provider (--auth-provider, default webauthn): the in-tree WebAuthn passkey verifier is the default;
  set authentik to delegate step-up to a self-hosted authentik over OIDC (then the GLA_AUTHENTIK_* config
  below is required). The client secret is sensitive and is never logged.

Auth assurance (--auth-assurance-policy, default phishing-resistant): unset demands passkey/phishing-resistant
  evidence; password-permitted is the explicit policy that admits password-grade evidence.

Env (flags win): GLA_PORT, GLA_HOST, GLA_ENDPOINT, GLA_PUBLIC_BASE_URL, GLA_TRUST_FORWARDED_PREFIX,
  GLA_RP_ID, GLA_RP_NAME, GLA_LAUNCHER_MODE, GLA_WORKSPACE_ROOT, GLA_STATE_ROOT,
  GLA_AUTH_PROVIDER, GLA_AUTH_ASSURANCE_POLICY,
  GLA_AUTHENTIK_ISSUER_URL, GLA_AUTHENTIK_CLIENT_ID, GLA_AUTHENTIK_CLIENT_SECRET,
  GLA_AUTHENTIK_REDIRECT_URI, GLA_AUTHENTIK_SCOPES.

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
      return v;
    }
    const e = env[envVar];
    return e !== undefined && e.length > 0 ? e : undefined;
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
  // ── Provider selection (§7): the switch + the authentik OIDC config it gates. Default `webauthn` (left
  //    unset so the default boot path is untouched). An invalid value is a stable error the caller surfaces.
  const authProvider = str("auth-provider", "GLA_AUTH_PROVIDER");
  if (authProvider !== undefined) {
    if (authProvider !== "webauthn" && authProvider !== "authentik") {
      throw new Error(`invalid --auth-provider "${authProvider}" (expected webauthn|authentik)`);
    }
    options.authProvider = authProvider;
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
  const authentikIssuerUrl = str("authentik-issuer-url", "GLA_AUTHENTIK_ISSUER_URL");
  if (authentikIssuerUrl !== undefined) {
    options.authentikIssuerUrl = authentikIssuerUrl;
  }
  const authentikClientId = str("authentik-client-id", "GLA_AUTHENTIK_CLIENT_ID");
  if (authentikClientId !== undefined) {
    options.authentikClientId = authentikClientId;
  }
  const authentikClientSecret = str("authentik-client-secret", "GLA_AUTHENTIK_CLIENT_SECRET");
  if (authentikClientSecret !== undefined) {
    options.authentikClientSecret = authentikClientSecret;
  }
  const authentikRedirectUri = str("authentik-redirect-uri", "GLA_AUTHENTIK_REDIRECT_URI");
  if (authentikRedirectUri !== undefined) {
    options.authentikRedirectUri = authentikRedirectUri;
  }
  const authentikScopes = str("authentik-scopes", "GLA_AUTHENTIK_SCOPES");
  if (authentikScopes !== undefined) {
    options.authentikScopes = authentikScopes;
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
    log(`error: ${e instanceof Error ? e.message : String(e)}`);
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
    log(`error: failed to start gla serve: ${e instanceof Error ? e.message : String(e)}`);
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
          log(`shutdown error: ${e instanceof Error ? e.message : String(e)}`);
          resolve(1);
        });
    };
    process.once("SIGINT", () => onSignal("SIGINT"));
    process.once("SIGTERM", () => onSignal("SIGTERM"));
  });
}
