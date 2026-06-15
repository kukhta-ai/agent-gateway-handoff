// Integration tests for the `gla` CLI surface (surfaces/cli): the exit-code taxonomy, the JSON/TTY
// output contract (docs/05 §1, §4, §5), and the Slice-1 orient commands wired over the Agent Bridge.
// Drives the async `run()` with an injected sink so no process is spawned.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentBridge } from "@gla/bridge";
import { CatalogService, defaultStoreContent, referenceWpmDependencyBindings } from "@gla/catalog";
import { glaError } from "@gla/kernel";
import { describe, expect, it, vi } from "vitest";
import { CLI_VERSION, type CliServices, run } from "../../src/cli.js";
import { CLI_COMMANDS, DEFERRED_CLI_SURFACES } from "../../src/contract.js";
import { ExitCode } from "../../src/exit-codes.js";
import { main } from "../../src/index.js";
import { Output, type OutputStreams } from "../../src/output.js";

/** Build an Output over capture buffers, with a settable stdout TTY flag. */
function capture(stdoutTty: boolean): { out: Output; stdout: () => string; stderr: () => string } {
  const o: string[] = [];
  const e: string[] = [];
  const streams: OutputStreams = {
    stdout: {
      write(s) {
        o.push(s);
      },
      isTTY: stdoutTty,
    },
    stderr: {
      write(s) {
        e.push(s);
      },
      isTTY: false,
    },
  };
  return { out: new Output("auto", streams), stdout: () => o.join(""), stderr: () => e.join("") };
}

/** Bridge fixture for tests that intentionally simulate WPM having installed the reference slice. */
function readyBridge(): AgentBridge {
  return new AgentBridge({
    catalog: new CatalogService({ dependencyBindings: referenceWpmDependencyBindings() }),
  });
}

/** Default services for tests (the reference-slice Bridge with explicit WPM receipt fixtures). */
function services(bridge: AgentBridge = readyBridge()): CliServices {
  return { bridge, connection: { mode: "in-process" } };
}

describe("gla exit codes", () => {
  it("`version` exits 0 and prints client version as JSON on stdout (non-TTY)", async () => {
    const c = capture(false);
    const code = await run(["version"], c.out, services());
    expect(code).toBe(ExitCode.OK);
    expect(JSON.parse(c.stdout())).toEqual({ client: CLI_VERSION, connection: "in-process" });
    expect(c.stderr()).toBe("");
  });

  it("`--help` exits 0", async () => {
    const c = capture(false);
    expect(await run(["--help"], c.out, services())).toBe(ExitCode.OK);
    expect(JSON.parse(c.stdout()).command).toBe("gla");
  });

  it("bare invocation (no args) prints usage and exits 0", async () => {
    const c = capture(false);
    expect(await run([], c.out, services())).toBe(ExitCode.OK);
  });

  it("unknown command exits 2 (usage) with a JSON error on stderr", async () => {
    const c = capture(false);
    const code = await run(["frobnicate"], c.out, services());
    expect(code).toBe(ExitCode.USAGE);
    expect(c.stdout()).toBe(""); // results channel stays clean
    const err = JSON.parse(c.stderr()).error;
    expect(err.code).toBe("usage.unknown_command");
    expect(err.skill).toBeTruthy();
  });

  it("unknown/invalid flag exits 2 (usage)", async () => {
    const c = capture(false);
    expect(await run(["-o", "yaml", "version"], c.out, services())).toBe(ExitCode.USAGE);
  });

  it("command-scoped flags without a command fail instead of falling through to root help", async () => {
    for (const argv of [["--bogus"], ["--endpoint"]]) {
      const c = capture(false);
      expect(await run(argv, c.out, services())).toBe(ExitCode.USAGE);
      expect(c.stdout()).toBe("");
      const err = JSON.parse(c.stderr()).error;
      expect(err.code).toBe("usage.bad_flag");
      expect(err.detail.flags).toEqual([argv[0]]);
    }
  });

  it("treats `--` as end-of-options so `pnpm gla -- version` works (exit 0)", async () => {
    const c = capture(false);
    expect(await run(["--", "version"], c.out, services())).toBe(ExitCode.OK);
    expect(JSON.parse(c.stdout())).toEqual({ client: CLI_VERSION, connection: "in-process" });
  });

  it("process entry redacts refused GLA_ENDPOINT values before printing daemon connection diagnostics", async () => {
    const endpoint =
      "https://gla.example/handoff/sess_1?grant=BRIDGE_GRANT_CANARY_090&secret=RAW_SECRET_CANARY_090";
    const previous = process.env.GLA_ENDPOINT;
    process.env.GLA_ENDPOINT = endpoint;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
      });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      });
    try {
      const code = await main(["-o", "json", "whoami"]);
      expect(code).toBe(ExitCode.USAGE);
      expect(stdout.join("")).toBe("");
      const text = stderr.join("");
      expect(text).toContain("usage.bad_argument");
      expect(text).not.toContain("BRIDGE_GRANT_CANARY_090");
      expect(text).not.toContain("RAW_SECRET_CANARY_090");
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, "GLA_ENDPOINT");
      } else {
        process.env.GLA_ENDPOINT = previous;
      }
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("process entry reports unreachable local daemon endpoints as dependency errors", async () => {
    const previous = process.env.GLA_ENDPOINT;
    process.env.GLA_ENDPOINT = join(tmpdir(), `gla-missing-${Date.now()}.sock`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
      });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      });
    try {
      const code = await main(["-o", "json", "whoami"]);
      expect(code).toBe(ExitCode.DEPENDENCY);
      expect(stdout.join("")).toBe("");
      const err = JSON.parse(stderr.join("")).error;
      expect(err.code).toBe("dependency.unavailable");
      expect(err.detail.endpoint).toContain("gla-missing-");
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, "GLA_ENDPOINT");
      } else {
        process.env.GLA_ENDPOINT = previous;
      }
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("process entry reports parser usage failures before connecting to a configured daemon", async () => {
    const previous = process.env.GLA_ENDPOINT;
    process.env.GLA_ENDPOINT = join(tmpdir(), `gla-missing-usage-${Date.now()}.sock`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
      });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      });
    try {
      const code = await main(["--bogus"]);
      expect(code).toBe(ExitCode.USAGE);
      expect(stdout.join("")).toBe("");
      const err = JSON.parse(stderr.join("")).error;
      expect(err.code).toBe("usage.bad_flag");
      expect(err.message).not.toContain("gla-missing-usage");
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, "GLA_ENDPOINT");
      } else {
        process.env.GLA_ENDPOINT = previous;
      }
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("process entry emits local machine help before connecting to a configured daemon", async () => {
    const previous = process.env.GLA_ENDPOINT;
    process.env.GLA_ENDPOINT = join(tmpdir(), `gla-missing-help-${Date.now()}.sock`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
      });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      });
    try {
      const code = await main(["--help"]);
      expect(code).toBe(ExitCode.OK);
      expect(JSON.parse(stdout.join("")).command).toBe("gla");
      expect(stderr.join("")).toBe("");
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, "GLA_ENDPOINT");
      } else {
        process.env.GLA_ENDPOINT = previous;
      }
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("--endpoint overrides a bad GLA_ENDPOINT before connecting", async () => {
    const previous = process.env.GLA_ENDPOINT;
    process.env.GLA_ENDPOINT = "https://gla.example/bridge?secret=ENV_SECRET_CANARY_094";
    const endpoint = join(tmpdir(), `gla-missing-override-${Date.now()}.sock`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
      });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      });
    try {
      const code = await main(["-o", "json", "--endpoint", endpoint, "whoami"]);
      expect(code).toBe(ExitCode.DEPENDENCY);
      expect(stdout.join("")).toBe("");
      const text = stderr.join("");
      expect(text).not.toContain("ENV_SECRET_CANARY_094");
      const err = JSON.parse(text).error;
      expect(err.code).toBe("dependency.unavailable");
      expect(err.detail.endpoint).toBe(endpoint);
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, "GLA_ENDPOINT");
      } else {
        process.env.GLA_ENDPOINT = previous;
      }
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });
});

