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

import { readFileSync } from "node:fs";
import { AgentBridge } from "@gla/bridge";
import { type OpaqueToken, exitCodeFor, glaError, isGlaError } from "@gla/kernel";
import { ExitCode } from "./exit-codes.js";
import type { Output, OutputMode } from "./output.js";

/** The proposal shape the bridge's `sessionCreate` consumes (sans the bound `task`). */
interface CliProposal {
  intent: string;
  template: string;
  recipient: string;
  ttl?: string;
  launcher?: { use: string };
  entrypoints?: Array<{ use: string }>;
  connector?: { use: string };
  workspace?: { use: string };
  detectors?: Array<{ use: string }>;
  mounts?: Array<{ host: string; target?: string; mode?: "ro" | "rw" }>;
}

/** Client version of the `gla` surface. Kept in lockstep with the package version. */
export const CLI_VERSION = "0.1.0" as const;

/** The nouns the CLI exposes (Slice 1 orient + Slice 2 task/session + version/help). */
const NOUNS = [
  "whoami",
  "version",
  "catalog",
  "template",
  "skill",
  "task",
  "session",
  "help",
] as const;

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
  task create [flags]         open a Task + mint its task capability (parent = agent-authority)
  task get <id>               read a Task aggregate
  task list [--state <s>]     list Tasks
  session create [flags]      admit + provision a capsule; --dry-run = admission only
  session connector <id>      re-emit the agent-connector for a live capsule (exit 7 if none)
  session get <id>            read a Session aggregate
  session list [flags]        list Sessions
  version                     print client (+ server when connected) version
  help                        print this usage

Command flags:
  catalog list --kind <k>     filter by entity kind/family
  catalog list --available    only entities whose dependencies are bound (system-derived)
  skill list --for <id>       only skills relevant to a template
  task create --intent <s> --recipient <ref>
  session create -f <spec>    a full assembly spec file (JSON), OR compose with:
                 --template <id> [--launcher <l>] [--entrypoint <e> …] [--connector <c>]
                 [--workspace <w>] [--detector <d> …] [--recipient <ref>] [--ttl <dur>]
                 [--task <id>] [--mount <host>:<target>:<ro|rw> …] [--dry-run]
  session list --task <id> --state <s>

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
  /** command-scoped flags collected verbatim (e.g. --kind, --available, --for); last value wins */
  flags: Map<string, string | true>;
  /** repeatable command flags collected in order (e.g. --mount, --detector, --entrypoint) */
  repeated: Map<string, string[]>;
  /** an unknown/invalid global flag, if any (→ usage error) */
  badFlag?: string;
}

/** Flags that may be repeated (collected into {@link ParsedArgs.repeated}, not overwritten). */
const REPEATABLE_FLAGS = new Set(["mount", "detector", "entrypoint"]);

/** Global flags consume a following value; command flags are parsed loosely and validated per-command. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    output: "auto",
    quiet: false,
    help: false,
    positionals: [],
    flags: new Map(),
    repeated: new Map(),
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
      case "-f":
      case "--file": {
        // The assembly spec file for `session create -f <spec>` (a short flag taking a value).
        const val = argv[++i];
        if (val !== undefined && !val.startsWith("-")) {
          out.flags.set("file", val);
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
          const takesValue = next !== undefined && !next.startsWith("-");
          if (REPEATABLE_FLAGS.has(name)) {
            // Repeatable: collect each occurrence's value in order (e.g. --mount a --mount b).
            const list = out.repeated.get(name) ?? [];
            if (takesValue) {
              list.push(next);
              i++;
            }
            out.repeated.set(name, list);
          } else if (takesValue) {
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

      case "task": {
        if (verb === "create") {
          const input: { intent?: string; recipient?: string } = {};
          const intent = parsed.flags.get("intent");
          if (typeof intent === "string") input.intent = intent;
          const recipient = parsed.flags.get("recipient");
          if (typeof recipient === "string") input.recipient = recipient;
          out.emit(await services.bridge.taskCreate(input));
          return ExitCode.OK;
        }
        if (verb === "get") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla task get <id>");
          out.emit(services.bridge.taskGet(id));
          return ExitCode.OK;
        }
        if (verb === "list") {
          const state = parsed.flags.get("state");
          out.emit(services.bridge.taskList(typeof state === "string" ? { state } : undefined));
          return ExitCode.OK;
        }
        return usageError(out, "usage: gla task (create | get <id> | list)");
      }

      case "session": {
        if (verb === "create") {
          return await sessionCreate(parsed, out, services);
        }
        if (verb === "connector") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla session connector <id>");
          // Re-emit the agent-connector for a LIVE capsule (GLA-025). No live capsule → the bridge
          // throws state.conflict, which the outer catch maps to exit 7 (NOT a crash).
          out.emit(await services.bridge.sessionConnector(id));
          return ExitCode.OK;
        }
        if (verb === "get") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla session get <id>");
          out.emit(services.bridge.sessionGet(id));
          return ExitCode.OK;
        }
        if (verb === "list") {
          const f: { task?: string; state?: string } = {};
          const task = parsed.flags.get("task");
          if (typeof task === "string") f.task = task;
          const state = parsed.flags.get("state");
          if (typeof state === "string") f.state = state;
          out.emit(services.bridge.sessionList(f));
          return ExitCode.OK;
        }
        return usageError(out, "usage: gla session (create | connector <id> | get <id> | list)");
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

/**
 * `session create` (docs/05; GLA-020/021). Build the proposal from `-f <spec>` OR `--template <id>` +
 * part flags + `--mount`, then call the bridge's `sessionCreate` (which admits and, unless --dry-run,
 * dispatches a Session in `issued`). On reject the bridge throws a typed GlaError → the outer catch
 * maps `.code` → its exit code (3/4/5/7/8). `--dry-run` prints accept/reject and provisions nothing.
 */
