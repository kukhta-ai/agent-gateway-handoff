// surfaces/cli · the daemon bridge transport (docs/05 §"Connection & auth": the local profile —
// `GLA_ENDPOINT` is a LOCAL socket; no token). This is the small, line-delimited JSON-RPC the `gla`
// CLI speaks to a RUNNING `gla serve` daemon so a command operates on the DAEMON's shared app state
// (the live capsules/grants) instead of composing a fresh in-process app per invocation.
//
// Wire shape (one JSON object per line, `\n`-terminated; UTF-8):
//   request : { "id": <number>, "op": "<bridge-op>", "args": [ ... ] }
//   response: { "id": <number>, "ok": true,  "result": <json> }
//           | { "id": <number>, "ok": false, "error": { "kind": "gla"|"internal", "code"?, "message", "detail"?, "retryable"? } }
//
// The daemon dispatches `op` to the SAME in-process {@link AgentBridge} (shared state); the CLI client
// re-throws a `gla` error as a real GlaError so the dispatcher's existing exit-code mapping is identical
// whether the bridge is in-process or remote. One client connection at a time is sufficient for the
// local single-operator profile; the daemon handles multiple SEQUENTIAL calls on a connection.
//
// Boundary: this lives in the EDGE `surfaces/cli` package; it imports `@gla/kernel` (the error helper)
// + node builtins only — no adapter. `app` (the composition root) owns the daemon side that binds it.

import { type Socket, connect as ipcConnect } from "node:net";
import type {
  CatalogShowResult,
  HandoffView,
  ProvisionResult,
  SessionView,
  TaskView,
  WhoamiResult,
} from "@gla/bridge";
import type { IndexedEntity, TemplateShowResult } from "@gla/catalog";
import { type GlaError, type OpaqueToken, glaError, redactOperatorText } from "@gla/kernel";

const BRIDGE_ENDPOINT_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * The exact surface the `gla` dispatcher (`run()`) invokes on "the bridge" — every noun-verb op it calls,
 * each returning its in-process result OR a Promise of it. The in-tree {@link AgentBridge} satisfies this
 * structurally (its sync reads/async mutations both fit `T | Promise<T>`); the {@link DaemonBridgeClient}
 * satisfies it by forwarding each op over the socket (always async). Defining the seam this way lets the
 * dispatcher stay byte-for-byte identical across the in-process and daemon paths (it already `await`s
 * every call). Keep this in lockstep with the ops the dispatcher uses.
 */
export interface BridgeLike {
  connect(): Promise<{ token: OpaqueToken | string; allowed_ops?: string[] }>;
  whoami(token: OpaqueToken): WhoamiResult | Promise<WhoamiResult>;
  templateList(filter?: { available?: boolean }): IndexedEntity[] | Promise<IndexedEntity[]>;
  templateShow(id: string): TemplateShowResult | Promise<TemplateShowResult>;
  skillList(filter?: {
    for?: string;
  }): Array<{ id: string; for?: string }> | Promise<Array<{ id: string; for?: string }>>;
  skillShow(
    id: string,
  ):
    | { id: string; for?: string; body: string }
    | Promise<{ id: string; for?: string; body: string }>;
  catalogList(filter?: {
    kind?: string;
    available?: boolean;
  }): IndexedEntity[] | Promise<IndexedEntity[]>;
  catalogShow(id: string): CatalogShowResult | Promise<CatalogShowResult>;
  taskCreate(input: { intent?: string; recipient?: string }): Promise<TaskView>;
  taskGet(id: string): TaskView | Promise<TaskView>;
  taskList(filter?: { state?: string }): TaskView[] | Promise<TaskView[]>;
  taskComplete(id: string): Promise<TaskView>;
  taskRevoke(id: string): Promise<TaskView>;
  sessionCreate(args: {
    proposal: unknown;
    task?: string;
    dryRun?: boolean;
  }): Promise<unknown>;
  sessionConnector(id: string): Promise<ProvisionResult>;
  sessionGet(id: string): SessionView | Promise<SessionView>;
  sessionList(filter?: {
    task?: string;
    state?: string;
  }): SessionView[] | Promise<SessionView[]>;
  sessionRevoke(id: string): Promise<SessionView>;
  handoffOpen(args: {
    session: string;
    reason?: string;
    recipient?: string;
    ttl?: string;
  }): Promise<HandoffView>;
  handoffWait(id: string, timeoutMs?: number): Promise<unknown>;
  handoffGet(id: string): HandoffView | Promise<HandoffView>;
  handoffList(filter?: { session?: string }): HandoffView[] | Promise<HandoffView[]>;
  handoffCancel(id: string): Promise<HandoffView>;
}