describe("gla JSON/TTY output contract", () => {
  it("emits JSON to stdout by default when stdout is NOT a TTY", async () => {
    const c = capture(false);
    await run(["version"], c.out, services());
    expect(() => JSON.parse(c.stdout())).not.toThrow();
    expect(c.stdout().trim().startsWith("{")).toBe(true);
  });

  it("emits human-readable text to stdout when stdout IS a TTY", async () => {
    const c = capture(true);
    await run(["version"], c.out, services());
    expect(c.stdout()).toContain(`client: ${CLI_VERSION}`);
    expect(() => JSON.parse(c.stdout())).toThrow();
  });

  it("-o json forces JSON even at a TTY", async () => {
    const o: string[] = [];
    const out = new Output("json", {
      stdout: {
        write(s) {
          o.push(s);
        },
        isTTY: true,
      },
      stderr: { write() {}, isTTY: true },
    });
    await run(["version"], out, services());
    expect(() => JSON.parse(o.join(""))).not.toThrow();
  });
});

describe("gla current contract/schema/help (GLA-094)", () => {
  it("every executable command contract has a machine-readable Commander help scope", async () => {
    for (const spec of CLI_COMMANDS) {
      const c = capture(false);
      const argv = [spec.noun, spec.verb, "--help"].filter((v): v is string => v !== undefined);
      const code = await run(argv, c.out, services());
      expect(code, argv.join(" ")).toBe(ExitCode.OK);
      const help = JSON.parse(c.stdout()) as {
        command: string;
        commands: Array<{ noun: string; verb?: string }>;
      };
      expect(help.command).toBe(["gla", spec.noun, spec.verb].filter(Boolean).join(" "));
      const expectedCommand =
        spec.verb === undefined ? { noun: spec.noun } : { noun: spec.noun, verb: spec.verb };
      expect(help.commands).toEqual(
        expect.arrayContaining([expect.objectContaining(expectedCommand)]),
      );
      expect(c.stderr()).toBe("");
    }
  });

  it("accepts Commander long-option value syntax while preserving the JSON contract", async () => {
    const version = capture(false);
    expect(await run(["version", "--output=json"], version.out, services())).toBe(ExitCode.OK);
    expect(JSON.parse(version.stdout())).toEqual({
      client: CLI_VERSION,
      connection: "in-process",
    });

    const catalog = capture(false);
    expect(await run(["catalog", "list", "--kind=Launcher"], catalog.out, services())).toBe(
      ExitCode.OK,
    );
    expect(JSON.parse(catalog.stdout()).map((e: { name: string }) => e.name)).toEqual([
      "launcher-process",
    ]);

    const task = capture(false);
    expect(
      await run(
        [
          "task",
          "create",
          "--intent=register on acme",
          "--recipient=tg:user:123",
          "--fields=task_id,state",
        ],
        task.out,
        services(),
      ),
    ).toBe(ExitCode.OK);
    expect(Object.keys(JSON.parse(task.stdout())).sort()).toEqual(["state", "task_id"]);
  });

  it("root machine help lists current executable commands separately from deferred surfaces", async () => {
    const c = capture(false);
    expect(await run(["--help"], c.out, services())).toBe(ExitCode.OK);
    const help = JSON.parse(c.stdout()) as {
      commands: Array<{ noun: string; verb?: string }>;
      deferred_surfaces: Array<{ surface: string }>;
    };
    const commands = help.commands.map((cmd) => [cmd.noun, cmd.verb].filter(Boolean).join(" "));
    expect(
      help.commands.find((cmd) => cmd.noun === "session" && cmd.verb === "create"),
    ).not.toHaveProperty("repeatableFlags");
    expect(commands).toEqual(
      expect.arrayContaining([
        "whoami",
        "version",
        "schema",
        "catalog list",
        "catalog show",
        "template list",
        "template show",
        "skill list",
        "skill show",
        "task create",
        "task get",
        "task list",
        "task complete",
        "task revoke",
        "session create",
        "session get",
        "session list",
        "session connector",
        "session revoke",
        "handoff open",
        "handoff wait",
        "handoff get",
        "handoff list",
        "handoff cancel",
      ]),
    );
    expect(commands).not.toContain("events");
    expect(commands).not.toContain("audit list");
    expect(help.deferred_surfaces.map((s) => s.surface)).toEqual(
      expect.arrayContaining(["events", "audit list", "auth login/logout", "output ndjson"]),
    );
  });

  it("docs/05 preserves current contract and future roadmap labels that root help exposes", async () => {
    const docs = readFileSync("docs/05-cli-and-entities.md", "utf8");
    const c = capture(false);
    await run(["--help"], c.out, services());
    const help = JSON.parse(c.stdout()) as {
      commands: Array<{ noun: string; verb?: string }>;
      deferred_surfaces: Array<{ surface: string }>;
    };
    expect(docs).toContain("### 3.1 Current executable contract");
    expect(docs).toContain("### 3.2 Future/target command tree");
    for (const command of help.commands) {
      const rendered = ["gla", command.noun, command.verb].filter(Boolean).join(" ");
      const treeLabel = [command.noun, command.verb].filter(Boolean).join(" ");
      expect(docs.includes(rendered) || docs.includes(treeLabel)).toBe(true);
    }
    for (const deferred of help.deferred_surfaces) {
      const docLabel = deferred.surface === "output ndjson" ? "-o ndjson" : deferred.surface;
      expect(docs).toContain(docLabel);
    }
  });

  it("command-scoped machine help exposes noun, verb, flags, output, effect, and exit codes", async () => {
    const c = capture(false);
    expect(await run(["task", "create", "--help"], c.out, services())).toBe(ExitCode.OK);
    const help = JSON.parse(c.stdout()) as {
      command: string;
      commands: Array<Record<string, unknown>>;
    };
    expect(help.command).toBe("gla task create");
    expect(help.commands).toHaveLength(1);
    expect(help.commands[0]).toMatchObject({
      noun: "task",
      verb: "create",
      output: "task",
      effect: "mutates",
    });
    expect(help.commands[0]?.flags).toContain("--intent <s>");
    expect(help.commands[0]?.exitCodes).toContain(0);
    expect(help.commands[0]?.exitCodes).toContain(2);
  });

  it("`schema [noun [verb]]` returns scoped machine-readable command contracts", async () => {
    const c = capture(false);
    expect(await run(["schema", "handoff", "wait"], c.out, services())).toBe(ExitCode.OK);
    const schema = JSON.parse(c.stdout()) as {
      command: string;
      commands: Array<Record<string, unknown>>;
    };
    expect(schema.command).toBe("gla handoff wait");
    expect(schema.commands).toEqual([
      expect.objectContaining({
        noun: "handoff",
        verb: "wait",
        effect: "blocks",
        output: "completion",
        args: ["id"],
        flags: ["--timeout <dur>"],
      }),
    ]);
  });

  it("deferred nouns, deferred auth login/logout, and ndjson fail with stable unsupported diagnostics", async () => {
    const documentedSurfaces = new Set(DEFERRED_CLI_SURFACES.map((surface) => surface.surface));
    for (const argv of [
      ["policy", "mounts"],
      ["events"],
      ["audit", "list"],
      ["auth", "login"],
      ["provider", "scaffold", "--family", "auth", "--id", "oidc-acme"],
      ["profile", "list"],
      ["provider-set", "plan", "--profile", "scenario-01"],
      ["doctor", "provider-graph"],
      ["-o", "ndjson", "version"],
      ["--context", "prod", "version"],
      ["--trace-id", "trace-1", "version"],
      ["batch"],
    ]) {
      const c = capture(false);
      expect(await run(argv, c.out, services())).toBe(ExitCode.USAGE);
      expect(c.stdout()).toBe("");
      const err = JSON.parse(c.stderr()).error;
      expect(err.code).toBe("usage.unsupported");
      expect(err.detail.surface).toBeTruthy();
      expect(documentedSurfaces).toContain(err.detail.surface);
      expect(err.detail.status).toBe("deferred");
    }
  });

  it("`--help` does not mask unknown or deferred command scopes", async () => {
    const unknown = capture(false);
    expect(await run(["frobnicate", "--help"], unknown.out, services())).toBe(ExitCode.USAGE);
    expect(unknown.stdout()).toBe("");
    expect(JSON.parse(unknown.stderr()).error.code).toBe("usage.unknown_command");

    const deferred = capture(false);
    expect(await run(["provider", "scaffold", "--help"], deferred.out, services())).toBe(
      ExitCode.USAGE,
    );
    expect(deferred.stdout()).toBe("");
    expect(JSON.parse(deferred.stderr()).error.code).toBe("usage.unsupported");
  });

  it("`gla help` is a strict root-help alias and does not mask bad inputs", async () => {
    for (const [argv, expectedCode] of [
      [["help", "--bogus"], "usage.bad_flag"],
      [["help", "task", "create", "--bogus"], "usage.bad_flag"],
      [["help", "--fields", "missing"], "usage.bad_field"],
      [["help", "task", "create"], "usage.bad_argument"],
    ] as const) {
      const c = capture(false);
      const code = await run(argv, c.out, services());
      expect(code, argv.join(" ")).toBe(ExitCode.USAGE);
      expect(c.stdout()).toBe("");
      expect(JSON.parse(c.stderr()).error.code).toBe(expectedCode);
    }
  });

  it("scoped `--help` still validates command-contract flags, fields, and extra args", async () => {
    for (const [argv, expectedCode] of [
      [["version", "--bogus", "--help"], "usage.bad_flag"],
      [["task", "create", "--intent", "--help"], "usage.bad_flag"],
      [["task", "create", "unexpected", "--help"], "usage.bad_argument"],
      [["task", "create", "--fields", "missing", "--help"], "usage.bad_field"],
    ] as const) {
      const c = capture(false);
      expect(await run(argv, c.out, services())).toBe(ExitCode.USAGE);
      expect(c.stdout()).toBe("");
      expect(JSON.parse(c.stderr()).error.code).toBe(expectedCode);
    }

    const help = capture(false);
    expect(await run(["catalog", "show", "--help"], help.out, services())).toBe(ExitCode.OK);
    expect(JSON.parse(help.stdout()).command).toBe("gla catalog show");
  });

  it("schema scoped `--help` validates field masks against the schema command contract", async () => {
    const c = capture(false);
    expect(
      await run(["schema", "handoff", "wait", "--fields", "missing", "--help"], c.out, services()),
    ).toBe(ExitCode.USAGE);
    expect(c.stdout()).toBe("");
    expect(JSON.parse(c.stderr()).error.code).toBe("usage.bad_field");
  });

  it("--fields trims successful JSON results and --quiet does not suppress results", async () => {
    const c = capture(false);
    const code = await run(
      [
        "task",
        "create",
        "--intent",
        "register on acme",
        "--recipient",
        "tg:user:123",
        "--fields",
        "task_id,state",
        "--quiet",
      ],
      c.out,
      services(),
    );
    expect(code).toBe(ExitCode.OK);
    const out = JSON.parse(c.stdout());
    expect(Object.keys(out).sort()).toEqual(["state", "task_id"]);
    expect(out.task_id).toMatch(/^task_/);
    expect(out.state).toBe("active");
    expect(c.stderr()).toBe("");
  });

  it("unknown --fields fail before mutating command state", async () => {
    const bridge = new AgentBridge();
    const bad = capture(false);
    const code = await run(
      ["task", "create", "--intent", "x", "--fields", "missing"],
      bad.out,
      services(bridge),
    );
    expect(code).toBe(ExitCode.USAGE);
    expect(bad.stdout()).toBe("");
    expect(JSON.parse(bad.stderr()).error.code).toBe("usage.bad_field");

    const list = capture(false);
    await run(["task", "list"], list.out, services(bridge));
    expect(JSON.parse(list.stdout())).toEqual([]);
  });

  it("unknown command-scoped flags fail with allowed flags before dispatch", async () => {
    const c = capture(false);
    expect(await run(["version", "--bogus", "x"], c.out, services())).toBe(ExitCode.USAGE);
    expect(c.stdout()).toBe("");
    const err = JSON.parse(c.stderr()).error;
    expect(err.code).toBe("usage.bad_flag");
    expect(err.detail.flags).toEqual(["--bogus"]);
    expect(err.detail.allowed_flags).toEqual([]);
  });

  it("unknown command-scoped flags on mutating commands fail before changing bridge state", async () => {
    const bridge = new AgentBridge();
    const bad = capture(false);
    expect(
      await run(
        ["task", "create", "--intent", "x", "--unsupported", "value"],
        bad.out,
        services(bridge),
      ),
    ).toBe(ExitCode.USAGE);
    expect(bad.stdout()).toBe("");
    const err = JSON.parse(bad.stderr()).error;
    expect(err.code).toBe("usage.bad_flag");
    expect(err.detail.flags).toEqual(["--unsupported"]);
    expect(err.detail.allowed_flags).toEqual(["--intent", "--recipient"]);

    const list = capture(false);
    await run(["task", "list"], list.out, services(bridge));
    expect(JSON.parse(list.stdout())).toEqual([]);
  });

  it("extra positional arguments fail from the command contract before changing bridge state", async () => {
    const bridge = new AgentBridge();
    const bad = capture(false);
    expect(
      await run(["task", "create", "unexpected", "--intent", "x"], bad.out, services(bridge)),
    ).toBe(ExitCode.USAGE);
    expect(bad.stdout()).toBe("");
    const err = JSON.parse(bad.stderr()).error;
    expect(err.code).toBe("usage.bad_argument");
    expect(err.detail.command).toBe("gla task create");
    expect(err.detail.expected).toEqual([]);

    const list = capture(false);
    await run(["task", "list"], list.out, services(bridge));
    expect(JSON.parse(list.stdout())).toEqual([]);
  });

  it("schema scoped help rejects too many positionals from the schema command contract", async () => {
    const c = capture(false);
    expect(await run(["schema", "handoff", "wait", "extra"], c.out, services())).toBe(
      ExitCode.USAGE,
    );
    expect(c.stdout()).toBe("");
    const err = JSON.parse(c.stderr()).error;
    expect(err.code).toBe("usage.bad_argument");
    expect(err.detail.command).toBe("gla schema");
    expect(err.detail.expected).toEqual(["[noun]", "[verb]"]);
  });

  it("value-bearing command flags without values fail before changing bridge state", async () => {
    const bridge = new AgentBridge();
    const bad = capture(false);
    expect(await run(["task", "create", "--intent"], bad.out, services(bridge))).toBe(
      ExitCode.USAGE,
    );
    expect(bad.stdout()).toBe("");
    const err = JSON.parse(bad.stderr()).error;
    expect(err.code).toBe("usage.bad_flag");
    expect(err.detail.missing_values).toEqual(["--intent"]);

    const list = capture(false);
    await run(["task", "list"], list.out, services(bridge));
    expect(JSON.parse(list.stdout())).toEqual([]);
  });

  it("repeatable value-bearing flags without values fail before dispatch", async () => {
    const c = capture(false);
    expect(
      await run(
        ["session", "create", "--template", "browser-handoff", "--mount", "--dry-run"],
        c.out,
        services(),
      ),
    ).toBe(ExitCode.USAGE);
    expect(c.stdout()).toBe("");
    const err = JSON.parse(c.stderr()).error;
    expect(err.code).toBe("usage.bad_flag");
    expect(err.detail.missing_values).toEqual(["--mount"]);
  });

  it("boolean command flags with values fail before mutating command dispatch", async () => {
    const bridge = new AgentBridge();
    const bad = capture(false);
    expect(
      await run(
        ["session", "create", "--template", "browser-handoff", "--dry-run", "false"],
        bad.out,
        services(bridge),
      ),
    ).toBe(ExitCode.USAGE);
    expect(bad.stdout()).toBe("");
    const err = JSON.parse(bad.stderr()).error;
    expect(err.code).toBe("usage.bad_flag");
    expect(err.detail.unexpected_values).toEqual(["--dry-run"]);

    const sessions = capture(false);
    await run(["session", "list"], sessions.out, services(bridge));
    expect(JSON.parse(sessions.stdout())).toEqual([]);
  });

  it("documented field-mask snippets parse JSON object ids before reuse", async () => {
    const docs = readFileSync("docs/05-cli-and-entities.md", "utf8");
    expect(docs).toContain("Field masks keep JSON object shape");
    expect(docs).toContain("TASK_JSON=$(gla task create");
    expect(docs).toContain("TASK=$(node -pe 'JSON.parse(process.argv[1]).task_id'");
    expect(docs).toContain("CONN_JSON=$(gla session connector");
    expect(docs).toContain("H1_JSON=$(gla handoff open");

    const dir = mkdtempSync(join(tmpdir(), "gla-cli-"));
    try {
      const path = specFile(dir, OK_ASSEMBLY);
      const bridge = readyBridge();

      const task = capture(false);
      expect(
        await run(
          [
            "task",
            "create",
            "--intent",
            "register on acme",
            "--recipient",
            "tg:user:123",
            "--fields",
            "task_id",
            "--quiet",
          ],
          task.out,
          services(bridge),
        ),
      ).toBe(ExitCode.OK);
      const taskJson = JSON.parse(task.stdout());
      expect(Object.keys(taskJson)).toEqual(["task_id"]);
      const taskId = taskJson.task_id as string;

      const session = capture(false);
      expect(
        await run(
          ["session", "create", "--task", taskId, "-f", path, "--fields", "session_id", "--quiet"],
          session.out,
          services(bridge),
        ),
      ).toBe(ExitCode.OK);
      const sessionJson = JSON.parse(session.stdout());
      expect(Object.keys(sessionJson)).toEqual(["session_id"]);
      const sessionId = sessionJson.session_id as string;

      const connector = capture(false);
      expect(
        await run(
          ["session", "connector", sessionId, "--fields", "type,secret_ref"],
          connector.out,
          services(new FakeSessionConnectorBridge()),
        ),
      ).toBe(ExitCode.OK);
      expect(JSON.parse(connector.stdout())).toEqual({
        type: "cdp",
        secret_ref: "cap_ref_connector_1",
      });

      const handoff = capture(false);
      expect(
        await run(
          [
            "handoff",
            "open",
            "--session",
            sessionId,
            "--reason",
            "complete registration form",
            "--fields",
            "handoff_id",
            "--quiet",
          ],
          handoff.out,
          services(new FakeHandoffBridge()),
        ),
      ).toBe(ExitCode.OK);
      const handoffJson = JSON.parse(handoff.stdout());
      expect(Object.keys(handoffJson)).toEqual(["handoff_id"]);
      expect(handoffJson.handoff_id).toBe("hand_1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--quiet does not suppress machine-readable errors", async () => {
    const c = capture(false);
    expect(await run(["--quiet", "frobnicate"], c.out, services())).toBe(ExitCode.USAGE);
    expect(c.stdout()).toBe("");
    expect(JSON.parse(c.stderr()).error.code).toBe("usage.unknown_command");
  });

  it("version distinguishes client-only, in-process, and daemon profiles without inventing a server version", async () => {
    const clientOnly = capture(false);
    expect(
      await run(["version"], clientOnly.out, {
        bridge: readyBridge(),
        connection: { mode: "client-only" },
      }),
    ).toBe(ExitCode.OK);
    expect(JSON.parse(clientOnly.stdout())).toEqual({
      client: CLI_VERSION,
      connection: "client-only",
    });

    const daemon = capture(false);
    expect(
      await run(["version"], daemon.out, {
        bridge: readyBridge(),
        connection: { mode: "daemon" },
      }),
    ).toBe(ExitCode.OK);
    expect(JSON.parse(daemon.stdout())).toEqual({
      client: CLI_VERSION,
      connection: "daemon",
    });
  });

  it("auth diagnostics field masks use the real diagnostic read-model fields", async () => {
    const bridge = Object.assign(readyBridge(), {
      request: vi.fn(async () => ({
        authProvider: "authentik",
        authAssuranceProfile: "passkey-and-password",
        enrollmentPolicy: { provider: "authentik" },
        deploymentRoles: [],
        edgeGuard: { summary: "GLA OIDC provider selected", outerGuards: [] },
        summary: "authentik diagnostics ready",
        concerns: ["missing deployed passkey proof"],
        actions: ["record loginMethodProofs"],
        bindingSemantics: {
          providerAccount: "provider-local account is not a GLA binding",
          glaBinding: "recipient must have a GLA enrollment record",
        },
      })),
    });
    const c = capture(false);
    expect(
      await run(["auth", "diagnostics", "--fields", "summary,concerns"], c.out, {
        bridge,
        connection: { mode: "daemon" },
      }),
    ).toBe(ExitCode.OK);
    expect(JSON.parse(c.stdout())).toEqual({
      summary: "authentik diagnostics ready",
      concerns: ["missing deployed passkey proof"],
    });
  });
});

describe("gla whoami (GLA-017 AC#1)", () => {
  it("returns identity + allowed operations as JSON, exit 0", async () => {
    const c = capture(false);
    const code = await run(["whoami"], c.out, services());
    expect(code).toBe(ExitCode.OK);
    const who = JSON.parse(c.stdout());
    expect(who.identity).toBe("agent:local");
    expect(who.authority_profile).toBe("local-single-operator");
    expect(Array.isArray(who.allowed_ops)).toBe(true);
    expect(who.allowed_ops).toContain("whoami");
  });
});

describe("gla template (GLA-017 AC#2)", () => {
  it("`template show <id>` returns required parts + each backing dependency binding status", async () => {
    const c = capture(false);
    const code = await run(["template", "show", "browser-handoff"], c.out, services());
    expect(code).toBe(ExitCode.OK);
    const show = JSON.parse(c.stdout());
    expect(show.requiredParts).toContain("launcher");
    const launcher = show.parts.find((p: { part: string }) => p.part === "launcher");
    expect(launcher.provider).toBe("launcher-process");
    expect(launcher.dependencies[0].status).toBe("bound");
  });

  it("`template show <unknown>` exits 5 (not found) with a JSON error on stderr", async () => {
    const c = capture(false);
    const code = await run(["template", "show", "does-not-exist"], c.out, services());
    expect(code).toBe(ExitCode.NOT_FOUND);
    expect(c.stdout()).toBe("");
    expect(JSON.parse(c.stderr()).error.code).toBe("catalog.unknown");
  });

  it("`template show` with no id is a usage error (exit 2)", async () => {
    const c = capture(false);
    expect(await run(["template", "show"], c.out, services())).toBe(ExitCode.USAGE);
  });

  it("`template list` lists the assemblable templates", async () => {
    const c = capture(false);
    await run(["template", "list"], c.out, services());
    expect(JSON.parse(c.stdout()).map((e: { name: string }) => e.name)).toEqual([
      "browser-handoff",
    ]);
  });
});

describe("gla catalog list (GLA-017 AC#3)", () => {
  it("returns only available entities with `--available`; availability is system-derived", async () => {
    // A Bridge whose launcher probe reports unavailable — the system derives the drop.
    const catalog = new CatalogService({
      content: defaultStoreContent(),
      dependencyBindings: referenceWpmDependencyBindings(),
      probes: { "launcher-process": () => "unavailable" },
    });
    const c = capture(false);
    await run(["catalog", "list", "--available"], c.out, services(new AgentBridge({ catalog })));
    const names = JSON.parse(c.stdout()).map((e: { name: string }) => e.name);
    expect(names).not.toContain("launcher-process"); // dropped by the probe, not the caller
    expect(names).not.toContain("browser-handoff");
  });

  it("filters by `--kind`", async () => {
    const c = capture(false);
    await run(["catalog", "list", "--kind", "Launcher"], c.out, services());
    expect(JSON.parse(c.stdout()).map((e: { name: string }) => e.name)).toEqual([
      "launcher-process",
    ]);
  });

  it("`catalog show <provider-id>` returns provider detail with graph facts", async () => {
    const c = capture(false);
    expect(await run(["catalog", "show", "launcher-process"], c.out, services())).toBe(ExitCode.OK);
    const show = JSON.parse(c.stdout());
    expect(show).toMatchObject({
      name: "launcher-process",
      family: "launcher",
      available: true,
    });
    expect(show.config_schema).toBeDefined();
    expect(show.requires[0]).toMatchObject({ dependency: "browser-runtime" });
    expect(show.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "provider.available" })]),
    );
  });

  it("`catalog show <unknown>` exits 5 with a JSON error on stderr", async () => {
    const c = capture(false);
    expect(await run(["catalog", "show", "does-not-exist"], c.out, services())).toBe(
      ExitCode.NOT_FOUND,
    );
    expect(c.stdout()).toBe("");
    expect(JSON.parse(c.stderr()).error.code).toBe("catalog.unknown");
  });
});

