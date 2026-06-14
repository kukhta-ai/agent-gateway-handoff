#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { constants, accessSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const allowSkip = process.argv.includes("--allow-skip");
const forceMissing = process.env.GLA_BROWSER_E2E_PREFLIGHT_FORCE_MISSING === "1";

const requiredFixtureGroups = [
  ["packages/app/src/scenario-01-e2e.test.ts", "packages/app/test/e2e/scenario-01-e2e.test.ts"],
  [
    "packages/app/src/authentik-scenario-e2e.test.ts",
    "packages/app/test/e2e/authentik-scenario-e2e.test.ts",
  ],
  ["packages/app/src/enrollment-e2e.test.ts", "packages/app/test/e2e/enrollment-e2e.test.ts"],
  ["packages/app/src/handoff-e2e.test.ts", "packages/app/test/e2e/handoff-e2e.test.ts"],
  ["packages/app/src/completion-e2e.test.ts", "packages/app/test/e2e/completion-e2e.test.ts"],
  ["packages/app/src/two-handoff-e2e.test.ts", "packages/app/test/e2e/two-handoff-e2e.test.ts"],
  ["packages/app/src/teardown-e2e.test.ts", "packages/app/test/e2e/teardown-e2e.test.ts"],
  [
    "packages/app/src/gateway-grant-canary-e2e.test.ts",
    "packages/app/test/e2e/gateway-grant-canary-e2e.test.ts",
  ],
  [
    "packages/app/src/novnc-handoff-client-e2e.test.ts",
    "packages/app/test/e2e/novnc-handoff-client-e2e.test.ts",
  ],
  ["packages/app/src/provision.test.ts", "packages/app/test/integration/provision.test.ts"],
  ["packages/app/src/daemon.test.ts", "packages/app/test/integration/daemon.test.ts"],
  ["packages/gateway/test/e2e/handoff-client-browser.test.ts"],
  ["adapters/detector-url/test/contract/detector-url.test.ts"],
  ["adapters/launcher-process/test/contract/launcher-process.test.ts"],
];
const requiredFullHumanViewBinaries = ["Xvfb", "x11vnc", "websockify"];

const remediation = [
  "Install the browser runtime before running the full gate:",
  "  pnpm dlx playwright@1.60.0 install chromium",
  "On Linux CI or a fresh VM, install launch dependencies too:",
  "  pnpm dlx playwright@1.60.0 install --with-deps chromium",
  "Install the full human-view stack for noVNC-backed E2E evidence:",
  "  sudo apt-get install -y xvfb x11vnc websockify",
  "If you are only doing a non-DoD local check, use:",
  "  pnpm run gate:without-browser-e2e",
].join("\n");

function binaryOnPath(bin) {
  try {
    return spawnSync("command", ["-v", bin], { shell: true, stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function reportFailure(message) {
  const text = [
    `GLA browser E2E preflight failed: ${message}`,
    "",
    remediation,
    "",
    "The default `pnpm gate` is the backlog Definition of Done and requires browser-backed/full-human-view E2E availability.",
  ].join("\n");
  if (allowSkip) {
    console.warn(
      [
        "GLA browser E2E preflight OPTIONAL MODE.",
        text,
        "",
        "This opt-out is visible and is not the Definition of Done for tasks requiring browser-level evidence.",
      ].join("\n"),
    );
    process.exit(0);
  }
  console.error(text);
  process.exit(1);
}

for (const fixtureGroup of requiredFixtureGroups) {
  if (!fixtureGroup.some((fixture) => existsSync(resolve(projectRoot, fixture)))) {
    console.error(
      `GLA browser E2E preflight failed: required test fixture is missing from all accepted locations: ${fixtureGroup.join(" or ")}`,
    );
    process.exit(1);
  }
}

if (forceMissing) {
  reportFailure("canary forced a missing browser runtime");
}

if (allowSkip) {
  console.warn(
    [
      "GLA browser E2E preflight OPTIONAL MODE.",
      "Browser-backed E2E availability is not required for this run, and browser-backed tests will report skipped branches through GLA_BROWSER_E2E_MODE=optional.",
      "This opt-out is visible and is not the Definition of Done for tasks requiring browser-level evidence.",
    ].join("\n"),
  );
  process.exit(0);
}

const missingFullHumanView = requiredFullHumanViewBinaries.filter((bin) => !binaryOnPath(bin));
if (missingFullHumanView.length > 0) {
  reportFailure(`full human-view stack binaries are missing: ${missingFullHumanView.join(", ")}`);
}

let chromium;
try {
  const requireFromApp = createRequire(new URL("../packages/app/package.json", import.meta.url));
  chromium = requireFromApp("playwright-core").chromium;
} catch (error) {
  reportFailure(`could not resolve playwright-core from @gla/app (${error.message})`);
}

let executablePath;
try {
  executablePath = chromium.executablePath();
} catch (error) {
  reportFailure(`could not resolve a Chromium executable path (${error.message})`);
}

if (typeof executablePath !== "string" || executablePath.length === 0) {
  reportFailure("playwright-core returned an empty Chromium executable path");
}
if (!existsSync(executablePath)) {
  reportFailure(`Chromium executable does not exist at ${executablePath}`);
}
try {
  accessSync(executablePath, constants.X_OK);
} catch {
  reportFailure(`Chromium executable is not runnable at ${executablePath}`);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("data:text/html,<title>gla-browser-e2e-preflight</title><h1>ok</h1>");
  const title = await page.title();
  if (title !== "gla-browser-e2e-preflight") {
    reportFailure(
      `Chromium launched but did not render the preflight page (title=${JSON.stringify(title)})`,
    );
  }
  console.log(
    `GLA browser E2E preflight passed: full human-view stack is on PATH and ${relative(projectRoot, executablePath)} launches headless Chromium.`,
  );
} catch (error) {
  reportFailure(`Chromium was found but failed to launch or render (${error.message})`);
} finally {
  await browser?.close().catch(() => {});
}
