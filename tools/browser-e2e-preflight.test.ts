import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./browser-e2e-preflight.mjs", import.meta.url));
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function readProjectFile(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("browser E2E preflight", () => {
  it("fails the default gate path when the browser-runtime canary is missing", () => {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        GLA_BROWSER_E2E_MODE: "required",
        GLA_BROWSER_E2E_PREFLIGHT_FORCE_MISSING: "1",
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("GLA browser E2E preflight failed");
    expect(`${result.stdout}\n${result.stderr}`).toContain("backlog Definition of Done");
  });

  it("fails the default gate path when full human-view binaries are absent", () => {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        GLA_BROWSER_E2E_MODE: "required",
        PATH: "/no/such/bin",
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "full human-view stack binaries are missing",
    );
    expect(`${result.stdout}\n${result.stderr}`).toContain("xvfb x11vnc websockify");
  });

  it("makes the browser E2E opt-out visible and marks it as non-DoD", () => {
    const result = spawnSync(process.execPath, [script, "--allow-skip"], {
      encoding: "utf8",
      env: { ...process.env, GLA_BROWSER_E2E_PREFLIGHT_FORCE_MISSING: "1" },
    });

    expect(result.status).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("OPTIONAL MODE");
    expect(`${result.stdout}\n${result.stderr}`).toContain("not the Definition of Done");
  });

  it("keeps package scripts, CI, and quality-gate docs aligned", () => {
    const pkg = JSON.parse(readProjectFile("package.json")) as {
      scripts: Record<string, string>;
    };
    const ci = readProjectFile(".github/workflows/ci.yml");
    const contributing = readProjectFile("CONTRIBUTING.md");
    const testStrategy = readProjectFile("docs/architecture/test-strategy.md");

    expect(pkg.scripts.gate).toContain("pnpm run test:e2e:preflight");
    expect(pkg.scripts.gate).toContain("GLA_BROWSER_E2E_MODE=required");
    expect(pkg.scripts["gate:without-browser-e2e"]).toContain("GLA_BROWSER_E2E_MODE=optional");
    expect(pkg.scripts["gate:without-browser-e2e"]).toContain("test:e2e:preflight:optional");
    expect(pkg.scripts["gate:browser-canary"]).toContain("browser-e2e-canary");
    expect(ci.indexOf("Install browser E2E runtime")).toBeLessThan(ci.indexOf("pnpm gate"));
    expect(ci.indexOf("Install human-view E2E runtime")).toBeLessThan(
      ci.indexOf("Install browser E2E runtime"),
    );
    expect(contributing).toContain("pnpm run test:e2e:preflight");
    expect(contributing).toContain("GLA_BROWSER_E2E_MODE=required");
    expect(contributing).toContain("xvfb x11vnc websockify");
    expect(contributing).toContain("pnpm run gate:without-browser-e2e");
    expect(contributing).toContain("pnpm run gate:browser-canary");
    expect(contributing).toContain("must not be used to close a backlog task");
    expect(testStrategy).toContain("test:e2e:preflight");
    expect(testStrategy).toContain("Xvfb");
    expect(testStrategy).toContain("websockify");
    expect(testStrategy).toContain("GLA_BROWSER_E2E_MODE=optional");
    expect(testStrategy).toContain("GLA_BROWSER_E2E_CANARY_FAIL=1");
    expect(testStrategy).toContain("not valid backlog");

    const preflight = readProjectFile("tools/browser-e2e-preflight.mjs");
    expect(preflight).toContain("packages/app/test/e2e/scenario-01-e2e.test.ts");
    expect(preflight).toContain("packages/app/test/integration/provision.test.ts");
    expect(preflight).not.toContain("packages/app/src/scenario-01-e2e.test.ts");
    expect(preflight).not.toContain("packages/app/src/provision.test.ts");
    expect(preflight).toContain("adapters/launcher-process/test/contract/launcher-process.test.ts");
  });
});
