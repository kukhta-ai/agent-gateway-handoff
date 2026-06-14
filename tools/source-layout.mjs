#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(here, "..");

/** Workspace roots whose package `src` directories are production runtime roots. */
export const WORKSPACE_ROOTS = Object.freeze(["packages", "adapters", "surfaces"]);

/** The allowed test-tree convention. This is data so tests and docs can point at the rule. */
export const TEST_LAYOUT_CONVENTION = Object.freeze({
  packageUnit: "packages/<name>/test/unit",
  packageContract: "packages/<name>/test/contract",
  packageIntegration: "packages/<name>/test/integration",
  packageE2e: "packages/<name>/test/e2e",
  packageFixtures: "packages/<name>/test/fixtures",
  adapterUnit: "adapters/<name>/test/unit",
  adapterContract: "adapters/<name>/test/contract",
  adapterFixtures: "adapters/<name>/test/fixtures",
  surfaceUnit: "surfaces/<name>/test/unit",
  surfaceIntegration: "surfaces/<name>/test/integration",
  topLevelHarness: "tests/<scope>",
  toolTests: "tools/**/*.test.ts",
});

const SKIP_DIRS = new Set(["dist", "node_modules"]);
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const RUNTIME_FILE_RE = /\.[cm]?[jt]sx?$/;
const TEST_ONLY_SEGMENT_RE = /(^|\/)(test|tests|fixtures|__fixtures__)(\/|$)/;
const TEST_ONLY_EXPORT_RE =
  /(^|\/)(test|tests|fixtures|__fixtures__)(\/|$)|(^|\/)testing(\/|$)|(^|\/)fake[-_][^/]+|\.(test|spec)\./i;
const FAKE_PROVIDER_SEGMENT_RE = /(^|\/)fake[-_][^/]+/i;

