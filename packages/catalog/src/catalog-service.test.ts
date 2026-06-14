// Unit tests for the Catalog (packages/catalog). The load-bearing properties:
//  - host-touching dependencies are requirements until WPM receipt evidence is supplied;
//  - availability is derived from validated WPM receipt evidence plus the current GLA probe;
//  - template diagnostics expose receipt/runtime evidence separately and never literal secrets.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exitCodeFor, isGlaError } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  CatalogService,
  type DependencyBinding,
  defaultStoreContent,
  referenceWpmDependencyBindings,
} from "./index.js";

function readyCatalog(update?: (bindings: DependencyBinding[]) => void): CatalogService {
  const bindings = referenceWpmDependencyBindings();
  update?.(bindings);
  return new CatalogService({ dependencyBindings: bindings });
}

function receipt(bindings: DependencyBinding[], dependency: string): DependencyBinding {
  const found = bindings.find((b) => b.dependency === dependency);
  if (found === undefined) {
    throw new Error(`missing fixture binding: ${dependency}`);
  }
  return found;
}

function replaceReceipt(
  bindings: DependencyBinding[],
  dependency: string,
  replacement: DependencyBinding,
): void {
  const index = bindings.findIndex((b) => b.dependency === dependency);
  if (index < 0) {
    throw new Error(`missing fixture binding: ${dependency}`);
  }
  bindings[index] = replacement;
}

function withoutConnection(binding: DependencyBinding): DependencyBinding {
  const { connection: _connection, ...rest } = binding;
  return rest;
}

function withoutInverseOp(binding: DependencyBinding): DependencyBinding {
  const { inverseOp: _inverseOp, ...rest } = binding;
  return rest;
}

function withoutRuntimeManagement(binding: DependencyBinding): DependencyBinding {
  const { connection: _connection, inverseOp: _inverseOp, ...rest } = binding;
  return rest;
}

