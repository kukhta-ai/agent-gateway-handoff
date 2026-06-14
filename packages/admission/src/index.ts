// @gla/admission — core-adjacent ring (baseline §1, components/admission-and-policy.md, docs/04 §4,
// GLA-020/021). The HEART: the only path from "the agent proposed a session" to "the system will
// build one" — the Kubernetes-style **mutate → validate** pipeline (the enforcement seam, baseline §2).
//
//   admit(proposal, presentedCapability, {dryRun}) →
//     MUTATE  : apply template defaults (via the @gla/assembly resolver) + canonicalize mounts; fill
//               defaults but NEVER invent missing required semantics — a missing required detail is a
//               REJECT, not a guess (GLA-021 AC#3).
//     VALIDATE: all OFFLINE, mints/runs NOTHING —
//       1. Cedar POLICY            (PolicyPort, forbid-wins)            → policy.*        → exit 3
//       2. CAPABILITY SCOPE        (proposal ⊆ presented cap's scope)  → auth.*          → exit 4
//       3. CATALOG AVAILABILITY    (every `use`d provider available)   → catalog.*       → exit 5/8
//       4. RECIPIENT / IDENTITY    (bound recipient valid; strength stub) → auth/policy
//       5. config_schema PER PART  (kernel validateConfig)             → policy.denied   → exit 3
//       6. PER-MOUNT               (allowed-set + denylist + mode + launcher cap) → mount.* codes
//     ACCEPT → (on a real run) DISPATCH to the task (create the Session in `issued`, no spawn);
//     REJECT{code} → a STABLE namespaced code → documented exit code.
//   DRY-RUN runs the EXACT same mutate+validate and returns the SAME accept/reject (GLA-021 AC#4);
//   nothing is provisioned either way. Adding a new check/policy changes NO caller or the pipeline
//   contract (the checks are an ordered list of pure predicates; AC#5/#8).
//
// Boundary: depends on @gla/kernel (ports/types/validators) + @gla/assembly (the resolver). It holds
// the PolicyPort + a small catalog/identity port it DEFINES — it NEVER names a concrete adapter
// (`policy-cedar`); `app` injects them. The import-boundary lint proves admission never imports
// @gla/policy-cedar.

import { homedir } from "node:os";
import { join as joinPath } from "node:path";
import { type AssemblyProposal, type TemplateDefaults, resolveAssembly } from "@gla/assembly";
import {
  type Capability,
  type ConfigSchema,
  type ErrorCode,
  type GlaError,
  type PartRef,
  type PolicyContext,
  type PolicyPort,
  type RecipientRef,
  type ResolvedAssemblySpec,
  exitCodeFor,
  glaError,
  validateConfig,
} from "@gla/kernel";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const ADMISSION_MODULE = "@gla/admission" as const;
/** Ring classification from the architecture baseline (informational). */
export const ADMISSION_RING = "core-adjacent" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Ports admission depends on (DEFINED here, so admission names no concrete adapter)
// ─────────────────────────────────────────────────────────────────────────────

/** A registered provider's facts admission reads (availability + its typed config_schema). */
export interface ProviderInfo {
  name: string;
  /** SYSTEM-DERIVED availability (catalog invariant). */
  available: boolean;
  /** Optional richer availability state from catalog reads. */
  availability?: string;
  /** Optional provider family, used only for diagnostics. */
  family?: string;
  /** Optional evaluated dependency evidence, already redacted by the catalog. */
  dependencies?: unknown[];
  /** Optional stable catalog/provider diagnostics. */
  diagnostics?: unknown[];
  /** The provider's typed option schema (for per-part config validation), if any. */
  config_schema?: ConfigSchema;
}

/** Template defaults plus optional catalog status evidence. */
export interface AdmissionTemplateDefaults extends TemplateDefaults {
  available?: boolean;
  availability?: string;
  dependencies?: unknown[];
  diagnostics?: unknown[];
}

/** A launcher's declared mount capability (kernel `MountCapability`-shaped). */
export interface LauncherMountCapability {
  file: boolean;
  directory: boolean;
  modes: Array<"ro" | "rw">;
}

/**
 * The catalog facts admission needs (a port it owns; the catalog service implements it). Keeps
 * admission decoupled from a concrete catalog — `app` adapts `CatalogService` to this shape.
 */
