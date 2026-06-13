import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd());
const PROTECTED_SRC_DIRS = [
  "packages/kernel/src",
  "packages/session/src",
  "packages/capability/src",
  "packages/identity/src",
] as const;

const FORBIDDEN_PROVIDER_RUNTIME_TOKENS = [
  "cdpWebSocketUrl",
  "novncEndpoint",
  "cdpUrl",
  "cdp_url",
  "internalEndpoint",
] as const;

function sourceFiles(dir: string): string[] {
  const abs = join(ROOT, dir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const path = join(abs, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...sourceFiles(relative(ROOT, path)));
      continue;
    }
    if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out;
}

describe("provider runtime boundary (GLA-088)", () => {
  it("keeps provider-specific runtime fields out of protected core/session/auth logic", () => {
    const offenders: Array<{ file: string; token: string }> = [];
    for (const dir of PROTECTED_SRC_DIRS) {
      for (const file of sourceFiles(dir)) {
        const source = readFileSync(file, "utf8");
        for (const token of FORBIDDEN_PROVIDER_RUNTIME_TOKENS) {
          if (source.includes(token)) {
            offenders.push({ file: relative(ROOT, file), token });
          }
        }
      }
    }

    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