/** A single JSON-RPC request line (the CLI → daemon direction). */
export interface DaemonRequest {
  id: number;
  op: string;
  args: unknown[];
}

/** A serialized error in a {@link DaemonResponse} — a `gla` taxonomy error (re-thrown) or an internal one. */
export interface WireError {
  kind: "gla" | "internal";
  /** The kernel error code (present for `kind:"gla"`), so the client re-throws the same typed GlaError. */
  code?: string;
  message: string;
  detail?: Record<string, unknown>;
  retryable?: boolean;
}

/** A single JSON-RPC response line (the daemon → CLI direction). */
export interface DaemonResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: WireError;
}

/** The default bridge socket endpoint when `GLA_ENDPOINT` is unset and a daemon path is needed. */
export const DEFAULT_BRIDGE_SOCKET = "/run/gla.sock" as const;

/**
 * Resolve the bridge endpoint from the environment for a CLIENT connection: explicit `GLA_ENDPOINT` wins,
 * else undefined (the caller then keeps the in-process behaviour). A `host:port` form (e.g. `127.0.0.1:7423`)
 * is parsed to a TCP target; anything else is treated as a unix-domain-socket PATH.
 */
export function resolveClientEndpoint(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const ep = env.GLA_ENDPOINT;
  return ep !== undefined && ep.length > 0 ? ep : undefined;
}

/** True when a CLI bridge endpoint is local: a Unix-socket path or loopback TCP, never a public URL/host. */
export function endpointIsLocalBridgeEndpoint(endpoint: string): boolean {
  if (BRIDGE_ENDPOINT_URL_RE.test(endpoint)) {
    return false;
  }
  const m = endpoint.match(/^(\[?[^\]]*\]?|[^:]+):(\d+)$/);
  if (m === null) {
    return true;
  }
  const host = (m[1] ?? "").replace(/^\[|\]$/g, "").toLowerCase();
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function endpointForDiagnostic(endpoint: string): string {
  return redactOperatorText(endpoint);
}

/** Parse an endpoint string into the node:net connect target (`{path}` for a uds, `{host,port}` for tcp). */
export function endpointToConnectTarget(
  endpoint: string,
): { path: string } | { host: string; port: number } {
  const m = endpoint.match(/^(\[?[^\]]*\]?|[^:]+):(\d+)$/);
  if (m !== null) {
    const host = m[1]?.replace(/^\[|\]$/g, "") ?? "127.0.0.1";
    const port = Number(m[2]);
    if (Number.isInteger(port) && port > 0) {
      return { host, port };
    }
  }
  return { path: endpoint };
}

/** Narrow an unknown thrown value to one carrying a kernel error `code` (a GlaError). */
function isCoded(e: unknown): e is GlaError & { toGlaError?: () => unknown } {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    typeof (e as { code: unknown }).code === "string"
  );
}

/**
 * Serialize a thrown bridge error into a {@link WireError} (daemon side). A typed kernel GlaError is wired
 * as `kind:"gla"` carrying its `code`/`detail`/`retryable` so the CLI re-throws the SAME typed error (and
 * maps the SAME exit code); anything else is `kind:"internal"`.
 */
export function errorToWire(e: unknown): WireError {
  if (isCoded(e)) {
    const ge = e as GlaError & { detail?: Record<string, unknown>; retryable?: boolean };
    const w: WireError = { kind: "gla", code: ge.code, message: ge.message };
    if (ge.detail !== undefined) {
      w.detail = ge.detail;
    }
    if (ge.retryable !== undefined) {
      w.retryable = ge.retryable;
    }
    return w;
  }
  return { kind: "internal", message: e instanceof Error ? e.message : String(e) };
}

