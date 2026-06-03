// surfaces/cli · the `gla` command tree (docs/05). Resource-oriented noun-verb dispatcher.
// Slice 1 wires the ORIENT read surface (scenario-01 Phase 1) over the Agent Bridge core:
//   gla whoami
//   gla template list | template show <id>
//   gla skill list | skill show <id>
//   gla catalog list [--kind <k>] [--available]
//   gla version | help
// Output contract (docs/05 §1/§4): JSON to stdout by default (text only at a TTY, via the Output
// helper); stderr carries a JSON `{error:{...}}`. Exit codes (docs/05 §5): 0 success, 2 usage,
// 5 not-found (unknown id), and the kernel taxonomy map for any thrown GlaError.
//
// Design: `run()` returns a Promise<exit code> and writes through an injected `Output` + an injected
// (or default) Agent Bridge, so it is unit-testable without spawning a process or hitting a network.

import { AgentBridge } from "@gla/bridge";
import { type OpaqueToken, exitCodeFor, isGlaError } from "@gla/kernel";
import { ExitCode } from "./exit-codes.js";
import type { Output, OutputMode } from "./output.js";

/** Client version of the `gla` surface. Kept in lockstep with the package version. */
export const CLI_VERSION = "0.1.0" as const;

/** The nouns the Slice-1 CLI exposes (the orient read surface + version/help). */
const NOUNS = ["whoami", "version", "catalog", "template", "skill", "help"] as const;

const USAGE = `gla — agent gateway control interface

Usage:
  gla [global-flags] <noun> [<verb>] [args]

Nouns:
  whoami                      print this agent's identity + authority scope (JSON)
  catalog list [flags]        what is installable / available in THIS install
  template list               the assemblable capsule templates
  template show <id>          required parts + each backing dependency's binding status
  skill list [--for <t>]      procedural knowledge the agent can load
  skill show <id>             emit the SKILL.md body to stdout
  version                     print client (+ server when connected) version
  help                        print this usage

Command flags:
  catalog list --kind <k>     filter by entity kind/family
  catalog list --available    only entities whose dependencies are bound (system-derived)
  skill list --for <id>       only skills relevant to a template

Global flags:
  -o, --output <fmt>  json | text   (default: json; text auto-selected only at a TTY)
  -q, --quiet         suppress non-essential diagnostics
  -h, --help          print this usage (add -o json for machine-readable form)

Output contract:
  stdout = results (JSON by default; human text only at a TTY). stderr = diagnostics/errors.

Exit codes (docs/05 §5):
  0 success · 1 internal · 2 usage · 3 policy · 4 auth · 5 not-found · 6 timeout · 7 conflict · 8 dependency
`;

interface ParsedArgs {
  output: OutputMode;
  quiet: boolean;
  help: boolean;
  /** positionals after global flags are stripped */
  positionals: string[];
  /** command-scoped flags collected verbatim (e.g. --kind, --available, --for) */
  flags: Map<string, string | true>;
  /** an unknown/invalid global flag, if any (→ usage error) */
  badFlag?: string;
}

/** Global flags consume a following value; command flags are parsed loosely and validated per-command. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    output: "auto",
    quiet: false,
    help: false,
    positionals: [],
    flags: new Map(),
  };
  let optsEnded = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    // POSIX end-of-options marker. Also lets `pnpm gla -- <args>` work.
    if (!optsEnded && arg === "--") {
      optsEnded = true;
      continue;
    }
    if (optsEnded) {
      out.positionals.push(arg);
      continue;
    }
    switch (arg) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "-q":
      case "--quiet":
        out.quiet = true;
        break;
      case "-o":
      case "--output": {
        const val = argv[++i];
        if (val === "json" || val === "text") {
          out.output = val;
        } else {
          out.badFlag = `${arg} ${val ?? ""}`.trim();
        }
        break;
      }
      default:
        if (arg.startsWith("--")) {
          // A command-scoped flag: `--name value` or a boolean `--name`.
          const name = arg.slice(2);
          const next = argv[i + 1];
          if (next !== undefined && !next.startsWith("-")) {
            out.flags.set(name, next);
            i++;
          } else {
            out.flags.set(name, true);
          }
        } else if (arg.startsWith("-")) {
          out.badFlag = arg;
        } else {
          out.positionals.push(arg);
        }
    }
  }
  return out;
}

/** Machine-readable usage payload, emitted for `--help -o json` (docs/05: agents introspect). */
function usagePayload(): Record<string, unknown> {
  return {
    command: "gla",
    summary: "agent gateway control interface",
    nouns: [...NOUNS],
    global_flags: ["-o/--output", "-q/--quiet", "-h/--help"],
    exit_codes: {
      "0": "success",
      "1": "internal",
      "2": "usage",
      "3": "policy",
      "4": "auth",
      "5": "not-found",
      "6": "timeout",
      "7": "conflict",
      "8": "dependency",
    },
  };
}