describe("CatalogService.list — WPM receipt-derived availability (GLA-082)", () => {
  it("lists seeded entities but does not mark host-touching providers available without bindings", () => {
    const cat = new CatalogService();
    const names = cat.list().map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "browser-handoff",
        "launcher-process",
        "entrypoint-novnc",
        "connector-cdp",
        "workspace-profile",
        "url-watcher",
        "user-done",
      ]),
    );

    const availableNames = cat.list({ available: true }).map((e) => e.name);
    expect(availableNames).not.toContain("launcher-process");
    expect(availableNames).not.toContain("entrypoint-novnc");
    expect(availableNames).not.toContain("connector-cdp");
    expect(availableNames).not.toContain("browser-handoff");
    expect(availableNames).toEqual(
      expect.arrayContaining(["channel-cli", "workspace-profile", "url-watcher", "user-done"]),
    );
  });

  it("valid WPM bindings plus passing current probes make dependent providers and template available", () => {
    const cat = readyCatalog();
    const availableNames = cat.list({ available: true }).map((e) => e.name);
    expect(availableNames).toEqual(
      expect.arrayContaining([
        "launcher-process",
        "entrypoint-novnc",
        "connector-cdp",
        "browser-handoff",
      ]),
    );
    expect(cat.show("launcher-process")?.requires[0]?.status).toBe("bound");
    expect(cat.show("browser-handoff")?.requires[0]).toMatchObject({
      dependency: "edge-proxy",
      status: "bound",
      ownershipMode: "local-external",
      state: "adopted",
    });
  });

  it("a current GLA probe degraded result keeps the provider out of available listings", () => {
    const cat = new CatalogService({
      content: defaultStoreContent(),
      dependencyBindings: referenceWpmDependencyBindings(),
      probes: { "launcher-process": () => "degraded" },
    });
    const launcher = cat.show("launcher-process");
    expect(launcher?.available).toBe(false);
    expect(launcher?.availability).toBe("degraded");
    expect(launcher?.requires[0]?.diagnostics).toEqual({
      install: "available",
      runtime: "degraded",
    });
    expect(cat.list({ available: true }).map((e) => e.name)).not.toContain("launcher-process");
  });

  it("missing structured receipt evidence cannot make a host dependency available", () => {
    const bindings = referenceWpmDependencyBindings();
    replaceReceipt(
      bindings,
      "browser-runtime",
      withoutConnection(receipt(bindings, "browser-runtime")),
    );
    const cat = new CatalogService({ dependencyBindings: bindings });
    const launcher = cat.show("launcher-process");
    expect(launcher?.available).toBe(false);
    expect(launcher?.requires[0]?.status).toBe("unbound");
    expect(launcher?.requires[0]?.missingEvidence).toContain("connection.refs");
  });

  it("empty connection evidence or missing required connection refs cannot bind a host dependency", () => {
    const emptyConnection = referenceWpmDependencyBindings();
    receipt(emptyConnection, "browser-runtime").connection = { refs: {} };
    const emptyConnectionCat = new CatalogService({ dependencyBindings: emptyConnection });
    expect(emptyConnectionCat.show("launcher-process")?.requires[0]).toMatchObject({
      status: "unbound",
      missingEvidence: expect.arrayContaining([
        "connection.refs.nonempty",
        "connection.refs.chromium",
      ]),
    });

    const missingRequiredRef = referenceWpmDependencyBindings();
    receipt(missingRequiredRef, "human-view").connection = {
      refs: { xvfb: { kind: "service-ref", ref: "runtime:xvfb" } },
    };
    const missingRequiredRefCat = new CatalogService({ dependencyBindings: missingRequiredRef });
    expect(missingRequiredRefCat.show("entrypoint-novnc")?.requires[0]).toMatchObject({
      status: "unbound",
      missingEvidence: expect.arrayContaining(["connection.refs.novnc"]),
    });
  });

  it("bundle evidence must match the provider's dependency contract", () => {
    const wrongVersion = referenceWpmDependencyBindings();
    receipt(wrongVersion, "browser-runtime").bundle.version = "9.9.9";
    const wrongVersionCat = new CatalogService({ dependencyBindings: wrongVersion });
    expect(wrongVersionCat.show("launcher-process")?.requires[0]).toMatchObject({
      status: "unbound",
      missingEvidence: expect.arrayContaining(["bundle.version"]),
    });

    const wrongRequires = referenceWpmDependencyBindings();
    receipt(wrongRequires, "human-view").bundle.declaredRequires = { "gla-core": "^0.1.0" };
    const wrongRequiresCat = new CatalogService({ dependencyBindings: wrongRequires });
    expect(wrongRequiresCat.show("entrypoint-novnc")?.requires[0]).toMatchObject({
      status: "unbound",
      missingEvidence: expect.arrayContaining(["bundle.declaredRequires.browser-runtime"]),
    });
  });

  it("unchecked task status or prose-like receipt fields cannot bind a host dependency", () => {
    const unchecked = referenceWpmDependencyBindings();
    receipt(unchecked, "browser-runtime").receipt = {
      taskId: "browser-runtime-3",
      status: "In Progress",
    } as never;
    const uncheckedCat = new CatalogService({ dependencyBindings: unchecked });
    expect(uncheckedCat.show("launcher-process")?.requires[0]).toMatchObject({
      status: "unbound",
      missingEvidence: expect.arrayContaining(["receipt"]),
    });

    const proseOnly = referenceWpmDependencyBindings();
    const index = proseOnly.findIndex((b) => b.dependency === "browser-runtime");
    if (index < 0) {
      throw new Error("missing browser-runtime fixture");
    }
    proseOnly[index] = {
      dependency: "browser-runtime",
      source: "conversation-memory",
      notes: "Hermes said the browser was installed",
    } as never;
    const proseCat = new CatalogService({ dependencyBindings: proseOnly });
    expect(proseCat.show("launcher-process")?.requires[0]).toMatchObject({
      status: "unbound",
      missingEvidence: expect.arrayContaining([
        "source.wpm-receipt",
        "bundle",
        "receipt",
        "lastProbe",
      ]),
    });
  });

  it("a missing or failed WPM last probe keeps the dependency unavailable", () => {
    const cat = readyCatalog((bindings) => {
      receipt(bindings, "browser-runtime").lastProbe = {
        at: "2026-06-13T00:00:00.000Z",
        result: "unavailable",
      };
    });
    const launcher = cat.show("launcher-process");
    expect(launcher?.available).toBe(false);
    expect(launcher?.requires[0]?.status).toBe("degraded");
    expect(launcher?.requires[0]?.diagnostics.install).toBe("unavailable");
  });

  it("disabled dependencies remain unavailable while preserving disabled ownership semantics", () => {
    const cat = readyCatalog((bindings) => {
      const humanView = receipt(bindings, "human-view");
      replaceReceipt(bindings, "human-view", {
        ...withoutRuntimeManagement(humanView),
        ownershipMode: "disabled",
        state: "disabled",
      });
    });
    const entrypoint = cat.show("entrypoint-novnc");
    expect(entrypoint?.available).toBe(false);
    expect(entrypoint?.requires[0]).toMatchObject({
      dependency: "human-view",
      ownershipMode: "disabled",
      state: "disabled",
      status: "unbound",
    });
  });

  it("local-adopted, remote-external, and manual-BYO outcomes keep distinct ownership evidence", () => {
    const local = readyCatalog((bindings) => {
      const browserRuntime = receipt(bindings, "browser-runtime");
      replaceReceipt(bindings, "browser-runtime", {
        ...withoutInverseOp(browserRuntime),
        ownershipMode: "local-external",
        state: "adopted",
        decisionNotes: [{ note: "Adopted host Chromium for the daemon user." }],
      });
    });
    expect(local.show("launcher-process")?.requires[0]).toMatchObject({
      ownershipMode: "local-external",
      state: "adopted",
      status: "bound",
    });

    const remote = readyCatalog((bindings) => {
      const humanView = receipt(bindings, "human-view");
      replaceReceipt(bindings, "human-view", {
        ...withoutInverseOp(humanView),
        ownershipMode: "remote-external",
        state: "remote",
        decisionNotes: [{ note: "Using an operator-run remote human-view endpoint." }],
      });
    });
    expect(remote.show("entrypoint-novnc")?.requires[0]).toMatchObject({
      ownershipMode: "remote-external",
      state: "remote",
      status: "bound",
    });

    const manual = readyCatalog((bindings) => {
      const humanView = receipt(bindings, "human-view");
      replaceReceipt(bindings, "human-view", {
        ...withoutInverseOp(humanView),
        ownershipMode: "manual-byo",
        state: "manual",
        decisionNotes: [{ note: "Operator supplied a BYO noVNC endpoint." }],
      });
    });
    expect(manual.show("entrypoint-novnc")?.requires[0]).toMatchObject({
      ownershipMode: "manual-byo",
      state: "manual",
      status: "bound",
    });
  });

  it("connection secrets are accepted and shown only as secret references", () => {
    const bindings = referenceWpmDependencyBindings();
    receipt(bindings, "browser-runtime").connection = {
      refs: {
        chromium: { kind: "path-ref", ref: "playwright:chromium" },
        clientId: { kind: "literal", ref: "gla-client" },
        clientSecret: { kind: "secret-ref", ref: "secret:gla/browser-runtime/client" },
      },
    };
    const cat = new CatalogService({ dependencyBindings: bindings });
    const conn = cat.show("launcher-process")?.requires[0]?.connection;
    expect(conn?.refs.clientId).toEqual({ kind: "literal", ref: "gla-client" });
    expect(conn?.refs.clientSecret).toEqual({
      kind: "secret-ref",
      ref: "secret:gla/browser-runtime/client",
    });
    expect(JSON.stringify(conn)).not.toContain("super-secret");
  });

  it("secret-bearing connection facts that are not secret refs are rejected", () => {
    const bindings = referenceWpmDependencyBindings();
    receipt(bindings, "browser-runtime").connection = {
      refs: {
        clientSecret: { kind: "uri-ref", ref: "https://example.invalid/not-a-secret-ref" },
      },
    };
    const cat = new CatalogService({ dependencyBindings: bindings });
    const dep = cat.show("launcher-process")?.requires[0];
    expect(dep?.status).toBe("unbound");
    expect(dep?.missingEvidence).toContain("connection.refs.clientSecret.secret-ref");

    const literalSecretRef = referenceWpmDependencyBindings();
    receipt(literalSecretRef, "browser-runtime").connection = {
      refs: {
        chromium: { kind: "path-ref", ref: "playwright:chromium" },
        clientSecret: { kind: "secret-ref", ref: "super-secret-literal" },
      },
    };
    const literalSecretCat = new CatalogService({ dependencyBindings: literalSecretRef });
    expect(literalSecretCat.show("launcher-process")?.requires[0]?.missingEvidence).toContain(
      "connection.refs.clientSecret.secret-ref-pointer",
    );
  });

  it("redaction and unresolved template placeholders cannot bind receipt or connection evidence", () => {
    const placeholderConnection = referenceWpmDependencyBindings();
    receipt(placeholderConnection, "browser-runtime").connection = {
      refs: {
        chromium: { kind: "path-ref", ref: "<redacted>" },
      },
    };
    const placeholderConnectionCat = new CatalogService({
      dependencyBindings: placeholderConnection,
    });
    expect(placeholderConnectionCat.show("launcher-process")?.requires[0]).toMatchObject({
      status: "unbound",
      missingEvidence: expect.arrayContaining(["connection.refs.chromium.placeholder"]),
    });

    const placeholderReceipt = referenceWpmDependencyBindings();
    receipt(placeholderReceipt, "browser-runtime").receipt = {
      taskId: "browser-runtime-3",
      status: "Done",
      refs: ["⟨placed-file⟩"],
      checksums: { "wpm/file": "***" },
    };
    const placeholderReceiptCat = new CatalogService({ dependencyBindings: placeholderReceipt });
    expect(placeholderReceiptCat.show("launcher-process")?.requires[0]).toMatchObject({
      status: "unbound",
      missingEvidence: expect.arrayContaining([
        "receipt.refs.0.placeholder",
        "receipt.checksums.wpm/file.placeholder",
      ]),
    });

    const unsafeReceiptAndConnection = referenceWpmDependencyBindings();
    const unsafeBinding = receipt(unsafeReceiptAndConnection, "browser-runtime");
    unsafeBinding.receipt = {
      taskId: "grant=task-grant-canary",
      status: "Done",
      recordedAt: "token=recorded-token-canary",
      refs: ["https://gla.example/handoff/sess_secret?grant=grant-canary"],
      checksums: { "token=checksum-token-canary": "sha256:abc" },
    };
    unsafeBinding.connection = {
      refs: {
        "grant=connection-grant-canary": {
          kind: "uri-ref",
          ref: "runtime:ok",
        },
        endpoint: {
          kind: "uri-ref",
          ref: "https://gla.example/enroll?grant=enroll-grant-canary",
        },
        chromium: { kind: "path-ref", ref: "playwright:chromium" },
      },
    };
    const unsafeReceiptAndConnectionCat = new CatalogService({
      dependencyBindings: unsafeReceiptAndConnection,
    });
    const unsafeDep = unsafeReceiptAndConnectionCat.show("launcher-process")?.requires[0];
    expect(unsafeDep).toMatchObject({
      status: "unbound",
      missingEvidence: expect.arrayContaining([
        "receipt.taskId.unsafe",
        "receipt.recordedAt.unsafe",
        "receipt.refs.0.unsafe",
        "receipt.checksums.key.unsafe",
        "connection.refs.key.unsafe",
        "connection.refs.endpoint.unsafe",
      ]),
    });
    const unsafeSerialized = JSON.stringify(unsafeDep);
    for (const raw of [
      "task-grant-canary",
      "recorded-token-canary",
      "grant-canary",
      "checksum-token-canary",
      "connection-grant-canary",
      "enroll-grant-canary",
      "sess_secret",
    ]) {
      expect(unsafeSerialized).not.toContain(raw);
    }

    const placeholderDiagnostics = referenceWpmDependencyBindings();
    const binding = receipt(placeholderDiagnostics, "browser-runtime");
    binding.lastProbe = {
      result: "available",
      detail: "connected through <redacted>",
    };
    binding.inverseOp = {
      description: "Remove only files installed by this bundle.",
      command: "rm --token=raw-token-canary",
      condition: "Only after https://gla.example/handoff/sess_secret?grant=grant-canary",
    };
    binding.decisionNotes = [
      {
        note: "adopted existing service",
        rationale: "client_secret=raw-client-secret-canary",
      },
    ];
    const placeholderDiagnosticsCat = new CatalogService({
      dependencyBindings: placeholderDiagnostics,
    });
    expect(placeholderDiagnosticsCat.show("launcher-process")?.requires[0]).toMatchObject({
      status: "unbound",
      missingEvidence: expect.arrayContaining([
        "lastProbe.detail.placeholder",
        "inverseOp.command.unsafe",
        "inverseOp.condition.unsafe",
        "decisionNotes.0.rationale.unsafe",
      ]),
    });
  });
});

