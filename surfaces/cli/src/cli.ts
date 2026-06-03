// surfaces/cli · the `gla` command tree (skeleton).
// Resource-oriented noun-verb dispatcher (docs/05 §1). This is the GLA-003 skeleton: enough
// commands to prove the exit-code + JSON/TTY contract, not the full surface. Later tasks grow the
// tree (session/handoff/template/skill/events…) over the bridge core — wired through `packages/app`.
//
// Design: `run()` is pure w.r.t. process control — it returns an exit code and writes through an
// injected `Output`, so it is unit-testable without spawning a process or calling process.exit.

import { ExitCode } from "./exit-codes.js";
import type { Output, OutputMode } from "./output.js";

/** Client version of the `gla` surface. Kept in lockstep with the package version. */
export const CLI_VERSION = "0.1.0" as const;

const USAGE = `gla — agent gateway control interface (GLA-003 skeleton)

Usage:
  gla [global-flags] <noun> [<verb>] [args]

Nouns (skeleton subset):
  version            print client (+ server when connected) version
  whoami             print this agent's identity + authority scope
  help               print this usage

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
  /** an unknown/invalid global flag, if any (→ usage error) */
  badFlag?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { output: "auto", quiet: false, help: false, positionals: [] };
  let optsEnded = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    // POSIX end-of-options marker. Also lets `pnpm gla -- <args>` work: pnpm forwards the `--`,
    // and everything after it is treated as positionals, not flags.
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
        if (arg.startsWith("-")) {
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
    summary: "agent gateway control interface (GLA-003 skeleton)",
    nouns: ["version", "whoami", "help"],
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

/**
 * Execute one `gla` invocation.
 * @param argv  args after the program name (i.e. `process.argv.slice(2)`)
 * @param out   output sink (injected for testability)
 * @returns the process exit code
 */
export function run(argv: readonly string[], out: Output): number {
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

  switch (noun) {
    case "version": {
      if (verb !== undefined)
        return usageError(out, `'version' takes no subcommand (got '${verb}')`);
      // server is unknown until the bridge is wired (later tasks) → omit the field.
      out.emit({ client: CLI_VERSION });
      return ExitCode.OK;
    }

    case "whoami": {
      if (verb !== undefined)
        return usageError(out, `'whoami' takes no subcommand (got '${verb}')`);
      // Skeleton: identity resolution lands with the bridge/identity wiring. Report it honestly
      // as not-yet-implemented via the stable error shape rather than fabricating an identity.
      out.fail({
        code: "unimplemented",
        message: "whoami is not implemented in the GLA-003 skeleton",
        detail: { noun: "whoami" },
        skill: "interpret-gla-rejections",
        retryable: false,
      });
      return ExitCode.INTERNAL;
    }

    default:
      return usageError(out, `unknown command: '${noun}'`);
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
