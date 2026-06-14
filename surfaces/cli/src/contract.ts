import { ExitCode } from "./exit-codes.js";

/** Whether a CLI command only reads state, mutates state, or blocks while waiting for a result. */
export type CliCommandEffect = "read" | "mutates" | "blocks";

/** Machine-readable contract for one currently executable CLI leaf command. */
export interface CliCommandSpec {
  noun: string;
  verb?: string;
  summary: string;
  args: string[];
  flags: string[];
  output: string;
  fields: string[];
  exitCodes: number[];
  effect: CliCommandEffect;
}

/** Machine-readable contract for a documented but intentionally deferred CLI surface. */
export interface DeferredCliSurface {
  surface: string;
  reason: string;
  followUp: string;
}

/** Supported global flags for the current executable contract. */
export const CURRENT_GLOBAL_FLAGS = [
  "-o/--output json|text",
  "--fields <a,b,c>",
  "-q/--quiet",
  "--endpoint <path|host:port>",
  "--no-input",
  "-h/--help",
] as const;

/** Documented future/deferred surfaces that must fail with stable unsupported diagnostics today. */
export const DEFERRED_CLI_SURFACES: readonly DeferredCliSurface[] = [
  {
    surface: "policy mounts",
    reason: "policy inspection is planned but not part of the current executable agent CLI slice",
    followUp: "future CLI policy surface",
  },
  {
    surface: "events",
    reason: "event streaming and NDJSON follow mode are planned but not implemented in this slice",
    followUp: "future CLI events stream",
  },
  {
    surface: "audit list",
    reason: "audit browsing is planned but not implemented in this slice",
    followUp: "future CLI audit browser",
  },
  {
    surface: "auth login/logout",
    reason:
      "authenticated-agent profiles are future work; the current local profile is credential-free",
    followUp: "future authenticated Agent Bridge profile",
  },
  {
    surface: "output ndjson",
    reason: "streaming output is reserved for future events/audit surfaces",
    followUp: "future CLI streaming contract",
  },
  {
    surface: "--context",
    reason:
      "multi-install context selection is planned; current endpoint selection uses GLA_ENDPOINT or --endpoint",
    followUp: "future CLI context profiles",
  },
  {
    surface: "--trace-id",
    reason: "trace correlation is planned with audit/event work",
    followUp: "future CLI trace/audit correlation",
  },
  {
    surface: "batch operations",
    reason:
      "bulk task/session operations are planned only after single-operation semantics are stable",
    followUp: "future CLI batch contract",
  },
] as const;