/** Re-throw a {@link WireError} on the CLIENT side as the appropriate Error (a typed GlaError for `gla`). */
export function throwFromWire(err: WireError): never {
  if (err.kind === "gla" && err.code !== undefined) {
    throw glaError(err.code as Parameters<typeof glaError>[0], err.message, {
      ...(err.detail !== undefined ? { detail: err.detail } : {}),
      ...(err.retryable !== undefined ? { retryable: err.retryable } : {}),
    });
  }
  // An internal daemon error → a generic Error the dispatcher maps to exit 1.
  throw new Error(err.message);
}

/**
 * A {@link BridgeLike} that forwards every op to a RUNNING `gla serve` daemon over the bridge socket. Each
 * method sends one `{id, op, args}` line and resolves the matching `{id, ok, …}` reply; a `gla` error reply
 * is re-thrown as the same typed GlaError (so the dispatcher's exit-code mapping is unchanged). Construct it
 * with {@link DaemonBridgeClient.connect} and `close()` it after the single command (the CLI is one-shot).
 */
export class DaemonBridgeClient implements BridgeLike {
  private nextId = 1;
  private buffer = "";
  private readonly pending = new Map<
    number,
    { resolve: (r: unknown) => void; reject: (e: unknown) => void }
  >();
  private closed = false;
  private fatal: Error | undefined;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("error", (e) => this.onFatal(e));
    socket.on("close", () => this.onFatal(this.fatal ?? new Error("daemon connection closed")));
  }

  /** Connect to the daemon at `endpoint` (a uds path or `host:port`). Rejects if the daemon is not running. */
  static connect(endpoint: string): Promise<DaemonBridgeClient> {
    if (!endpointIsLocalBridgeEndpoint(endpoint)) {
      return Promise.reject(
        glaError(
          "usage.bad_argument",
          `refusing to connect to non-local Agent Bridge endpoint "${endpointForDiagnostic(
            endpoint,
          )}" — use a Unix socket for trusted-local operation or 127.0.0.1:<port> only for development/advanced loopback mode.`,
        ),
      );
    }
    const target = endpointToConnectTarget(endpoint);
    return new Promise((resolve, reject) => {
      const socket = ipcConnect(target as never);
      const onErr = (e: Error): void => {
        socket.removeAllListeners("connect");
        reject(e);
      };
      socket.once("error", onErr);
      socket.once("connect", () => {
        socket.removeListener("error", onErr);
        resolve(new DaemonBridgeClient(socket));
      });
    });
  }

  /** Close the client connection (the CLI is one-shot; call after the single command completes). */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.socket.end();
    this.socket.destroy();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx = this.buffer.indexOf("\n");
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.trim().length > 0) {
        this.dispatchLine(line);
      }
      idx = this.buffer.indexOf("\n");
    }
  }

  private dispatchLine(line: string): void {
    let msg: DaemonResponse;
    try {
      msg = JSON.parse(line) as DaemonResponse;
    } catch {
      return; // a malformed line is ignored (the daemon only emits well-formed responses).
    }
    const waiter = this.pending.get(msg.id);
    if (waiter === undefined) {
      return;
    }
    this.pending.delete(msg.id);
    if (msg.ok) {
      waiter.resolve(msg.result);
    } else {
      waiter.reject(msg.error ?? { kind: "internal", message: "unknown daemon error" });
    }
  }

  private onFatal(e: Error): void {
    this.fatal = e;
    for (const [, waiter] of this.pending) {
      waiter.reject({ kind: "internal", message: e.message } satisfies WireError);
    }
    this.pending.clear();
  }

  /** Send one op + resolve its reply; a `gla` error reply is re-thrown as the same typed GlaError. */
  private call<T>(op: string, args: unknown[]): Promise<T> {
    if (this.fatal !== undefined) {
      return Promise.reject(this.fatal);
    }
    const id = this.nextId++;
    const line = `${JSON.stringify({ id, op, args } satisfies DaemonRequest)}\n`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (r) => resolve(r as T),
        reject: (e) => {
          // A wire error → re-throw the typed/ internal error so the dispatcher maps the right exit code.
          if (isWireError(e)) {
            try {
              throwFromWire(e);
            } catch (thrown) {
              reject(thrown);
            }
            return;
          }
          reject(e);
        },
      });
      this.socket.write(line);
    });
  }

  /**
   * Send an ARBITRARY op + args over the socket and resolve its result — used for daemon OPERATOR ops (e.g.
   * `enrollInvite`) that are not part of the agent {@link BridgeLike} surface. A `gla` error reply is re-thrown
   * as the same typed GlaError. (The {@link BridgeLike} methods below are thin wrappers over this.)
   */
  request<T = unknown>(op: string, args: unknown[] = []): Promise<T> {
    return this.call<T>(op, args);
  }

  // ── BridgeLike — every op forwarded over the socket (the daemon runs it on the shared in-process bridge).
  connect(): Promise<{ token: OpaqueToken | string; allowed_ops?: string[] }> {
    return this.call("connect", []);
  }
  whoami(token: OpaqueToken): Promise<WhoamiResult> {
    return this.call("whoami", [token]);
  }
  templateList(filter?: { available?: boolean }): Promise<IndexedEntity[]> {
    return this.call("templateList", [filter]);
  }
  templateShow(id: string): Promise<TemplateShowResult> {
    return this.call("templateShow", [id]);
  }
  skillList(filter?: { for?: string }): Promise<Array<{ id: string; for?: string }>> {
    return this.call("skillList", [filter]);
  }
  skillShow(id: string): Promise<{ id: string; for?: string; body: string }> {
    return this.call("skillShow", [id]);
  }
  catalogList(filter?: { kind?: string; available?: boolean }): Promise<IndexedEntity[]> {
    return this.call("catalogList", [filter]);
  }
  catalogShow(id: string): Promise<CatalogShowResult> {
    return this.call("catalogShow", [id]);
  }
  taskCreate(input: { intent?: string; recipient?: string }): Promise<TaskView> {
    return this.call("taskCreate", [input]);
  }
  taskGet(id: string): Promise<TaskView> {
    return this.call("taskGet", [id]);
  }
  taskList(filter?: { state?: string }): Promise<TaskView[]> {
    return this.call("taskList", [filter]);
  }
  taskComplete(id: string): Promise<TaskView> {
    return this.call("taskComplete", [id]);
  }
  taskRevoke(id: string): Promise<TaskView> {
    return this.call("taskRevoke", [id]);
  }
  sessionCreate(args: { proposal: unknown; task?: string; dryRun?: boolean }): Promise<unknown> {
    return this.call("sessionCreate", [args]);
  }
  sessionConnector(id: string): Promise<ProvisionResult> {
    return this.call("sessionConnector", [id]);
  }
  sessionGet(id: string): Promise<SessionView> {
    return this.call("sessionGet", [id]);
  }
  sessionList(filter?: { task?: string; state?: string }): Promise<SessionView[]> {
    return this.call("sessionList", [filter]);
  }
  sessionRevoke(id: string): Promise<SessionView> {
    return this.call("sessionRevoke", [id]);
  }
  handoffOpen(args: {
    session: string;
    reason?: string;
    recipient?: string;
    ttl?: string;
  }): Promise<HandoffView> {
    return this.call("handoffOpen", [args]);
  }
  handoffWait(id: string, timeoutMs?: number): Promise<unknown> {
    return this.call("handoffWait", [id, timeoutMs]);
  }
  handoffGet(id: string): Promise<HandoffView> {
    return this.call("handoffGet", [id]);
  }
  handoffList(filter?: { session?: string }): Promise<HandoffView[]> {
    return this.call("handoffList", [filter]);
  }
  handoffCancel(id: string): Promise<HandoffView> {
    return this.call("handoffCancel", [id]);
  }
}

