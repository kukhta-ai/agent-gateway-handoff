import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");
}

describe("provider authoring UX documentation", () => {
  const doc = repoFile("docs/architecture/provider-authoring-ux.md");

  it("defines the required UX spine for the provider-authoring flow", () => {
    for (const heading of [
      "## 1. Protagonist And Job",
      "## 2. Entry Points",
      "## 3. Package Inputs",
      "## 4. Authoring Journey",
      "## 5. States",
      "## 6. Diagnostics And Recovery",
      "## 7. Guarded Operations As UX Constraints",
      "## 8. Success State And Handoff",
    ]) {
      expect(doc).toContain(heading);
    }
  });

  it("covers provider and template authoring without treating templates as runtime factories", () => {
    expect(doc).toContain("ProviderPackage");
    expect(doc).toContain("TemplatePackage");
    expect(doc).toContain("CapsuleTemplate");
    expect(doc).toContain("not a runtime provider factory");
    expect(doc).toContain("No Provider Host runtime factory");
  });

  it("covers diagnostics, recovery, and guarded operations as UX constraints", () => {
    for (const requiredPhrase of [
      "Missing manifest fields",
      "Invalid schemas",
      "Missing skills or docs",
      "Missing probes",
      "Dependency requirements",
      "Duplicate ids or versions",
      "Inert or unsupported fields",
      "Redaction failures",
      "Contract-test failures",
      "operator install/update",
      "not as the journey structure",
      "current executable `gla` CLI",
      "JSON-first authoring flow",
    ]) {
      expect(doc).toContain(requiredPhrase);
    }
    expect(doc).not.toMatch(/authority modes?/i);
  });

  it("is linked from the documentation map and provider author workflow", () => {
    expect(repoFile("docs/README.md")).toContain("architecture/provider-authoring-ux.md");
    expect(repoFile("docs/architecture/provider-author-workflow.md")).toContain(
      "provider-authoring-ux.md",
    );
    const graphPlan = repoFile("docs/architecture/provider-graph-defaults-and-extension-plan.md");
    expect(graphPlan).toContain("Produce a readiness handoff");
    expect(graphPlan).toContain(
      "The operator install/update flow starts from that readiness handoff",
    );
  });
});
