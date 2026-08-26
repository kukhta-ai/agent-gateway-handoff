#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["run", "gate"], {
  encoding: "utf8",
  env: {
    ...process.env,
    GLA_BROWSER_E2E_CANARY_FAIL: "1",
    GLA_BROWSER_E2E_MODE: "required",
  },
});

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (result.status === 0) {
  console.error("GLA browser E2E canary failed: `pnpm gate` unexpectedly passed.");
  process.exit(1);
}

if (!output.includes("GLA-092 browser E2E canary failure")) {
  console.error(
    "GLA browser E2E canary failed: `pnpm gate` failed for a reason other than the browser canary.",
  );
  console.error(output);
  process.exit(1);
}

console.log(
  "GLA browser E2E canary passed: a failing assertion inside a browser-backed E2E file fails `pnpm gate`.",
);
