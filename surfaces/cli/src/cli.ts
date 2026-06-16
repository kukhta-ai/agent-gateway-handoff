// surfaces/cli · the `gla` command tree (docs/05). Resource-oriented noun-verb dispatcher.
// Slice 1 wires the ORIENT read surface (scenario-01 Phase 1) over the Agent Bridge core:
//   gla whoami
//   gla template list | template show <id>
//   gla skill list | skill show <id>
//   gla catalog list [--kind <k>] [--available] | catalog show <id>
//   gla version | help
// Output contract (docs/05 §1/§4): JSON to stdout by default (text only at a TTY, via the Output
// helper); stderr carries a JSON `{error:{...}}`. Exit codes (docs/05 §5): 0 success, 2 usage,
// 5 not-found (unknown id), and the kernel taxonomy map for any thrown GlaError.
//
// Design: `run()` returns a Promise<exit code> and writes through an injected `Output` + an injected
// (or default) Agent Bridge, so it is unit-testable without spawning a process or hitting a network.

import { readFileSync, writeFileSync } from "node:fs";
import { AgentBridge } from "@gla/bridge";
import {
  PROVIDER_MANIFESTS,
  type ProviderAuthoringRuntimeFamily,
  type ProviderAuthoringWorkspaceInput,
  type ProviderInstallInventoryInput,
  type ProviderInstallRollbackSnapshot,
  type ProviderManifest,
  type ProviderPackageAuthoringInput,
  type ProviderPackageAuthoringReport,
  type TemplatePackageAuthoringInput,
  type TemplatePackageAuthoringReport,
  applyProviderInstallUpdate,
  createProviderPackageSkeleton,
  createTemplatePackageSkeleton,
  doctorProviderInstallInventory,
  planProviderInstallUpdate,
  rollbackProviderInstallUpdate,
  validateProviderAuthoringWorkspace,
  validateProviderPackageAuthoring,
  validateTemplatePackageAuthoring,
} from "@gla/catalog";
import {
  type OpaqueToken,
  assemblyDefectsToError,
  exitCodeFor,
  glaError,
  isGlaError,
  redactOperatorEgress,
  validateAssembly,
} from "@gla/kernel";
import { Command, InvalidArgumentError } from "commander";
import {
  CLI_COMMANDS,
  type CliCommandSpec,
  commandSpecsForNoun,
  currentNouns,
  findCommandSpec,
  findDeferredCliSurface,
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
export const CLI_VERSION = "0.1.0" as const;

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
  /** a Commander parse failure translated into GLA's stable JSON usage taxonomy */
  parseError?: CliParseError;
  /** a documented future surface requested before it is supported by the current contract */
  unsupported?: { surface: string; message: string };
}

interface CliParseError {
  code: "usage.bad_flag" | "usage.bad_argument";
  message: string;
  detail: Record<string, unknown>;
}

type AuthoringReport =
  | ProviderPackageAuthoringReport
  | TemplatePackageAuthoringReport
  | ReturnType<typeof validateProviderAuthoringWorkspace>;

interface FlagDefinition {
  source: string;
  commanderSyntax: string;
  longName: string;
  shortName: string | undefined;
  valueRequired: boolean;
  repeatable: boolean;
  optionKey: string;
}

function redactHandoffReadModel<T>(value: T): T {
  return redactOperatorEgress(value) as T;
}

/** Build the neutral parsed-argument shape consumed by the dispatcher. */
function emptyParsedArgs(): ParsedArgs {
  return {
    output: "auto",
    quiet: false,
    help: false,
    noInput: false,
    positionals: [],
    flags: new Map(),
    repeated: new Map(),
    missingValueFlags: [],
  };
}

