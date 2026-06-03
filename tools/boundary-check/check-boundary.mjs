// Shared boundary-check runner: invoke the import-boundary lint against the deliberately-bad
// fixture and report whether it was REJECTED. Used by both the vitest test and the gate:selftest
// so they share one implementation. Prefers the local Biome binary (fast, ~30ms) and falls back to
// `pnpm exec biome` if that binary isn't present (e.g. a not-yet-fully-installed checkout).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const fixtureConfig = resolve(here, "biome.fixture.json");
const fixtureFile = resolve(here, "fixtures", "core-importing-adapter.ts");
const biomeBin = resolve(repoRoot, "node_modules", ".bin", "biome");

/**
 * Run Biome's boundary rule against the bad fixture.
 * @returns {{status:number, output:string, rejected:boolean, namedTheRule:boolean}}
 */
export function checkBoundary() {
  const args = ["check", `--config-path=${fixtureConfig}`, fixtureFile];
  const [cmd, cmdArgs] = existsSync(biomeBin)
    ? [biomeBin, args]
    : ["pnpm", ["exec", "biome", ...args]];

  let status = 0;
  let output = "";
  try {
    output = execFileSync(cmd, cmdArgs, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    status = typeof err.status === "number" ? err.status : -1;
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }

  const rejected = status !== 0;
  const namedTheRule = /noRestrictedImports|connector-cdp|Boundary violation/i.test(output);
  return { status, output, rejected, namedTheRule };
}
