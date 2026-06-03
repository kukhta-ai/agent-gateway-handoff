// Unit tests for the Catalog (packages/catalog). The load-bearing properties:
//  - availability is SYSTEM-DERIVED (a probe seam), not caller-asserted (GLA-017 AC#3): flip a
//    probe → the entity drops from the available view.
//  - template show returns required parts + each backing dependency's binding status (GLA-017 AC#2).
//  - an unknown id is a not-found (catalog.unknown → exit 5 at the CLI).
import { exitCodeFor, isGlaError } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { CatalogService, defaultStoreContent } from "./index.js";

describe("CatalogService.list — system-derived availability (GLA-017 AC#3)", () => {
  it("lists the seeded reference-slice entities", () => {
    const cat = new CatalogService();
    const names = cat.list().map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "browser-handoff",
        "launcher-process",
        "entrypoint-novnc",
        "connector-cdp",
        "workspace-profile",
        "detector-url",
        "user-done",
      ]),
    );
  });

  it("`available: true` returns only entities the SYSTEM derived as available", () => {
    const cat = new CatalogService();
    const available = cat.list({ available: true });
    // With all in-tree probes available, the providers are available.
    expect(available.map((e) => e.name)).toEqual(expect.arrayContaining(["launcher-process"]));
    expect(available.every((e) => e.available)).toBe(true);
  });

  it("flipping a probe to unavailable DROPS that entity from the available view", () => {
    const cat = new CatalogService({
      content: defaultStoreContent(),
      // System-derived: the launcher's probe now reports unavailable.
      probes: { "launcher-process": () => "unavailable" },
    });
    const availableNames = cat.list({ available: true }).map((e) => e.name);
    expect(availableNames).not.toContain("launcher-process");
    // And the template that requires it is no longer available either (derived, not asserted).
    expect(availableNames).not.toContain("browser-handoff");
    // The entity still EXISTS in the index (show), just not as available.
    expect(cat.show("launcher-process")?.available).toBe(false);
    expect(cat.show("launcher-process")?.availability).toBe("unavailable");
  });

  it("an unbound dependency forces unavailable (binding drives availability, not the author)", () => {
    const content = defaultStoreContent();
    // Mutate the seeded binding to unbound for the launcher's browser-runtime dependency.
    const launcher = content.providers.find((p) => p.metadata.name === "launcher-process");
    if (launcher?.spec.requires?.[0]) {
      launcher.spec.requires[0] = {
        ...launcher.spec.requires[0],
        status: "unbound",
      };
    }
    const cat = new CatalogService({ content });
    expect(cat.show("launcher-process")?.available).toBe(false);
  });

  it("filters by kind", () => {
    const cat = new CatalogService();
    const launchers = cat.list({ kind: "Launcher" });
    expect(launchers.map((e) => e.name)).toEqual(["launcher-process"]);
  });
});

describe("CatalogService.templateShow (GLA-017 AC#2)", () => {
  it("returns required parts and each backing dependency's binding status", () => {
    const cat = new CatalogService();
    const show = cat.templateShow("browser-handoff");
    expect(show.requiredParts.sort()).toEqual(
      ["connector", "detector", "entrypoint", "launcher", "workspace"].sort(),
    );
    const launcherPart = show.parts.find((p) => p.part === "launcher");
    expect(launcherPart?.provider).toBe("launcher-process");
    expect(launcherPart?.availability).toBe("available");
    // The backing dependency binding status is present.
    expect(launcherPart?.dependencies?.[0]?.dependency).toBe("browser-runtime");
    expect(launcherPart?.dependencies?.[0]?.status).toBe("bound");
  });

  it("a flipped backing probe surfaces as a hole (the part is unavailable)", () => {
    const cat = new CatalogService({
      content: defaultStoreContent(),
      probes: { "connector-cdp": () => "unavailable" },
    });
    const show = cat.templateShow("browser-handoff");
    const connectorPart = show.parts.find((p) => p.part === "connector");
    expect(connectorPart?.availability).toBe("unavailable");
    // The template as a whole is no longer available.
    expect(show.available).toBe(false);
  });

  it("an unknown template id throws catalog.unknown (→ exit 5)", () => {
    const cat = new CatalogService();
    try {
      cat.templateShow("does-not-exist");
      throw new Error("expected templateShow to throw");
    } catch (e) {
      expect(isGlaError(e)).toBe(true);
      if (isGlaError(e)) {
        expect(e.code).toBe("catalog.unknown");
        expect(exitCodeFor(e.code)).toBe(5);
      }
    }
  });

  it("resolveTemplate returns undefined for an unknown id (the CLI maps that to exit 5)", () => {
    const cat = new CatalogService();
    expect(cat.resolveTemplate("nope")).toBeUndefined();
    expect(cat.resolveTemplate("browser-handoff")?.requiredParts.length).toBe(5);
  });
});

describe("CatalogService skills", () => {
  it("skillShow emits the browser-handoff SKILL.md body", () => {
    const cat = new CatalogService();
    const skill = cat.skillShow("browser-handoff");
    expect(skill.id).toBe("browser-handoff");
    expect(skill.body).toContain("# browser-handoff");
  });

  it("skillList --for filters by template", () => {
    const cat = new CatalogService();
    const forTemplate = cat.skillList({ for: "browser-handoff" });
    expect(forTemplate.map((s) => s.id)).toContain("browser-handoff");
  });

  it("an unknown skill id throws catalog.unknown (→ exit 5)", () => {
    const cat = new CatalogService();
    expect(() => cat.skillShow("nope")).toThrowError(/unknown skill/i);
  });
});