describe("gla skill", () => {
  it("`skill show <id>` emits the SKILL.md body, exit 0", async () => {
    const c = capture(false);
    expect(await run(["skill", "show", "browser-handoff"], c.out, services())).toBe(ExitCode.OK);
    expect(JSON.parse(c.stdout()).body).toContain("# browser-handoff");
  });

  it("`skill show <unknown>` exits 5 (not found)", async () => {
    const c = capture(false);
    expect(await run(["skill", "show", "nope"], c.out, services())).toBe(ExitCode.NOT_FOUND);
  });

  it("`skill list --for <template>` filters", async () => {
    const c = capture(false);
    await run(["skill", "list", "--for", "browser-handoff"], c.out, services());
    expect(JSON.parse(c.stdout()).map((s: { id: string }) => s.id)).toContain("browser-handoff");
  });
});

// ── Slice 2: task + session commands (GLA-018/019/020/021) ────────────────────────────────────────
// The default Bridge uses an allow-all PolicyPort (the real Cedar forbid-wins is proven in
// adapters/policy-cedar + packages/app); these tests prove the COMMAND WIRING + exit-code mapping. The
// structural rejection classes (catalog/config/mount) are Cedar-independent, so they exercise the full
// admit pipeline through the CLI.

/** Write a temp assembly spec file and return its path (caller cleans the dir). */
function specFile(dir: string, doc: unknown): string {
  const p = join(dir, "assembly.json");
  writeFileSync(p, JSON.stringify(doc));
  return p;
}