describe("CatalogService.templateShow (GLA-082 diagnostics)", () => {
  it("reports each required part's backing dependency evidence and separate diagnostics", () => {
    const show = readyCatalog().templateShow("browser-handoff");
    expect(show.requiredParts.sort()).toEqual(
      ["connector", "detector", "entrypoint", "launcher", "workspace"].sort(),
    );
    expect(show.compatibleProviders).toMatchObject({
      entrypoint: expect.arrayContaining(["entrypoint-novnc"]),
      connector: expect.arrayContaining(["connector-cdp"]),
      detector: expect.arrayContaining(["url-watcher", "user-done"]),
    });
    expect(show.dependencies[0]).toMatchObject({
      dependency: "edge-proxy",
      status: "bound",
      connection: {
        refs: {
          publicBaseUrl: { kind: "uri-ref", ref: "https://gla.example/" },
          gatewayUpstream: { kind: "uri-ref", ref: "http://127.0.0.1:3000" },
        },
      },
    });
    const launcherPart = show.parts.find((p) => p.part === "launcher");
    expect(launcherPart?.provider).toBe("launcher-process");
    expect(launcherPart?.family).toBe("launcher");
    expect(launcherPart?.availability).toBe("available");
    expect(launcherPart?.available).toBe(true);
    expect(launcherPart?.dependencies[0]).toMatchObject({
      dependency: "browser-runtime",
      status: "bound",
      ownershipMode: "managed",
      state: "installed",
      bundle: {
        id: "browser-runtime",
        version: "0.1.0",
        declaredRequires: { "gla-core": "^0.1.0" },
      },
      receipt: { taskId: "browser-runtime-3", status: "Done" },
      lastProbe: { result: "available" },
      diagnostics: { install: "available", runtime: "available" },
    });
  });

  it("does not mark every same-family provider compatible without a template relation or default", () => {
    const content = defaultStoreContent();
    content.providers.push({
      apiVersion: "gla.dev/v1",
      kind: "AgentConnector",
      metadata: { name: "connector-unrelated", version: "0.1.0" },
      spec: {
        family: "connector",
        capability: { summary: "available connector not declared compatible with browser-handoff" },
        probe: "connector-unrelated",
      },
    });

    const show = new CatalogService({
      content,
      dependencyBindings: referenceWpmDependencyBindings(),
    }).templateShow("browser-handoff");

    expect(show.compatibleProviders?.connector).toContain("connector-cdp");
    expect(show.compatibleProviders?.connector).not.toContain("connector-unrelated");
  });

  it("keeps public-edge dependency evidence separate from access-gateway authorization facts", () => {
    const bindings = referenceWpmDependencyBindings().filter(
      (binding) => binding.dependency !== "edge-proxy",
    );
    const show = new CatalogService({ dependencyBindings: bindings }).templateShow(
      "browser-handoff",
    );

    expect(show.available).toBe(false);
    expect(show.availability).toBe("unavailable");
    expect(show.dependencies[0]).toMatchObject({
      dependency: "edge-proxy",
      status: "unbound",
      missingEvidence: ["wpm-receipt"],
      diagnostics: { install: "unavailable", runtime: "available" },
    });
    expect(show.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "template.dependency_unavailable",
          dependency: "edge-proxy",
        }),
      ]),
    );
  });

  it("accepts custom-base and subpath public-edge refs as transport dependency evidence", () => {
    const bindings = referenceWpmDependencyBindings();
    receipt(bindings, "edge-proxy").connection = {
      refs: {
        publicBaseUrl: { kind: "uri-ref", ref: "https://gla.example/team-a/" },
        gatewayUpstream: { kind: "uri-ref", ref: "http://127.0.0.1:3000" },
      },
    };

    const show = new CatalogService({ dependencyBindings: bindings }).templateShow(
      "browser-handoff",
    );

    expect(show.available).toBe(true);
    expect(show.dependencies[0]).toMatchObject({
      dependency: "edge-proxy",
      status: "bound",
      connection: {
        refs: {
          publicBaseUrl: { kind: "uri-ref", ref: "https://gla.example/team-a/" },
        },
      },
    });
  });

  it("marks templates with unknown required providers unavailable with stable provider diagnostics", () => {
    const content = defaultStoreContent();
    const template = content.templates.find(
      (candidate) => candidate.metadata.name === "browser-handoff",
    );
    if (template === undefined) {
      throw new Error("missing browser-handoff fixture");
    }
    template.spec.requiredParts.connector = "connector-missing";

    const show = new CatalogService({
      content,
      dependencyBindings: referenceWpmDependencyBindings(),
    }).templateShow("browser-handoff");

    expect(show.available).toBe(false);
    expect(show.availability).toBe("unavailable");
    const connectorPart = show.parts.find((part) => part.part === "connector");
    expect(connectorPart).toMatchObject({
      provider: "connector-missing",
      available: false,
      availability: "unavailable",
      diagnostics: [
        expect.objectContaining({
          code: "provider.unknown",
          provider: "connector-missing",
          part: "connector",
        }),
      ],
    });
  });

  it("keeps deterministic bundle payload/template/script refs separate from receipt decisions", () => {
    const bindings = referenceWpmDependencyBindings();
    const browserRuntime = receipt(bindings, "browser-runtime");
    browserRuntime.bundle = {
      ...browserRuntime.bundle,
      fileRefs: ["payload/files/browser-runtime.env"],
      templateRefs: ["payload/templates/browser-runtime.service"],
      scriptRefs: ["installer-scripts/verify-browser-runtime.mjs"],
    };
    browserRuntime.decisionNotes = [{ note: "Installed managed Chromium after host detection." }];

    const show = new CatalogService({ dependencyBindings: bindings }).templateShow(
      "browser-handoff",
    );
    const dep = show.parts.find((p) => p.part === "launcher")?.dependencies[0];
    expect(dep?.bundle).toMatchObject({
      fileRefs: ["payload/files/browser-runtime.env"],
      templateRefs: ["payload/templates/browser-runtime.service"],
      scriptRefs: ["installer-scripts/verify-browser-runtime.mjs"],
    });
    expect(dep?.decisionNotes).toEqual([
      { note: "Installed managed Chromium after host detection." },
    ]);
  });

  it("with no binding source, template details show the missing dependency evidence", () => {
    const show = new CatalogService().templateShow("browser-handoff");
    const launcherPart = show.parts.find((p) => p.part === "launcher");
    expect(show.available).toBe(false);
    expect(launcherPart?.availability).toBe("unavailable");
    expect(launcherPart?.dependencies[0]).toMatchObject({
      dependency: "browser-runtime",
      status: "unbound",
      missingEvidence: ["wpm-receipt"],
    });
  });

  it("a flipped backing probe surfaces as current runtime health, not install evidence", () => {
    const cat = new CatalogService({
      content: defaultStoreContent(),
      dependencyBindings: referenceWpmDependencyBindings(),
      probes: { "connector-cdp": () => "unavailable" },
    });
    const show = cat.templateShow("browser-handoff");
    const connectorPart = show.parts.find((p) => p.part === "connector");
    expect(connectorPart?.availability).toBe("unavailable");
    expect(connectorPart?.dependencies[0]?.diagnostics).toEqual({
      install: "available",
      runtime: "unavailable",
    });
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
  it("skillShow emits the browser-handoff SKILL.md body even when host deps are unavailable", () => {
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

describe("CatalogService runtime boundary", () => {
  it("does not import WPM executors, shells, package managers, or service managers", () => {
    const src = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/from\s+["']node:child_process["']/);
    expect(src).not.toMatch(/\b(spawn|exec|execFile)\s*\(/);
    expect(src).not.toMatch(/\b(apt|dnf|yum|brew|systemctl|docker\s+compose)\b/);
    expect(src).not.toMatch(/from\s+["'][^"']*wpm[^"']*["']/);
  });
});
