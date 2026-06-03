// AC#7 — purity: the kernel imports ONLY Node builtins (node:*) and its own relative modules.
// No adapter, no I/O library, no network/DB, no third-party runtime dependency. This test reads
// every kernel source file and asserts each import specifier is either a `node:` builtin or a
// relative path — failing loudly if a future edit pulls in a concrete dependency.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Every non-test .ts file under src/. */
function kernelSourceFiles(): string[] {
  return readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(SRC_DIR, f));
}

/** Module specifiers from static `from "x"` and dynamic-import forms. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const fromRe = /(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;
  const dynRe = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [fromRe, dynRe]) {
    let m: RegExpExecArray | null = re.exec(source);
    while (m !== null) {
      const spec = m[1];
      if (spec) {
        specs.push(spec);
      }
      m = re.exec(source);
    }
  }
  return specs;
}

describe("kernel purity (GLA-004 AC#7 / invariant 1)", () => {
  it("imports only node:* builtins and relative modules — no third-party/runtime dep", () => {
    const files = kernelSourceFiles();
    expect(files.length).toBeGreaterThan(0);

    const offenders: Array<{ file: string; spec: string }> = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(src)) {
        const isNodeBuiltin = spec.startsWith("node:");
        const isRelative = spec.startsWith("./") || spec.startsWith("../");
        if (!isNodeBuiltin && !isRelative) {
          offenders.push({ file: file.replace(SRC_DIR, "."), spec });
        }
      }
    }
    expect(offenders, `non-pure imports found: ${JSON.stringify(offenders)}`).toEqual([]);
  });

  it("shipped runtime modules touch no builtin beyond node:crypto", () => {
    // The reference signer's only runtime builtin is node:crypto; node:fs/path/url appear solely
    // in this test file (excluded here). Assert the shipped modules stay that narrow.
    const runtimeFiles = kernelSourceFiles();
    const allowedRuntimeBuiltins = new Set(["node:crypto"]);
    const used = new Set<string>();
    for (const file of runtimeFiles) {
      const src = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(src)) {
        if (spec.startsWith("node:")) {
          used.add(spec);
        }
      }
    }
    for (const b of used) {
      expect(allowedRuntimeBuiltins.has(b), `unexpected runtime builtin import: ${b}`).toBe(true);
    }
  });
});
