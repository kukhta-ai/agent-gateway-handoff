import { existsSync, readdirSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";

const workspaceRoots = ["packages", "adapters", "surfaces"];
const TEST_ARTIFACT_RE = /\.(test|spec)\.(js|d\.ts|js\.map|d\.ts\.map)$/;
const TEST_DIRS = new Set(["test", "tests", "fixtures", "__fixtures__"]);

function walk(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function distFiles() {
  return workspaceRoots.flatMap((workspaceRoot) => {
    const root = resolve(workspaceRoot);
    if (!existsSync(root)) {
      return [];
    }
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => walk(resolve(root, entry.name, "dist")));
  });
}

const violations = distFiles()
  .map((file) => relative(process.cwd(), file))
  .filter((file) => {
    const segments = file.split(sep);
    return (
      TEST_ARTIFACT_RE.test(basename(file)) || segments.some((segment) => TEST_DIRS.has(segment))
    );
  });

if (violations.length > 0) {
  console.error("Production dist contains test or fixture artifacts:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}
