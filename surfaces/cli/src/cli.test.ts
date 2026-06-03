// Integration tests for the `gla` CLI surface (surfaces/cli): the exit-code taxonomy, the JSON/TTY
// output contract (docs/05 §1, §4, §5), and the Slice-1 orient commands wired over the Agent Bridge.
// Drives the async `run()` with an injected sink so no process is spawned.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      const bridge = new AgentBridge();
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
      const bridge = new AgentBridge();
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
      const bridge = new AgentBridge();
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
      const bridge = new AgentBridge();
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