/** Parse argv through a Commander program generated from {@link CLI_COMMANDS}. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed = emptyParsedArgs();
  parsed.help = hasHelpToken(argv);

  const unsupported = scanDeferredGlobalSurface(argv);
  if (unsupported !== undefined) {
    parsed.unsupported = unsupported;
    return parsed;
  }

  const argvForCommander = stripHelpTokens(argv);
  parsed.positionals = extractCommandTokens(argvForCommander);
  const missingValue = missingValueBeforeCommander(argvForCommander, parsed.positionals);
  if (missingValue !== undefined) {
    parsed.parseError = missingValue;
    return parsed;
  }
  const program = buildCommanderProgram(parsed);

  try {
    program.parse(argvForCommander, { from: "user" });
  } catch (e) {
    applyCommanderGlobalOptions(parsed, program);
    const parseError = parseErrorForCommander(e, argvForCommander, parsed.positionals);
    if (parseError !== undefined) {
      parsed.parseError = parseError;
    }
    return parsed;
  }

  applyCommanderGlobalOptions(parsed, program);
  return parsed;
}

function buildCommanderProgram(parsed: ParsedArgs): Command {
  const program = new Command("gla");
  program
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
    .showHelpAfterError(false)
    .showSuggestionAfterError(false)
    .helpOption(false)
    .addHelpCommand(false)
    .option("-o, --output <mode>", "output mode", parseOutputModeOption)
    .option("--fields <a,b,c>", "field mask", parseFieldMaskOption)
    .option("-q, --quiet", "suppress non-result chatter")
    .option("--no-input", "never prompt for interactive input");

  const groups = new Map<string, Command>();
  for (const spec of CLI_COMMANDS) {
    const parent =
      spec.verb === undefined
        ? program
        : (groups.get(spec.noun) ?? createCommandGroup(program, groups, spec.noun));
    const commandSyntax = [
      spec.verb ?? spec.noun,
      ...spec.args.map((arg) => commanderArgSyntax(arg, parsed.help)),
    ].join(" ");
    const command = parent
      .command(commandSyntax)
      .description(spec.summary)
      .allowExcessArguments(false)
      .addHelpCommand(false)
      .helpOption(false);

    const flags = flagDefinitionsForSpec(spec);
    for (const flag of flags) {
      if (flag.repeatable) {
        command.option(flag.commanderSyntax, flag.source, collectRepeatedOption, []);
      } else if (flag.valueRequired) {
        command.option(flag.commanderSyntax, flag.source);
      } else {
        command.option(flag.commanderSyntax, flag.source);
      }
    }

    command.action((...actionArgs: unknown[]) => {
      const commanderCommand = actionArgs.at(-1);
      if (!(commanderCommand instanceof Command)) {
        return;
      }
      const positionals = actionArgs
        .slice(0, -2)
        .filter((value): value is string => typeof value === "string");
      parsed.positionals = [spec.noun, ...(spec.verb ? [spec.verb] : []), ...positionals];
      collectCommandOptions(parsed, spec, commanderCommand);
    });
  }

  return program;
}

function createCommandGroup(program: Command, groups: Map<string, Command>, noun: string): Command {
  const group = program
    .command(noun)
    .description(`${noun} commands`)
    .addHelpCommand(false)
    .helpOption(false);
  groups.set(noun, group);
  return group;
}

function commanderArgSyntax(arg: string, helpRequested: boolean): string {
  if (arg.startsWith("[")) {
    return arg;
  }
  return helpRequested ? `[${arg}]` : `<${arg}>`;
}

function parseOutputModeOption(value: string): OutputMode {
  if (value === "json" || value === "text") {
    return value;
  }
  throw new InvalidArgumentError("expected json or text");
}

function parseFieldMaskOption(value: string): string[] {
  return value
    .split(",")
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
}

function collectRepeatedOption(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function applyCommanderGlobalOptions(parsed: ParsedArgs, program: Command): void {
  const opts = program.opts() as {
    output?: OutputMode;
    fields?: string[];
    quiet?: boolean;
    input?: boolean;
  };
  if (opts.output !== undefined) {
    parsed.output = opts.output;
  }
  if (opts.fields !== undefined) {
    parsed.fields = opts.fields;
  }
  if (opts.quiet === true) {
    parsed.quiet = true;
  }
  if (opts.input === false) {
    // The current CLI never prompts; accept the flag as a no-op so scripts can be explicit.
    parsed.noInput = true;
  }
}

function collectCommandOptions(parsed: ParsedArgs, spec: CliCommandSpec, command: Command): void {
  const opts = command.opts() as Record<string, unknown>;
  for (const flag of flagDefinitionsForSpec(spec)) {
    const value = opts[flag.optionKey];
    if (value === undefined) {
      continue;
    }
    if (flag.repeatable) {
      parsed.repeated.set(
        flag.longName,
        Array.isArray(value) ? value.map(String) : [String(value)],
      );
    } else if (flag.valueRequired) {
      parsed.flags.set(flag.longName, String(value));
    } else if (value === true) {
      parsed.flags.set(flag.longName, true);
    }
  }
}

function hasHelpToken(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "-h" || arg === "--help");
}

function stripHelpTokens(argv: readonly string[]): string[] {
  return argv.filter((arg) => arg !== "-h" && arg !== "--help");
}

function scanDeferredGlobalSurface(
  argv: readonly string[],
): { surface: string; message: string } | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    const [name, equalsValue] = splitEqualsOption(arg);
    if (name === "-o" || name === "--output") {
      const value = equalsValue ?? argv[i + 1];
      if (value === "ndjson") {
        return {
          surface: "output ndjson",
          message: "ndjson output is deferred until streaming commands exist",
        };
      }
      if (equalsValue === undefined && arg !== "--output=ndjson") {
        i++;
      }
      continue;
    }
    if (name === "--context") {
      const value = equalsValue ?? valueAfterOption(argv, i);
      return {
        surface: "--context",
        message: `context selection is deferred; use GLA_ENDPOINT or --endpoint for the current local profile${value ? ` (got "${value}")` : ""}`,
      };
    }
    if (name === "--trace-id") {
      const value = equalsValue ?? valueAfterOption(argv, i);
      return {
        surface: "--trace-id",
        message: `trace correlation is deferred until audit/event support is implemented${value ? ` (got "${value}")` : ""}`,
      };
    }
  }
  return undefined;
}

function valueAfterOption(argv: readonly string[], index: number): string | undefined {
  const next = argv[index + 1];
  return next !== undefined && !next.startsWith("-") ? next : undefined;
}

function splitEqualsOption(arg: string): [name: string, value: string | undefined] {
  const eq = arg.indexOf("=");
  if (eq < 0) {
    return [arg, undefined];
  }
  return [arg.slice(0, eq), arg.slice(eq + 1)];
}

function parseErrorForCommander(
  error: unknown,
  argv: readonly string[],
  positionals: string[],
): CliParseError | undefined {
  if (!isCommanderParseError(error)) {
    return undefined;
  }
  const command = commandSpecForPositionals(positionals);
  switch (error.code) {
    case "commander.help":
    case "commander.unknownCommand": {
      if (positionals[0] === "help") {
        const flag = firstUnsupportedHelpAliasFlag(argv);
        return flag === undefined ? undefined : badFlagParseError(flag, undefined);
      }
      return undefined;
    }
    case "commander.unknownOption":
    case "commander.invalidArgument": {
      const flag = extractFlagFromCommanderMessage(error.message) ?? firstUnknownFlag(argv);
      return badFlagParseError(flag ?? error.message, command);
    }
    case "commander.optionMissingArgument": {
      const flag = extractFlagFromCommanderMessage(error.message) ?? firstUnknownFlag(argv);
      return missingValueParseError(flag ?? error.message, command);
    }
    case "commander.missingArgument":
    case "commander.excessArguments": {
      const unexpectedBooleanValues =
        command === undefined ? [] : unexpectedBooleanValueFlags(argv, command.spec);
      if (command !== undefined && unexpectedBooleanValues.length > 0) {
        return unexpectedBooleanValueParseError(unexpectedBooleanValues, command);
      }
      return command === undefined ? undefined : badArgumentParseError(command, positionals);
    }
    default:
      return undefined;
  }
}

function missingValueBeforeCommander(
  argv: readonly string[],
  positionals: string[],
): CliParseError | undefined {
  const command = commandSpecForPositionals(positionals);
  const valueFlags = new Map<string, string>();
  valueFlags.set("-o", "-o");
  valueFlags.set("--output", "--output");
  valueFlags.set("--fields", "--fields");
  if (command !== undefined) {
    for (const flag of flagDefinitionsForSpec(command.spec)) {
      if (!flag.valueRequired) {
        continue;
      }
      valueFlags.set(`--${flag.longName}`, `--${flag.longName}`);
      if (flag.shortName !== undefined) {
        valueFlags.set(flag.shortName, flag.shortName);
      }
    }
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || arg === "--") {
      continue;
    }
    const [name, inlineValue] = splitEqualsOption(arg);
    const flag = valueFlags.get(name);
    if (flag === undefined || inlineValue !== undefined) {
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("-")) {
      return missingValueParseError(flag, command);
    }
  }
  return undefined;
}

function firstUnsupportedHelpAliasFlag(argv: readonly string[]): string | undefined {
  const allowed = new Set(["-o", "--output", "--fields", "-q", "--quiet", "--no-input"]);
  for (const arg of argv) {
    if (!arg.startsWith("-") || arg === "--") {
      continue;
    }
    const [name] = splitEqualsOption(arg);
    if (!allowed.has(name)) {
      return name;
    }
  }
  return undefined;
}

function isCommanderParseError(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    typeof (error as { message: unknown }).message === "string"
  );
}

function extractFlagFromCommanderMessage(message: string): string | undefined {
  const option = message.match(/option '([^']+)'/);
  const unknown = message.match(/unknown option '([^']+)'/);
  const value = option?.[1] ?? unknown?.[1];
  return value?.split(/[,\s]/)[0];
}

function firstUnknownFlag(argv: readonly string[]): string | undefined {
  return argv.find((arg) => arg.startsWith("-") && arg !== "--");
}

function commandSpecForPositionals(
  positionals: string[],
): { spec: CliCommandSpec; argStart: number; command: string } | undefined {
  const [noun, verb] = positionals;
  if (noun === undefined) {
    return undefined;
  }
  const exact = commandSpecForParsedArgs(noun, verb);
  if (exact !== undefined) {
    return exact;
  }
  const root = findCommandSpec(noun, undefined);
  if (root === undefined) {
    return undefined;
  }
  return { spec: root, argStart: 1, command: `gla ${root.noun}` };
}

function badFlagParseError(
  flag: string,
  command: { spec: CliCommandSpec; command: string } | undefined,
): CliParseError {
  if (command === undefined) {
    return {
      code: "usage.bad_flag",
      message: `unknown or invalid flag: ${flag}`,
      detail: { flags: [flag], flag },
    };
  }
  const allowed = [...allowedFlagNames(command.spec)].map((f) => `--${f}`);
  return {
    code: "usage.bad_flag",
    message: `unsupported flag(s) for ${command.command}: ${flag}`,
    detail: { flags: [flag], allowed_flags: allowed },
  };
}

function missingValueParseError(
  flag: string,
  command: { spec: CliCommandSpec; command: string } | undefined,
): CliParseError {
  if (command === undefined) {
    return {
      code: "usage.bad_flag",
      message: `missing value for flag: ${flag}`,
      detail: { flags: [flag], missing_values: [flag] },
    };
  }
  return {
    code: "usage.bad_flag",
    message: `missing value for flag(s) on ${command.command}: ${flag}`,
    detail: {
      flags: [flag],
      missing_values: [flag],
      allowed_flags: [...allowedFlagNames(command.spec)].map((f) => `--${f}`),
    },
  };
}

function badArgumentParseError(
  command: { spec: CliCommandSpec; argStart: number; command: string },
  positionals: string[],
): CliParseError {
  const supplied = positionals.slice(command.argStart);
  const min = requiredArgCount(command.spec);
  const max = command.spec.args.length;
  return {
    code: "usage.bad_argument",
    message: `bad arguments for ${command.command}: expected ${usageTextForSpec(command.spec)}`,
    detail: {
      command: command.command,
      expected: command.spec.args,
      supplied,
      min_args: min,
      max_args: max,
    },
  };
}

function unexpectedBooleanValueParseError(
  flags: string[],
  command: { spec: CliCommandSpec; command: string },
): CliParseError {
  return {
    code: "usage.bad_flag",
    message: `unexpected value for flag(s) on ${command.command}: ${flags.join(", ")}`,
    detail: {
      flags,
      unexpected_values: flags,
      allowed_flags: [...allowedFlagNames(command.spec)].map((f) => `--${f}`),
    },
  };
}

function unexpectedBooleanValueFlags(argv: readonly string[], spec: CliCommandSpec): string[] {
  const flags = flagDefinitionsForSpec(spec).filter((flag) => !flag.valueRequired);
  const names = new Map<string, FlagDefinition>();
  for (const flag of flags) {
    names.set(`--${flag.longName}`, flag);
    if (flag.shortName !== undefined) {
      names.set(flag.shortName, flag);
    }
  }
  const unexpected: string[] = [];
  for (let i = 0; i < argv.length - 1; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    const [name, equalsValue] = splitEqualsOption(arg);
    const flag = names.get(name);
    if (flag === undefined) {
      continue;
    }
    const next = equalsValue ?? argv[i + 1];
    if (next !== undefined && !next.startsWith("-")) {
      unexpected.push(`--${flag.longName}`);
    }
  }
  return [...new Set(unexpected)];
}

function extractCommandTokens(argv: readonly string[]): string[] {
  const positionals: string[] = [];
  const valueFlags = allValueFlagAliases();
  let optionsEnded = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
      continue;
    }
    if (optionsEnded) {
      positionals.push(arg);
      continue;
    }
    if (arg.startsWith("-")) {
      const [name, inlineValue] = splitEqualsOption(arg);
      if (inlineValue === undefined && valueFlags.has(name)) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          i++;
        }
      }
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

function allValueFlagAliases(): Set<string> {
  const aliases = new Set(["-o", "--output", "--fields", "--endpoint", "--context", "--trace-id"]);
  for (const spec of CLI_COMMANDS) {
    for (const flag of flagDefinitionsForSpec(spec)) {
      if (!flag.valueRequired) {
        continue;
      }
      aliases.add(`--${flag.longName}`);
      if (flag.shortName !== undefined) {
        aliases.add(flag.shortName);
      }
    }
  }
  return aliases;
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
  const preflight = validateParsedArgsBeforeDispatch(parsed, out);
  if (preflight !== undefined) return preflight;

  const [noun, verb] = parsed.positionals;

  try {
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
        if (verb === "list") {
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
        if (verb === "show") {
          const id = parsed.positionals[2];
          if (id === undefined) return usageError(out, "usage: gla catalog show <id>");
          return emitCommandResult(
            parsed,
            out,
            "catalog",
            "show",
            await services.bridge.catalogShow(id),
          );
        }
        return usageError(out, "usage: gla catalog (list [--kind <k>] [--available] | show <id>)");
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

      case "provider": {
        if (verb === "scaffold") {
          return providerScaffold(parsed, out);
        }
        if (verb === "validate") {
          return providerValidate(parsed, out);
        }
        if (verb === "test") {
          return providerTest(parsed, out);
        }
        if (verb === "inspect") {
          return providerInspect(parsed, out);
        }
        return usageError(
          out,
          "usage: gla provider (scaffold | validate <path> | test <path> | inspect <path>)",
        );
      }

      case "template-package": {
        if (verb === "scaffold") {
          return templatePackageScaffold(parsed, out);
        }
        if (verb === "validate") {
          return templatePackageValidate(parsed, out);
        }
        if (verb === "test") {
          return templatePackageTest(parsed, out);
        }
        if (verb === "inspect") {
          return templatePackageInspect(parsed, out);
        }
        return usageError(
          out,
          "usage: gla template-package (scaffold | validate <path> | test <path> | inspect <path>)",
        );
      }

      case "provider-install": {
        if (verb === "plan") {
          return providerInstallPlan(parsed, out);
        }
        if (verb === "apply") {
          return providerInstallApply(parsed, out);
        }
        if (verb === "rollback") {
          return providerInstallRollback(parsed, out);
        }
        return usageError(
          out,
          "usage: gla provider-install (plan <path> [--state <path>] | apply <path> --state <path> | rollback <snapshot> --state <path>)",
        );
      }

      case "doctor": {
        if (verb === "provider-graph") {
          return providerGraphDoctor(parsed, out);
        }
        return usageError(out, "usage: gla doctor provider-graph <path>");
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

/** Validate parse/usage failures that must happen before any bridge or daemon connection. */
export function preflightUsage(argv: readonly string[], out: Output): number | undefined {
  return validateParsedArgsBeforeDispatch(parseArgs(argv), out);
}

