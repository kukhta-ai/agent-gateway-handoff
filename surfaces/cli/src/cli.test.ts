// Integration tests for the `gla` CLI surface (surfaces/cli): the exit-code taxonomy, the JSON/TTY
// output contract (docs/05 §1, §4, §5), and the Slice-1 orient commands wired over the Agent Bridge.
// Drives the async `run()` with an injected sink so no process is spawned.
import { AgentBridge } from "@gla/bridge";
import { CatalogService, defaultStoreContent } from "@gla/catalog";
import { describe, expect, it } from "vitest";
import { CLI_VERSION, type CliServices, run } from "./cli.js";
import { ExitCode } from "./exit-codes.js";
import { Output, type OutputStreams } from "./output.js";

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

/** Default services for tests (the in-tree reference-slice Bridge). */
function services(bridge: AgentBridge = new AgentBridge()): CliServices {
  return { bridge };
}

describe("gla exit codes", () => {
  it("`version` exits 0 and prints client version as JSON on stdout (non-TTY)", async () => {
    const c = capture(false);
    const code = await run(["version"], c.out, services());
    expect(code).toBe(ExitCode.OK);
    expect(JSON.parse(c.stdout())).toEqual({ client: CLI_VERSION });
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

  it("treats `--` as end-of-options so `pnpm gla -- version` works (exit 0)", async () => {
    const c = capture(false);
    expect(await run(["--", "version"], c.out, services())).toBe(ExitCode.OK);
    expect(JSON.parse(c.stdout())).toEqual({ client: CLI_VERSION });
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
