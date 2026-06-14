import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run unit + boundary tests across all workspace packages.
    include: [
      "packages/**/*.test.ts",
      "surfaces/**/*.test.ts",
      "adapters/**/*.test.ts",
      "tools/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // The boundary test shells out to Biome (a real subprocess) — give it headroom.
    testTimeout: 60_000,
    globals: false,
  },
});
