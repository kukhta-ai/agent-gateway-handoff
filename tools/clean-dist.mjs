import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRoots = ["packages", "adapters", "surfaces"];

for (const workspaceRoot of workspaceRoots) {
  const root = resolve(workspaceRoot);
  if (!existsSync(root)) {
    continue;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dist = resolve(root, entry.name, "dist");
    if (existsSync(dist)) {
      rmSync(dist, { recursive: true, force: true });
    }
  }
}
