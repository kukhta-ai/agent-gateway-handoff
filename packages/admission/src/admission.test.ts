// UNIT tests for the AdmissionService mutate→validate pipeline (packages/admission, GLA-020/021).
// The HEART, and a security seam — the negatives are covered hard. Admission depends on the
// PolicyPort CONTRACT (not Cedar): a tiny in-test forbid-wins PolicyPort stands in (the real Cedar
// guarantee is proven by adapters/policy-cedar's own contract test). Each rejection class maps to its
// stable code + exit code (3/4/5/7/8). DRY-RUN == real-run for the same spec (GLA-021 AC#4). Pure.

import { mkdirSync, mkdtempSync, realpathSync as realpath, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import type {
  Capability,
  PolicyContext,
  PolicyPort,
  RecipientRef,
  ResolvedAssemblySpec,
} from "@gla/kernel";
import { HmacCapabilitySigner } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  type AdmissionCatalogPort,
  AdmissionService,
  type AdmissionTemplateDefaults,
  type AssemblyProposal,
  DEFAULT_MOUNT_POLICY,
  type LauncherMountCapability,
  type ProviderInfo,
  type TemplateDefaults,
  defaultDenylist,
  glaStateDir,
} from "./index.js";

// ── A controllable test catalog (so each rejection branch is reachable) ──────────────────────────
const BROWSER_DEFAULTS: TemplateDefaults = {
  template: "browser-handoff",
  launcher: { use: "launcher-process" },
  entrypoints: [{ use: "entrypoint-novnc" }],
  connector: { use: "connector-cdp" },
  workspace: { use: "workspace-profile" },
  // The fake template's default detector is `user-done` (no required param) so a bare {template,
  // recipient} proposal is admissible in these unit tests; the agent ADDS `url-watcher` (which
  // requires `complete_on`) when it wants URL completion. (The real catalog's default detector is
  // `url-watcher`, so a bare proposal there correctly rejects — covered by the app-level test.)
  detectors: [{ use: "user-done" }],
  ttl: "1h",
  // docs/04 §5: launcher + workspace are FIXED; entrypoint/connector/detector are OPEN (compatible).
  openParts: ["entrypoint", "connector", "detector"],
  compatibleProviders: {
    entrypoint: ["entrypoint-novnc"],
    connector: ["connector-cdp"],
    detector: ["url-watcher", "user-done"],
  },
};

const LAUNCHER_CAP: LauncherMountCapability = {
  file: true,
  directory: true,
  modes: ["ro", "rw"],
};

interface FakeCatalogOpts {
  /** Provider availability/schema overrides by name. */
  providers?: Record<string, ProviderInfo | undefined>;
  /** Whether the template is known (default true). */
  templateKnown?: boolean;
  /** Optional template availability/diagnostics override. */
  templateStatus?: Pick<
    AdmissionTemplateDefaults,
    "available" | "availability" | "dependencies" | "diagnostics"
  >;
  /** Launcher mount capability override (default: file+dir, ro+rw). */
  launcherCap?: LauncherMountCapability | undefined;
}

function fakeCatalog(opts: FakeCatalogOpts = {}): AdmissionCatalogPort {
  const defaultProviders: Record<string, ProviderInfo> = {
    "launcher-process": { name: "launcher-process", available: true },
    "entrypoint-novnc": { name: "entrypoint-novnc", available: true },
    "connector-cdp": { name: "connector-cdp", available: true },
    "workspace-profile": { name: "workspace-profile", available: true },
    "user-done": { name: "user-done", available: true },
    "url-watcher": {
      name: "url-watcher",
      available: true,
      config_schema: { complete_on: { type: "string", required: true, pattern: "^/" } },
    },
  };
  return {
    templateDefaults: (id) =>
      (opts.templateKnown ?? true) && id === "browser-handoff"
        ? { ...BROWSER_DEFAULTS, ...(opts.templateStatus ?? {}) }
        : undefined,
    provider: (use) => {
      if (opts.providers && use in opts.providers) {
        return opts.providers[use];
      }
      return defaultProviders[use];
    },
    launcherMountCapability: () => ("launcherCap" in opts ? opts.launcherCap : LAUNCHER_CAP),
  };
}

