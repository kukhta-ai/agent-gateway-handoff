import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");
}

describe("provider install/update UX documentation", () => {
  const doc = repoFile("docs/architecture/provider-install-update-ux.md");

  it("defines the required UX spine for the operator install/update flow", () => {
    for (const heading of [
      "## 1. Protagonist And Job",
      "## 2. Executable Entry Points",
      "## 3. Inputs",
      "## 4. Activation Preview",
      "## 5. Rejection And Diagnostics",
      "## 6. Doctor Output",
      "## 7. Rollback",
      "## 8. UX Boundaries",
    ]) {
      expect(doc).toContain(heading);
    }
  });

  it("covers executable commands, WPM touchpoints, doctor evidence, and rollback", () => {
    for (const requiredPhrase of [
      "gla provider-install plan <candidate.json> [--state <active.json>]",
      "gla provider-install apply <candidate.json> --state <active.json>",
      "gla doctor provider-graph <active.json>",
      "gla provider-install rollback <snapshot.json> --state <active.json>",
      "dependencyBindings",
      "signed: true",
      "verified: true",
      "rollback snapshot",
      "leaves the previously active inventory observable and unchanged",
      "browser-client asset provenance and mutability",
      "packaged",
      "local override",
    ]) {
      expect(doc).toContain(requiredPhrase);
    }
    expect(doc).not.toContain("not the current executable `gla` CLI contract");
    expect(doc).not.toContain("deferred");
  });

  it("covers diagnostics and recovery without authority-mode framing", () => {
    for (const requiredPhrase of [
      "a package is unsigned or unverifiable",
      "provider ids, provider versions, or template ids collide",
      "compatibility relations are ambiguous or unresolved",
      "host-touching dependency evidence is missing",
      "Diagnostics name the affected provider id, family, package, template, dependency, and layer",
      "Runtime agents inspect catalog, template, schema, skill, dry-run, and",
    ]) {
      expect(doc).toContain(requiredPhrase);
    }
    expect(doc).not.toMatch(/authority modes?/i);
  });

  it("is linked from the documentation map and graph-related UX specs", () => {
    expect(repoFile("docs/README.md")).toContain("architecture/provider-install-update-ux.md");
    expect(repoFile("docs/architecture/provider-graph-defaults-and-extension-plan.md")).toContain(
      "provider-install-update-ux.md",
    );
    expect(repoFile("docs/architecture/provider-authoring-ux.md")).toContain(
      "provider-install-update-ux.md",
    );
  });
});