/** Injectable services for the dispatcher (so tests can drive a custom Bridge). */
export interface CliServices {
  bridge: AgentBridge;
}

/** Build the default services (the in-tree reference-slice Bridge). */
function defaultServices(): CliServices {
  return { bridge: new AgentBridge() };
}

/**
 * Execute one `gla` invocation.
 * @param argv      args after the program name (i.e. `process.argv.slice(2)`)
 * @param out       output sink (injected for testability)
 * @param services  injectable services (defaults to the in-tree Bridge)
 * @returns the process exit code
 */
export async function run(
  argv: readonly string[],
  out: Output,
  services: CliServices = defaultServices(),
): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.badFlag) {
    out.fail({
      code: "usage.bad_flag",
      message: `unknown or invalid flag: ${parsed.badFlag}`,
      detail: { flag: parsed.badFlag },
      skill: "interpret-gla-rejections",
      retryable: false,
    });
    return ExitCode.USAGE;
  }

  const [noun, verb] = parsed.positionals;

  // `gla --help` / `gla -h` / `gla help` / bare `gla` → usage on stdout, success.
  if (parsed.help || noun === undefined || noun === "help") {
    out.emit(usagePayload(), () => USAGE.trimEnd());
    return ExitCode.OK;
  }

  try {
    switch (noun) {
      case "version": {
        if (verb !== undefined)
          return usageError(out, `'version' takes no subcommand (got '${verb}')`);
        // server is unknown until a remote bridge is wired (later) → omit the field.
        out.emit({ client: CLI_VERSION });
        return ExitCode.OK;
      }

      case "whoami": {
        if (verb !== undefined)
          return usageError(out, `'whoami' takes no subcommand (got '${verb}')`);
        // Local profile: connect (anchor the authority) then resolve identity + allowed ops.
        const connected = await services.bridge.connect();
        const who = services.bridge.whoami(connected.token as OpaqueToken);
        out.emit(who);
        return ExitCode.OK;
      }

      case "catalog": {
        if (verb !== "list")
          return usageError(out, "usage: gla catalog list [--kind <k>] [--available]");
        const filter: { kind?: string; available?: boolean } = {};
        const kind = parsed.flags.get("kind");
        if (typeof kind === "string") filter.kind = kind;
        if (parsed.flags.get("available") === true) filter.available = true;
        out.emit(services.bridge.catalogList(filter));
        return ExitCode.OK;
      }

      case "template": {
        if (verb === "list") {
          const available =
            parsed.flags.get("available") === true ? { available: true } : undefined;
          out.emit(services.bridge.templateList(available));
          return ExitCode.OK;
        }
        if (verb === "show") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla template show <id>");
          out.emit(services.bridge.templateShow(id));
          return ExitCode.OK;
        }
        return usageError(out, "usage: gla template (list | show <id>)");
      }

      case "skill": {
        if (verb === "list") {
          const forT = parsed.flags.get("for");
          out.emit(services.bridge.skillList(typeof forT === "string" ? { for: forT } : undefined));
          return ExitCode.OK;
        }
        if (verb === "show") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla skill show <id>");
          out.emit(services.bridge.skillShow(id));
          return ExitCode.OK;
        }
        return usageError(out, "usage: gla skill (list | show <id>)");
      }

      default:
        return usageError(out, `unknown command: '${noun}'`);
    }
  } catch (e) {
    // A typed kernel error (e.g. catalog.unknown for an unknown id) maps to its exit code (docs/05
    // §5) — unknown id → exit 5. The richer signal is the JSON error.code on stderr.
    if (isGlaError(e)) {
      out.fail(e.toGlaError());
      return exitCodeFor(e.code);
    }
    // Anything else is an unexpected internal error.
    out.fail({
      code: "internal",
      message: e instanceof Error ? e.message : String(e),
      skill: "interpret-gla-rejections",
      retryable: false,
    });
    return ExitCode.INTERNAL;
  }
}

function usageError(out: Output, message: string): number {
  out.fail({
    code: "usage.unknown_command",
    message,
    skill: "interpret-gla-rejections",
    retryable: false,
  });
  return ExitCode.USAGE;
}
