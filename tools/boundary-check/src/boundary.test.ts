// Proves the module-boundary enforcement (baseline §1) is real and demonstrable (GLA-003 AC#2/#6):
// running Biome's import-boundary rule against the deliberately-bad fixture must REJECT it
// (non-zero exit) and name the offending import. If this ever passes silently, the boundary guard
// has regressed and the gate would be bypassable.
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM helper used as a project-owned source-layout scanner.
import { TEST_LAYOUT_CONVENTION, checkSourceLayout } from "../../source-layout.mjs";
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

describe("runtime source/test layout", () => {
  it("keeps runtime src separated from package-local and app-local test trees", () => {
    const result = checkSourceLayout();
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    expect(TEST_LAYOUT_CONVENTION.packageUnit).toBe("packages/<name>/test/unit");
    expect(TEST_LAYOUT_CONVENTION.packageE2e).toBe("packages/<name>/test/e2e");
    expect(TEST_LAYOUT_CONVENTION.adapterContract).toBe("adapters/<name>/test/contract");
    expect(TEST_LAYOUT_CONVENTION.topLevelHarness).toBe("tests/<scope>");
  });

  it("would reject a test file placed under runtime src with an actionable target location", () => {
    const result = checkSourceLayout({
      extraRuntimeFiles: [
        {
          file: "packages/app/src/regression.test.ts",
          source: 'import { describe } from "vitest";\n',
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: "runtime-src-test-file",
        file: "packages/app/src/regression.test.ts",
        message: expect.stringContaining(
          "packages/app/test/integration/ or packages/app/test/e2e/",
        ),
      }),
    );
  });

  it("would reject production runtime imports from test fixtures or /testing exports", () => {
    const result = checkSourceLayout({
      extraRuntimeFiles: [
        {
          file: "packages/app/src/fixture-leak.ts",
          source:
            'import { FakeAuthentik } from "../../../../adapters/auth-authentik/test/fixtures/fake-authentik.js";\n',
        },
        {
          file: "packages/gateway/src/testing-export-leak.ts",
          source: 'const helper = require("@gla/auth-authentik/testing");\n',
        },
        {
          file: "packages/identity/src/fake-provider-leak.ts",
          source: 'import { FakeAuthentik } from "@gla/auth-authentik/fake-authentik";\n',
        },
        {
          file: "packages/session/src/relative-fake-provider-leak.ts",
          source:
            'import { FakeAuthentik } from "../../../adapters/auth-authentik/src/fake-authentik.js";\n',
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime-test-import",
          file: "packages/app/src/fixture-leak.ts",
          specifier: "../../../../adapters/auth-authentik/test/fixtures/fake-authentik.js",
        }),
        expect.objectContaining({
          kind: "runtime-test-import",
          file: "packages/gateway/src/testing-export-leak.ts",
          specifier: "@gla/auth-authentik/testing",
        }),
        expect.objectContaining({
          kind: "runtime-test-import",
          file: "packages/identity/src/fake-provider-leak.ts",
          specifier: "@gla/auth-authentik/fake-authentik",
        }),
        expect.objectContaining({
          kind: "runtime-test-import",
          file: "packages/session/src/relative-fake-provider-leak.ts",
          specifier: "../../../adapters/auth-authentik/src/fake-authentik.js",
        }),
      ]),
    );
  });

  it("would reject production package manifests that export tests or fixtures", () => {
    const result = checkSourceLayout({
      extraPackageJsons: [
        {
          file: "adapters/auth-authentik/package.json",
          packageJson: {
            bin: { "fake-authentik": "./test/fixtures/bin.js" },
            browser: { "./dist/index.js": "./fixtures/browser.js" },
            exports: {
              ".": "./dist/index.js",
              "./fake-authentik": "./dist/fake-authentik.js",
              "./testing": "./test/fixtures/fake-authentik.ts",
            },
            files: ["dist", "test/fixtures"],
            main: "./dist/index.js",
            module: "./fixtures/module.js",
            types: "./dist/index.d.ts",
            typesVersions: { "*": { testing: ["test/fixtures/types.d.ts"] } },
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "production-manifest-test-export",
          file: "adapters/auth-authentik/package.json",
          field: "exports",
          value: "./testing",
        }),
        expect.objectContaining({
          kind: "production-manifest-test-export",
          file: "adapters/auth-authentik/package.json",
          field: "exports",
          value: "./fake-authentik",
        }),
        expect.objectContaining({
          kind: "production-manifest-test-export",
          file: "adapters/auth-authentik/package.json",
          field: "files",
          value: "test/fixtures",
        }),
        expect.objectContaining({
          kind: "production-manifest-test-export",
          file: "adapters/auth-authentik/package.json",
          field: "bin",
          value: "./test/fixtures/bin.js",
        }),
        expect.objectContaining({
          kind: "production-manifest-test-export",
          file: "adapters/auth-authentik/package.json",
          field: "browser",
          value: "./fixtures/browser.js",
        }),
        expect.objectContaining({
          kind: "production-manifest-test-export",
          file: "adapters/auth-authentik/package.json",
          field: "module",
          value: "./fixtures/module.js",
        }),
        expect.objectContaining({
          kind: "production-manifest-test-export",
          file: "adapters/auth-authentik/package.json",
          field: "typesVersions",
          value: "test/fixtures/types.d.ts",
        }),
      ]),
    );
  });
});
