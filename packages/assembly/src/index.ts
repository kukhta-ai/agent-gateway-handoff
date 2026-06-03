// @gla/assembly — shared/core-adjacent ring (baseline §1, docs/04 §4, GLA-019).
// The AssemblySpec RESOLVER: the **mutate** half of admission's mutate→validate (docs/04 §4). Given a
// thin proposal (a delta over a template), it:
//   1. DEEP-MERGES the template's defaults UNDER the agent's overrides — the agent wins only on fields
//      the template leaves open; the resolver fills the structural holes (launcher / entrypoint /
//      connector / workspace / detectors / ttl) so the agent never has to produce the full spec.
//   2. CANONICALIZES each mount's host path: `..`/`.` collapsed (lexical) AND — because a symlink
//      *inside* the allowed-set can point at a denied path and slip the downstream check — SYMLINKS
//      RESOLVED via a best-effort `fs.realpathSync` (kernel-contracts.md §3.1, docs/04 §4/§6), so the
//      allowed-set/denylist check downstream runs on the REAL target, never an alias that escapes it.
//      A path that does not exist yet falls back to the lexical normalize (existence is OS-enforced at
//      spawn). This is a justified, SCOPED exception to "pure-offline": it reads the filesystem ONLY to
//      `realpath` a mount host path — a proposal with no `mounts` never touches the FS, so non-mount
//      dry-runs stay fully offline.
//   3. produces a `ResolvedAssemblySpec` (the immutable full form a Session pins).
//
// It REUSES the kernel's structural validator (`validateAssembly`) — a malformed proposal is rejected
// at SUBMISSION with a typed error BEFORE admission (GLA-019 AC#4). The resolver mints/runs NOTHING.
//
// Boundary: depends ONLY on @gla/kernel — the template defaults are passed in as plain DATA
// (`TemplateDefaults`), so assembly never imports the catalog; admission (which holds the CatalogPort)
// supplies them. This keeps the resolver host-free except for the scoped mount-path realpath above.

import { realpathSync } from "node:fs";
import { posix as posixPath } from "node:path";
import {
  type AssemblySpec,
  GlaErrorException,
  type MountSpec,
  type PartRef,
  type RecipientRef,
  type ResolvedAssemblySpec,
  assemblyDefectsToError,
  glaError,
  validateAssembly,
} from "@gla/kernel";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const ASSEMBLY_MODULE = "@gla/assembly" as const;
/** Ring classification from the architecture baseline (informational). */
export const ASSEMBLY_RING = "shared" as const;

/**
 * The defaults a template contributes to the mutate step (docs/04 §4 "template defaults injection").
 * Plain data — admission derives this from the catalog template so assembly stays catalog-free. Each
 * field is the DEFAULT the resolver injects when the agent omitted that part; agent overrides win on
 * open fields. `ttl` is the template's default TTL when the agent gives none.
 */
export interface TemplateDefaults {
  /** The template id (echoed back; the resolved spec keeps `spec.template`). */
  template: string;
  launcher?: PartRef;
  entrypoints?: PartRef[];
  connector?: PartRef;
  workspace?: PartRef;
  detectors?: PartRef[];
  /** Default TTL injected when the agent omits one. */
  ttl?: string;
  /**
   * Part-roles the agent MAY override (docs/04 §5 the fixed/open line). A role NOT listed is
   * template-FIXED. Consumed by admission (the resolver itself ignores it); when absent, admission
   * treats every part as fixed (fail-closed: only what the template explicitly opens is overridable).
   */
  openParts?: string[];
  /** Per open part-role, the compatible provider `use` names (`relations.compatibleWith`, docs/04 §4). */
  compatibleProviders?: Record<string, string[]>;
}

/** The thin proposal the agent submits to the resolver (a template ref + recipient + overrides). */
export interface AssemblyProposal {
  /** The intent label (cognition; carried into metadata). */
  intent: string;
  /** Optional explicit task id (else admission threads an implicit task). */
  task?: string;
  template: string;
  /** The recipient bound from the channel — narrow-only, never invented. */
  recipient: RecipientRef;
  ttl?: string;
  launcher?: PartRef;
  entrypoints?: PartRef[];
  connector?: PartRef;
  workspace?: PartRef;
  detectors?: PartRef[];
  mounts?: MountSpec[];
}

/** Outcome of {@link resolveAssembly}: the resolved spec, or the typed validation error. */
export type ResolveResult =
  | { ok: true; resolved: ResolvedAssemblySpec }
  | { ok: false; error: GlaErrorException };

/**
 * Canonicalize one mount's host path (kernel-contracts.md §3.1, docs/04 §4/§6):
 *  1. collapse `.`/`..` segments via POSIX `normalize` (lexical);
 *  2. RESOLVE SYMLINKS via a best-effort `fs.realpathSync` so the downstream allowed-set/denylist
 *     check runs on the REAL target — a symlink inside the allowed-set pointing at a denied path
 *     (e.g. `~/.ssh`) must NOT slip past. If the path does not exist yet (`ENOENT`, or any FS error),
 *     fall back to the lexical normalize — existence/readability are OS-enforced at spawn as the
 *     agent's uid (the resolver does not assert existence).
 *
 * The structural validator independently REJECTS a non-absolute path or a residual `..` escape, so
 * this never silently "fixes" a traversal into an escape: an already-absolute path is resolved to its
 * canonical real form; a bad path is left bad (to be rejected).
 *
 * NB: step 2 reads the filesystem — the only place the resolver touches the host, and ONLY for a
 * declared mount host path. A proposal with no `mounts` never reaches here.
 */
