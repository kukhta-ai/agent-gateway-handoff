// Proves the module-boundary enforcement (baseline §1) is real and demonstrable (GLA-003 AC#2/#6):
// running Biome's import-boundary rule against the deliberately-bad fixture must REJECT it
// (non-zero exit) and name the offending import. If this ever passes silently, the boundary guard
// has regressed and the gate would be bypassable.
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM helper shared with the .mjs selftest (no .d.ts; runtime-only).
import { checkBoundary } from "../check-boundary.mjs";
// @ts-expect-error — plain ESM helper used as a project-owned boundary scanner.
import { checkProviderBoundaries } from "../provider-boundary.mjs";

describe("module boundary (biome import-boundary rule)", () => {
  it("rejects a core/edge module that imports a concrete adapter", () => {
    const { rejected, status, namedTheRule } = checkBoundary();
    // The whole point: a forbidden import is a NON-ZERO result.
    expect(rejected, `expected non-zero exit, got ${status}`).toBe(true);
    // And the diagnostic must actually be the boundary rule firing on the adapter import.
    expect(namedTheRule).toBe(true);
  });
});

describe("Provider Host runtime boundaries", () => {
  it("keeps migrated provider adapters behind provider sets in protected runtime packages", () => {
    const result = checkProviderBoundaries();
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("would reject a protected runtime package importing a concrete provider adapter", () => {
    const result = checkProviderBoundaries({
      extraRuntimeFiles: [
        {
          file: "packages/gateway/src/provider-leak.ts",
          source: 'import { CONNECTOR_CDP_MODULE } from "@gla/connector-cdp";\n',
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: "runtime-import",
        file: "packages/gateway/src/provider-leak.ts",
        specifier: "@gla/connector-cdp",
      }),
    );
  });

  it("would reject protected runtime CommonJS-style provider adapter loads", () => {
    const result = checkProviderBoundaries({
      extraRuntimeFiles: [
        {
          file: "packages/app/src/provider-leak.ts",
          source: 'const cdp = require("@gla/connector-cdp/testing");\n',
        },
        {
          file: "packages/worker/src/provider-leak.ts",
          source: 'import launcher = require("@gla/launcher-process/internal");\n',
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime-import",
          file: "packages/app/src/provider-leak.ts",
          specifier: "@gla/connector-cdp/testing",
        }),
        expect.objectContaining({
          kind: "runtime-import",
          file: "packages/worker/src/provider-leak.ts",
          specifier: "@gla/launcher-process/internal",
        }),
      ]),
    );
  });

  it("would reject a protected package declaring a concrete provider as a production dependency", () => {
    const result = checkProviderBoundaries({
      extraPackageJsons: [
        {
          packagePath: "packages/app",
          packageJson: { dependencies: { "@gla/auth-webauthn": "workspace:*" } },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: "runtime-dependency",
        file: "packages/app/package.json",
        specifier: "@gla/auth-webauthn",
      }),
    );
  });
});