// ── A tiny forbid-wins PolicyPort (the real Cedar guarantee is tested in adapters/policy-cedar) ──
function policyAllowAll(): PolicyPort {
  return { evaluate: () => ({ decision: "permit", reasons: [] }) };
}
function policyDenyTemplate(template: string): PolicyPort {
  return {
    evaluate: (req: { resource: ResolvedAssemblySpec; context: PolicyContext }) =>
      req.resource.spec.template === template
        ? { decision: "forbid", reasons: ["policy.denied"] }
        : { decision: "permit", reasons: [] },
  };
}
/** A fail-closed policy: an authoring/load error means deny-all (the real adapter's posture). */
function policyFailClosed(): PolicyPort {
  return { evaluate: () => ({ decision: "forbid", reasons: ["policy.denied"] }) };
}

function proposal(overrides: Partial<AssemblyProposal> = {}): AssemblyProposal {
  return {
    intent: "register on acme",
    template: "browser-handoff",
    recipient: "tg:user:123" as RecipientRef,
    ...overrides,
  };
}

// A signed agent-authority capability with no scope caveat (an implicit-task proposal passes scope).
async function agentAuthority(): Promise<Capability> {
  const signer = new HmacCapabilitySigner();
  const { capability } = await signer.mint({
    cls: "agent-authority",
    caveats: [
      { kind: "authority-profile", profile: "local-single-operator" },
      { kind: "allowed-ops", ops: ["session.create"] },
    ],
  });
  return capability;
}

// A signed task capability scoped to a specific task path (for the capability-scope check).
async function taskCapScopedTo(taskId: string): Promise<Capability> {
  const signer = new HmacCapabilitySigner();
  const { token } = await signer.mint({
    cls: "agent-authority",
    caveats: [{ kind: "allowed-ops", ops: ["session.create"] }],
  });
  const { capability } = await signer.attenuate(token, [
    { kind: "scope", path: `/task/${taskId}` },
  ]);
  return capability;
}

function admission(policy: PolicyPort, catalog = fakeCatalog()): AdmissionService {
  return new AdmissionService({ policy, catalog });
}

