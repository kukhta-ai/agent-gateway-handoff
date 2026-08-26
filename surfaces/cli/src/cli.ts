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
import {
  type OpaqueToken,
  exitCodeFor,
  glaError,
  isGlaError,
  redactOperatorEgress,
} from "@gla/kernel";
import {
  type CliCommandSpec,
  commandSpecsForNoun,
  currentNouns,
  findCommandSpec,
  schemaPayload,
  usageText,
} from "./contract.js";
import { ExitCode } from "./exit-codes.js";
import type { Output, OutputMode } from "./output.js";
import type { BridgeLike } from "./transport.js";

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
export const CLI_VERSION = "0.1.0-alpha.1" as const;

interface ParsedArgs {
  output: OutputMode;
  quiet: boolean;
  help: boolean;
  noInput: boolean;
  fields?: string[];
  /** positionals after global flags are stripped */
  positionals: string[];
  /** command-scoped flags collected verbatim (e.g. --kind, --available, --for); last value wins */
  flags: Map<string, string | true>;
  /** repeatable command flags collected in order (e.g. --mount, --detector, --entrypoint) */
  repeated: Map<string, string[]>;
  /** command-scoped flags seen without a following value; validated once the command spec is known */
  missingValueFlags: string[];
  /** an unknown/invalid global flag, if any (→ usage error) */
  badFlag?: string;
  /** a documented future surface requested before it is supported by the current contract */
  unsupported?: { surface: string; message: string };
}

/** Flags that may be repeated (collected into {@link ParsedArgs.repeated}, not overwritten). */
const REPEATABLE_FLAGS = new Set(["mount", "detector", "entrypoint"]);

function redactHandoffReadModel<T>(value: T): T {
  return redactOperatorEgress(value) as T;
}

/** Global flags consume a following value; command flags are parsed loosely and validated per-command. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    output: "auto",
    quiet: false,
    help: false,
    noInput: false,
    positionals: [],
    flags: new Map(),
    repeated: new Map(),
    missingValueFlags: [],
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
      case "--no-input":
        // The current CLI never prompts; accept the flag as a no-op so scripts can be explicit.
        out.noInput = true;
        break;
      case "-o":
      case "--output": {
        const val = argv[++i];
        if (val === "json" || val === "text") {
          out.output = val;
        } else if (val === "ndjson") {
          out.unsupported = {
            surface: "output ndjson",
            message: "ndjson output is deferred until streaming commands exist",
          };
        } else {
          out.badFlag = `${arg} ${val ?? ""}`.trim();
        }
        break;
      }
      case "--fields": {
        const val = argv[++i];
        if (val !== undefined && !val.startsWith("-")) {
          out.fields = val
            .split(",")
            .map((f) => f.trim())
            .filter((f) => f.length > 0);
        } else {
          out.badFlag = `${arg} ${val ?? ""}`.trim();
        }
        break;
      }
      case "--context": {
        const val = argv[++i];
        out.unsupported = {
          surface: "--context",
          message: `context selection is deferred; use GLA_ENDPOINT or --endpoint for the current local profile${val ? ` (got "${val}")` : ""}`,
        };
        break;
      }
      case "--trace-id": {
        const val = argv[++i];
        out.unsupported = {
          surface: "--trace-id",
          message: `trace correlation is deferred until audit/event support is implemented${val ? ` (got "${val}")` : ""}`,
        };
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
            } else {
              out.missingValueFlags.push(name);
            }
            out.repeated.set(name, list);
          } else if (takesValue) {
            out.flags.set(name, next);
            i++;
          } else {
            out.flags.set(name, true);
            out.missingValueFlags.push(name);
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

/**
 * Injectable services for the dispatcher (so tests can drive a custom Bridge). `bridge` is typed as the
 * structural {@link BridgeLike} surface so the dispatcher runs IDENTICALLY over either an in-process
 * {@link AgentBridge} (the default + every existing test/E2E) OR a {@link DaemonBridgeClient} that forwards
 * each op to a running `gla serve` daemon (the `GLA_ENDPOINT`-is-set path). The output + exit-code contract
 * is the same on both — the dispatcher already `await`s every call, so a sync in-process read and a Promise
 * from the daemon client are interchangeable.
 */
export interface CliServices {
  bridge: BridgeLike;
  /** How this invocation is connected; used only for truthful `gla version` reporting. */
  connection?: {
    mode: "client-only" | "in-process" | "daemon";
    server?: string;
  };
}