/** The current executable leaf command contract. Keep this in lockstep with the parser in cli.ts. */
export const CLI_COMMANDS: readonly CliCommandSpec[] = [
  {
    noun: "whoami",
    summary: "print this agent's identity and authority scope",
    args: [],
    flags: [],
    output: "whoami",
    fields: ["identity", "authority_profile", "allowed_ops"],
    exitCodes: [ExitCode.OK, ExitCode.DEPENDENCY, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "version",
    summary: "print client/runtime compatibility information",
    args: [],
    flags: [],
    output: "version",
    fields: ["client", "connection", "server"],
    exitCodes: [ExitCode.OK, ExitCode.DEPENDENCY, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "schema",
    summary: "emit the machine-readable current CLI contract",
    args: ["[noun]", "[verb]"],
    flags: [],
    output: "schema",
    fields: ["command", "commands", "deferred_surfaces", "global_flags", "exit_codes"],
    exitCodes: [ExitCode.OK, ExitCode.USAGE],
    effect: "read",
  },
  {
    noun: "catalog",
    verb: "list",
    summary: "list installable or available entities in this install",
    args: [],
    flags: ["--kind <k>", "--available"],
    output: "entity[]",
    fields: ["id", "name", "kind", "family", "status", "available", "dependencies"],
    exitCodes: [ExitCode.OK, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "template",
    verb: "list",
    summary: "list assemblable capsule templates",
    args: [],
    flags: ["--available"],
    output: "template[]",
    fields: ["id", "name", "kind", "family", "status", "available", "dependencies"],
    exitCodes: [ExitCode.OK, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "template",
    verb: "show",
    summary: "show required parts and dependency binding status for a template",
    args: ["id"],
    flags: [],
    output: "template",
    fields: ["id", "name", "requiredParts", "parts"],
    exitCodes: [ExitCode.OK, ExitCode.NOT_FOUND, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "skill",
    verb: "list",
    summary: "list procedural skills the agent can load",
    args: [],
    flags: ["--for <template>"],
    output: "skill[]",
    fields: ["id", "for", "body"],
    exitCodes: [ExitCode.OK, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "skill",
    verb: "show",
    summary: "emit one SKILL.md body",
    args: ["id"],
    flags: [],
    output: "skill",
    fields: ["id", "for", "body"],
    exitCodes: [ExitCode.OK, ExitCode.NOT_FOUND, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "task",
    verb: "create",
    summary: "open a task and mint its task capability",
    args: [],
    flags: ["--intent <s>", "--recipient <ref>"],
    output: "task",
    fields: [
      "task_id",
      "state",
      "intent",
      "recipient",
      "sessions",
      "implicit",
      "created_at",
      "updated_at",
    ],
    exitCodes: [ExitCode.OK, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "mutates",
  },
  {
    noun: "task",
    verb: "get",
    summary: "read a task aggregate",
    args: ["id"],
    flags: [],
    output: "task",
    fields: [
      "task_id",
      "state",
      "intent",
      "recipient",
      "sessions",
      "implicit",
      "created_at",
      "updated_at",
    ],
    exitCodes: [ExitCode.OK, ExitCode.NOT_FOUND, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "task",
    verb: "list",
    summary: "list visible tasks",
    args: [],
    flags: ["--state <s>"],
    output: "task[]",
    fields: [
      "task_id",
      "state",
      "intent",
      "recipient",
      "sessions",
      "implicit",
      "created_at",
      "updated_at",
    ],
    exitCodes: [ExitCode.OK, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "task",
    verb: "complete",
    summary: "complete a task and tear down descendants",
    args: ["id"],
    flags: [],
    output: "task",
    fields: ["task_id", "state", "sessions", "updated_at"],
    exitCodes: [
      ExitCode.OK,
      ExitCode.NOT_FOUND,
      ExitCode.CONFLICT,
      ExitCode.USAGE,
      ExitCode.INTERNAL,
    ],
    effect: "mutates",
  },
  {
    noun: "task",
    verb: "revoke",
    summary: "abort a task and tear down descendants",
    args: ["id"],
    flags: [],
    output: "task",
    fields: ["task_id", "state", "sessions", "updated_at"],
    exitCodes: [
      ExitCode.OK,
      ExitCode.NOT_FOUND,
      ExitCode.CONFLICT,
      ExitCode.USAGE,
      ExitCode.INTERNAL,
    ],
    effect: "mutates",
  },
  {
    noun: "session",
    verb: "create",
    summary: "admit and optionally provision a capsule session",
    args: [],
    flags: [
      "-f/--file <spec>",
      "--template <id>",
      "--task <id>",
      "--intent <s>",
      "--launcher <id>",
      "--entrypoint <id>",
      "--connector <id>",
      "--workspace <id>",
      "--detector <id>",
      "--recipient <ref>",
      "--ttl <dur>",
      "--mount <host>:<target>:<ro|rw>",
      "--dry-run",
    ],
    output: "session-create-result",
    fields: ["decision", "dry_run", "session_id", "state", "task_id", "capsule", "connector"],
    exitCodes: [
      ExitCode.OK,
      ExitCode.USAGE,
      ExitCode.POLICY,
      ExitCode.AUTH,
      ExitCode.NOT_FOUND,
      ExitCode.CONFLICT,
      ExitCode.DEPENDENCY,
      ExitCode.INTERNAL,
    ],
    effect: "mutates",
  },
  {
    noun: "session",
    verb: "get",
    summary: "read a session aggregate",
    args: ["id"],
    flags: [],
    output: "session",
    fields: ["session_id", "task_id", "state", "template", "capsule", "connector"],
    exitCodes: [ExitCode.OK, ExitCode.NOT_FOUND, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "session",
    verb: "list",
    summary: "list sessions",
    args: [],
    flags: ["--task <id>", "--state <s>"],
    output: "session[]",
    fields: ["session_id", "task_id", "state", "template", "capsule", "connector"],
    exitCodes: [ExitCode.OK, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "session",
    verb: "connector",
    summary: "re-emit the agent connector for a live capsule",
    args: ["id"],
    flags: [],
    output: "connector",
    fields: ["type", "cdp_url", "path", "secret_ref", "session_id", "state"],
    exitCodes: [
      ExitCode.OK,
      ExitCode.NOT_FOUND,
      ExitCode.CONFLICT,
      ExitCode.USAGE,
      ExitCode.INTERNAL,
    ],
    effect: "read",
  },
  {
    noun: "session",
    verb: "revoke",
    summary: "stop and reap one session's capsule and workspace",
    args: ["id"],
    flags: [],
    output: "session",
    fields: ["session_id", "task_id", "state", "template", "capsule", "connector"],
    exitCodes: [
      ExitCode.OK,
      ExitCode.NOT_FOUND,
      ExitCode.CONFLICT,
      ExitCode.USAGE,
      ExitCode.INTERNAL,
    ],
    effect: "mutates",
  },
  {
    noun: "handoff",
    verb: "open",
    summary: "open a recipient-bound handoff window",
    args: [],
    flags: ["--session <id>", "--reason <text>", "--recipient <ref>", "--ttl <dur>"],
    output: "handoff",
    fields: ["handoff_id", "link", "recipient", "expires_at", "state", "session_id"],
    exitCodes: [
      ExitCode.OK,
      ExitCode.USAGE,
      ExitCode.NOT_FOUND,
      ExitCode.CONFLICT,
      ExitCode.INTERNAL,
    ],
    effect: "mutates",
  },
  {
    noun: "handoff",
    verb: "wait",
    summary: "block until a handoff completes or expires",
    args: ["id"],
    flags: ["--timeout <dur>"],
    output: "completion",
    fields: ["handoff_id", "status", "state", "result", "next"],
    exitCodes: [
      ExitCode.OK,
      ExitCode.TIMEOUT,
      ExitCode.NOT_FOUND,
      ExitCode.USAGE,
      ExitCode.INTERNAL,
    ],
    effect: "blocks",
  },
  {
    noun: "handoff",
    verb: "get",
    summary: "read a handoff window state",
    args: ["id"],
    flags: [],
    output: "handoff",
    fields: ["handoff_id", "link", "recipient", "expires_at", "state", "session_id"],
    exitCodes: [ExitCode.OK, ExitCode.NOT_FOUND, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "handoff",
    verb: "list",
    summary: "list handoff windows",
    args: [],
    flags: ["--session <id>"],
    output: "handoff[]",
    fields: ["handoff_id", "link", "recipient", "expires_at", "state", "session_id"],
    exitCodes: [ExitCode.OK, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "handoff",
    verb: "cancel",
    summary: "cancel a handoff window early",
    args: ["id"],
    flags: [],
    output: "handoff",
    fields: ["handoff_id", "link", "recipient", "expires_at", "state", "session_id"],
    exitCodes: [
      ExitCode.OK,
      ExitCode.NOT_FOUND,
      ExitCode.CONFLICT,
      ExitCode.USAGE,
      ExitCode.INTERNAL,
    ],
    effect: "mutates",
  },
  {
    noun: "auth",
    verb: "diagnostics",
    summary: "read provider and enrollment-method diagnostics from a running local daemon",
    args: [],
    flags: ["--recipient <ref>"],
    output: "auth-diagnostics",
    fields: [
      "authProvider",
      "authAssuranceProfile",
      "enrollmentPolicy",
      "deploymentRoles",
      "edgeGuard",
      "recipientBinding",
      "summary",
      "concerns",
      "actions",
      "bindingSemantics",
    ],
    exitCodes: [ExitCode.OK, ExitCode.USAGE, ExitCode.DEPENDENCY, ExitCode.INTERNAL],
    effect: "read",
  },
] as const;

/** Current noun list, derived from executable command metadata plus help. */
export function currentNouns(): string[] {
  return [...new Set([...CLI_COMMANDS.map((c) => c.noun), "help"])];
}

/** Find the executable command spec for a noun/verb pair. */
export function findCommandSpec(noun: string, verb?: string): CliCommandSpec | undefined {
  return CLI_COMMANDS.find((c) => c.noun === noun && c.verb === verb);
}

/** Return all executable commands under a noun. */
export function commandSpecsForNoun(noun: string): CliCommandSpec[] {
  return CLI_COMMANDS.filter((c) => c.noun === noun);
}

/** Root or scoped machine-readable schema/help payload for the current executable contract. */
export function schemaPayload(noun?: string, verb?: string): Record<string, unknown> {
  if (noun === undefined) {
    return {
      command: "gla",
      current_contract: "GLA-094 current executable CLI surface",
      global_flags: [...CURRENT_GLOBAL_FLAGS],
      commands: CLI_COMMANDS,
      deferred_surfaces: DEFERRED_CLI_SURFACES,
      exit_codes: exitCodePayload(),
    };
  }
  const scoped =
    verb === undefined ? commandSpecsForNoun(noun) : [findCommandSpec(noun, verb)].filter(Boolean);
  return {
    command: ["gla", noun, verb].filter(Boolean).join(" "),
    global_flags: [...CURRENT_GLOBAL_FLAGS],
    commands: scoped,
    deferred_surfaces: DEFERRED_CLI_SURFACES.filter(
      (d) => d.surface === noun || d.surface.startsWith(`${noun} `),
    ),
    exit_codes: exitCodePayload(),
  };
}

/** Stable exit-code taxonomy exposed through help/schema. */
export function exitCodePayload(): Record<string, string> {
  return {
    "0": "success",
    "1": "internal",
    "2": "usage",
    "3": "policy",
    "4": "auth",
    "5": "not-found",
    "6": "timeout",
    "7": "conflict",
    "8": "dependency",
  };
}

/** Text help for the root or for a scoped noun/verb. */
export function usageText(noun?: string, verb?: string): string {
  if (noun !== undefined) {
    const found = verb === undefined ? undefined : findCommandSpec(noun, verb);
    const commands =
      verb === undefined ? commandSpecsForNoun(noun) : found === undefined ? [] : [found];
    if (commands.length === 0) {
      return `gla ${noun}${verb ? ` ${verb}` : ""}\n\nNo current executable command matches this scope.`;
    }
    return [
      `gla ${noun}${verb ? ` ${verb}` : ""}`,
      "",
      ...commands.map((c) => {
        const command = ["gla", c.noun, c.verb, ...c.args].filter(Boolean).join(" ");
        const flags = c.flags.length > 0 ? `\n  flags: ${c.flags.join(", ")}` : "";
        return `${command}\n  ${c.summary}\n  effect: ${c.effect}; output: ${c.output}; exit_codes: ${c.exitCodes.join(", ")}${flags}`;
      }),
    ].join("\n");
  }

  const commandLines = CLI_COMMANDS.map((c) => {
    const command = ["gla", c.noun, c.verb, ...c.args].filter(Boolean).join(" ");
    return `  ${command.padEnd(38)} ${c.summary}`;
  });
  const deferred = DEFERRED_CLI_SURFACES.map(
    (d) => `  ${d.surface.padEnd(22)} deferred: ${d.reason}`,
  );
  return `gla — agent gateway control interface

Usage:
  gla [global-flags] <noun> [<verb>] [args]

Current executable commands:
${commandLines.join("\n")}

Current global flags:
  ${CURRENT_GLOBAL_FLAGS.join("\n  ")}

Deferred/future surfaces (stable unsupported diagnostics today):
${deferred.join("\n")}

Output contract:
  stdout = results (JSON by default; human text only at a TTY). stderr = diagnostics/errors.

Exit codes:
  0 success · 1 internal · 2 usage · 3 policy · 4 auth · 5 not-found · 6 timeout · 7 conflict · 8 dependency`;
}