export function canonicalizeMountHost(host: string): string {
  // posix.normalize collapses `a/../b` → `b` and `a/./b` → `a/b`; on an absolute path it keeps the
  // leading slash. A relative path stays relative (and the validator then rejects it).
  const normalized = posixPath.normalize(host);
  // Only realpath an already-absolute path; a relative one is rejected structurally anyway and we do
  // not want realpath to resolve it against the process CWD.
  if (!normalized.startsWith("/")) {
    return normalized;
  }
  try {
    // Resolve symlinks to the real target so the allowed-set/denylist check cannot be aliased past.
    return realpathSync(normalized);
  } catch {
    // The path does not exist yet (common for an rw mount that will be created) — fall back to the
    // lexical form; the real path is what the OS enforces at spawn.
    return normalized;
  }
}

/** Apply mount defaults + canonicalization to one mount (target default `/work/<basename>`, mode `ro`). */
function resolveMount(m: MountSpec): MountSpec {
  const host = canonicalizeMountHost(m.host);
  const base = host.split("/").filter(Boolean).pop() ?? "";
  const out: MountSpec = {
    host,
    target: m.target ?? `/work/${base}`,
    mode: m.mode ?? "ro",
  };
  return out;
}

/**
 * MUTATE: deep-merge `defaults` UNDER `proposal`. The agent's explicit parts win; any part the agent
 * omitted is filled from the template default (the structural holes). This is a shallow-by-part merge
 * (each part is replaced wholesale, not field-merged) — matching docs/04 §4 "template defaults
 * injection": the agent overrides a *part*, it does not field-merge into a default part.
 */
function mergeDefaults(
  proposal: AssemblyProposal,
  defaults: TemplateDefaults,
): AssemblySpec["spec"] {
  const spec: AssemblySpec["spec"] = {
    template: proposal.template,
    recipient: proposal.recipient,
  };
  const ttl = proposal.ttl ?? defaults.ttl;
  if (ttl !== undefined) {
    spec.ttl = ttl as NonNullable<AssemblySpec["spec"]["ttl"]>;
  }
  const launcher = proposal.launcher ?? defaults.launcher;
  if (launcher !== undefined) {
    spec.launcher = launcher;
  }
  const connector = proposal.connector ?? defaults.connector;
  if (connector !== undefined) {
    spec.connector = connector;
  }
  const workspace = proposal.workspace ?? defaults.workspace;
  if (workspace !== undefined) {
    spec.workspace = workspace;
  }
  const entrypoints = proposal.entrypoints ?? defaults.entrypoints;
  if (entrypoints !== undefined) {
    spec.entrypoints = entrypoints;
  }
  // Detectors: if the agent supplies any, theirs win wholesale; else the template defaults.
  // (Merging detector lists by union is a richer policy a later slice may add; docs/04 keeps the
  // agent's set authoritative when present.)
  const detectors = proposal.detectors ?? defaults.detectors;
  if (detectors !== undefined) {
    spec.detectors = detectors;
  }
  if (proposal.mounts !== undefined) {
    spec.mounts = proposal.mounts.map(resolveMount);
  }
  return spec;
}

/**
 * Resolve a thin {@link AssemblyProposal} into a {@link ResolvedAssemblySpec} (docs/04 §4, GLA-019).
 * Pure & offline: mutate (defaults + mount canonicalization) → reuse the kernel structural validator.
 * A proposal that does not conform to the assembly contract is rejected HERE with a typed error
 * (`policy.denied` / `catalog.unknown` / `mount.*`) **before admission** (GLA-019 AC#4) — the resolver
 * does not provision and does not reach the policy/catalog/identity checks (those are admission's
 * validate stage). Returns the resolved spec, or the typed error.
 */
export function resolveAssembly(
  proposal: AssemblyProposal,
  defaults: TemplateDefaults,
): ResolveResult {
  // MUTATE
  const merged = mergeDefaults(proposal, defaults);
  const candidate: AssemblySpec = {
    apiVersion: "gla.dev/v1",
    kind: "Assembly",
    metadata:
      proposal.task !== undefined
        ? { intent: proposal.intent, task: proposal.task }
        : { intent: proposal.intent },
    spec: merged,
  };

  // VALIDATE (structural, host-free) — reuse the kernel validator (one pass, all defects).
  const validation = validateAssembly(candidate);
  if (!validation.ok) {
    const err = assemblyDefectsToError(validation.defects);
    return { ok: false, error: new GlaErrorException(err) };
  }

  const resolved = { ...candidate, __resolved: true as const } as ResolvedAssemblySpec;
  return { ok: true, resolved };
}

/**
 * Resolve-or-throw variant: returns the {@link ResolvedAssemblySpec} or THROWS the typed
 * {@link GlaErrorException} (so a caller that prefers exceptions — like the Bridge submission path —
 * gets the pre-admission rejection as a throw mapped to its exit code).
 */
export function resolveAssemblyOrThrow(
  proposal: AssemblyProposal,
  defaults: TemplateDefaults,
): ResolvedAssemblySpec {
  const r = resolveAssembly(proposal, defaults);
  if (!r.ok) {
    throw r.error;
  }
  return r.resolved;
}

export type { AssemblyDefect } from "@gla/kernel";
export { glaError };