function validateParsedArgsBeforeDispatch(parsed: ParsedArgs, out: Output): number | undefined {
  if (parsed.parseError !== undefined) {
    out.fail({
      code: parsed.parseError.code,
      message: parsed.parseError.message,
      detail: parsed.parseError.detail,
      skill: "interpret-gla-rejections",
      retryable: false,
    });
    return ExitCode.USAGE;
  }
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

  if (noun === undefined) {
    const rootInputError = validateNoCommandInputs(parsed, out, "gla");
    if (rootInputError !== undefined) {
      return rootInputError;
    }
  }
  if (noun === "help") {
    const helpAliasError = validateHelpAlias(parsed, out);
    if (helpAliasError !== undefined) {
      return helpAliasError;
    }
  }

  // `gla --help` / `gla -h` / `gla help` / bare `gla` -> usage on stdout, success.
  if (parsed.help || noun === undefined || noun === "help") {
    const helpScopeError = validateHelpScope(parsed, out, noun, verb);
    if (helpScopeError !== undefined) {
      return helpScopeError;
    }
    const helpContractError = validateHelpContractInputs(parsed, out, noun, verb);
    if (helpContractError !== undefined) {
      return helpContractError;
    }
    const scopeNoun = noun === "help" ? undefined : noun;
    out.emit(schemaPayload(scopeNoun, scopeNoun === undefined ? undefined : verb), () =>
      usageText(scopeNoun, scopeNoun === undefined ? undefined : verb),
    );
    return ExitCode.OK;
  }

  const deferred = findDeferredCliSurface(noun, verb);
  if (deferred !== undefined) {
    return unsupportedError(out, deferred.surface, deferred.message);
  }
  const argError = validateCommandArgs(parsed, out, noun, verb);
  if (argError !== undefined) {
    return argError;
  }
  const flagError = validateCommandFlags(parsed, out, noun, verb);
  if (flagError !== undefined) {
    return flagError;
  }
  return validateFieldMask(parsed, out, noun, verb);
}

