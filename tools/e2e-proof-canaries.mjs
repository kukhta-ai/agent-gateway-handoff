import { spawnSync } from "node:child_process";

const cases = [
  {
    mode: "wrong-recipient",
    marker: "GLA-093 wrong-recipient canary failure",
  },
  {
    mode: "upstream-leak",
    marker: "GLA-093 upstream-leak canary failure",
  },
];

for (const c of cases) {
  const result = spawnSync(
    "pnpm",
    ["exec", "vitest", "run", "packages/app/src/authentik-scenario-e2e.test.ts", "--reporter=dot"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GLA_BROWSER_E2E_MODE: "required",
        GLA_E2E_PROOF_CANARY: c.mode,
      },
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error(`Expected ${c.mode} canary to fail, but the E2E suite passed.`);
    process.exit(1);
  }
  if (!combined.includes(c.marker)) {
    console.error(`Expected ${c.mode} canary output to include marker: ${c.marker}`);
    console.error(combined);
    process.exit(1);
  }
}

console.log(
  "GLA-093 proof canaries passed: wrong-recipient and upstream-leak failures are visible.",
);
