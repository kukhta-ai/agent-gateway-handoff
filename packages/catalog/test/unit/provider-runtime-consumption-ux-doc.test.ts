import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");
}

describe("provider runtime consumption UX documentation", () => {
  const doc = repoFile("docs/architecture/provider-runtime-consumption-ux.md");

  it("defines the required UX spine for the runtime-consumption flow", () => {
    for (const heading of [
      "## 1. Protagonist And Job",
      "## 2. Entry Points",
      "## 3. Read Surfaces",
      "## 4. Runtime Consumption Journey",
      "## 5. Provider And Template States",
      "## 6. Diagnostics And Recovery",
      "## 7. Write Restrictions As UX Constraints",
      "## 8. Success State And Task Handoff",
    ]) {
      expect(doc).toContain(heading);
    }
  });

  it("covers discovery, dry-run, proposal, success, and task handoff surfaces", () => {
    for (const requiredPhrase of [
      "catalog",
      "gla catalog show <provider-id>",
      "gla catalog list --kind <family> [--available]",
      "Provider detail",
      "config_schema",
      "template",
      "defaultSource",
      "compatible providers",
      "schema",
      "skill",
      "gla session create ... --dry-run",
      "gla session create ...",
      "connector descriptor",
      "hands back to task execution",
      "current executable CLI commands",
    ]) {
      expect(doc).toContain(requiredPhrase);
    }
  });

  it("explains provider and template states with runtime actions", () => {
    for (const requiredPhrase of [
      "`available`",
      "`degraded`",
      "`unavailable`",
      "`incompatible`",
      "`policy-rejected`",
      "Expected runtime action",
    ]) {
      expect(doc).toContain(requiredPhrase);
    }
  });

  it("covers required diagnostics and recovery paths", () => {
    for (const requiredPhrase of [
      "Unavailable provider",
      "Not installed provider",
      "Incompatible selection",
      "Ambiguous default",
      "Schema error",
      "Template-fixed override",
      "Missing skills",
      "Dry-run admission failure",
      "stable code",
      "skill pointer",
    ]) {
      expect(doc).toContain(requiredPhrase);
    }
  });

  it("documents write restrictions as runtime constraints without authority-mode framing", () => {
    for (const requiredPhrase of [
      "write provider code",
      "write selected provider profiles",
      "write WPM receipts",
      "daemon config",
      "AuthProvider",
      "ChannelAdapter",
      "SecretStore",
      "constraints inside",
    ]) {
      expect(doc).toContain(requiredPhrase);
    }
    expect(doc).not.toMatch(/authority modes?/i);
  });

  it("is linked from the documentation map and neighboring provider UX specs", () => {
    expect(repoFile("docs/README.md")).toContain("architecture/provider-runtime-consumption-ux.md");
    expect(repoFile("docs/architecture/provider-graph-defaults-and-extension-plan.md")).toContain(
      "provider-runtime-consumption-ux.md",
    );
    expect(repoFile("docs/architecture/provider-install-update-ux.md")).toContain(
      "provider-runtime-consumption-ux.md",
    );
  });
});