export interface AdmissionCatalogPort {
  /** The template's structural DEFAULTS (parts + ttl) for the mutate step; undefined ⇒ unknown template. */
  templateDefaults(id: string): AdmissionTemplateDefaults | undefined;
  /** A provider's facts by `use` name; undefined ⇒ not registered. */
  provider(use: string): ProviderInfo | undefined;
  /** The mount capability of a launcher provider; undefined ⇒ launcher unknown / declares none. */
  launcherMountCapability(launcher: string): LauncherMountCapability | undefined;
}

/**
 * The host-mount policy facts (operator-set, permissive by default for the single-operator profile;
 * docs/04 §6, baseline §5). The allowed-set + catastrophic denylist; both are path-prefix sets.
 */
export interface MountPolicy {
  /** Permitted host-path roots (a path is allowed iff under some root). `["/"]` = permissive (default). */
  allowedRoots: string[];
  /** Catastrophic paths never mountable (the seatbelt): Docker socket, ~/.ssh, the GLA state dir. */
  denylist: string[];
}

/**
 * The conventional GLA state directory — the dir that holds capability signing material / session
 * state (baseline §5 names it among the catastrophic denylist). Resolved to an absolute path:
 * `$GLA_STATE_DIR` if set, else `$HOME/.gla`. Never mountable into a web-browsing capsule by request.
 */
export function glaStateDir(): string {
  const fromEnv = process.env.GLA_STATE_DIR;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  const home = homedir();
  return home.length > 0 ? joinPath(home, ".gla") : "/root/.gla";
}

/**
 * Build the default catastrophic denylist (docs/04 §6, baseline §5). The MVP allowed-set is permissive
 * (`/`), so under it the **denylist is the ONLY guard** — it MUST cover the docs' full set: the Docker
 * socket, **`~/.ssh`** (resolved to `$HOME/.ssh`), and the **GLA state dir** (capability signing
 * material / session state). The prefix logic in {@link AdmissionService} denies each path AND
 * everything beneath it.
 */
export function defaultDenylist(): string[] {
  const home = homedir();
  const sshDir = home.length > 0 ? joinPath(home, ".ssh") : "/root/.ssh";
  return [
    "/var/run/docker.sock",
    "/run/docker.sock",
    sshDir, // ~/.ssh — private keys / known_hosts (resolved to an absolute path)
    glaStateDir(), // the GLA state dir — capability signing material / session state
  ];
}

/** The default permissive single-operator mount policy (baseline §5: up to `*`, denylist seatbelt on). */
export const DEFAULT_MOUNT_POLICY: MountPolicy = {
  allowedRoots: ["/"],
  denylist: defaultDenylist(),
};

/**
 * Recipient/identity facts admission checks (a stub seam for this slice). Full enrollment/verify is
 * Slice 4; here admission only confirms the bound recipient is well-formed/known to the binder.
 */
export interface AdmissionIdentityPort {
  /** Is this recipient a valid bound recipient? (Slice-2 stub: well-formed ⇒ valid.) */
  isBoundRecipient(recipient: RecipientRef): boolean;
}

