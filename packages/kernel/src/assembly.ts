// K5 — AssemblySpec + Mount + Resolved types + offline validator (kernel-contracts.md §3, docs/04).
// The artifact the agent authors: a K8s/Backstage-shaped delta over a template. The kernel owns
// the SHAPE and a STRUCTURAL offline validator (`validateAssembly`) that a `--dry-run` runs with
// no host touch (invariant 5). It reports EACH distinct defect with its JSON path in a SINGLE
// pass (collect-all, never fail-fast — task AC#4). Catalog availability + config_schema +
// Cedar/mount-policy are layered on by `admission` (which owns the catalog and policy ports);
// here we validate everything checkable from the spec alone.

import type { Duration, RecipientRef } from "./brands.js";
import type { ErrorCode, GlaError } from "./errors.js";

/** A reference to a registered provider plus its (schema-validated, §4) params. */
export interface PartRef {
  /** Names a registered + AVAILABLE provider by capability. */
  use: string;
  /** Validated against that provider's config_schema (§4); structural-only here. */
  params?: Record<string, unknown>;
}

/** A host-path mount the agent attaches (§3.1, docs/04 §6). */
export interface MountSpec {
  /** Host path; canonicalized at admission (symlinks resolved, absolute, no ".." escape). */
  host: string;
  /** Container target; default `/work/<basename>`. */
  target?: string;
  /** `"ro"` (default) or `"rw"`. */
  mode?: "ro" | "rw";
}

/** The thin form the agent submits (§3). Admission resolves it to {@link ResolvedAssemblySpec}. */
export interface AssemblySpec {
  /** Versioned — bump on a breaking change. */
  apiVersion: "gla.dev/v1";
  kind: "Assembly";
  metadata: { intent: string; task?: string };
  spec: {
    /** A registered + available CapsuleTemplate. */
    template: string;
    /** Passed through from the channel binding; narrow-only, never invented. */
    recipient: RecipientRef;
    ttl?: Duration;
    launcher?: PartRef;
    /** A capsule may expose several human surfaces. */
    entrypoints?: PartRef[];
    connector?: PartRef;
    workspace?: PartRef;
    detectors?: PartRef[];
    /** Host paths the agent can already reach (§3.1). */
    mounts?: MountSpec[];
  };
}

/** The full form after admission-mutate (template defaults merged in). IMMUTABLE on a Session. */
export type ResolvedAssemblySpec = AssemblySpec & { __resolved: true };

/** A single structural defect, located by JSON path (task AC#4: "each defect with its location"). */
export interface AssemblyDefect {
  /** JSON path to the offending node, e.g. `"spec.recipient"` or `"spec.mounts[1].mode"`. */
  path: string;
  code: ErrorCode;
  message: string;
}

/** Outcome of {@link validateAssembly}: ok, or EVERY defect found in one pass. */
export type AssemblyValidation = { ok: true } | { ok: false; defects: AssemblyDefect[] };