/** Narrow an unknown rejection value to a {@link WireError}. */
function isWireError(e: unknown): e is WireError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    "message" in e &&
    ((e as WireError).kind === "gla" || (e as WireError).kind === "internal")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Server side — dispatch a wire op onto a shared in-process bridge (used by `gla serve`).
// ─────────────────────────────────────────────────────────────────────────────

/** The ops the daemon accepts — the exact {@link BridgeLike} surface, used to reject an unknown op safely. */
const KNOWN_OPS: ReadonlySet<string> = new Set([
  "connect",
  "whoami",
  "templateList",
  "templateShow",
  "skillList",
  "skillShow",
  "catalogList",
  "catalogShow",
  "taskCreate",
  "taskGet",
  "taskList",
  "taskComplete",
  "taskRevoke",
  "sessionCreate",
  "sessionConnector",
  "sessionGet",
  "sessionList",
  "sessionRevoke",
  "handoffOpen",
  "handoffWait",
  "handoffGet",
  "handoffList",
  "handoffCancel",
]);

/**
 * Optional OPERATOR ops the daemon may expose ALONGSIDE the agent bridge surface (docs/05 §3: operator setup
 * actions are NOT on the agent surface). The daemon passes a map of `op-name → handler` (e.g. `enrollInvite`)
 * so a recipient can be enrolled against the LIVE server. Kept distinct from {@link BridgeLike} so the agent's
 * door never gains an operator capability — these are reachable only because the operator runs the daemon call.
 */