describe("AdmissionService.admit — ACCEPT path (GLA-020/021)", () => {
  it("accepts the browser-handoff proposal: mutate (defaults) → validate → accept", async () => {
    const res = admission(policyAllowAll()).admit(proposal(), await agentAuthority());
    expect(res.decision).toBe("accept");
    if (res.decision !== "accept") return;
    // The resolved spec carries the injected template defaults + immutability marker.
    expect(res.resolved.spec.launcher).toEqual({ use: "launcher-process" });
    expect(res.resolved.spec.ttl).toBe("1h");
    expect(res.resolved.__resolved).toBe(true);
  });

  it("a detector with a valid required param is accepted (config_schema conforms)", async () => {
    const res = admission(policyAllowAll()).admit(
      proposal({
        detectors: [
          { use: "user-done" },
          { use: "url-watcher", params: { complete_on: "/dashboard" } },
        ],
      }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("accept");
  });
});

describe("AdmissionService.admit — each rejection class → its stable code + exit code (S-7)", () => {
  it("POLICY forbid → policy.denied → exit 3 (Cedar forbid-wins via the port)", async () => {
    const res = admission(policyDenyTemplate("browser-handoff")).admit(
      proposal(),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("policy.denied");
    expect(res.exitCode).toBe(3);
  });

  it("FAIL-CLOSED policy (load/authoring error) → forbid → exit 3 (never fail-open)", async () => {
    const res = admission(policyFailClosed()).admit(proposal(), await agentAuthority());
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.exitCode).toBe(3);
  });

  it("CAPABILITY SCOPE violation → auth.insufficient → exit 4 (from cap + request alone)", async () => {
    // The presented task cap is scoped to /task/OTHER; the proposal names task FOO → outside scope.
    const cap = await taskCapScopedTo("OTHER");
    const res = admission(policyAllowAll()).admit(proposal({ task: "FOO" }), cap);
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("auth.insufficient");
    expect(res.exitCode).toBe(4);
  });

  it("a task cap scoped to the SAME task passes the capability-scope check", async () => {
    const cap = await taskCapScopedTo("FOO");
    const res = admission(policyAllowAll()).admit(proposal({ task: "FOO" }), cap);
    expect(res.decision).toBe("accept");
  });

  it("UNKNOWN provider (use not registered) → catalog.unknown → exit 5", async () => {
    // Make a template-DEFAULT part (the connector — not an agent override, so it skips the
    // compatibility gate) unknown to the catalog's provider index → reaches the availability check.
    const catalog = fakeCatalog({ providers: { "connector-cdp": undefined } });
    const res = new AdmissionService({ policy: policyAllowAll(), catalog }).admit(
      proposal(),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("catalog.unknown");
    expect(res.exitCode).toBe(5);
  });

  it("UNAVAILABLE provider (registered but probe down) → catalog.unavailable → exit 8", async () => {
    const catalog = fakeCatalog({
      providers: { "connector-cdp": { name: "connector-cdp", available: false } },
    });
    const res = new AdmissionService({ policy: policyAllowAll(), catalog }).admit(
      proposal(),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("catalog.unavailable");
    expect(res.exitCode).toBe(8);
  });

  it("UNAVAILABLE template dependency → catalog.unavailable with template diagnostics before part checks", async () => {
    const catalog = fakeCatalog({
      templateStatus: {
        available: false,
        availability: "unavailable",
        dependencies: [{ dependency: "edge-proxy", status: "unbound" }],
        diagnostics: [
          {
            code: "template.dependency_unavailable",
            dependency: "edge-proxy",
          },
        ],
      },
    });
    const res = new AdmissionService({ policy: policyAllowAll(), catalog }).admit(
      proposal(),
      await agentAuthority(),
    );

    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("catalog.unavailable");
    expect(res.exitCode).toBe(8);
    expect(res.error.detail).toMatchObject({
      template: "browser-handoff",
      availability: "unavailable",
      diagnostics: [
        expect.objectContaining({
          code: "template.dependency_unavailable",
          dependency: "edge-proxy",
        }),
      ],
    });
  });

  it("MISSING required detail → reject, NOT a guess (GLA-021 AC#3): url-watcher without complete_on", async () => {
    const res = admission(policyAllowAll()).admit(
      proposal({ detectors: [{ use: "url-watcher" }] }), // complete_on omitted (required)
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("policy.denied"); // config-schema violation
    expect(res.exitCode).toBe(3);
    // Admission named the missing field rather than inventing it.
    expect(JSON.stringify(res.error.detail)).toMatch(/complete_on/);
  });

  it("MOUNT denied (catastrophic denylist) → mount.denied → exit 3", async () => {
    const res = admission(policyAllowAll()).admit(
      proposal({ mounts: [{ host: "/var/run/docker.sock", mode: "rw" }] }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("mount.denied");
    expect(res.exitCode).toBe(3);
  });

  it("MOUNT denied (outside the allowed-set) → mount.denied → exit 3", async () => {
    const catalog = fakeCatalog();
    const svc = new AdmissionService({
      policy: policyAllowAll(),
      catalog,
      mountPolicy: { allowedRoots: ["/home/op"], denylist: [] },
    });
    const res = svc.admit(
      proposal({ mounts: [{ host: "/etc/passwd", mode: "ro" }] }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("mount.denied");
    expect(res.exitCode).toBe(3);
  });

  it("MOUNT conflict (duplicate target) → mount.conflict → exit 7 (structural, via the resolver)", async () => {
    const res = admission(policyAllowAll()).admit(
      proposal({
        mounts: [
          { host: "/home/op/a", target: "/work/x" },
          { host: "/home/op/b", target: "/work/x" },
        ],
      }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("mount.conflict");
    expect(res.exitCode).toBe(7);
  });

  it("MOUNT unsupported (launcher shares no host) → mount.unsupported → exit 8", async () => {
    // A launcher that declares no mount capability (a remote worker).
    const catalog = fakeCatalog({ launcherCap: { file: false, directory: false, modes: [] } });
    const svc = new AdmissionService({ policy: policyAllowAll(), catalog });
    const res = svc.admit(
      proposal({ mounts: [{ host: "/home/op/draft.md", mode: "rw" }] }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("mount.unsupported");
    expect(res.exitCode).toBe(8);
  });

  it("UNKNOWN template → catalog.unknown → exit 5 (rejected before any default injection)", async () => {
    const res = admission(policyAllowAll()).admit(
      proposal({ template: "no-such-template" }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("catalog.unknown");
    expect(res.exitCode).toBe(5);
  });
});

// ── #1 BLOCKER: the catastrophic denylist must cover ~/.ssh + the GLA state dir (docs/04 §6) ─────
describe("AdmissionService — DEFAULT denylist covers ~/.ssh + the GLA state dir (#1)", () => {
  // Under the permissive MVP allowed-set ("/"), the denylist is the ONLY guard.
  const svc = (): AdmissionService =>
    new AdmissionService({ policy: policyAllowAll(), catalog: fakeCatalog() }); // DEFAULT_MOUNT_POLICY

  it("the default denylist names the docker socket, ~/.ssh (absolute), and the GLA state dir", () => {
    const home = homedir();
    expect(DEFAULT_MOUNT_POLICY.denylist).toContain("/var/run/docker.sock");
    expect(DEFAULT_MOUNT_POLICY.denylist).toContain(joinPath(home, ".ssh"));
    expect(DEFAULT_MOUNT_POLICY.denylist).toContain(glaStateDir());
    // ~/.ssh is resolved to an absolute path (not a literal "~/.ssh").
    expect(defaultDenylist().some((p) => p.startsWith("/") && p.endsWith("/.ssh"))).toBe(true);
  });

  it("a rw mount of ~/.ssh → mount.denied → exit 3 (the only guard under permissive allowed-set)", async () => {
    const sshDir = joinPath(homedir(), ".ssh");
    const res = svc().admit(
      proposal({ mounts: [{ host: sshDir, mode: "rw" }] }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("mount.denied");
    expect(res.exitCode).toBe(3);
  });

  it("a rw mount of a FILE UNDER ~/.ssh (prefix) → mount.denied", async () => {
    const key = joinPath(homedir(), ".ssh", "id_ed25519");
    const res = svc().admit(
      proposal({ mounts: [{ host: key, mode: "rw" }] }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("mount.denied");
  });

  it("a rw mount of the GLA state dir → mount.denied → exit 3", async () => {
    const res = svc().admit(
      proposal({ mounts: [{ host: glaStateDir(), mode: "rw" }] }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("mount.denied");
    expect(res.exitCode).toBe(3);
  });

  it("#2: a SYMLINK under the allowed-set pointing at a DENIED path → mount.denied (real target checked)", async () => {
    const root = mkdtempSync(joinPath(tmpdir(), "gla-mnt-"));
    try {
      // A real "secret" dir that the policy denies, and a symlink to it under an allowed area.
      const denied = joinPath(root, "secret");
      mkdirSync(denied);
      const allowed = joinPath(root, "allowed");
      mkdirSync(allowed);
      const link = joinPath(allowed, "looks-innocent");
      symlinkSync(denied, link);

      // Allowed-set permits everything under `root`; the denylist names the real `secret` dir. The
      // mount targets the SYMLINK (under allowed) — only realpath resolution catches that it aliases
      // the denied target. (realpath also resolves /tmp symlinks, so compare resolved-to-resolved.)
      const svc = new AdmissionService({
        policy: policyAllowAll(),
        catalog: fakeCatalog(),
        mountPolicy: { allowedRoots: [realpath(root)], denylist: [realpath(denied)] },
      });
      const res = svc.admit(
        proposal({ mounts: [{ host: link, mode: "rw" }] }),
        await agentAuthority(),
      );
      expect(res.decision).toBe("reject");
      if (res.decision !== "reject") return;
      expect(res.code).toBe("mount.denied");
      expect(res.exitCode).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── #3 fixed part + #4 compatibility (docs/04 §4/§5) ─────────────────────────────────────────────
describe("AdmissionService — template-FIXED part override is a reject (#3)", () => {
  it("overriding the FIXED launcher against browser-handoff → policy.denied → exit 3", async () => {
    const res = admission(policyAllowAll()).admit(
      proposal({ launcher: { use: "launcher-docker" } }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("policy.denied");
    expect(res.exitCode).toBe(3);
    expect(JSON.stringify(res.error.detail)).toMatch(/launcher/);
  });

  it("overriding the FIXED launcher with the SAME provider as the default is STILL a reject (the agent never sets a fixed part)", async () => {
    const res = admission(policyAllowAll()).admit(
      proposal({ launcher: { use: "launcher-process" } }), // equals the template default
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("policy.denied");
  });

  it("overriding the FIXED workspace → policy.denied → exit 3", async () => {
    const res = admission(policyAllowAll()).admit(
      proposal({ workspace: { use: "workspace-persistent" } }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("policy.denied");
  });

  it("overriding an OPEN part (detector) WITH A COMPATIBLE provider is accepted", async () => {
    const res = admission(policyAllowAll()).admit(
      proposal({ detectors: [{ use: "url-watcher", params: { complete_on: "/dashboard" } }] }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("accept");
  });
});

describe("AdmissionService — incompatible provider for an OPEN part is a reject (#4)", () => {
  it("overriding the OPEN detector with an INCOMPATIBLE (but available) provider → policy.denied → exit 3", async () => {
    // `exit-code` is available in the catalog but NOT in the template's compatibleProviders.detector.
    const catalog = fakeCatalog({
      providers: { "exit-code": { name: "exit-code", available: true } },
    });
    const svc = new AdmissionService({ policy: policyAllowAll(), catalog });
    const res = svc.admit(proposal({ detectors: [{ use: "exit-code" }] }), await agentAuthority());
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("policy.denied");
    expect(res.exitCode).toBe(3);
    expect(JSON.stringify(res.error.detail)).toMatch(/compatible/i);
  });

  it("the incompatibility reject fires BEFORE availability (it is a template constraint, not a probe)", async () => {
    // `exit-code` is incompatible AND not registered; the compatibility reject (policy.denied) wins
    // over catalog.unknown — proving the template-constraint check runs first.
    const res = admission(policyAllowAll()).admit(
      proposal({ entrypoints: [{ use: "entrypoint-rdp" }] }),
      await agentAuthority(),
    );
    expect(res.decision).toBe("reject");
    if (res.decision !== "reject") return;
    expect(res.code).toBe("policy.denied");
  });
});

describe("AdmissionService.admit — DRY-RUN == REAL-RUN (GLA-021 AC#4)", () => {
  it("dry-run and real run yield the IDENTICAL accept for the same spec", async () => {
    const svc = admission(policyAllowAll());
    const cap = await agentAuthority();
    const dry = svc.admit(proposal(), cap, { dryRun: true });
    const real = svc.admit(proposal(), cap, { dryRun: false });
    expect(dry.decision).toBe("accept");
    expect(real.decision).toBe("accept");
    if (dry.decision !== "accept" || real.decision !== "accept") return;
    // The resolved spec is identical (the pipeline is the same; only the CALLER withholds dispatch).
    expect(dry.resolved).toEqual(real.resolved);
  });

  it("dry-run and real run yield the IDENTICAL reject (code + exit) for a bad spec", async () => {
    const svc = admission(policyDenyTemplate("browser-handoff"));
    const cap = await agentAuthority();
    const dry = svc.admit(proposal(), cap, { dryRun: true });
    const real = svc.admit(proposal(), cap, { dryRun: false });
    expect(dry).toEqual(real);
  });
});

describe("AdmissionService — adding a check changes no caller (structural, AC#5/#8)", () => {
  it("the admit() signature is (proposal, capability, opts?) regardless of the check set", () => {
    // A structural assertion: admit takes exactly these params. Adding a new internal check (a new
    // private predicate) does not change this arity or the AdmitResult shape — callers are unaffected.
    const svc = admission(policyAllowAll());
    expect(svc.admit.length).toBe(2); // (proposal, presentedCapability) + optional opts (not counted)
  });
});