function defect(defects: AssemblyDefect[], path: string, code: ErrorCode, message: string): void {
  defects.push({ path, code, message });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const APP_INFRA_PROVIDER_SPEC_KEYS = ["auth", "authProvider", "channel", "secretStore"] as const;

/** Validate one `PartRef` node (its `use` is a non-empty string; `params`, if present, an object). */
function validatePartRef(node: unknown, path: string, defects: AssemblyDefect[]): void {
  if (!isObject(node)) {
    defect(defects, path, "policy.denied", `"${path}" must be an object with a "use" field`);
    return;
  }
  if (typeof node.use !== "string" || node.use.length === 0) {
    defect(
      defects,
      `${path}.use`,
      "catalog.unknown",
      `"${path}.use" must name a registered provider`,
    );
  }
  if (node.params !== undefined && !isObject(node.params)) {
    defect(defects, `${path}.params`, "policy.denied", `"${path}.params" must be an object`);
  }
}

/** Validate a list of `PartRef`s under `path` (e.g. `spec.entrypoints`). */
function validatePartRefList(node: unknown, path: string, defects: AssemblyDefect[]): void {
  if (!Array.isArray(node)) {
    defect(defects, path, "policy.denied", `"${path}" must be a list`);
    return;
  }
  node.forEach((el, i) => validatePartRef(el, `${path}[${i}]`, defects));
}

/**
 * Validate the `mounts` shape (§3.1): each entry has a non-empty `host`, an OPTIONAL `target`,
 * and a `mode` ∈ {ro,rw}; host paths must be absolute and must not contain a `".."` escape
 * segment (the canonicalization invariant, checked structurally here). Also flags duplicate
 * targets (a `mount.conflict`). All defects collected; nothing on the host is touched.
 */
function validateMounts(node: unknown, path: string, defects: AssemblyDefect[]): void {
  if (!Array.isArray(node)) {
    defect(defects, path, "policy.denied", `"${path}" must be a list of mounts`);
    return;
  }
  const seenTargets = new Map<string, number>();
  node.forEach((el, i) => {
    const p = `${path}[${i}]`;
    if (!isObject(el)) {
      defect(defects, p, "policy.denied", `"${p}" must be a mount object`);
      return;
    }
    // host
    if (typeof el.host !== "string" || el.host.length === 0) {
      defect(defects, `${p}.host`, "mount.not_found", `"${p}.host" must be a non-empty path`);
    } else {
      if (!el.host.startsWith("/")) {
        defect(
          defects,
          `${p}.host`,
          "mount.denied",
          `"${p}.host" must be an absolute path (got "${el.host}")`,
        );
      }
      if (el.host.split("/").includes("..")) {
        defect(
          defects,
          `${p}.host`,
          "mount.denied",
          `"${p}.host" must not contain a ".." path escape`,
        );
      }
    }
    // target (optional; if present must be an absolute string and unique)
    let target: string | undefined;
    if (el.target !== undefined) {
      if (typeof el.target !== "string" || el.target.length === 0) {
        defect(defects, `${p}.target`, "policy.denied", `"${p}.target" must be a non-empty path`);
      } else if (!el.target.startsWith("/")) {
        defect(
          defects,
          `${p}.target`,
          "mount.denied",
          `"${p}.target" must be an absolute path (got "${el.target}")`,
        );
      } else {
        target = el.target;
      }
    } else if (typeof el.host === "string" && el.host.length > 0) {
      // default target = /work/<basename> (so default-target collisions are caught too)
      const base = el.host.split("/").filter(Boolean).pop() ?? "";
      target = `/work/${base}`;
    }
    if (target !== undefined) {
      const prev = seenTargets.get(target);
      if (prev !== undefined) {
        defect(
          defects,
          `${p}.target`,
          "mount.conflict",
          `mount target "${target}" collides with "${path}[${prev}]"`,
        );
      } else {
        seenTargets.set(target, i);
      }
    }
    // mode
    if (el.mode !== undefined && el.mode !== "ro" && el.mode !== "rw") {
      defect(
        defects,
        `${p}.mode`,
        "policy.denied",
        `"${p}.mode" must be "ro" or "rw" (got ${JSON.stringify(el.mode)})`,
      );
    }
  });
}

/**
 * Offline structural validation of an {@link AssemblySpec} (§3, invariant 5) — what `--dry-run`
 * can check from the spec ALONE, without touching the host or the catalog: the envelope
 * (`apiVersion`/`kind`/`metadata`), required `spec.template` and `spec.recipient`, the shape of
 * every part (`use` present, `params` an object), and the `mounts` shape (§3.1) including
 * absolute/no-`..` host paths, valid `mode`, and duplicate-target conflicts.
 *
 * EVERY distinct defect is reported with its JSON path in a SINGLE pass (collect-all, not
 * fail-fast — task AC#4). Catalog availability of each `use`, per-provider `config_schema`
 * conformance (via {@link validateConfig}), and Cedar/mount-allowed-set policy are layered on by
 * `admission` (which holds the catalog + policy ports); they are intentionally out of the
 * kernel's host-free structural pass.
 */
export function validateAssembly(spec: unknown): AssemblyValidation {
  const defects: AssemblyDefect[] = [];

  if (!isObject(spec)) {
    return {
      ok: false,
      defects: [{ path: "$", code: "policy.denied", message: "assembly must be an object" }],
    };
  }

  // envelope
  if (spec.apiVersion !== "gla.dev/v1") {
    defect(
      defects,
      "apiVersion",
      "policy.denied",
      `apiVersion must be "gla.dev/v1" (got ${JSON.stringify(spec.apiVersion)})`,
    );
  }
  if (spec.kind !== "Assembly") {
    defect(
      defects,
      "kind",
      "policy.denied",
      `kind must be "Assembly" (got ${JSON.stringify(spec.kind)})`,
    );
  }

  // metadata
  if (!isObject(spec.metadata)) {
    defect(defects, "metadata", "policy.denied", `"metadata" must be an object`);
  } else {
    if (typeof spec.metadata.intent !== "string" || spec.metadata.intent.length === 0) {
      defect(
        defects,
        "metadata.intent",
        "policy.denied",
        `"metadata.intent" must be a non-empty string`,
      );
    }
    if (spec.metadata.task !== undefined && typeof spec.metadata.task !== "string") {
      defect(
        defects,
        "metadata.task",
        "policy.denied",
        `"metadata.task" must be a string when present`,
      );
    }
  }

  // spec
  if (!isObject(spec.spec)) {
    defect(defects, "spec", "policy.denied", `"spec" must be an object`);
    // Without spec we cannot validate its members; return what we have (still single-pass).
    return { ok: false, defects };
  }
  const s = spec.spec;

  for (const key of APP_INFRA_PROVIDER_SPEC_KEYS) {
    if (Object.hasOwn(s, key)) {
      defect(
        defects,
        `spec.${key}`,
        "policy.denied",
        `"spec.${key}" is app deployment provider selection and is not part of AssemblySpec`,
      );
    }
  }

  if (typeof s.template !== "string" || s.template.length === 0) {
    defect(
      defects,
      "spec.template",
      "catalog.unknown",
      `"spec.template" must name a registered template`,
    );
  }
  if (typeof s.recipient !== "string" || s.recipient.length === 0) {
    defect(
      defects,
      "spec.recipient",
      "policy.denied",
      `"spec.recipient" must be a non-empty recipient reference (passed through from the channel)`,
    );
  }
  if (s.ttl !== undefined && typeof s.ttl !== "string") {
    defect(
      defects,
      "spec.ttl",
      "policy.denied",
      `"spec.ttl" must be a duration string (e.g. "1h")`,
    );
  }

  if (s.launcher !== undefined) {
    validatePartRef(s.launcher, "spec.launcher", defects);
  }
  if (s.connector !== undefined) {
    validatePartRef(s.connector, "spec.connector", defects);
  }
  if (s.workspace !== undefined) {
    validatePartRef(s.workspace, "spec.workspace", defects);
  }
  if (s.entrypoints !== undefined) {
    validatePartRefList(s.entrypoints, "spec.entrypoints", defects);
  }
  if (s.detectors !== undefined) {
    validatePartRefList(s.detectors, "spec.detectors", defects);
  }
  if (s.mounts !== undefined) {
    validateMounts(s.mounts, "spec.mounts", defects);
  }

  return defects.length === 0 ? { ok: true } : { ok: false, defects };
}

/** Turn assembly defects into the wire {@link GlaError} (first defect is the headline; all in `detail`). */
export function assemblyDefectsToError(
  defects: AssemblyDefect[],
  skill = "interpret-gla-rejections",
): GlaError {
  const head = defects[0];
  return {
    code: head?.code ?? "policy.denied",
    message: head?.message ?? "assembly validation failed",
    detail: { defects },
    skill,
    retryable: false,
  };
}