/** Build the default services (the in-tree reference-slice Bridge). */
function defaultServices(): CliServices {
  return { bridge: new AgentBridge(), connection: { mode: "in-process" } };
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
  if (parsed.unsupported) {
    return unsupportedError(out, parsed.unsupported.surface, parsed.unsupported.message);
  }

  const [noun, verb] = parsed.positionals;

  // `gla --help` / `gla -h` / `gla help` / bare `gla` → usage on stdout, success.
  if (parsed.help || noun === undefined || noun === "help") {
    const scopeNoun = noun === "help" ? undefined : noun;
    out.emit(schemaPayload(scopeNoun, scopeNoun === undefined ? undefined : verb), () =>
      usageText(scopeNoun, scopeNoun === undefined ? undefined : verb),
    );
    return ExitCode.OK;
  }

  try {
    const deferred = deferredSurface(noun, verb);
    if (deferred !== undefined) {
      return unsupportedError(out, deferred.surface, deferred.message);
    }
    const flagError = validateCommandFlags(parsed, out, noun, verb);
    if (flagError !== undefined) {
      return flagError;
    }
    const fieldError = validateFieldMask(parsed, out, noun, verb);
    if (fieldError !== undefined) {
      return fieldError;
    }

    switch (noun) {
      case "schema": {
        const schemaNoun = verb;
        const schemaVerb = parsed.positionals[2];
        if (schemaNoun !== undefined && !schemaScopeExists(schemaNoun, schemaVerb)) {
          return usageError(
            out,
            `unknown schema scope: ${schemaNoun}${schemaVerb ? ` ${schemaVerb}` : ""}`,
          );
        }
        return emitCommandResult(
          parsed,
          out,
          "schema",
          undefined,
          schemaPayload(schemaNoun, schemaVerb),
        );
      }

      case "version": {
        if (verb !== undefined)
          return usageError(out, `'version' takes no subcommand (got '${verb}')`);
        return emitCommandResult(parsed, out, "version", undefined, versionPayload(services));
      }

      case "whoami": {
        if (verb !== undefined)
          return usageError(out, `'whoami' takes no subcommand (got '${verb}')`);
        // Local profile: connect (anchor the authority) then resolve identity + allowed ops.
        const connected = await services.bridge.connect();
        const who = await services.bridge.whoami(connected.token as OpaqueToken);
        return emitCommandResult(parsed, out, "whoami", undefined, who);
      }

      case "catalog": {
        if (verb !== "list")
          return usageError(out, "usage: gla catalog list [--kind <k>] [--available]");
        const filter: { kind?: string; available?: boolean } = {};
        const kind = parsed.flags.get("kind");
        if (typeof kind === "string") filter.kind = kind;
        if (parsed.flags.get("available") === true) filter.available = true;
        return emitCommandResult(
          parsed,
          out,
          "catalog",
          "list",
          await services.bridge.catalogList(filter),
        );
      }

      case "template": {
        if (verb === "list") {
          const available =
            parsed.flags.get("available") === true ? { available: true } : undefined;
          return emitCommandResult(
            parsed,
            out,
            "template",
            "list",
            await services.bridge.templateList(available),
          );
        }
        if (verb === "show") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla template show <id>");
          return emitCommandResult(
            parsed,
            out,
            "template",
            "show",
            await services.bridge.templateShow(id),
          );
        }
        return usageError(out, "usage: gla template (list | show <id>)");
      }

      case "skill": {
        if (verb === "list") {
          const forT = parsed.flags.get("for");
          return emitCommandResult(
            parsed,
            out,
            "skill",
            "list",
            await services.bridge.skillList(typeof forT === "string" ? { for: forT } : undefined),
          );
        }
        if (verb === "show") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla skill show <id>");
          return emitCommandResult(
            parsed,
            out,
            "skill",
            "show",
            await services.bridge.skillShow(id),
          );
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
          return emitCommandResult(
            parsed,
            out,
            "task",
            "create",
            await services.bridge.taskCreate(input),
          );
        }
        if (verb === "get") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla task get <id>");
          return emitCommandResult(parsed, out, "task", "get", await services.bridge.taskGet(id));
        }
        if (verb === "list") {
          const state = parsed.flags.get("state");
          return emitCommandResult(
            parsed,
            out,
            "task",
            "list",
            await services.bridge.taskList(typeof state === "string" ? { state } : undefined),
          );
        }
        if (verb === "complete") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla task complete <id>");
          // TERMINAL (Phase 15): tear down sessions+capsules, revoke descendant caps, task → completed.
          return emitCommandResult(
            parsed,
            out,
            "task",
            "complete",
            await services.bridge.taskComplete(id),
          );
        }
        if (verb === "revoke") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla task revoke <id>");
          // ABORT: the same teardown to a non-success terminal state (task → revoked).
          return emitCommandResult(
            parsed,
            out,
            "task",
            "revoke",
            await services.bridge.taskRevoke(id),
          );
        }
        return usageError(
          out,
          "usage: gla task (create | get <id> | list | complete <id> | revoke <id>)",
        );
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
          return emitCommandResult(
            parsed,
            out,
            "session",
            "connector",
            await services.bridge.sessionConnector(id),
          );
        }
        if (verb === "get") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla session get <id>");
          return emitCommandResult(
            parsed,
            out,
            "session",
            "get",
            await services.bridge.sessionGet(id),
          );
        }
        if (verb === "list") {
          const f: { task?: string; state?: string } = {};
          const task = parsed.flags.get("task");
          if (typeof task === "string") f.task = task;
          const state = parsed.flags.get("state");
          if (typeof state === "string") f.state = state;
          return emitCommandResult(
            parsed,
            out,
            "session",
            "list",
            await services.bridge.sessionList(f),
          );
        }
        if (verb === "revoke") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla session revoke <id>");
          // TERMINAL: stop + reap this session's capsule + workspace, revoke grants + connector → revoked.
          return emitCommandResult(
            parsed,
            out,
            "session",
            "revoke",
            await services.bridge.sessionRevoke(id),
          );
        }
        return usageError(
          out,
          "usage: gla session (create | connector <id> | get <id> | list | revoke <id>)",
        );
      }

      case "handoff": {
        if (verb === "open") {
          const session = parsed.flags.get("session");
          if (typeof session !== "string") {
            return usageError(
              out,
              "usage: gla handoff open --session <id> [--reason --recipient --ttl]",
            );
          }
          const args: { session: string; reason?: string; recipient?: string; ttl?: string } = {
            session,
          };
          const reason = parsed.flags.get("reason");
          if (typeof reason === "string") args.reason = reason;
          const recipient = parsed.flags.get("recipient");
          if (typeof recipient === "string") args.recipient = recipient;
          const ttl = parsed.flags.get("ttl");
          if (typeof ttl === "string") args.ttl = ttl;
          return emitCommandResult(
            parsed,
            out,
            "handoff",
            "open",
            redactHandoffReadModel(await services.bridge.handoffOpen(args)),
          );
        }
        if (verb === "wait") {
          const id = parsed.positionals[2];
          if (id === undefined)
            return usageError(out, "usage: gla handoff wait <id> [--timeout <dur>]");
          const timeout = parsed.flags.get("timeout");
          const timeoutMs = typeof timeout === "string" ? parseDurationToMs(timeout) : undefined;
          // BLOCK until completion or expiry. A timeout/expiry throws auth.expired; at the WAIT surface that is a
          // TIMEOUT (exit 6, not the default auth exit 4) — the one documented re-label (errors.ts §5.2 note,
          // docs/05 §5). Handle it here so the exit code is the timeout branch.
          try {
            return emitCommandResult(
              parsed,
              out,
              "handoff",
              "wait",
              redactHandoffReadModel(await services.bridge.handoffWait(id, timeoutMs)),
            );
          } catch (e) {
            if (isGlaError(e) && e.code === "auth.expired") {
              out.fail(e.toGlaError());
              return ExitCode.TIMEOUT; // exit 6 — the window expired / the wait timed out
            }
            throw e;
          }
        }
        if (verb === "get") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla handoff get <id>");
          return emitCommandResult(
            parsed,
            out,
            "handoff",
            "get",
            redactHandoffReadModel(await services.bridge.handoffGet(id)),
          );
        }
        if (verb === "list") {
          const session = parsed.flags.get("session");
          return emitCommandResult(
            parsed,
            out,
            "handoff",
            "list",
            redactHandoffReadModel(
              await services.bridge.handoffList(
                typeof session === "string" ? { session } : undefined,
              ),
            ),
          );
        }
        if (verb === "cancel") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla handoff cancel <id>");
          return emitCommandResult(
            parsed,
            out,
            "handoff",
            "cancel",
            redactHandoffReadModel(await services.bridge.handoffCancel(id)),
          );
        }
        return usageError(
          out,
          "usage: gla handoff (open | wait <id> | get <id> | list | cancel <id>)",
        );
      }

      case "auth": {
        if (verb !== "diagnostics") {
          return usageError(out, "usage: gla auth diagnostics [--recipient <ref>]");
        }
        const recipient = parsed.flags.get("recipient");
        if (recipient === true) {
          return usageError(out, "usage: gla auth diagnostics [--recipient <ref>]");
        }
        const request = operatorRequest(services.bridge);
        if (request === undefined) {
          throw glaError(
            "dependency.unavailable",
            "gla auth diagnostics requires a running daemon; set GLA_ENDPOINT or pass --endpoint to the app binary",
            { detail: { operation: "authDiagnostics" }, retryable: true },
          );
        }
        // Auth diagnostics are already sanitized at the daemon boundary. The generic handoff redactor would
        // erase safe policy keys such as `credentialSetupStages`, making the operator diagnostic unusable.
        return emitCommandResult(
          parsed,
          out,
          "auth",
          "diagnostics",
          await request("authDiagnostics", [
            ...(typeof recipient === "string" ? [{ recipient }] : []),
          ]),
        );
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

function schemaScopeExists(noun: string, verb?: string): boolean {
  if (verb !== undefined) {
    return findCommandSpec(noun, verb) !== undefined;
  }
  return commandSpecsForNoun(noun).length > 0;
}

function deferredSurface(
  noun: string,
  verb: string | undefined,
): { surface: string; message: string } | undefined {
  if (noun === "policy" && (verb === undefined || verb === "mounts")) {
    return {
      surface: "policy mounts",
      message: "policy inspection is deferred for the current CLI contract",
    };
  }
  if (noun === "events") {
    return {
      surface: "events",
      message: "event streaming is deferred for the current CLI contract",
    };
  }
  if (noun === "audit" && (verb === undefined || verb === "list")) {
    return {
      surface: "audit list",
      message: "audit browsing is deferred for the current CLI contract",
    };
  }
  if (noun === "auth" && (verb === "login" || verb === "logout")) {
    return {
      surface: `auth ${verb}`,
      message:
        "authenticated-agent login/logout is deferred; the current local profile is credential-free",
    };
  }
  if (noun === "batch") {
    return {
      surface: "batch operations",
      message: "batch operations are deferred for the current CLI contract",
    };
  }
  return undefined;
}

function unsupportedError(out: Output, surface: string, message: string): number {
  out.fail({
    code: "usage.unsupported",
    message,
    detail: { surface, status: "deferred", current_nouns: currentNouns() },
    skill: "interpret-gla-rejections",
    retryable: false,
  });
  return ExitCode.USAGE;
}

function versionPayload(services: CliServices): Record<string, unknown> {
  const connection = services.connection ?? { mode: "client-only" as const };
  const payload: Record<string, unknown> = {
    client: CLI_VERSION,
    connection: connection.mode,
  };
  if (connection.server !== undefined) {
    payload.server = connection.server;
  }
  return payload;
}

function validateFieldMask(
  parsed: ParsedArgs,
  out: Output,
  noun: string,
  verb: string | undefined,
): number | undefined {
  const fields = parsed.fields;
  if (fields === undefined || fields.length === 0) {
    return undefined;
  }
  const spec = findCommandSpec(noun, verb);
  if (spec === undefined) {
    return undefined;
  }
  return validateFieldsForSpec(fields, spec, out, ["gla", noun, verb].filter(Boolean).join(" "));
}

function validateCommandFlags(
  parsed: ParsedArgs,
  out: Output,
  noun: string,
  verb: string | undefined,
): number | undefined {
  const spec =
    noun === "schema" ? findCommandSpec("schema", undefined) : findCommandSpec(noun, verb);
  if (spec === undefined) {
    return undefined;
  }
  const allowed = allowedFlagNames(spec);
  const unknown = [...parsed.flags.keys(), ...parsed.repeated.keys()].filter(
    (flag) => !allowed.has(flag),
  );
  if (unknown.length === 0) {
    const valueRequired = valueRequiredFlagNames(spec);
    const missingValues = parsed.missingValueFlags.filter((flag) => valueRequired.has(flag));
    if (missingValues.length > 0) {
      out.fail({
        code: "usage.bad_flag",
        message: `missing value for flag(s) on ${["gla", noun, verb].filter(Boolean).join(" ")}: ${missingValues
          .map((f) => `--${f}`)
          .join(", ")}`,
        detail: {
          flags: missingValues.map((f) => `--${f}`),
          missing_values: missingValues.map((f) => `--${f}`),
          allowed_flags: [...allowed].map((f) => `--${f}`),
        },
        skill: "interpret-gla-rejections",
        retryable: false,
      });
      return ExitCode.USAGE;
    }

    const unexpectedValues = [...parsed.flags.entries()]
      .filter(([flag, value]) => allowed.has(flag) && !valueRequired.has(flag) && value !== true)
      .map(([flag]) => flag);
    if (unexpectedValues.length === 0) {
      return undefined;
    }
    out.fail({
      code: "usage.bad_flag",
      message: `unexpected value for flag(s) on ${["gla", noun, verb].filter(Boolean).join(" ")}: ${unexpectedValues
        .map((f) => `--${f}`)
        .join(", ")}`,
      detail: {
        flags: unexpectedValues.map((f) => `--${f}`),
        unexpected_values: unexpectedValues.map((f) => `--${f}`),
        allowed_flags: [...allowed].map((f) => `--${f}`),
      },
      skill: "interpret-gla-rejections",
      retryable: false,
    });
    return ExitCode.USAGE;
  }
  out.fail({
    code: "usage.bad_flag",
    message: `unsupported flag(s) for ${["gla", noun, verb].filter(Boolean).join(" ")}: ${unknown
      .map((f) => `--${f}`)
      .join(", ")}`,
    detail: {
      flags: unknown.map((f) => `--${f}`),
      allowed_flags: [...allowed].map((f) => `--${f}`),
    },
    skill: "interpret-gla-rejections",
    retryable: false,
  });
  return ExitCode.USAGE;
}

function allowedFlagNames(spec: CliCommandSpec): Set<string> {
  return flagNamesMatching(spec, /--([a-z0-9-]+)/g);
}

function valueRequiredFlagNames(spec: CliCommandSpec): Set<string> {
  return flagNamesMatching(spec, /--([a-z0-9-]+)\s+<[^>]+>/g);
}

function flagNamesMatching(spec: CliCommandSpec, pattern: RegExp): Set<string> {
  const names = new Set<string>();
  for (const flag of spec.flags) {
    for (const match of flag.matchAll(pattern)) {
      const name = match[1];
      if (name !== undefined) {
        names.add(name);
      }
    }
  }
  return names;
}

function emitCommandResult(
  parsed: ParsedArgs,
  out: Output,
  noun: string,
  verb: string | undefined,
  data: unknown,
  text?: (data: unknown) => string,
): number {
  const spec = findCommandSpec(noun, verb);
  const fields = parsed.fields;
  if (fields !== undefined && fields.length > 0) {
    if (spec === undefined) {
      return usageError(
        out,
        `command does not support --fields: ${["gla", noun, verb].filter(Boolean).join(" ")}`,
      );
    }
    const invalid = validateFieldsForSpec(
      fields,
      spec,
      out,
      ["gla", noun, verb].filter(Boolean).join(" "),
    );
    if (invalid !== undefined) {
      return invalid;
    }
  }
  out.emit(applyFields(data, spec, fields), text);
  return ExitCode.OK;
}

function validateFieldsForSpec(
  fields: string[],
  spec: CliCommandSpec,
  out: Output,
  command: string,
): number | undefined {
  const unknown = fields.filter((field) => !spec.fields.includes(field));
  if (unknown.length === 0) {
    return undefined;
  }
  out.fail({
    code: "usage.bad_field",
    message: `unknown field(s) for ${command}: ${unknown.join(", ")}`,
    detail: { fields: unknown, allowed_fields: spec.fields },
    skill: "interpret-gla-rejections",
    retryable: false,
  });
  return ExitCode.USAGE;
}

function applyFields(
  data: unknown,
  spec: CliCommandSpec | undefined,
  fields: string[] | undefined,
): unknown {
  if (fields === undefined || fields.length === 0 || spec === undefined) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => pickFields(item, fields));
  }
  return pickFields(data, fields);
}

function pickFields(data: unknown, fields: string[]): unknown {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }
  const source = data as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.hasOwn(source, field)) {
      picked[field] = source[field];
    }
  }
  return picked;
}

function operatorRequest(
  bridge: BridgeLike,
): (<T = unknown>(op: string, args?: unknown[]) => Promise<T>) | undefined {
  const maybe = bridge as BridgeLike & {
    request?: <T = unknown>(op: string, args?: unknown[]) => Promise<T>;
  };
  if (typeof maybe.request === "function") {
    return maybe.request.bind(maybe);
  }
  return undefined;
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
  return emitCommandResult(parsed, out, "session", "create", result);
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

/** Parse a coarse duration ("15m"/"30s"/"1h"/"2d") into milliseconds for `handoff wait --timeout`, or undefined. */
function parseDurationToMs(d: string): number | undefined {
  const m = d.trim().match(/^(\d+)\s*(s|m|h|d)$/);
  if (m === null) {
    return undefined;
  }
  const n = Number(m[1]);
  const unit = m[2];
  const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mult;
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
