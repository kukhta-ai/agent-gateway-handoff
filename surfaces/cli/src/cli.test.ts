// Smoke tests for the `gla` skeleton: the exit-code taxonomy and the JSON/TTY output contract
// (docs/05 §1, §4, §5). Drives the pure `run()` with an injected sink so no process is spawned.
import { describe, expect, it } from "vitest";
import { CLI_VERSION, run } from "./cli.js";
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
  // mode "auto": JSON unless stdout is a TTY — exactly the default contract.
  return { out: new Output("auto", streams), stdout: () => o.join(""), stderr: () => e.join("") };
}

describe("gla exit codes", () => {
  it("`version` exits 0 and prints client version as JSON on stdout (non-TTY)", () => {
    const c = capture(false);
    const code = run(["version"], c.out);
    expect(code).toBe(ExitCode.OK);
    const parsed = JSON.parse(c.stdout());
    expect(parsed).toEqual({ client: CLI_VERSION });
    expect(c.stderr()).toBe("");
  });

  it("`--help` exits 0", () => {
    const c = capture(false);
    expect(run(["--help"], c.out)).toBe(ExitCode.OK);
    expect(JSON.parse(c.stdout()).command).toBe("gla");
  });

  it("bare invocation (no args) prints usage and exits 0", () => {
    const c = capture(false);
    expect(run([], c.out)).toBe(ExitCode.OK);
  });

  it("unknown command exits 2 (usage) with a JSON error on stderr", () => {
    const c = capture(false);
    const code = run(["frobnicate"], c.out);
    expect(code).toBe(ExitCode.USAGE);
    expect(c.stdout()).toBe(""); // results channel stays clean
    const err = JSON.parse(c.stderr()).error;
    expect(err.code).toBe("usage.unknown_command");
    expect(err.skill).toBeTruthy();
  });

  it("unknown/invalid flag exits 2 (usage)", () => {
    const c = capture(false);
    expect(run(["--bogus"], c.out)).toBe(ExitCode.USAGE);
    expect(JSON.parse(c.stderr()).error.code).toBe("usage.bad_flag");
  });

  it("invalid -o value is a usage error (exit 2)", () => {
    const c = capture(false);
    expect(run(["-o", "yaml", "version"], c.out)).toBe(ExitCode.USAGE);
  });

  it("treats `--` as end-of-options so `pnpm gla -- version` works (exit 0)", () => {
    const c = capture(false);
    expect(run(["--", "version"], c.out)).toBe(ExitCode.OK);
    expect(JSON.parse(c.stdout())).toEqual({ client: CLI_VERSION });
  });
});

describe("gla JSON/TTY output contract", () => {
  it("emits JSON to stdout by default when stdout is NOT a TTY", () => {
    const c = capture(false);
    run(["version"], c.out);
    // valid JSON, single line
    expect(() => JSON.parse(c.stdout())).not.toThrow();
    expect(c.stdout().trim().startsWith("{")).toBe(true);
  });

  it("emits human-readable text to stdout when stdout IS a TTY", () => {
    const c = capture(true);
    run(["version"], c.out);
    // text mode: not JSON — a `key: value` line
    expect(c.stdout()).toContain(`client: ${CLI_VERSION}`);
    expect(() => JSON.parse(c.stdout())).toThrow();
  });

  it("-o json forces JSON even at a TTY", () => {
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
    run(["version"], out);
    expect(() => JSON.parse(o.join(""))).not.toThrow();
  });
});