function schemaScopeExists(noun: string, verb?: string): boolean {
  if (verb !== undefined) {
    return findCommandSpec(noun, verb) !== undefined;
  }
  return commandSpecsForNoun(noun).length > 0;
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

function validateNoCommandInputs(
  parsed: ParsedArgs,
  out: Output,
  command: string,
): number | undefined {
  const flags = [...parsed.flags.keys(), ...parsed.repeated.keys()];
  if (flags.length > 0) {
    out.fail({
      code: "usage.bad_flag",
      message: `command-scoped flag(s) require a command: ${flags.map((f) => `--${f}`).join(", ")}`,
      detail: {
        flags: flags.map((f) => `--${f}`),
        ...(parsed.missingValueFlags.length > 0
          ? { missing_values: parsed.missingValueFlags.map((f) => `--${f}`) }
          : {}),
      },
      skill: "interpret-gla-rejections",
      retryable: false,
    });
    return ExitCode.USAGE;
  }
  if (parsed.fields !== undefined && parsed.fields.length > 0) {
    out.fail({
      code: "usage.bad_field",
      message: `--fields is not supported on ${command} without a current executable command scope`,
      detail: { fields: parsed.fields, allowed_fields: [] },
      skill: "interpret-gla-rejections",
      retryable: false,
    });
    return ExitCode.USAGE;
  }
  return undefined;
}

function validateHelpAlias(parsed: ParsedArgs, out: Output): number | undefined {
  const inputError = validateNoCommandInputs(parsed, out, "gla help");
  if (inputError !== undefined) {
    return inputError;
  }
  const supplied = parsed.positionals.slice(1);
  if (supplied.length === 0) {
    return undefined;
  }
  out.fail({
    code: "usage.bad_argument",
    message: "bad arguments for gla help: expected gla help",
    detail: {
      command: "gla help",
      expected: [],
      supplied,
      min_args: 0,
      max_args: 0,
    },
    skill: "interpret-gla-rejections",
    retryable: false,
  });
  return ExitCode.USAGE;
}

function validateHelpScope(
  parsed: ParsedArgs,
  out: Output,
  noun: string | undefined,
  verb: string | undefined,
): number | undefined {
  if (noun === undefined || noun === "help") {
    return undefined;
  }
  const deferred = findDeferredCliSurface(noun, verb);
  if (deferred !== undefined) {
    return unsupportedError(out, deferred.surface, deferred.message);
  }
  if (noun === "schema") {
    const schemaNoun = verb;
    const schemaVerb = parsed.positionals[2];
    if (schemaNoun !== undefined && !schemaScopeExists(schemaNoun, schemaVerb)) {
      return usageError(
        out,
        `unknown schema scope: ${schemaNoun}${schemaVerb ? ` ${schemaVerb}` : ""}`,
      );
    }
    return undefined;
  }
  const nounCommands = commandSpecsForNoun(noun);
  if (nounCommands.length === 0) {
    return usageError(out, `unknown command: '${noun}'`);
  }
  if (verb !== undefined && findCommandSpec(noun, verb) === undefined) {
    return usageError(out, `unknown command: '${noun} ${verb}'`);
  }
  return undefined;
}

function validateHelpContractInputs(
  parsed: ParsedArgs,
  out: Output,
  noun: string | undefined,
  verb: string | undefined,
): number | undefined {
  if (noun === undefined || noun === "help") {
    return undefined;
  }
  const argError = validateCommandArgs(parsed, out, noun, verb, { allowMissingRequired: true });
  if (argError !== undefined) {
    return argError;
  }
  const flagError = validateCommandFlags(parsed, out, noun, verb);
  if (flagError !== undefined) {
    return flagError;
  }
  return validateFieldMask(parsed, out, noun, verb);
}

function commandSpecForParsedArgs(
  noun: string,
  verb: string | undefined,
): { spec: CliCommandSpec; argStart: number; command: string } | undefined {
  if (noun === "schema") {
    const spec = findCommandSpec("schema", undefined);
    return spec === undefined ? undefined : { spec, argStart: 1, command: "gla schema" };
  }
  const spec = findCommandSpec(noun, verb);
  if (spec === undefined) {
    return undefined;
  }
  return {
    spec,
    argStart: spec.verb === undefined ? 1 : 2,
    command: ["gla", spec.noun, spec.verb].filter(Boolean).join(" "),
  };
}

function requiredArgCount(spec: CliCommandSpec): number {
  return spec.args.filter((arg) => !arg.startsWith("[")).length;
}

function usageTextForSpec(spec: CliCommandSpec): string {
  return ["gla", spec.noun, spec.verb, ...spec.args].filter(Boolean).join(" ");
}

function validateCommandArgs(
  parsed: ParsedArgs,
  out: Output,
  noun: string,
  verb: string | undefined,
  opts: { allowMissingRequired?: boolean } = {},
): number | undefined {
  const command = commandSpecForParsedArgs(noun, verb);
  if (command === undefined) {
    return undefined;
  }
  const supplied = parsed.positionals.slice(command.argStart);
  const min = requiredArgCount(command.spec);
  const max = command.spec.args.length;
  const minimumSatisfied = opts.allowMissingRequired === true || supplied.length >= min;
  if (minimumSatisfied && supplied.length <= max) {
    return undefined;
  }
  const detail: Record<string, unknown> = {
    command: command.command,
    expected: command.spec.args,
    supplied,
    min_args: min,
    max_args: max,
  };
  out.fail({
    code: "usage.bad_argument",
    message: `bad arguments for ${command.command}: expected ${usageTextForSpec(command.spec)}`,
    detail,
    skill: "interpret-gla-rejections",
    retryable: false,
  });
  return ExitCode.USAGE;
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
  const spec =
    noun === "schema" ? findCommandSpec("schema", undefined) : findCommandSpec(noun, verb);
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
  return new Set(flagDefinitionsForSpec(spec).map((flag) => flag.longName));
}

function valueRequiredFlagNames(spec: CliCommandSpec): Set<string> {
  return new Set(
    flagDefinitionsForSpec(spec)
      .filter((flag) => flag.valueRequired)
      .map((flag) => flag.longName),
  );
}

function flagDefinitionsForSpec(spec: CliCommandSpec): FlagDefinition[] {
  const repeatable = new Set(spec.repeatableFlags ?? []);
  return spec.flags.map((source) => flagDefinitionFromContract(source, repeatable));
}

function flagDefinitionFromContract(source: string, repeatable: Set<string>): FlagDefinition {
  const [aliases = source, valueToken] = source.split(/\s+/, 2);
  const parts = aliases.split("/");
  const shortName = parts.find((part) => /^-[a-zA-Z]$/.test(part));
  const longAlias = parts.find((part) => part.startsWith("--"));
  if (longAlias === undefined) {
    throw new Error(`CLI command contract flag is missing a long name: ${source}`);
  }
  const longName = longAlias.slice(2);
  const valueRequired = valueToken?.startsWith("<") === true;
  return {
    source,
    commanderSyntax: `${aliases.replace("/", ", ")}${valueToken ? ` ${valueToken}` : ""}`,
    longName,
    shortName,
    valueRequired,
    repeatable: repeatable.has(longName),
    optionKey: commanderOptionKey(longName),
  };
}

function commanderOptionKey(longName: string): string {
  return longName.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
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

const AUTHORING_RUNTIME_FAMILIES = new Set<ProviderAuthoringRuntimeFamily>([
  "auth",
  "launcher",
  "entrypoint",
  "connector",
  "workspace",
  "detector",
  "channel",
  "secret-store",
]);

function requiredStringFlag(parsed: ParsedArgs, flag: string, usage: string): string {
  const value = parsed.flags.get(flag);
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw glaError("usage.bad_argument", usage, { detail: { flag: `--${flag}` } });
}

function optionalStringFlag(parsed: ParsedArgs, flag: string): string | undefined {
  const value = parsed.flags.get(flag);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseAuthoringFamily(value: string): ProviderAuthoringRuntimeFamily {
  if (AUTHORING_RUNTIME_FAMILIES.has(value as ProviderAuthoringRuntimeFamily)) {
    return value as ProviderAuthoringRuntimeFamily;
  }
  throw glaError("usage.bad_argument", `unsupported provider family: ${value}`, {
    detail: { family: value, supported: [...AUTHORING_RUNTIME_FAMILIES] },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAuthoringJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw glaError("usage.bad_argument", `cannot read authoring file "${path}": ${String(e)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw glaError("usage.bad_argument", `authoring file "${path}" is not valid JSON`);
  }
}

function readOperatorJson(path: string, purpose: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw glaError("usage.bad_argument", `cannot read ${purpose} file "${path}": ${String(e)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw glaError("usage.bad_argument", `${purpose} file "${path}" is not valid JSON`);
  }
}

function readOptionalInstallState(
  path: string | undefined,
): ProviderInstallInventoryInput | undefined {
  if (path === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ProviderInstallInventoryInput;
  } catch (e) {
    if (isRecord(e) && e.code === "ENOENT") {
      return {};
    }
    throw glaError(
      "usage.bad_argument",
      `cannot read provider install state "${path}": ${String(e)}`,
    );
  }
}

function writeInstallState(path: string, state: ProviderInstallInventoryInput): void {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function installPlanInputFromDoc(
  doc: unknown,
  activeOverride?: ProviderInstallInventoryInput,
): { active?: ProviderInstallInventoryInput; candidate?: ProviderInstallInventoryInput } {
  if (isRecord(doc) && isRecord(doc.candidate)) {
    const active =
      activeOverride ??
      (isRecord(doc.active) ? (doc.active as ProviderInstallInventoryInput) : undefined);
    return {
      ...(active !== undefined ? { active } : {}),
      candidate: doc.candidate as ProviderInstallInventoryInput,
    };
  }
  return {
    ...(activeOverride !== undefined ? { active: activeOverride } : {}),
    candidate: doc as ProviderInstallInventoryInput,
  };
}

function isAuthoringWorkspace(doc: unknown): doc is ProviderAuthoringWorkspaceInput {
  return isRecord(doc) && (Array.isArray(doc.providers) || Array.isArray(doc.templatePackages));
}

function manifestKind(doc: unknown): string | undefined {
  return isRecord(doc) && isRecord(doc.manifest) && typeof doc.manifest.kind === "string"
    ? doc.manifest.kind
    : undefined;
}

function manifestVersion(doc: unknown): string | undefined {
  return isRecord(doc) &&
    isRecord(doc.manifest) &&
    isRecord(doc.manifest.metadata) &&
    typeof doc.manifest.metadata.version === "string"
    ? doc.manifest.metadata.version
    : undefined;
}

function providerManifestId(doc: unknown): string | undefined {
  return isRecord(doc) &&
    isRecord(doc.manifest) &&
    isRecord(doc.manifest.metadata) &&
    typeof doc.manifest.metadata.name === "string"
    ? doc.manifest.metadata.name
    : undefined;
}

function providerManifestFamily(doc: unknown): string | undefined {
  return isRecord(doc) &&
    isRecord(doc.manifest) &&
    isRecord(doc.manifest.spec) &&
    typeof doc.manifest.spec.family === "string"
    ? doc.manifest.spec.family
    : undefined;
}

function templatePackageId(doc: unknown): string | undefined {
  return isRecord(doc) &&
    isRecord(doc.manifest) &&
    isRecord(doc.manifest.metadata) &&
    typeof doc.manifest.metadata.name === "string"
    ? doc.manifest.metadata.name
    : undefined;
}

function templateIds(doc: unknown): string[] {
  if (
    !isRecord(doc) ||
    !isRecord(doc.manifest) ||
    !isRecord(doc.manifest.spec) ||
    !Array.isArray(doc.manifest.spec.templates)
  ) {
    return [];
  }
  return doc.manifest.spec.templates.flatMap((template) =>
    isRecord(template) && isRecord(template.metadata) && typeof template.metadata.name === "string"
      ? [template.metadata.name]
      : [],
  );
}

function providerManifestSpec(doc: unknown): Record<string, unknown> | undefined {
  return isRecord(doc) && isRecord(doc.manifest) && isRecord(doc.manifest.spec)
    ? doc.manifest.spec
    : undefined;
}

function templatePackageSpec(doc: unknown): Record<string, unknown> | undefined {
  return providerManifestSpec(doc);
}

function templateSummaries(doc: unknown): Array<Record<string, unknown>> {
  const spec = templatePackageSpec(doc);
  const templates = Array.isArray(spec?.templates) ? spec.templates : [];
  return templates.flatMap((template) => {
    if (!isRecord(template) || !isRecord(template.metadata) || !isRecord(template.spec)) {
      return [];
    }
    return [
      {
        id: template.metadata.name,
        version: template.metadata.version,
        kind: template.kind,
        requiredParts: template.spec.requiredParts,
        openParts: template.spec.openParts,
        compatibleProviders: template.spec.compatibleProviders,
      },
    ];
  });
}

function defaultAuthoringProviders(): ProviderManifest[] {
  return Object.values(PROVIDER_MANIFESTS);
}

function providerReportFromDoc(doc: unknown): AuthoringReport {
  if (isAuthoringWorkspace(doc)) {
    return validateProviderAuthoringWorkspace(doc);
  }
  if (manifestKind(doc) === "TemplatePackage") {
    throw glaError(
      "usage.bad_argument",
      "provider authoring command received a TemplatePackage; use gla template-package validate/test/inspect",
    );
  }
  return validateProviderPackageAuthoring(doc as ProviderPackageAuthoringInput);
}

function templatePackageReportFromDoc(doc: unknown): AuthoringReport {
  if (isAuthoringWorkspace(doc)) {
    return validateProviderAuthoringWorkspace(doc);
  }
  if (manifestKind(doc) !== "TemplatePackage") {
    throw glaError(
      "usage.bad_argument",
      "template-package command expects a TemplatePackage authoring JSON file",
    );
  }
  const templatePackage = doc as TemplatePackageAuthoringInput;
  const providers = templatePackage.providers ?? defaultAuthoringProviders();
  return validateTemplatePackageAuthoring({
    ...templatePackage,
    providers,
  });
}

function emitAuthoringReport(
  parsed: ParsedArgs,
  out: Output,
  noun: string,
  verb: string,
  report: AuthoringReport,
): number {
  const code = emitCommandResult(parsed, out, noun, verb, report);
  return code === ExitCode.OK && !report.ok ? ExitCode.USAGE : code;
}

function providerScaffold(parsed: ParsedArgs, out: Output): number {
  const family = parseAuthoringFamily(
    requiredStringFlag(parsed, "family", "provider scaffold requires --family <family>"),
  );
  const providerId = requiredStringFlag(
    parsed,
    "id",
    "provider scaffold requires --id <provider-id>",
  );
  const version = optionalStringFlag(parsed, "version");
  const summary = optionalStringFlag(parsed, "summary");
  const skeleton = createProviderPackageSkeleton({
    providerId,
    family,
    ...(version !== undefined ? { version } : {}),
    ...(summary !== undefined ? { summary } : {}),
  });
  return emitCommandResult(parsed, out, "provider", "scaffold", skeleton);
}

function providerValidate(parsed: ParsedArgs, out: Output): number {
  const path = parsed.positionals[2];
  if (path === undefined) {
    return usageError(out, "usage: gla provider validate <path>");
  }
  return emitAuthoringReport(
    parsed,
    out,
    "provider",
    "validate",
    providerReportFromDoc(readAuthoringJson(path)),
  );
}

function providerContractTests(doc: unknown): unknown[] {
  return isRecord(doc) && Array.isArray(doc.contractTests) ? doc.contractTests : [];
}

function templateContractTests(doc: unknown): unknown[] {
  const spec = templatePackageSpec(doc);
  return Array.isArray(spec?.tests) ? spec.tests : [];
}

function authoringTestReport(
  report: AuthoringReport,
  declaredContractTests: readonly unknown[],
): Record<string, unknown> {
  return {
    ok: report.ok,
    harness: "authoring-contract-preflight",
    declaredContractTests,
    externalContractTests: "not-executed",
    validation: report,
    tests: [
      {
        id: "authoring-validation",
        status: report.ok ? "passed" : "failed",
        diagnostics: report.diagnostics,
      },
    ],
  };
}

function providerTest(parsed: ParsedArgs, out: Output): number {
  const path = parsed.positionals[2];
  if (path === undefined) {
    return usageError(out, "usage: gla provider test <path>");
  }
  const doc = readAuthoringJson(path);
  const report = providerReportFromDoc(doc);
  const code = emitCommandResult(
    parsed,
    out,
    "provider",
    "test",
    authoringTestReport(report, providerContractTests(doc)),
  );
  return code === ExitCode.OK && !report.ok ? ExitCode.USAGE : code;
}

function providerInspect(parsed: ParsedArgs, out: Output): number {
  const path = parsed.positionals[2];
  if (path === undefined) {
    return usageError(out, "usage: gla provider inspect <path>");
  }
  const doc = readAuthoringJson(path);
  const report = providerReportFromDoc(doc);
  const spec = providerManifestSpec(doc);
  return emitCommandResult(parsed, out, "provider", "inspect", {
    kind: isAuthoringWorkspace(doc) ? "ProviderAuthoringWorkspace" : "ProviderPackage",
    providerId: providerManifestId(doc),
    family: providerManifestFamily(doc),
    version: manifestVersion(doc),
    ok: report.ok,
    diagnostics: report.diagnostics,
    readiness: "readiness" in report ? report.readiness : undefined,
    changedFiles: isRecord(doc) && Array.isArray(doc.changedFiles) ? doc.changedFiles : undefined,
    capability: spec?.capability,
    configSchema: spec?.config_schema,
    factoryConfigSchema: spec?.factory_config_schema,
    requirements: spec?.requires,
    skills: spec?.skills,
    docs: isRecord(doc) && Array.isArray(doc.docs) ? doc.docs : undefined,
    contractTests: providerContractTests(doc),
    module: isRecord(doc) && isRecord(doc.module) ? doc.module : undefined,
    wpmSkeletons: isRecord(doc) && Array.isArray(doc.wpmSkeletons) ? doc.wpmSkeletons : undefined,
  });
}

function parseOpenParts(value: string | undefined): string[] {
  if (value === undefined) {
    return ["entrypoint", "connector", "workspace", "detector"];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function templateRequiredParts(parsed: ParsedArgs): Record<string, string> {
  return {
    launcher: optionalStringFlag(parsed, "launcher") ?? "launcher-process",
    entrypoint: optionalStringFlag(parsed, "entrypoint") ?? "entrypoint-novnc",
    connector: optionalStringFlag(parsed, "connector") ?? "connector-cdp",
    workspace: optionalStringFlag(parsed, "workspace") ?? "workspace-profile",
    detector: optionalStringFlag(parsed, "detector") ?? "url-watcher",
  };
}

function compatibleProvidersForOpenParts(
  requiredParts: Record<string, string>,
  openParts: readonly string[],
): Record<string, string[]> {
  return Object.fromEntries(
    openParts.flatMap((part) => {
      const providerId = requiredParts[part];
      return providerId === undefined ? [] : [[part, [providerId]]];
    }),
  );
}

function templatePackageScaffold(parsed: ParsedArgs, out: Output): number {
  const packageId = requiredStringFlag(
    parsed,
    "id",
    "template-package scaffold requires --id <package-id>",
  );
  const templateId = optionalStringFlag(parsed, "template") ?? packageId;
  const requiredParts = templateRequiredParts(parsed);
  const openParts = parseOpenParts(optionalStringFlag(parsed, "open-parts"));
  const version = optionalStringFlag(parsed, "version");
  const summary = optionalStringFlag(parsed, "summary");
  const skeleton = createTemplatePackageSkeleton({
    packageId,
    templateId,
    requiredParts,
    openParts,
    compatibleProviders: compatibleProvidersForOpenParts(requiredParts, openParts),
    ...(version !== undefined ? { version } : {}),
    ...(summary !== undefined ? { summary } : {}),
  });
  return emitCommandResult(parsed, out, "template-package", "scaffold", skeleton);
}

function templatePackageValidate(parsed: ParsedArgs, out: Output): number {
  const path = parsed.positionals[2];
  if (path === undefined) {
    return usageError(out, "usage: gla template-package validate <path>");
  }
  return emitAuthoringReport(
    parsed,
    out,
    "template-package",
    "validate",
    templatePackageReportFromDoc(readAuthoringJson(path)),
  );
}

function templatePackageTest(parsed: ParsedArgs, out: Output): number {
  const path = parsed.positionals[2];
  if (path === undefined) {
    return usageError(out, "usage: gla template-package test <path>");
  }
  const doc = readAuthoringJson(path);
  const report = templatePackageReportFromDoc(doc);
  const code = emitCommandResult(
    parsed,
    out,
    "template-package",
    "test",
    authoringTestReport(report, templateContractTests(doc)),
  );
  return code === ExitCode.OK && !report.ok ? ExitCode.USAGE : code;
}

function templatePackageInspect(parsed: ParsedArgs, out: Output): number {
  const path = parsed.positionals[2];
  if (path === undefined) {
    return usageError(out, "usage: gla template-package inspect <path>");
  }
  const doc = readAuthoringJson(path);
  const report = templatePackageReportFromDoc(doc);
  const spec = templatePackageSpec(doc);
  return emitCommandResult(parsed, out, "template-package", "inspect", {
    kind: isAuthoringWorkspace(doc) ? "ProviderAuthoringWorkspace" : "TemplatePackage",
    packageId: templatePackageId(doc),
    templateIds: templateIds(doc),
    version: manifestVersion(doc),
    ok: report.ok,
    diagnostics: report.diagnostics,
    readiness: "readiness" in report ? report.readiness : undefined,
    changedFiles: isRecord(doc) && Array.isArray(doc.changedFiles) ? doc.changedFiles : undefined,
    defaults: spec?.defaults,
    compatibility: spec?.compatibility,
    templates: templateSummaries(doc),
    docs: Array.isArray(spec?.docs) ? spec.docs : undefined,
    tests: templateContractTests(doc),
    wpmSkeletons: isRecord(doc) && Array.isArray(doc.wpmSkeletons) ? doc.wpmSkeletons : undefined,
  });
}

function providerInstallPlan(parsed: ParsedArgs, out: Output): number {
  const path = parsed.positionals[2];
  if (path === undefined) {
    return usageError(out, "usage: gla provider-install plan <path> [--state <path>]");
  }
  const state = optionalStringFlag(parsed, "state");
  const plan = planProviderInstallUpdate(
    installPlanInputFromDoc(
      readOperatorJson(path, "provider install candidate"),
      readOptionalInstallState(state),
    ),
  );
  const code = emitCommandResult(parsed, out, "provider-install", "plan", plan);
  return code === ExitCode.OK && !plan.ok ? ExitCode.USAGE : code;
}

function providerInstallApply(parsed: ParsedArgs, out: Output): number {
  const path = parsed.positionals[2];
  if (path === undefined) {
    return usageError(out, "usage: gla provider-install apply <path> --state <path>");
  }
  const statePath = requiredStringFlag(
    parsed,
    "state",
    "provider-install apply requires --state <path>",
  );
  const planInput = installPlanInputFromDoc(
    readOperatorJson(path, "provider install candidate"),
    readOptionalInstallState(statePath),
  );
  const result = applyProviderInstallUpdate(planInput);
  if (result.ok) {
    writeInstallState(statePath, planInput.candidate ?? {});
  }
  const code = emitCommandResult(parsed, out, "provider-install", "apply", result);
  return code === ExitCode.OK && !result.ok ? ExitCode.USAGE : code;
}

function snapshotFromDoc(doc: unknown): ProviderInstallRollbackSnapshot {
  if (isRecord(doc) && isRecord(doc.rollbackSnapshot)) {
    return doc.rollbackSnapshot as unknown as ProviderInstallRollbackSnapshot;
  }
  if (
    isRecord(doc) &&
    Object.hasOwn(doc, "snapshotId") &&
    Object.hasOwn(doc, "inventory") &&
    Object.hasOwn(doc, "summary")
  ) {
    return doc as unknown as ProviderInstallRollbackSnapshot;
  }
  throw glaError("usage.bad_argument", "provider install rollback snapshot is invalid", {
    detail: {
      required: ["snapshotId", "inventory", "summary"],
    },
    retryable: false,
  });
}

function providerInstallRollback(parsed: ParsedArgs, out: Output): number {
  const path = parsed.positionals[2];
  if (path === undefined) {
    return usageError(out, "usage: gla provider-install rollback <snapshot> --state <path>");
  }
  const statePath = requiredStringFlag(
    parsed,
    "state",
    "provider-install rollback requires --state <path>",
  );
  const result = rollbackProviderInstallUpdate(
    snapshotFromDoc(readOperatorJson(path, "provider install rollback snapshot")),
  );
  writeInstallState(statePath, result.restoredInventory);
  return emitCommandResult(parsed, out, "provider-install", "rollback", result);
}

function providerGraphDoctor(parsed: ParsedArgs, out: Output): number {
  const path = parsed.positionals[2];
  if (path === undefined) {
    return usageError(out, "usage: gla doctor provider-graph <path>");
  }
  return emitCommandResult(
    parsed,
    out,
    "doctor",
    "provider-graph",
    doctorProviderInstallInventory(
      readOperatorJson(path, "provider install state") as ProviderInstallInventoryInput,
    ),
  );
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
  const structural = validateAssembly(doc);
  if (!structural.ok) {
    const error = assemblyDefectsToError(structural.defects);
    throw glaError(error.code, error.message, {
      ...(error.detail !== undefined ? { detail: error.detail } : {}),
      ...(error.skill !== undefined ? { skill: error.skill } : {}),
      ...(error.retryable !== undefined ? { retryable: error.retryable } : {}),
    });
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