/** The default identity stub: a non-empty recipient ref is treated as a valid binding (Slice 2). */
export const DEFAULT_IDENTITY: AdmissionIdentityPort = {
  isBoundRecipient: (r) => typeof r === "string" && r.length > 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// The admit result
// ─────────────────────────────────────────────────────────────────────────────

/** An accept (the resolved spec is admissible). On a REAL run the caller dispatches it to the task. */
export interface AdmitAccept {
  decision: "accept";
  /** The immutable resolved spec a Session pins. */
  resolved: ResolvedAssemblySpec;
}

/** A reject with a STABLE namespaced code → documented exit code (the agent's skill interprets it). */
export interface AdmitReject {
  decision: "reject";
  code: ErrorCode;
  /** The exit code this rejection maps to (docs/05 §5; convenience over the kernel map). */
  exitCode: number;
  /** The full wire error (`{code, message, detail, skill, retryable}`). */
  error: GlaError;
}

/** The admit outcome — accept or reject. The SAME shape for dry-run and a real run (GLA-021 AC#4). */
export type AdmitResult = AdmitAccept | AdmitReject;

/** Options for one `admit` call. */
export interface AdmitOptions {
  /**
   * Dry-run: run the EXACT same mutate+validate and return the SAME accept/reject — but the CALLER
   * never dispatches on accept (nothing is provisioned). Provided for documentation/symmetry; the
   * pipeline itself is identical regardless (it never provisions). Default false.
   */
  dryRun?: boolean;
}

/** Construction dependencies for {@link AdmissionService} (all injected — no concrete adapter named). */
export interface AdmissionServiceOptions {
  policy: PolicyPort;
  catalog: AdmissionCatalogPort;
  identity?: AdmissionIdentityPort;
  mountPolicy?: MountPolicy;
  /** The action string Cedar evaluates (default `"admit"`). */
  action?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a reject result from a code + message (+ optional detail). Maps the code → exit code. */
function reject(code: ErrorCode, message: string, detail?: Record<string, unknown>): AdmitReject {
  const error: GlaError = {
    code,
    message,
    skill: "interpret-gla-rejections",
    retryable: false,
  };
  if (detail !== undefined) {
    error.detail = detail;
  }
  return { decision: "reject", code, exitCode: exitCodeFor(code), error };
}

/** Is `path` at-or-under any root in `roots`? (Path-prefix on `/`-segments; `"/"` matches everything.) */
function underAnyRoot(path: string, roots: string[]): boolean {
  return roots.some((root) => {
    if (root === "/" || root === "") {
      return true;
    }
    const r = root.endsWith("/") ? root.slice(0, -1) : root;
    return path === r || path.startsWith(`${r}/`);
  });
}

/** Is `path` at-or-under any denied prefix? (A denylisted root denies itself and everything under it.) */
function underAnyDenied(path: string, denied: string[]): boolean {
  return denied.some((d) => {
    const dd = d.endsWith("/") ? d.slice(0, -1) : d;
    return path === dd || path.startsWith(`${dd}/`);
  });
}

/** All part refs in a resolved spec, paired with the part-role (for config-schema validation). */
function allParts(spec: ResolvedAssemblySpec): Array<{ role: string; ref: PartRef }> {
  const out: Array<{ role: string; ref: PartRef }> = [];
  const s = spec.spec;
  if (s.launcher) {
    out.push({ role: "launcher", ref: s.launcher });
  }
  if (s.connector) {
    out.push({ role: "connector", ref: s.connector });
  }
  if (s.workspace) {
    out.push({ role: "workspace", ref: s.workspace });
  }
  for (const e of s.entrypoints ?? []) {
    out.push({ role: "entrypoint", ref: e });
  }
  for (const d of s.detectors ?? []) {
    out.push({ role: "detector", ref: d });
  }
  return out;
}

/**
 * Read the presented capability's effective `scope` paths (the conjunction of its `scope` caveats).
 * A `task`/`agent-authority` cap presented to admission may carry a `scope` caveat (e.g. `/task/<id>`
 * on a task cap). The proposal is "within scope" if the session path it would occupy is within every
 * scope caveat. Decided from the CAPABILITY + REQUEST ALONE — no lookup (the contract).
 */
function capabilityScopes(cap: Capability): string[] {
  return cap.caveats.filter((c) => c.kind === "scope").map((c) => (c as { path: string }).path);
}

/** Is `path` within `scope` (path-prefix on `/`-segments)? Mirrors the kernel's `isPathWithin`. */
function pathWithin(path: string, scope: string): boolean {
  if (scope === path) {
    return true;
  }
  const s = scope.endsWith("/") && scope.length > 1 ? scope.slice(0, -1) : scope;
  if (s === "/" || s === "") {
    return true;
  }
  return path === s || path.startsWith(`${s}/`);
}

// ─────────────────────────────────────────────────────────────────────────────
// AdmissionService
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Admission service (components/admission-and-policy.md). The one gate from proposal to
 * provisioning. `admit` runs mutate → validate and returns accept/reject; it MINTS NOTHING and RUNS
 * NOTHING (the dispatch/Session creation is the caller's, on a real-run accept). Pluggable checks: the
 * validate stage is an ordered list of pure predicates, so adding a check changes no caller (AC#5/#8).
 */
export class AdmissionService {
  private readonly policy: PolicyPort;
  private readonly catalog: AdmissionCatalogPort;
  private readonly identity: AdmissionIdentityPort;
  private readonly mountPolicy: MountPolicy;
  private readonly action: string;

  constructor(opts: AdmissionServiceOptions) {
    this.policy = opts.policy;
    this.catalog = opts.catalog;
    this.identity = opts.identity ?? DEFAULT_IDENTITY;
    this.mountPolicy = opts.mountPolicy ?? DEFAULT_MOUNT_POLICY;
    this.action = opts.action ?? "admit";
  }

  /**
   * Admit a proposal (the heart). MUTATE → VALIDATE; returns accept (resolved spec) or reject
   * (stable code + exit code). `dryRun` does not change the pipeline (it never provisions); it is the
   * CALLER that withholds dispatch on a dry-run accept. So **dry-run and a real run yield the SAME
   * accept/reject for the same spec** (GLA-021 AC#4).
   *
   * @param proposal             the thin agent proposal (template ref + recipient + overrides)
   * @param presentedCapability  the agent's `task`/`agent-authority` capability (scope is checked
   *                             from it + the request alone — no lookup)
   */
  admit(
    proposal: AssemblyProposal,
    presentedCapability: Capability,
    _opts: AdmitOptions = {},
  ): AdmitResult {
    // ── MUTATE ────────────────────────────────────────────────────────────────
    // The template must be a known, registered template before we can inject its defaults.
    const defaults = this.catalog.templateDefaults(proposal.template);
    if (defaults === undefined) {
      return reject("catalog.unknown", `unknown template: "${proposal.template}"`, {
        template: proposal.template,
      });
    }
    if (defaults.available === false) {
      return reject("catalog.unavailable", `template "${proposal.template}" is not available`, {
        template: proposal.template,
        availability: defaults.availability ?? "unavailable",
        dependencies: defaults.dependencies ?? [],
        diagnostics: defaults.diagnostics ?? [],
      });
    }
    // FIXED/OPEN line (docs/04 §4/§5): an agent override of a template-FIXED part is a REJECT, not a
    // silent override; an override of an OPEN part must use a COMPATIBLE provider. Decided from the
    // agent's EXPLICIT proposal parts (not the merged spec), so it runs BEFORE resolution.
    const overrideReject = this.checkOverrides(proposal, defaults);
    if (overrideReject) {
      return overrideReject;
    }
    // Resolve = inject defaults + canonicalize mounts + structural validate (reuses the kernel).
    // A malformed proposal is rejected here with its typed structural code (BEFORE the policy/catalog
    // checks). The resolver fills defaults but never invents missing required semantics.
    const resolution = resolveAssembly(proposal, defaults);
    if (!resolution.ok) {
      const e = resolution.error;
      return reject(e.code, e.message, e.detail);
    }
    const resolved = resolution.resolved;

    // ── VALIDATE (ordered, pure predicates; all OFFLINE) ───────────────────────
    // 1) POLICY (Cedar, forbid-wins). Forbid (or fail-closed) → reject policy.* (exit 3).
    const policyReject = this.checkPolicy(resolved, presentedCapability);
    if (policyReject) {
      return policyReject;
    }

    // 2) CAPABILITY SCOPE — the proposal must fall within the presented capability's scope, decided
    //    from the capability + request alone (no lookup).
    const scopeReject = this.checkCapabilityScope(resolved, presentedCapability);
    if (scopeReject) {
      return scopeReject;
    }

    // 3) CATALOG AVAILABILITY — every `use`d provider registered + available, else reject.
    const availReject = this.checkAvailability(resolved);
    if (availReject) {
      return availReject;
    }

    // 4) RECIPIENT / IDENTITY — the bound recipient is valid (strength check is a stub this slice).
    const idReject = this.checkRecipient(resolved);
    if (idReject) {
      return idReject;
    }

    // 5) config_schema PER PART — kernel validateConfig; off-schema input → policy.denied (exit 3).
    const cfgReject = this.checkConfigSchemas(resolved);
    if (cfgReject) {
      return cfgReject;
    }

    // 6) PER-MOUNT — allowed-set + denylist + mode + launcher mount capability → mount.* codes.
    const mountReject = this.checkMounts(resolved);
    if (mountReject) {
      return mountReject;
    }

    // ── ACCEPT ─────────────────────────────────────────────────────────────────
    return { decision: "accept", resolved };
  }

  /**
   * FIXED/OPEN + COMPATIBILITY (docs/04 §4/§5). Reads the agent's EXPLICIT proposal parts (the raw
   * overrides, before the resolver merges defaults in):
   *  - **Fixed part:** a part-role the agent sets that is NOT in the template's `openParts` is a
   *    REJECT (`policy.denied` → exit 3) — overriding the launcher / isolation tier / security-bearing
   *    wiring is never a silent override (docs/04 §5). When the template declares no `openParts`, every
   *    part is fixed (fail-closed).
   *  - **Incompatible provider:** a part-role the agent overrides within the OPEN set must use a
   *    provider in `compatibleProviders[role]` (`relations.compatibleWith`, docs/04 §4); an
   *    incompatible-but-available provider is a REJECT.
   */
  private checkOverrides(
    proposal: AssemblyProposal,
    defaults: TemplateDefaults,
  ): AdmitReject | undefined {
    const open = new Set(defaults.openParts ?? []);
    const compat = defaults.compatibleProviders ?? {};

    // The part-roles the agent EXPLICITLY set in the proposal (singletons + lists), each with its
    // chosen provider `use` names. A role absent from the proposal is filled by the template default
    // (not an override) and is therefore never rejected here.
    const overridden: Array<{ role: string; uses: string[] }> = [];
    if (proposal.launcher !== undefined) {
      overridden.push({ role: "launcher", uses: [proposal.launcher.use] });
    }
    if (proposal.connector !== undefined) {
      overridden.push({ role: "connector", uses: [proposal.connector.use] });
    }
    if (proposal.workspace !== undefined) {
      overridden.push({ role: "workspace", uses: [proposal.workspace.use] });
    }
    if (proposal.entrypoints !== undefined) {
      overridden.push({ role: "entrypoint", uses: proposal.entrypoints.map((p) => p.use) });
    }
    if (proposal.detectors !== undefined) {
      overridden.push({ role: "detector", uses: proposal.detectors.map((p) => p.use) });
    }

    for (const { role, uses } of overridden) {
      if (!open.has(role)) {
        // Overriding a template-FIXED part — reject, not a silent override.
        return reject(
          "policy.denied",
          `cannot override template-fixed part "${role}" (it is not in the template's open parts)`,
          { part: role, openParts: [...open] },
        );
      }
      // OPEN part — each chosen provider must be compatible with the template/part.
      const allowed = compat[role] ?? [];
      for (const use of uses) {
        if (!allowed.includes(use)) {
          return reject(
            "policy.denied",
            `provider "${use}" is not compatible with template part "${role}"`,
            { part: role, use, compatibleWith: allowed },
          );
        }
      }
    }
    return undefined;
  }

  /** Cedar policy (forbid-wins). A forbid (or any fail-closed outcome) → reject with the policy code. */
  private checkPolicy(
    resolved: ResolvedAssemblySpec,
    principal: Capability,
  ): AdmitReject | undefined {
    const context: PolicyContext = {};
    const decision = this.policy.evaluate({
      principal,
      action: this.action,
      resource: resolved,
      context,
    });
    if (decision.decision === "forbid") {
      const code = decision.reasons[0] ?? "policy.denied";
      return reject(code, `assembly denied by policy: ${code}`, { reasons: decision.reasons });
    }
    return undefined;
  }

  /**
   * CAPABILITY SCOPE: every `scope` caveat on the presented capability must contain the session path
   * this proposal would occupy. The session path is derived from the bound task/template (here
   * `/task/<task>` when an explicit task is named; for an implicit task the agent-authority carries no
   * task-scope so it passes). Decided from the capability + request alone — no store lookup (contract).
   */
  private checkCapabilityScope(
    resolved: ResolvedAssemblySpec,
    cap: Capability,
  ): AdmitReject | undefined {
    const scopes = capabilityScopes(cap);
    if (scopes.length === 0) {
      return undefined; // the cap is not path-confined → no scope to violate
    }
    const task = resolved.metadata.task;
    // The path the proposal would occupy under its task. With no explicit task the proposal is not
    // yet bound to a task path; a path-confined cap that names a task must match it.
    const proposalPath = task !== undefined ? `/task/${task}` : "/task";
    for (const scope of scopes) {
      if (!pathWithin(proposalPath, scope)) {
        return reject(
          "auth.insufficient",
          `proposal path "${proposalPath}" is outside the presented capability's scope "${scope}"`,
          { proposalPath, scope },
        );
      }
    }
    return undefined;
  }

  /** CATALOG AVAILABILITY: every `use`d provider is registered + available, else reject. */
  private checkAvailability(resolved: ResolvedAssemblySpec): AdmitReject | undefined {
    for (const { ref } of allParts(resolved)) {
      const info = this.catalog.provider(ref.use);
      if (info === undefined) {
        return reject("catalog.unknown", `unknown provider: "${ref.use}"`, { use: ref.use });
      }
      if (!info.available) {
        return reject("catalog.unavailable", `provider "${ref.use}" is not available`, {
          use: ref.use,
          availability: info.availability ?? "unavailable",
          family: info.family,
          dependencies: info.dependencies ?? [],
          diagnostics: info.diagnostics ?? [],
        });
      }
    }
    return undefined;
  }

  /** RECIPIENT / IDENTITY: the bound recipient is valid (Slice-2 stub; full verify is Slice 4). */
  private checkRecipient(resolved: ResolvedAssemblySpec): AdmitReject | undefined {
    const recipient = resolved.spec.recipient;
    if (!this.identity.isBoundRecipient(recipient)) {
      return reject("auth.insufficient", `recipient "${recipient}" is not a valid binding`, {
        recipient,
      });
    }
    return undefined;
  }

  /**
   * config_schema PER PART: each part's `params` conform to its provider's typed schema (kernel
   * `validateConfig`). Off-schema input — including a MISSING REQUIRED param (e.g. `url-watcher`'s
   * `complete_on`) — is a reject, NOT a guess (GLA-021 AC#3): admission never invents the value.
   */
  private checkConfigSchemas(resolved: ResolvedAssemblySpec): AdmitReject | undefined {
    for (const { role, ref } of allParts(resolved)) {
      const info = this.catalog.provider(ref.use);
      const schema = info?.config_schema;
      if (schema === undefined) {
        continue; // provider declares no options → nothing to validate
      }
      const params = ref.params ?? {};
      const result = validateConfig(schema, params);
      if (!result.ok) {
        const head = result.defects[0];
        return reject(head?.code ?? "policy.denied", `invalid params for ${role} "${ref.use}"`, {
          part: role,
          use: ref.use,
          defects: result.defects,
        });
      }
    }
    return undefined;
  }

  /**
   * PER-MOUNT: each mount against the operator allowed-set + catastrophic denylist (policy), its mode,
   * and the RESOLVED launcher's declared mount capability — all OFFLINE. Maps to the mount.* codes
   * (kernel-contracts.md §5.2): `denied → 3`, `not_found → 5`, `conflict → 7`, `unsupported → 8`.
   * (Structural shape + duplicate-target conflicts are already caught by the resolver's
   * `validateAssembly`; this is the POLICY layer — allowed-set/denylist/launcher-capability.)
   *
   * The launcher is the **template-FIXED** one: `checkOverrides` already rejected any agent attempt to
   * override it, so `resolved.spec.launcher` is the launcher the template pins — the mount-capability
   * gate is read off it, never off an agent-chosen launcher.
   */
  private checkMounts(resolved: ResolvedAssemblySpec): AdmitReject | undefined {
    const mounts = resolved.spec.mounts ?? [];
    if (mounts.length === 0) {
      return undefined;
    }
    // The resolved (template-fixed) launcher's declared mount capability gates host mounts.
    const launcher = resolved.spec.launcher?.use;
    const cap = launcher !== undefined ? this.catalog.launcherMountCapability(launcher) : undefined;

    for (const m of mounts) {
      const mode = m.mode ?? "ro";
      // denylist (catastrophic) — a denied path is a policy reject (mount.denied → exit 3).
      if (underAnyDenied(m.host, this.mountPolicy.denylist)) {
        return reject("mount.denied", `mount host "${m.host}" is on the catastrophic denylist`, {
          host: m.host,
        });
      }
      // allowed-set — a host outside the permitted roots is denied (mount.denied → exit 3).
      if (!underAnyRoot(m.host, this.mountPolicy.allowedRoots)) {
        return reject("mount.denied", `mount host "${m.host}" is outside the allowed-set`, {
          host: m.host,
          allowedRoots: this.mountPolicy.allowedRoots,
        });
      }
      // launcher mount capability — a launcher that shares no host rejects mounts (mount.unsupported → 8).
      if (cap === undefined || (!cap.file && !cap.directory)) {
        return reject(
          "mount.unsupported",
          `launcher "${launcher ?? "?"}" declares no host-mount capability`,
          { launcher, host: m.host },
        );
      }
      // mode capability — the launcher must support the requested mode (mount.unsupported → 8).
      if (!cap.modes.includes(mode)) {
        return reject(
          "mount.unsupported",
          `launcher "${launcher}" does not support "${mode}" mounts`,
          { launcher, host: m.host, mode },
        );
      }
    }
    return undefined;
  }
}

export type { AssemblyProposal, TemplateDefaults };
export { glaError };
export type { Capability, ResolvedAssemblySpec };