const OK_ASSEMBLY = {
  apiVersion: "gla.dev/v1",
  kind: "Assembly",
  metadata: { intent: "register on acme" },
  spec: {
    template: "browser-handoff",
    recipient: "tg:user:123",
    detectors: [
      { use: "user-done" },
      { use: "url-watcher", params: { complete_on: "/dashboard" } },
    ],
  },
};

describe("gla task", () => {
  it("`task create --intent --recipient` opens a task (active) and prints {task_id,state}", async () => {
    const c = capture(false);
    const code = await run(
      ["task", "create", "--intent", "register on acme", "--recipient", "tg:user:123"],
      c.out,
      services(),
    );
    expect(code).toBe(ExitCode.OK);
    const out = JSON.parse(c.stdout());
    expect(out.task_id).toMatch(/^task_/);
    expect(out.state).toBe("active");
    expect(out.intent).toBe("register on acme");
  });

  it("`task get <id>` reads back a created task; an unknown id exits 5", async () => {
    const bridge = new AgentBridge();
    const create = capture(false);
    await run(["task", "create", "--intent", "t"], create.out, { bridge });
    const id = JSON.parse(create.stdout()).task_id as string;

    const get = capture(false);
    expect(await run(["task", "get", id], get.out, { bridge })).toBe(ExitCode.OK);
    expect(JSON.parse(get.stdout()).task_id).toBe(id);

    const miss = capture(false);
    expect(await run(["task", "get", "task_missing"], miss.out, { bridge })).toBe(
      ExitCode.NOT_FOUND,
    );
  });

  it("`task list` returns created tasks", async () => {
    const bridge = new AgentBridge();
    await run(["task", "create", "--intent", "a"], capture(false).out, { bridge });
    const c = capture(false);
    await run(["task", "list"], c.out, { bridge });
    expect(JSON.parse(c.stdout()).length).toBeGreaterThanOrEqual(1);
  });
});