export type OperatorOps = Record<string, (...args: unknown[]) => unknown>;

/**
 * Run ONE request against the shared in-process bridge and produce its {@link DaemonResponse} (daemon side).
 * Dispatches `op` to the matching {@link BridgeLike} method on `bridge` (the SAME bridge across all calls →
 * shared state), OR to an OPERATOR op in `operators` (operator setup actions like `enrollInvite`); awaits sync
 * OR async results uniformly; serializes a thrown error to a {@link WireError} (a typed GlaError keeps its
 * `code` so the CLI maps the SAME exit code). An unknown op is a stable `usage.unknown_command` error, never a
 * crash.
 */
export async function dispatchBridgeRequest(
  bridge: BridgeLike,
  req: DaemonRequest,
  operators: OperatorOps = {},
): Promise<DaemonResponse> {
  try {
    const args = Array.isArray(req.args) ? req.args : [];
    // Operator ops first (a distinct, operator-only surface — not part of the agent BridgeLike door).
    const opFn = operators[req.op];
    if (typeof opFn === "function") {
      const result = await opFn(...args);
      return { id: req.id, ok: true, result };
    }
    if (!KNOWN_OPS.has(req.op)) {
      throw glaError("usage.unknown_command", `unknown daemon op: ${String(req.op)}`);
    }
    const fn = (bridge as unknown as Record<string, (...a: unknown[]) => unknown>)[req.op];
    if (typeof fn !== "function") {
      throw glaError("usage.unknown_command", `unsupported daemon op: ${String(req.op)}`);
    }
    const result = await fn.apply(bridge, args);
    return { id: req.id, ok: true, result };
  } catch (e) {
    return { id: req.id, ok: false, error: errorToWire(e) };
  }
}

/**
 * Attach the daemon's line-delimited JSON-RPC protocol to one accepted bridge {@link Socket}: parse each
 * `\n`-delimited request line, {@link dispatchBridgeRequest} it onto the shared `bridge` (+ any `operators`),
 * and write back the `\n`-terminated response. Handles multiple SEQUENTIAL calls on the connection (one client
 * at a time is the local single-operator profile). Errors on the socket are swallowed (a dropped client must
 * not crash the daemon). Returns nothing — the daemon keeps the listener alive.
 */
export function serveBridgeConnection(
  socket: Socket,
  bridge: BridgeLike,
  operators: OperatorOps = {},
): void {
  socket.setEncoding("utf8");
  let buffer = "";
  let draining = Promise.resolve();
  const handleLine = (line: string): void => {
    let req: DaemonRequest;
    try {
      req = JSON.parse(line) as DaemonRequest;
    } catch {
      return; // ignore a malformed request line (the client only sends well-formed requests).
    }
    // Serialize per-connection dispatch so sequential calls keep request/response order on the wire.
    draining = draining.then(async () => {
      const res = await dispatchBridgeRequest(bridge, req, operators);
      if (!socket.destroyed) {
        socket.write(`${JSON.stringify(res)}\n`);
      }
    });
  };
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim().length > 0) {
        handleLine(line);
      }
      idx = buffer.indexOf("\n");
    }
  });
  socket.on("error", () => {
    // A client that drops mid-call must not take down the daemon; the listener stays up for the next client.
  });
}
