import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");
}

const contractDoc = repoFile("docs/architecture/provider-layer-refactor-contract.md");

function sectionAfter(heading: string): string {
  const start = contractDoc.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = contractDoc.indexOf("\n## ", start + heading.length);
  return next === -1 ? contractDoc.slice(start) : contractDoc.slice(start, next);
}

function markdownRows(section: string): string[][] {
  return section
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.includes("|---"))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length > 1);
}

function rowsByFirstCell(section: string): Map<string, string[]> {
  const rows = markdownRows(section).slice(1);
  const keyedRows = rows.map((row) => [row[0]?.replaceAll("`", "") ?? "", row] as const);
  const rowMap = new Map(keyedRows);
  expect(rowMap.size, `duplicate first-cell keys in section:\n${section}`).toBe(keyedRows.length);
  return rowMap;
}

describe("provider layer refactor contract documentation", () => {
  it("names each retained provider-layer entity and its responsibility", () => {
    const rows = rowsByFirstCell(sectionAfter("## 1. Target Contract"));
    expect(rows.get("ProviderRegistry")?.[1]).toBe("Boot-time executable provider registration.");
    expect(rows.get("AppDeploymentConfig")?.[1]).toBe(
      "Operator/app boot selection for app infrastructure providers.",
    );
    expect(rows.get("CapsuleTemplate / TemplatePackage plus AssemblySpec")?.[1]).toBe(
      "Capsule composition.",
    );
    expect(rows.get("CapabilityCatalog")?.[1]).toBe("Read-only capability projection.");
    expect(rows.get("Admission Resolver")?.[1]).toBe("Proposal-to-plan resolution.");
    for (const [entity, row] of rows) {
      expect(entity).toBeTruthy();
      expect(row[2], `${entity} boundary contract`).toBeTruthy();
      expect(row[3], `${entity} non-owner clause`).toMatch(/does not|do not/);
    }
  });

  it("identifies eliminated or narrowed legacy provider-layer surfaces", () => {
    const rows = rowsByFirstCell(sectionAfter("## 2. Eliminated Or Narrowed Entities"));
    for (const requiredSurface of [
      "AppProviderSet as central runtime input",
      "ProviderSelectionProfile",
      "ProviderProfileManifest / broad profile overlays",
      "templateWithProviderProfile()",
      "Provider-set callbacks: defaultConfig, defaultServices, entrypointClientAssets, templateProbes",
      "ProviderHost as a public architecture noun",
      "ProviderRuntime / similar generic runtime nouns",
    ]) {
      const row = rows.get(requiredSurface);
      expect(row, requiredSurface).toBeDefined();
      expect(row?.[1], `${requiredSurface} disposition`).toMatch(
        /Eliminate|Split|Narrow|Delete|Move|Avoid/,
      );
      expect(row?.[2], `${requiredSurface} replacement`).toBeTruthy();
    }
  });

  it("assigns each provider family to exactly one target selection surface", () => {
    const rows = markdownRows(sectionAfter("## 3. Provider Family Assignment")).slice(1);
    const assignments = new Map(
      rows.map((row) => [row[0]?.replaceAll("`", "") ?? "", row[1] ?? ""]),
    );
    expect(assignments.size).toBe(rows.length);
    expect([...assignments.keys()].sort()).toEqual(
      [
        "AgentConnector",
        "AuthProvider",
        "ChannelAdapter",
        "CompletionDetector",
        "HumanEntrypoint",
        "Launcher",
        "SecretStore",
        "Workspace",
      ].sort(),
    );
    for (const providerFamily of ["AuthProvider", "ChannelAdapter", "SecretStore"]) {
      expect(assignments.get(providerFamily), providerFamily).toBe("`AppDeploymentConfig`");
    }
    for (const providerFamily of [
      "Launcher",
      "Workspace",
      "HumanEntrypoint",
      "AgentConnector",
      "CompletionDetector",
    ]) {
      expect(assignments.get(providerFamily), providerFamily).toBe(
        "`CapsuleTemplate` default/fixed/open part plus `AssemblySpec` override when open",
      );
    }
  });

  it("maps all required migration surfaces", () => {
    const rows = rowsByFirstCell(sectionAfter("## 4. Migration Map"));
    for (const requiredSurface of [
      "packages/app/src/composition.ts",
      "packages/app/src/index.ts",
      "packages/app/src/daemon.ts",
      "packages/catalog/src/index.ts",
      "packages/catalog/src/provider-profile.ts",
      "packages/catalog/src/provider-authoring.ts",
      "packages/provider-host/src/index.ts",
      "packages/provider-set-reference/src/index.ts",
      "packages/kernel/src/assembly.ts and packages/assembly/src/index.ts",
      "surfaces/cli/src/cli.ts and CLI/MCP surfaces",
      "packages/gateway/src/index.ts and entrypoint assets",
      "docs/",
      "Tests and quality gates",
    ]) {
      const row = rows.get(requiredSurface);
      expect(row, requiredSurface).toBeDefined();
      expect(row?.[1], `${requiredSurface} current drift`).toBeTruthy();
      expect(row?.[2], `${requiredSurface} migration action`).toBeTruthy();
    }
  });

  it("maps current artifacts and fields to the refactored model", () => {
    const rows = rowsByFirstCell(sectionAfter("## 5. Migration Guidance By Artifact"));
    for (const requiredArtifact of [
      "Current reference profile ids such as local-dev, single-operator, scenario-01, and hardened-idp",
      "--provider-profile / providerProfileId / providerProfile",
      "Legacy --auth-provider and enrollment policy fallback",
      "AppProviderSet.modules",
      "defaultConfig(providerId)",
      "defaultServices()",
      "entrypointClientAssets()",
      "templateProbes",
      "Template defaults keyed by plain template id",
      "Template compatibility using openParts or unsupported relation keys",
      "Provider authoring scaffold fields",
      "Install/update inventory profileId labels",
    ]) {
      const row = rows.get(requiredArtifact);
      expect(row, requiredArtifact).toBeDefined();
      expect(row?.[1], `${requiredArtifact} target owner`).toBeTruthy();
      expect(row?.[2], `${requiredArtifact} migration rule`).toBeTruthy();
    }
  });

  it("records the architecture decision replacing provider-set/profile layering", () => {
    const decision = sectionAfter("## 6. Architecture Decision Note");
    for (const requiredPhrase of [
      "ProviderRegistry",
      "AppDeploymentConfig",
      "CapsuleTemplate",
      "AssemblySpec",
      "CapabilityCatalog",
      "Admission Resolver",
      "provider-layer-refactor-as-is-to-be.html",
      "GLA-110.02",
      "GLA-110.13",
    ]) {
      expect(decision).toContain(requiredPhrase);
    }
    expect(decision).toContain("Replace broad provider-set/profile layering");
  });

  it("keeps target architecture docs aligned on the five-entity model", () => {
    for (const relativePath of [
      "docs/architecture/provider-graph-defaults-and-extension-plan.md",
      "docs/architecture/current-architecture-and-lifecycle-diagram.html",
      "docs/02-provider-and-extension-model.md",
    ]) {
      const doc = repoFile(relativePath);
      for (const requiredPhrase of [
        "ProviderRegistry",
        "AppDeploymentConfig",
        "CapsuleTemplate",
        "AssemblySpec",
        "CapabilityCatalog",
        "Admission Resolver",
      ]) {
        expect(doc, `${relativePath} missing ${requiredPhrase}`).toContain(requiredPhrase);
      }
    }
    expect(repoFile("docs/architecture/provider-layer-refactor-contract.md")).toContain(
      "ProviderHost as a public architecture noun is therefore retired",
    );
    expect(repoFile("docs/architecture/provider-host-extension-architecture.md")).toContain(
      "historical migration addendum",
    );
  });

  it("is linked from the documentation map", () => {
    const readme = repoFile("docs/README.md");
    expect(readme).toContain("architecture/provider-layer-refactor-contract.md");
    expect(readme).toContain("ProviderRegistry, AppDeploymentConfig");
  });
});
