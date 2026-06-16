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
  /** Long flag names that may be supplied more than once, preserving input order. */
  repeatableFlags?: string[];
  output: string;
  fields: string[];
  exitCodes: number[];
  effect: CliCommandEffect;
}

type PublicCliCommandSpec = Omit<CliCommandSpec, "repeatableFlags">;

/** Machine-readable contract for a documented but intentionally deferred CLI surface. */
export interface DeferredCliSurface {
  surface: string;
  reason: string;
  followUp: string;
}

interface DeferredCliSurfaceContract extends DeferredCliSurface {
  nouns: readonly string[];
  verbs?: readonly string[];
  matchesBare?: boolean;
  matchesAnyVerb?: boolean;
  message: string;
}

export interface DeferredCliUnsupported {
  surface: string;
  message: string;
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

const DEFERRED_CLI_SURFACE_CONTRACTS: readonly DeferredCliSurfaceContract[] = [
  {
    surface: "profile install/update commands",
    reason:
      "profile list/show/validate/overlay validation are UX-specified target commands, not part of the current executable CLI contract",
    followUp: "future provider install/update CLI surface",
    nouns: ["profile"],
    matchesAnyVerb: true,
    message:
      "profile list/show/validate/overlay validation are planned UX command names, not current executable commands",
  },
  {
    surface: "provider-set install/update commands",
    reason:
      "provider-set inspect/plan/apply/rollback are UX-specified target commands, not part of the current executable CLI contract",
    followUp: "future provider install/update CLI surface",
    nouns: ["provider-set"],
    matchesAnyVerb: true,
    message:
      "provider-set inspect/plan/apply/rollback are planned UX command names, not current executable commands",
  },
  {
    surface: "doctor provider-graph",
    reason:
      "provider graph doctor output exists in app composition but is not exposed as an executable CLI command yet",
    followUp: "future provider graph doctor CLI surface",
    nouns: ["doctor"],
    verbs: ["provider-graph"],
    matchesBare: true,
    message: "provider graph doctor is planned for CLI exposure but is not executable yet",
  },
  {
    surface: "policy mounts",
    reason: "policy inspection is planned but not part of the current executable agent CLI slice",
    followUp: "future CLI policy surface",
    nouns: ["policy"],
    verbs: ["mounts"],
    matchesBare: true,
    message: "policy inspection is deferred for the current CLI contract",
  },
  {
    surface: "events",
    reason: "event streaming and NDJSON follow mode are planned but not implemented in this slice",
    followUp: "future CLI events stream",
    nouns: ["events"],
    matchesAnyVerb: true,
    message: "event streaming is deferred for the current CLI contract",
  },
  {
    surface: "audit list",
    reason: "audit browsing is planned but not implemented in this slice",
    followUp: "future CLI audit browser",
    nouns: ["audit"],
    verbs: ["list"],
    matchesBare: true,
    message: "audit browsing is deferred for the current CLI contract",
  },
  {
    surface: "auth login/logout",
    reason:
      "authenticated-agent profiles are future work; the current local profile is credential-free",
    followUp: "future authenticated Agent Bridge profile",
    nouns: ["auth"],
    verbs: ["login", "logout"],
    message:
      "authenticated-agent login/logout is deferred; the current local profile is credential-free",
  },
  {
    surface: "output ndjson",
    reason: "streaming output is reserved for future events/audit surfaces",
    followUp: "future CLI streaming contract",
    nouns: [],
    message: "ndjson output is deferred until streaming commands exist",
  },
  {
    surface: "--context",
    reason:
      "multi-install context selection is planned; current endpoint selection uses GLA_ENDPOINT or --endpoint",
    followUp: "future CLI context profiles",
    nouns: [],
    message:
      "context selection is deferred; use GLA_ENDPOINT or --endpoint for the current local profile",
  },
  {
    surface: "--trace-id",
    reason: "trace correlation is planned with audit/event work",
    followUp: "future CLI trace/audit correlation",
    nouns: [],
    message: "trace correlation is deferred until audit/event support is implemented",
  },
  {
    surface: "batch operations",
    reason:
      "bulk task/session operations are planned only after single-operation semantics are stable",
    followUp: "future CLI batch contract",
    nouns: ["batch"],
    matchesAnyVerb: true,
    message: "batch operations are deferred for the current CLI contract",
  },
] as const;

/** Documented future/deferred surfaces that must fail with stable unsupported diagnostics today. */
export const DEFERRED_CLI_SURFACES: readonly DeferredCliSurface[] =
  DEFERRED_CLI_SURFACE_CONTRACTS.map(({ surface, reason, followUp }) => ({
    surface,
    reason,
    followUp,
  }));

/** Find a documented deferred surface by parsed noun/verb. */
export function findDeferredCliSurface(
  noun: string,
  verb: string | undefined,
): DeferredCliUnsupported | undefined {
  const match = DEFERRED_CLI_SURFACE_CONTRACTS.find((surface) => {
    if (!surface.nouns.includes(noun)) {
      return false;
    }
    if (surface.matchesAnyVerb === true) {
      return true;
    }
    if (verb === undefined) {
      return surface.matchesBare === true;
    }
    return surface.verbs?.includes(verb) === true;
  });
  if (match === undefined) {
    return undefined;
  }
  return { surface: match.surface, message: match.message };
}

/** The current executable leaf command contract. The parser consumes this contract rather than duplicating arity/flag metadata. */
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
    noun: "catalog",
    verb: "show",
    summary: "show one provider/template catalog entity with graph availability and diagnostics",
    args: ["id"],
    flags: [],
    output: "entity",
    fields: [
      "id",
      "name",
      "kind",
      "family",
      "status",
      "available",
      "availability",
      "dependencies",
      "config_schema",
      "diagnostics",
    ],
    exitCodes: [ExitCode.OK, ExitCode.NOT_FOUND, ExitCode.USAGE, ExitCode.INTERNAL],
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
    noun: "provider",
    verb: "scaffold",
    summary: "emit a JSON runtime provider package authoring skeleton",
    args: [],
    flags: ["--family <family>", "--id <provider-id>", "--version <version>", "--summary <text>"],
    output: "provider-authoring-skeleton",
    fields: ["manifest", "module", "docs", "contractTests", "changedFiles", "wpmSkeletons"],
    exitCodes: [ExitCode.OK, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "provider",
    verb: "validate",
    summary: "validate a provider authoring JSON file or local authoring bundle",
    args: ["path"],
    flags: [],
    output: "provider-authoring-report",
    fields: ["ok", "diagnostics", "readiness", "providers", "templatePackages"],
    exitCodes: [ExitCode.OK, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "provider",
    verb: "test",
    summary: "run local provider authoring contract preflight",
    args: ["path"],
    flags: [],
    output: "provider-authoring-test-report",
    fields: [
      "ok",
      "harness",
      "declaredContractTests",
      "externalContractTests",
      "validation",
      "tests",
    ],
    exitCodes: [ExitCode.OK, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "provider",
    verb: "inspect",
    summary: "show provider authoring readiness for reviewer/operator handoff",
    args: ["path"],
    flags: [],
    output: "provider-authoring-inspection",
    fields: [
      "kind",
      "providerId",
      "family",
      "version",
      "ok",
      "diagnostics",
      "readiness",
      "changedFiles",
      "capability",
      "configSchema",
      "factoryConfigSchema",
      "requirements",
      "skills",
      "docs",
      "contractTests",
      "module",
      "wpmSkeletons",
    ],
    exitCodes: [ExitCode.OK, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "template-package",
    verb: "scaffold",
    summary: "emit a JSON TemplatePackage authoring skeleton",
    args: [],
    flags: [
      "--id <package-id>",
      "--template <template-id>",
      "--launcher <provider-id>",
      "--entrypoint <provider-id>",
      "--connector <provider-id>",
      "--workspace <provider-id>",
      "--detector <provider-id>",
      "--open-parts <parts>",
      "--version <version>",
      "--summary <text>",
    ],
    output: "template-package-authoring-skeleton",
    fields: ["manifest", "docs", "changedFiles", "wpmSkeletons"],
    exitCodes: [ExitCode.OK, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "template-package",
    verb: "validate",
    summary: "validate a TemplatePackage authoring JSON file or local authoring bundle",
    args: ["path"],
    flags: [],
    output: "template-package-authoring-report",
    fields: ["ok", "diagnostics", "readiness", "providers", "templatePackages"],
    exitCodes: [ExitCode.OK, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "template-package",
    verb: "test",
    summary: "run local TemplatePackage authoring contract preflight",
    args: ["path"],
    flags: [],
    output: "template-package-authoring-test-report",
    fields: [
      "ok",
      "harness",
      "declaredContractTests",
      "externalContractTests",
      "validation",
      "tests",
    ],
    exitCodes: [ExitCode.OK, ExitCode.USAGE, ExitCode.INTERNAL],
    effect: "read",
  },
  {
    noun: "template-package",
    verb: "inspect",
    summary: "show TemplatePackage readiness for reviewer/operator handoff",
    args: ["path"],
    flags: [],
    output: "template-package-authoring-inspection",
    fields: [
      "kind",
      "packageId",
      "templateIds",
      "version",
      "ok",
      "diagnostics",
      "readiness",
      "changedFiles",
      "defaults",
      "compatibility",
      "templates",
      "docs",
      "tests",
      "wpmSkeletons",
    ],
    exitCodes: [ExitCode.OK, ExitCode.USAGE, ExitCode.INTERNAL],
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
    repeatableFlags: ["entrypoint", "detector", "mount"],
    output: "session-create-result",
    fields: [
      "decision",
      "dry_run",
      "session_id",
      "state",
      "task_id",
      "capsule_plan",
      "capsule",
      "connector",
    ],
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
      commands: publicCommandSpecs(CLI_COMMANDS),
      deferred_surfaces: DEFERRED_CLI_SURFACES,
      exit_codes: exitCodePayload(),
    };
  }
  const found = verb === undefined ? undefined : findCommandSpec(noun, verb);
  const scoped =
    verb === undefined ? commandSpecsForNoun(noun) : found === undefined ? [] : [found];
  return {
    command: ["gla", noun, verb].filter(Boolean).join(" "),
    global_flags: [...CURRENT_GLOBAL_FLAGS],
    commands: publicCommandSpecs(scoped),
    deferred_surfaces: DEFERRED_CLI_SURFACES.filter(
      (d) => d.surface === noun || d.surface.startsWith(`${noun} `),
    ),
    exit_codes: exitCodePayload(),
  };
}

function publicCommandSpecs(commands: readonly CliCommandSpec[]): PublicCliCommandSpec[] {
  return commands.map((command) => {
    const { noun, verb, summary, args, flags, output, fields, exitCodes, effect } = command;
    return {
      noun,
      ...(verb === undefined ? {} : { verb }),
      summary,
      args,
      flags,
      output,
      fields,
      exitCodes,
      effect,
    };
  });
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