function toRepoPath(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function walkFiles(dir, predicate = () => true) {
  if (!existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(path, predicate));
    } else if (entry.isFile() && predicate(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function workspacePackageDirs(root) {
  return WORKSPACE_ROOTS.flatMap((workspaceRoot) => {
    const workspacePath = resolve(root, workspaceRoot);
    if (!existsSync(workspacePath)) {
      return [];
    }
    return readdirSync(workspacePath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${workspaceRoot}/${entry.name}`);
  });
}

function runtimeSrcFiles(root) {
  return workspacePackageDirs(root).flatMap((packagePath) =>
    walkFiles(resolve(root, packagePath, "src"), (name) => RUNTIME_FILE_RE.test(name)).map(
      (file) => ({
        file: toRepoPath(root, file),
        source: readFileSync(file, "utf8"),
      }),
    ),
  );
}

function packageJsons(root) {
  return workspacePackageDirs(root).flatMap((packagePath) => {
    const file = resolve(root, packagePath, "package.json");
    if (!existsSync(file) || !statSync(file).isFile()) {
      return [];
    }
    return [{ file: `${packagePath}/package.json`, packageJson: readJson(file) }];
  });
}

function packageOwner(file) {
  const [workspaceRoot, packageName] = file.split("/");
  return `${workspaceRoot}/${packageName}`;
}

function expectedLocation(file) {
  const owner = packageOwner(file);
  if (owner === "packages/app") {
    return `${owner}/test/integration/ or ${owner}/test/e2e/`;
  }
  if (owner.startsWith("adapters/")) {
    return `${owner}/test/contract/, ${owner}/test/unit/, or ${owner}/test/fixtures/`;
  }
  if (owner.startsWith("surfaces/")) {
    return `${owner}/test/integration/ or ${owner}/test/unit/`;
  }
  return `${owner}/test/unit/, ${owner}/test/contract/, ${owner}/test/integration/, ${owner}/test/e2e/, or ${owner}/test/fixtures/`;
}

function lineNumberFor(source, index) {
  return source.slice(0, index).split("\n").length;
}

function importSpecifiers(source) {
  const specifiers = [];
  const staticImport = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  const commonjsRequire = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticImport, dynamicImport, commonjsRequire]) {
    let match = re.exec(source);
    while (match !== null) {
      specifiers.push({ specifier: match[1], line: lineNumberFor(source, match.index) });
      match = re.exec(source);
    }
  }
  return specifiers;
}

function isTestOnlyImport(specifier) {
  const normalized = specifier.replaceAll("\\", "/");
  return (
    TEST_ONLY_SEGMENT_RE.test(normalized) ||
    /(^|\/)testing(\/|$)/.test(normalized) ||
    FAKE_PROVIDER_SEGMENT_RE.test(normalized)
  );
}

function flattenManifestValues(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenManifestValues);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nestedValue]) => [
      key,
      ...flattenManifestValues(nestedValue),
    ]);
  }
  return [];
}

function runtimeSrcViolations(files) {
  return files.flatMap(({ file }) => {
    const afterSrc = file.split("/src/")[1] ?? "";
    const violations = [];
    if (TEST_FILE_RE.test(file)) {
      violations.push({
        kind: "runtime-src-test-file",
        file,
        message: `${file} is a test file inside runtime src. Move it to ${expectedLocation(file)}.`,
      });
    }
    if (TEST_ONLY_SEGMENT_RE.test(afterSrc)) {
      violations.push({
        kind: "runtime-src-test-directory",
        file,
        message: `${file} is under a test-only directory inside runtime src. Move test helpers or fixtures to ${expectedLocation(file)}.`,
      });
    }
    return violations;
  });
}

function runtimeImportViolations(files) {
  return files.flatMap(({ file, source }) =>
    importSpecifiers(source)
      .filter(({ specifier }) => isTestOnlyImport(specifier))
      .map(({ specifier, line }) => ({
        kind: "runtime-test-import",
        file,
        line,
        specifier,
        message: `${file}:${line} imports test-only module "${specifier}". Production runtime source must not import package-local tests, fixtures, fake providers, or /testing exports.`,
      })),
  );
}

function manifestViolations(manifests) {
  return manifests.flatMap(({ file, packageJson }) => {
    const checkedFields = {
      bin: packageJson.bin,
      browser: packageJson.browser,
      exports: packageJson.exports,
      files: packageJson.files,
      main: packageJson.main,
      module: packageJson.module,
      types: packageJson.types,
      typings: packageJson.typings,
      typesVersions: packageJson.typesVersions,
    };
    return Object.entries(checkedFields).flatMap(([field, value]) =>
      flattenManifestValues(value)
        .filter((entry) => TEST_ONLY_EXPORT_RE.test(entry.replaceAll("\\", "/")))
        .map((entry) => ({
          kind: "production-manifest-test-export",
          file,
          field,
          value: entry,
          message: `${file} ${field} exposes test-only path "${entry}". Production manifests must publish runtime dist/bin artifacts only, not tests, fixtures, or test helpers.`,
        })),
    );
  });
}

/**
 * Check runtime src/test-tree separation against the repository layout.
 *
 * Extra inputs let tests prove failure modes without committing bad fixtures to the real tree.
 */
export function checkSourceLayout(options = {}) {
  const root = options.repoRoot ?? defaultRepoRoot;
  const files = [...runtimeSrcFiles(root), ...(options.extraRuntimeFiles ?? [])];
  const manifests = [...packageJsons(root), ...(options.extraPackageJsons ?? [])];
  const violations = [
    ...runtimeSrcViolations(files),
    ...runtimeImportViolations(files.filter(({ file }) => !TEST_FILE_RE.test(file))),
    ...manifestViolations(manifests),
  ];
  return {
    ok: violations.length === 0,
    violations,
    convention: TEST_LAYOUT_CONVENTION,
  };
}

export function formatSourceLayoutViolations(violations) {
  return [
    "Runtime source/test layout violations:",
    ...violations.map((violation) => `- ${violation.message}`),
  ].join("\n");
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const result = checkSourceLayout();
  if (!result.ok) {
    console.error(formatSourceLayoutViolations(result.violations));
    process.exit(1);
  }
}
