// Provider Host boundary scanner (GLA-101).
//
// Biome proves the generic import-boundary rule can reject a deliberately bad fixture, but the
// Provider Host migration needs a richer project rule: migrated provider adapters may be imported
// by the selected provider set and tests, not by runtime narrow-waist packages.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

/** Concrete provider packages that must stay behind a provider set in runtime code. */
export const PROVIDER_ADAPTER_PACKAGES = Object.freeze([
  "@gla/auth-authentik",
  "@gla/auth-webauthn",
  "@gla/channel-cli",
  "@gla/channel-telegram",
  "@gla/connector-cdp",
  "@gla/detector-url",
  "@gla/entrypoint-novnc",
  "@gla/launcher-docker",
  "@gla/launcher-process",
  "@gla/workspace-profile",
]);

/** Provider-set distributions that are allowed only at explicit distribution/default entrypoints. */
export const REFERENCE_PROVIDER_SET_PACKAGES = Object.freeze(["@gla/provider-set-reference"]);

/** Runtime source files that intentionally select a provider-set distribution at boot. */
export const PROVIDER_SET_ENTRYPOINT_FILES = Object.freeze(["packages/app/src/index.ts"]);

/** Runtime packages whose production source must not know concrete provider adapters. */
export const PROTECTED_RUNTIME_PACKAGES = Object.freeze([
  "packages/app",
  "packages/gateway",
  "packages/session",
  "packages/identity",
  "packages/route",
  "packages/completion",
  "packages/worker",
  "packages/kernel",
]);

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TS_FILE_RE = /\.[cm]?tsx?$/;
const SKIP_DIRS = new Set(["dist", "node_modules"]);

function isProviderAdapterSpecifier(specifier) {
  return PROVIDER_ADAPTER_PACKAGES.some(
    (providerPackage) =>
      specifier === providerPackage || specifier.startsWith(`${providerPackage}/`),
  );
}

function isReferenceProviderSetSpecifier(specifier) {
  return REFERENCE_PROVIDER_SET_PACKAGES.some(
    (providerSetPackage) =>
      specifier === providerSetPackage || specifier.startsWith(`${providerSetPackage}/`),
  );
}

function isProviderSetEntrypoint(file) {
  return PROVIDER_SET_ENTRYPOINT_FILES.includes(file.replaceAll("\\", "/"));
}

function relativeImportTargets(file, specifier) {
  if (!specifier.startsWith(".")) {
    return [];
  }
  const target = resolve("/", dirname(file), specifier).slice(1).replaceAll("\\", "/");
  const candidates = [target];
  if (/\.[cm]?js$/i.test(target)) {
    candidates.push(target.replace(/\.[cm]?js$/i, ".ts"));
  }
  if (!/\.[cm]?[jt]sx?$/i.test(target)) {
    candidates.push(`${target}.ts`, `${target}/index.ts`);
  }
  return candidates;
}

function isProviderSetEntrypointRelativeImport(file, specifier) {
  return relativeImportTargets(file, specifier).some((target) =>
    PROVIDER_SET_ENTRYPOINT_FILES.includes(target),
  );
}

function walkFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(path));
    } else if (entry.isFile() && TS_FILE_RE.test(entry.name) && !TEST_FILE_RE.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
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

function retiredProviderLayerViolations(file, source) {
  const violations = [];
  const retiredToken = /\b(AppProviderSet|ProviderSelectionProfile|ProviderProfileManifest)\b/g;
  let tokenMatch = retiredToken.exec(source);
  while (tokenMatch !== null) {
    violations.push({
      kind: "runtime-retired-provider-layer-token",
      file,
      line: lineNumberFor(source, tokenMatch.index),
      token: tokenMatch[1],
      message: `${file}:${lineNumberFor(source, tokenMatch.index)} uses retired provider-layer token "${tokenMatch[1]}". Protected runtime packages must use ProviderRegistry, AppDeploymentConfig, capsule templates/assembly, and resolved capsule plans; no legacy runtime compatibility files are supported.`,
    });
    tokenMatch = retiredToken.exec(source);
  }

  const directProviderSetRead =
    /\bproviderSet\s*\??\.\s*(modules|profiles|profile|selectedProfileId|defaultConfig|defaultServices|entrypointClientAssets|templateProbes)\b/g;
  let readMatch = directProviderSetRead.exec(source);
  while (readMatch !== null) {
    violations.push({
      kind: "runtime-provider-set-shape-read",
      file,
      line: lineNumberFor(source, readMatch.index),
      token: `providerSet.${readMatch[1]}`,
      message: `${file}:${lineNumberFor(source, readMatch.index)} reads legacy provider-set shape "${readMatch[1]}". Runtime code must use ProviderRegistry, AppDeploymentConfig, capsule templates/assembly, and resolved capsule plans; the legacy compatibility adapter has been removed.`,
    });
    readMatch = directProviderSetRead.exec(source);
  }
  return violations;
}

function sourceViolations(file, source) {
  return [
    ...importSpecifiers(source).flatMap(({ specifier, line }) => {
      if (isProviderAdapterSpecifier(specifier)) {
        return [
          {
            kind: "runtime-import",
            file,
            line,
            specifier,
            message: `${file}:${line} imports concrete provider adapter "${specifier}". Runtime packages must use provider ids, kernel ports, ProviderHost, or a selected provider set.`,
          },
        ];
      }
      if (isReferenceProviderSetSpecifier(specifier) && !isProviderSetEntrypoint(file)) {
        return [
          {
            kind: "runtime-reference-set-import",
            file,
            line,
            specifier,
            message: `${file}:${line} imports reference provider set "${specifier}". Generic runtime packages must receive provider-set/profile data; only explicit distribution/default entrypoints may select a concrete provider set.`,
          },
        ];
      }
      if (
        isProviderSetEntrypointRelativeImport(file, specifier) &&
        !isProviderSetEntrypoint(file)
      ) {
        return [
          {
            kind: "runtime-provider-set-entrypoint-import",
            file,
            line,
            specifier,
            message: `${file}:${line} imports the provider-set distribution entrypoint "${specifier}". Generic runtime files must import provider-set-agnostic modules such as composition.ts, not the reference/default entrypoint.`,
          },
        ];
      }
      return [];
    }),
    ...retiredProviderLayerViolations(file, source),
  ];
}

function packageDependencyViolations(packagePath, packageJson) {
  const dependencies = packageJson.dependencies ?? {};
  return Object.keys(dependencies)
    .filter((specifier) => isProviderAdapterSpecifier(specifier))
    .map((specifier) => ({
      kind: "runtime-dependency",
      file: `${packagePath}/package.json`,
      specifier,
      message: `${packagePath}/package.json declares concrete provider adapter "${specifier}" as a production dependency. Put concrete providers behind a provider-set package; test-only imports belong in devDependencies.`,
    }));
}

function protectedRuntimeFiles(root) {
  return PROTECTED_RUNTIME_PACKAGES.flatMap((packagePath) => {
    const sourceRoot = resolve(root, packagePath, "src");
    return walkFiles(sourceRoot).map((file) => ({
      file: relative(root, file),
      source: readFileSync(file, "utf8"),
    }));
  });
}

function protectedPackageJsons(root) {
  return PROTECTED_RUNTIME_PACKAGES.flatMap((packagePath) => {
    const file = resolve(root, packagePath, "package.json");
    if (!existsSync(file) || !statSync(file).isFile()) {
      return [];
    }
    return [{ packagePath, packageJson: JSON.parse(readFileSync(file, "utf8")) }];
  });
}

/**
 * Check Provider Host boundaries against current repo state.
 *
 * `extraRuntimeFiles` exists so tests can prove the check fails on a synthetic protected-package
 * import without committing a permanently failing fixture.
 */
export function checkProviderBoundaries(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const runtimeFiles = [...protectedRuntimeFiles(root), ...(options.extraRuntimeFiles ?? [])];
  const packageJsons = [...protectedPackageJsons(root), ...(options.extraPackageJsons ?? [])];
  const violations = [
    ...runtimeFiles.flatMap(({ file, source }) => sourceViolations(file, source)),
    ...packageJsons.flatMap(({ packagePath, packageJson }) =>
      packageDependencyViolations(packagePath, packageJson),
    ),
  ];
  return { ok: violations.length === 0, violations };
}