async function sessionCreate(
  parsed: ParsedArgs,
  out: Output,
  services: CliServices,
): Promise<number> {
  let proposal: CliProposal;
  try {
    proposal = buildProposal(parsed);
  } catch (e) {
    // A malformed -f/flag combination is a usage error (exit 2), distinct from an admission reject.
    if (isGlaError(e) && e.code.startsWith("usage.")) {
      out.fail(e.toGlaError());
      return ExitCode.USAGE;
    }
    throw e;
  }

  const args: { proposal: CliProposal; task?: string; dryRun?: boolean } = { proposal };
  const task = parsed.flags.get("task");
  if (typeof task === "string") args.task = task;
  if (parsed.flags.get("dry-run") === true) args.dryRun = true;

  // `CliProposal` is structurally the bridge's `CliAssemblyProposal` (plain-string recipient); the
  // bridge does the brand cast. No `any` needed at this boundary.
  const result = await services.bridge.sessionCreate(args);
  out.emit(result);
  return ExitCode.OK;
}

/** Build the session-create proposal from `-f <spec>` (a full AssemblySpec) or the part flags. */
function buildProposal(parsed: ParsedArgs): CliProposal {
  const file = parsed.flags.get("file");
  if (typeof file === "string") {
    return proposalFromFile(file);
  }
  return proposalFromFlags(parsed);
}

/** Read an assembly spec file (JSON) and project it to the proposal the bridge consumes. */
function proposalFromFile(path: string): CliProposal {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw glaError("usage.bad_argument", `cannot read assembly file "${path}": ${String(e)}`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw glaError("usage.bad_argument", `assembly file "${path}" is not valid JSON`);
  }
  if (typeof doc !== "object" || doc === null) {
    throw glaError("usage.bad_argument", `assembly file "${path}" must be a JSON object`);
  }
  const d = doc as {
    metadata?: { intent?: unknown; task?: unknown };
    spec?: Record<string, unknown>;
  };
  const spec = d.spec ?? {};
  const intent = typeof d.metadata?.intent === "string" ? d.metadata.intent : "";
  const out: CliProposal = {
    intent,
    template: typeof spec.template === "string" ? spec.template : "",
    recipient: typeof spec.recipient === "string" ? spec.recipient : "",
  };
  // Carry the optional parts/ttl/mounts through verbatim (admission re-validates them structurally).
  if (typeof spec.ttl === "string") out.ttl = spec.ttl;
  if (spec.launcher !== undefined)
    out.launcher = spec.launcher as NonNullable<CliProposal["launcher"]>;
  if (spec.entrypoints !== undefined)
    out.entrypoints = spec.entrypoints as NonNullable<CliProposal["entrypoints"]>;
  if (spec.connector !== undefined)
    out.connector = spec.connector as NonNullable<CliProposal["connector"]>;
  if (spec.workspace !== undefined)
    out.workspace = spec.workspace as NonNullable<CliProposal["workspace"]>;
  if (spec.detectors !== undefined)
    out.detectors = spec.detectors as NonNullable<CliProposal["detectors"]>;
  if (spec.mounts !== undefined) out.mounts = spec.mounts as NonNullable<CliProposal["mounts"]>;
  return out;
}

/** Build the proposal from `--template <id>` + part flags + `--mount` (the imperative compose form). */
function proposalFromFlags(parsed: ParsedArgs): CliProposal {
  const template = parsed.flags.get("template");
  if (typeof template !== "string") {
    throw glaError("usage.bad_argument", "session create needs -f <spec> or --template <id>");
  }
  const recipient = parsed.flags.get("recipient");
  const intent = parsed.flags.get("intent");
  const out: CliProposal = {
    intent: typeof intent === "string" ? intent : "",
    template,
    recipient: typeof recipient === "string" ? recipient : "",
  };
  const ttl = parsed.flags.get("ttl");
  if (typeof ttl === "string") out.ttl = ttl;
  const launcher = parsed.flags.get("launcher");
  if (typeof launcher === "string") out.launcher = { use: launcher };
  const connector = parsed.flags.get("connector");
  if (typeof connector === "string") out.connector = { use: connector };
  const workspace = parsed.flags.get("workspace");
  if (typeof workspace === "string") out.workspace = { use: workspace };
  const entrypoints = parsed.repeated.get("entrypoint");
  if (entrypoints && entrypoints.length > 0) out.entrypoints = entrypoints.map((use) => ({ use }));
  const detectors = parsed.repeated.get("detector");
  if (detectors && detectors.length > 0) out.detectors = detectors.map((use) => ({ use }));
  const mounts = parsed.repeated.get("mount");
  if (mounts && mounts.length > 0) out.mounts = mounts.map(parseMount);
  return out;
}

/** Parse one `--mount <host>:<target>:<ro|rw>` (target/mode optional; mode defaults handled downstream). */
function parseMount(s: string): { host: string; target?: string; mode?: "ro" | "rw" } {
  const parts = s.split(":");
  const host = parts[0] ?? "";
  if (host.length === 0) {
    throw glaError(
      "usage.bad_argument",
      `invalid --mount "${s}" (expected <host>[:<target>[:<mode>]])`,
    );
  }
  const mount: { host: string; target?: string; mode?: "ro" | "rw" } = { host };
  const target = parts[1];
  if (target !== undefined && target.length > 0) mount.target = target;
  const mode = parts[2];
  if (mode === "ro" || mode === "rw") {
    mount.mode = mode;
  } else if (mode !== undefined && mode.length > 0) {
    throw glaError("usage.bad_argument", `invalid mount mode "${mode}" (expected ro|rw)`);
  }
  return mount;
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