describe("gla session create — dry-run (admission only)", () => {
  it("`-f <spec> --dry-run` accepts a valid browser-handoff proposal (exit 0)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gla-cli-"));
    try {
      const path = specFile(dir, OK_ASSEMBLY);
      const bridge = readyBridge();
      const c = capture(false);
      const code = await run(["session", "create", "-f", path, "--dry-run"], c.out, { bridge });
      expect(code).toBe(ExitCode.OK);
      const out = JSON.parse(c.stdout());
      expect(out.decision).toBe("accept");
      expect(out.dry_run).toBe(true);
      // An IMPLICIT dry-run (no --task) provisions nothing AND opens NO task — so no task_id, and the
      // task store stays empty (the §5 fix: no orphan task/cap on a dry-run).
      expect(out.task_id).toBeUndefined();
      const list = capture(false);
      await run(["task", "list"], list.out, { bridge });
      expect(JSON.parse(list.stdout()).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unavailable provider from missing WPM binding rejects with catalog.unavailable and creates no state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gla-cli-"));
    try {
      const path = specFile(dir, OK_ASSEMBLY);
      const bridge = new AgentBridge();
      const c = capture(false);
      const code = await run(["session", "create", "-f", path], c.out, { bridge });
      expect(code).toBe(ExitCode.DEPENDENCY);
      expect(JSON.parse(c.stderr()).error.code).toBe("catalog.unavailable");

      const tasks = capture(false);
      await run(["task", "list"], tasks.out, { bridge });
      expect(JSON.parse(tasks.stdout()).length).toBe(0);
      const sessions = capture(false);
      await run(["session", "list"], sessions.out, { bridge });
      expect(JSON.parse(sessions.stdout()).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("MISSING required detail → reject NOT guess: url-watcher without complete_on → exit 3", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gla-cli-"));
    try {
      const path = specFile(dir, {
        ...OK_ASSEMBLY,
        spec: { ...OK_ASSEMBLY.spec, detectors: [{ use: "url-watcher" }] },
      });
      const c = capture(false);
      const code = await run(["session", "create", "-f", path, "--dry-run"], c.out, services());
      expect(code).toBe(ExitCode.POLICY); // 3
      expect(JSON.parse(c.stderr()).error.code).toBe("policy.denied");
      expect(c.stderr()).toMatch(/complete_on/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("UNKNOWN template → exit 5 (catalog.unknown)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gla-cli-"));
    try {
      const path = specFile(dir, {
        ...OK_ASSEMBLY,
        spec: { ...OK_ASSEMBLY.spec, template: "nope" },
      });
      const c = capture(false);
      expect(await run(["session", "create", "-f", path, "--dry-run"], c.out, services())).toBe(
        ExitCode.NOT_FOUND,
      );
      expect(JSON.parse(c.stderr()).error.code).toBe("catalog.unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("MOUNT denied (catastrophic denylist) → exit 3 (mount.denied) via --mount flag", async () => {
    const c = capture(false);
    const code = await run(
      [
        "session",
        "create",
        "--template",
        "browser-handoff",
        "--intent",
        "x",
        "--recipient",
        "tg:user:1",
        "--detector",
        "user-done",
        "--mount",
        "/var/run/docker.sock::rw",
        "--dry-run",
      ],
      c.out,
      services(),
    );
    expect(code).toBe(ExitCode.POLICY); // mount.denied → 3
    expect(JSON.parse(c.stderr()).error.code).toBe("mount.denied");
  });

  it("MOUNT conflict (duplicate target) → exit 7 (mount.conflict)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gla-cli-"));
    try {
      const path = specFile(dir, {
        ...OK_ASSEMBLY,
        spec: {
          ...OK_ASSEMBLY.spec,
          mounts: [
            { host: "/home/op/a", target: "/work/x" },
            { host: "/home/op/b", target: "/work/x" },
          ],
        },
      });
      const c = capture(false);
      expect(await run(["session", "create", "-f", path, "--dry-run"], c.out, services())).toBe(
        ExitCode.CONFLICT, // 7
      );
      expect(JSON.parse(c.stderr()).error.code).toBe("mount.conflict");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a bad -f path is a usage error (exit 2), not an admission reject", async () => {
    const c = capture(false);
    expect(
      await run(["session", "create", "-f", "/no/such/file.json", "--dry-run"], c.out, services()),
    ).toBe(ExitCode.USAGE);
  });

  it("session create with neither -f nor --template is a usage error (exit 2)", async () => {
    const c = capture(false);
    expect(await run(["session", "create", "--dry-run"], c.out, services())).toBe(ExitCode.USAGE);
  });
});

describe("gla session create — real run (dispatch a Session in `issued`, no spawn)", () => {
  it("without --dry-run, admits + creates the session in `issued`, prints {session_id,state,task_id}", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gla-cli-"));
    try {
      const path = specFile(dir, OK_ASSEMBLY);
      const bridge = readyBridge();
      const c = capture(false);
      const code = await run(["session", "create", "-f", path], c.out, { bridge });
      expect(code).toBe(ExitCode.OK);
      const out = JSON.parse(c.stdout());
      expect(out.decision).toBe("accept");
      expect(out.dry_run).toBe(false);
      expect(out.session_id).toMatch(/^sess_/);
      expect(out.state).toBe("issued");
      expect(out.task_id).toMatch(/^task_/);

      // The session is readable and the implicit task now lists it.
      const get = capture(false);
      await run(["session", "get", out.session_id], get.out, { bridge });
      expect(JSON.parse(get.stdout()).state).toBe("issued");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("#5: a REJECTED `session create` (no --task) leaves NO task in the store (no orphan task/cap)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gla-cli-"));
    try {
      // A spec that admission REJECTS (url-watcher detector without the required complete_on).
      const badSpec = specFile(dir, {
        ...OK_ASSEMBLY,
        spec: { ...OK_ASSEMBLY.spec, detectors: [{ use: "url-watcher" }] },
      });
      const bridge = readyBridge();
      const c = capture(false);
      const code = await run(["session", "create", "-f", badSpec], c.out, { bridge });
      expect(code).toBe(ExitCode.POLICY); // rejected (config-schema) → exit 3
      // The implicit task must NOT have been created — admission ran BEFORE any task mint.
      const list = capture(false);
      await run(["task", "list"], list.out, { bridge });
      expect(JSON.parse(list.stdout()).length).toBe(0);
      const sessions = capture(false);
      await run(["session", "list"], sessions.out, { bridge });
      expect(JSON.parse(sessions.stdout()).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("`session create --task <id>` threads the session under an explicit task", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gla-cli-"));
    try {
      const path = specFile(dir, OK_ASSEMBLY);
      const bridge = readyBridge();
      const tc = capture(false);
      await run(["task", "create", "--intent", "explicit"], tc.out, { bridge });
      const taskId = JSON.parse(tc.stdout()).task_id as string;

      const c = capture(false);
      const code = await run(["session", "create", "-f", path, "--task", taskId], c.out, {
        bridge,
      });
      expect(code).toBe(ExitCode.OK);
      expect(JSON.parse(c.stdout()).task_id).toBe(taskId);

      const list = capture(false);
      await run(["session", "list", "--task", taskId], list.out, { bridge });
      expect(JSON.parse(list.stdout()).length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("DRY-RUN and REAL run agree (both accept) for the same spec (GLA-021 AC#4)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gla-cli-"));
    try {
      const path = specFile(dir, OK_ASSEMBLY);
      const dry = capture(false);
      expect(await run(["session", "create", "-f", path, "--dry-run"], dry.out, services())).toBe(
        ExitCode.OK,
      );
      expect(JSON.parse(dry.stdout()).decision).toBe("accept");
      const real = capture(false);
      expect(await run(["session", "create", "-f", path], real.out, services())).toBe(ExitCode.OK);
      expect(JSON.parse(real.stdout()).decision).toBe("accept");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

class FakeSessionConnectorBridge extends AgentBridge {
  override async sessionConnector(id: string) {
    return {
      session_id: id as `sess_${string}`,
      type: "cdp" as const,
      cdp_url: "ws://127.0.0.1:9222/devtools/browser/abc",
      secret_ref: "cap_ref_connector_1",
      state: "issued" as const,
    } as never;
  }
}

describe("gla session connector", () => {
  it("`session connector <id>` re-emits the connector and supports field masks", async () => {
    const c = capture(false);
    const code = await run(
      ["session", "connector", "sess_1", "--fields", "type,secret_ref"],
      c.out,
      services(new FakeSessionConnectorBridge()),
    );
    expect(code).toBe(ExitCode.OK);
    expect(JSON.parse(c.stdout())).toEqual({
      type: "cdp",
      secret_ref: "cap_ref_connector_1",
    });
  });
});

// ── Handoff verbs (Slice 4b) — dispatch + exit-code contract over a FAKE bridge ─────────────────────────
// A minimal AgentBridge subclass returning canned handoff results, so the CLI dispatch (flags, JSON output,
// the exit-6 timeout re-label) is tested without the full provision/gateway stack.
class FakeHandoffBridge extends AgentBridge {
  waitBehavior: "complete" | "timeout" = "complete";
  lastOpenArgs: unknown;
  override async handoffOpen(args: {
    session: string;
    reason?: string;
    recipient?: string;
    ttl?: string;
  }) {
    this.lastOpenArgs = args;
    return {
      handoff_id: "hand_1" as `hand_${string}`,
      link: `http://gw.local/handoff/${args.session}?grant=tok`,
      recipient: (args.recipient ?? "tg:user:123") as never,
      expires_at: "2999-01-01T00:00:00.000Z" as never,
      state: "open" as const,
      session_id: args.session as `sess_${string}`,
    };
  }
  override async handoffWait(id: string, _timeoutMs?: number) {
    if (this.waitBehavior === "timeout") {
      throw glaError("auth.expired", `handoff wait timed out for "${id}"`, { retryable: false });
    }
    // Slice 5: a completion RETURNS the normalized envelope {status, result, next?}.
    return {
      handoff_id: id as `hand_${string}`,
      status: "submitted",
      state: "completed" as const,
      result: {
        url: "https://acme.example/verify?token=completion-token-canary&ok=1",
        match: "/verify",
      },
      next: "email-verification",
    };
  }
  override handoffGet(id: string) {
    return {
      handoff_id: id as `hand_${string}`,
      link: "http://gw.local/handoff/sess_1?grant=tok",
      recipient: "tg:user:123" as never,
      expires_at: "2999-01-01T00:00:00.000Z" as never,
      state: "open" as const,
      session_id: "sess_1" as `sess_${string}`,
    };
  }
  override handoffList(_filter?: { session?: string }) {
    return [];
  }
  override async handoffCancel(id: string) {
    return {
      handoff_id: id as `hand_${string}`,
      link: "http://gw.local/handoff/sess_1?grant=tok",
      recipient: "tg:user:123" as never,
      expires_at: "2999-01-01T00:00:00.000Z" as never,
      state: "cancelled" as const,
      session_id: "sess_1" as `sess_${string}`,
    };
  }
}

describe("gla handoff verbs (Slice 4b)", () => {
  it("`handoff open --session S --reason r` prints a redacted read model (exit 0)", async () => {
    const c = capture(false);
    const bridge = new FakeHandoffBridge();
    const code = await run(
      ["handoff", "open", "--session", "sess_1", "--reason", "complete form", "--ttl", "15m"],
      c.out,
      services(bridge),
    );
    expect(code).toBe(ExitCode.OK);
    const out = JSON.parse(c.stdout());
    expect(out.handoff_id).toBe("hand_1");
    expect(out.link).toBe("<redacted-url>");
    expect(c.stdout()).not.toContain("grant=");
    expect(c.stdout()).not.toContain("tok");
    expect(out.recipient).toBe("tg:user:123");
    expect(out.expires_at).toBeTruthy();
    // The CLI passed the flags through to the bridge.
    expect(bridge.lastOpenArgs).toMatchObject({
      session: "sess_1",
      reason: "complete form",
      ttl: "15m",
    });
  });

  it("`handoff open` without --session is a usage error (exit 2)", async () => {
    const c = capture(false);
    expect(await run(["handoff", "open"], c.out, services(new FakeHandoffBridge()))).toBe(
      ExitCode.USAGE,
    );
  });

  it("`handoff wait <id>` returns the normalized completion envelope {status, result, next} (exit 0)", async () => {
    const c = capture(false);
    const bridge = new FakeHandoffBridge();
    bridge.waitBehavior = "complete";
    const code = await run(["handoff", "wait", "hand_1"], c.out, services(bridge));
    expect(code).toBe(ExitCode.OK);
    const out = JSON.parse(c.stdout());
    // The CLI preserves completion structure while redacting operator-visible result details.
    expect(out.status).toBe("submitted");
    expect(out.result).toEqual({
      url: "https://acme.example/verify?token=<redacted>&ok=1",
      match: "/verify",
    });
    expect(out.next).toBe("email-verification");
    expect(c.stdout()).not.toContain("completion-token-canary");
  });

  it("`handoff wait <id>` on a timeout/expiry exits 6 (TIMEOUT), not 4 (auth)", async () => {
    const c = capture(false);
    const bridge = new FakeHandoffBridge();
    bridge.waitBehavior = "timeout";
    const code = await run(
      ["handoff", "wait", "hand_1", "--timeout", "1s"],
      c.out,
      services(bridge),
    );
    expect(code).toBe(ExitCode.TIMEOUT); // exit 6 — the documented wait re-label of auth.expired
    expect(JSON.parse(c.stderr()).error.code).toBe("auth.expired");
  });

  it("`handoff get <id>` reads the window state (exit 0)", async () => {
    const c = capture(false);
    const code = await run(["handoff", "get", "hand_1"], c.out, services(new FakeHandoffBridge()));
    expect(code).toBe(ExitCode.OK);
    const out = JSON.parse(c.stdout());
    expect(out.state).toBe("open");
    expect(out.link).toBe("<redacted-url>");
    expect(c.stdout()).not.toContain("grant=");
  });

  it("`handoff cancel <id>` closes the window (exit 0)", async () => {
    const c = capture(false);
    const code = await run(
      ["handoff", "cancel", "hand_1"],
      c.out,
      services(new FakeHandoffBridge()),
    );
    expect(code).toBe(ExitCode.OK);
    const out = JSON.parse(c.stdout());
    expect(out.state).toBe("cancelled");
    expect(out.link).toBe("<redacted-url>");
    expect(c.stdout()).not.toContain("grant=");
  });

  it("`handoff list` returns an array (exit 0)", async () => {
    const c = capture(false);
    const code = await run(
      ["handoff", "list", "--session", "sess_1"],
      c.out,
      services(new FakeHandoffBridge()),
    );
    expect(code).toBe(ExitCode.OK);
    expect(Array.isArray(JSON.parse(c.stdout()))).toBe(true);
  });

  it("`handoff frobnicate` is a usage error (exit 2)", async () => {
    const c = capture(false);
    expect(await run(["handoff", "frobnicate"], c.out, services(new FakeHandoffBridge()))).toBe(
      ExitCode.USAGE,
    );
  });
});

/** A fake bridge that records the teardown verbs the CLI routes (Slice 7). */
class FakeTeardownBridge extends AgentBridge {
  completed: string[] = [];
  revokedTasks: string[] = [];
  revokedSessions: string[] = [];
  conflictOn: string | undefined;
  override async taskComplete(id: string) {
    if (this.conflictOn === id) {
      throw glaError("state.conflict", `task "${id}" is already terminal`, { retryable: false });
    }
    this.completed.push(id);
    return {
      task_id: id as `task_${string}`,
      state: "completed" as const,
      sessions: [],
      implicit: false,
      created_at: "2026-06-03T00:00:00.000Z" as never,
      updated_at: "2026-06-03T00:00:01.000Z" as never,
    };
  }
  override async taskRevoke(id: string) {
    this.revokedTasks.push(id);
    return {
      task_id: id as `task_${string}`,
      state: "revoked" as const,
      sessions: [],
      implicit: false,
      created_at: "2026-06-03T00:00:00.000Z" as never,
      updated_at: "2026-06-03T00:00:01.000Z" as never,
    };
  }
  override async sessionRevoke(id: string) {
    this.revokedSessions.push(id);
    return {
      session_id: id as `sess_${string}`,
      task_id: "task_1" as `task_${string}`,
      state: "revoked" as const,
      template: "browser-handoff",
    };
  }
}

describe("gla teardown verbs (Slice 7 — task complete/revoke, session revoke)", () => {
  it("`task complete <id>` drives the terminal teardown and prints {state:completed} (exit 0)", async () => {
    const bridge = new FakeTeardownBridge();
    const c = capture(false);
    const code = await run(["task", "complete", "task_1"], c.out, { bridge });
    expect(code).toBe(ExitCode.OK);
    expect(bridge.completed).toEqual(["task_1"]);
    expect(JSON.parse(c.stdout()).state).toBe("completed");
  });

  it("`task revoke <id>` aborts to a non-success terminal state {state:revoked} (exit 0)", async () => {
    const bridge = new FakeTeardownBridge();
    const c = capture(false);
    const code = await run(["task", "revoke", "task_1"], c.out, { bridge });
    expect(code).toBe(ExitCode.OK);
    expect(bridge.revokedTasks).toEqual(["task_1"]);
    expect(JSON.parse(c.stdout()).state).toBe("revoked");
  });

  it("`session revoke <id>` tears down one session and prints {state:revoked} (exit 0)", async () => {
    const bridge = new FakeTeardownBridge();
    const c = capture(false);
    const code = await run(["session", "revoke", "sess_1"], c.out, { bridge });
    expect(code).toBe(ExitCode.OK);
    expect(bridge.revokedSessions).toEqual(["sess_1"]);
    expect(JSON.parse(c.stdout()).state).toBe("revoked");
  });

  it("`task complete` with no id is a usage error (exit 2)", async () => {
    const c = capture(false);
    expect(await run(["task", "complete"], c.out, services(new FakeTeardownBridge()))).toBe(
      ExitCode.USAGE,
    );
  });

  it("`task complete` on an already-terminal task maps state.conflict → exit 7", async () => {
    const bridge = new FakeTeardownBridge();
    bridge.conflictOn = "task_done";
    const c = capture(false);
    const code = await run(["task", "complete", "task_done"], c.out, { bridge });
    expect(code).toBe(ExitCode.CONFLICT); // 7
    expect(JSON.parse(c.stderr()).error.code).toBe("state.conflict");
  });

  it("`session revoke` with no id is a usage error (exit 2)", async () => {
    const c = capture(false);
    expect(await run(["session", "revoke"], c.out, services(new FakeTeardownBridge()))).toBe(
      ExitCode.USAGE,
    );
  });
});
