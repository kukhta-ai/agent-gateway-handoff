// @gla/cli — EDGE ring (baseline §1). The `gla` command tree over the bridge core (docs/05).
// Public surface of the package: the pure `run()` dispatcher, the `Output` helper, the exit-code
// taxonomy, and a `main()` that binds them to the real process (used by bin/gla.mjs).

import { AgentBridge } from "@gla/bridge";
import { isGlaError, redactOperatorText } from "@gla/kernel";
import { type CliServices, run } from "./cli.js";
import { ExitCode } from "./exit-codes.js";
import { Output, type OutputMode } from "./output.js";
import { DaemonBridgeClient, resolveClientEndpoint } from "./transport.js";

export { run, CLI_VERSION } from "./cli.js";
export type { CliServices } from "./cli.js";
export { Output, resolveMode } from "./output.js";
export type { OutputMode, OutputStreams, CliError } from "./output.js";
export { ExitCode } from "./exit-codes.js";
export type {
  BridgeLike,
  DaemonRequest,
  DaemonResponse,
  WireError,
  OperatorOps,
} from "./transport.js";
export {
  DaemonBridgeClient,
  resolveClientEndpoint,
  endpointToConnectTarget,
  dispatchBridgeRequest,
  serveBridgeConnection,
  errorToWire,
  DEFAULT_BRIDGE_SOCKET,
} from "./transport.js";

/**
 * Process entry point: parse the global output flag from argv just enough to construct the sink,
 * run the dispatcher against the real stdout/stderr, and return the exit code. The caller (the bin
 * shim) is responsible for `process.exit` so this stays side-effect-light and testable. Async
 * because the dispatcher connects to the Agent Bridge (minting the agent-authority anchor).
 *
 * **Connection profile (docs/05 §"Connection & auth").** When `GLA_ENDPOINT` is set, the command is sent
 * over the local bridge socket to a RUNNING `gla serve` daemon, so it operates on the DAEMON's shared app
 * state (the live capsules/grants). When it is unset, the in-process bridge is composed per invocation (the
 * unchanged default — every existing test + E2E). The output/exit-code contract is identical either way.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  // `--endpoint <path|host:port>` is a global convenience equivalent to setting `GLA_ENDPOINT` (docs/05
  // §"Connection & auth"): strip it from argv (so the dispatcher never sees it) and let it OVERRIDE the env.
  const { argv: rest, endpoint: flagEndpoint } = extractEndpointFlag(argv);
  const mode = sniffOutputMode(rest);
  const out = new Output(mode);
  const endpoint = flagEndpoint ?? resolveClientEndpoint();
  if (endpoint === undefined) {
    // In-process profile (no daemon): compose a fresh bridge per invocation (the default behaviour).
    return run(rest, out, inProcessServices());
  }
  // Daemon profile: forward the command to the running `gla serve` over the local bridge socket.
  let client: DaemonBridgeClient;
  try {
    client = await DaemonBridgeClient.connect(endpoint);
  } catch (e) {
    const diagnosticEndpoint = redactOperatorText(endpoint);
    const diagnosticError = redactOperatorText(e instanceof Error ? e.message : String(e));
    if (isGlaError(e) && e.code.startsWith("usage.")) {
      out.fail({
        code: e.code,
        message: diagnosticError,
        detail: { endpoint: diagnosticEndpoint },
        skill: "interpret-gla-rejections",
        retryable: false,
      });
      return ExitCode.USAGE;
    }
    // No daemon reachable at GLA_ENDPOINT → a stable dependency error (exit 8), not a crash.
    out.fail({
      code: "dependency.unavailable",
      message: `cannot reach the GLA daemon at ${diagnosticEndpoint}: ${diagnosticError} (is 'gla serve' running?)`,
      detail: { endpoint: diagnosticEndpoint },
      skill: "interpret-gla-rejections",
      retryable: true,
    });
    return ExitCode.DEPENDENCY;
  }
  try {
    const services: CliServices = { bridge: client, connection: { mode: "daemon" } };
    return await run(rest, out, services);
  } finally {
    client.close();
  }
}

/**
 * Extract a leading-or-anywhere `--endpoint <value>` global flag from argv, returning argv WITHOUT it plus the
 * value (or undefined). Keeps the flag out of the noun-verb dispatcher (which would reject an unknown global
 * flag). A bare `--endpoint` with no value is left in place (the dispatcher reports the usage error).
 */
function extractEndpointFlag(argv: readonly string[]): {
  argv: string[];
  endpoint: string | undefined;
} {
  const out: string[] = [];
  let endpoint: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--endpoint") {
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith("-")) {
        endpoint = v;
        i++; // consume the value too
        continue;
      }
    }
    if (a !== undefined) {
      out.push(a);
    }
  }
  return { argv: out, endpoint };
}

/** Build the default in-process services (the in-tree reference-slice Bridge) — exported for callers/tests. */
export function inProcessServices(): CliServices {
  return { bridge: new AgentBridge(), connection: { mode: "in-process" } };
}

/** Pre-scan argv for -o/--output so the Output sink is built with the right mode up front. */
function sniffOutputMode(argv: readonly string[]): OutputMode {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-o" || argv[i] === "--output") {
      const v = argv[i + 1];
      if (v === "json" || v === "text") return v;
    }
  }
  return "auto";
}
