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
      "## 2. Entry Points",
      "## 3. Inputs",
      "## 4. Named Profiles And Defaults",
      "## 5. Install/Update Journey",
      "## 6. States",
      "## 7. Diagnostics And Recovery",
      "## 8. Guarded Operations And Rollback Limits",
      "## 9. Success State And Handoff",
    ]) {
      expect(doc).toContain(heading);
    }
  });

  it("covers named profiles, overlays, WPM touchpoints, doctor evidence, and rollback", () => {
    for (const requiredPhrase of [
      "named provider profile",
      "ProviderProfileOverlay",
      "WPM bundle metadata",
      "DependencyBinding",
      "gla doctor provider-graph",
      "not the current executable `gla` CLI contract",
      "deferred",
      "public-edge transport evidence",
      "rollback snapshot",
      "ready-to-apply",
      "rolled-back",
    ]) {
      expect(doc).toContain(requiredPhrase);
    }
  });

  it("covers diagnostics and recovery without global default ambiguity", () => {
    for (const requiredPhrase of [
      "Unavailable dependency",
      "Invalid overlay",
      "Unresolved secret ref",
      "Failed WPM probe",
      "Degraded runtime probe",
      "Unsafe public-edge evidence",
      "Profile ambiguity",
      "A default is always default **inside a named profile**",
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
