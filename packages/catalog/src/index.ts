// @gla/catalog — core-adjacent ring (baseline §1).
// The system's typed configuration model: Store → Ingester → Index (docs/02 §4, components/catalog.md).
// It holds the entity descriptors, ingests them through a mutate-then-validate pipeline, and exposes
// a queryable index whose availability is **system-derived** (a probe seam), never author-declared
// (the frozen invariant). This is the read surface the Agent Bridge serves at orient (Phase 1) and
// Admission checks at propose (Phase 2). Slice 1 implements the read contract GLA-017 needs:
//   list({kind?, available?}) · show(id) · resolveTemplate(id)/templateShow(id) · skillList/skillShow
//
// It depends ONLY on @gla/kernel (the CatalogPort + the config-schema validator). The concrete probe
// implementations and the YAML Store are seams; Slice 1 loads in-tree manifest data and stubs probes
// to `available` for in-tree parts, while keeping the seam so flipping a probe drops the entity.

import {
  type CatalogEntity,
  type CatalogPort,
  type ConfigSchema,
  type TemplateDescriptor,
  glaError,
  isRedactionOrTemplatePlaceholder,
  redactOperatorEgress,
  redactOperatorText,
  validateSchemaShape,
} from "@gla/kernel";
import {
  BROWSER_HANDOFF_TEMPLATE,
  type BindingStatus,
  CHANNEL_CLI_MANIFEST,
  type DependencyBinding,
  type DependencyConnectionEvidence,
  type DependencyDecisionNote,
  type DependencyInverseOperation,
  type DependencyProbeEvidence,
  type DependencyReceiptEvidence,
  type DependencyRequirement,
  type DependencyState,
  type IndexedDependencyBinding,
  type OwnershipMode,
  PROVIDER_MANIFESTS,
  type ProbeResult,
  type ProviderFamily,
  type ProviderManifest,
  type SkillManifest,
  type TemplateManifest,
  type WpmBundleEvidence,
} from "./manifests.js";

export * from "./manifests.js";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const CATALOG_MODULE = "@gla/catalog" as const;
/** Ring classification from the architecture baseline (informational). */
export const CATALOG_RING = "core-adjacent" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Availability — SYSTEM-DERIVED via a probe seam (docs/02 §4, invariant)
// ─────────────────────────────────────────────────────────────────────────────

/** The system-derived availability of an entity (docs/02 §4): never author-declared. */
export type Availability = "available" | "degraded" | "unavailable";

/**
 * A probe: the health/contract check that proves a provider actually works (docs/02 §3 `probe`).
 * It returns the live availability — the Index derives the indexed status from this + the
 * dependency bindings, so a provider whose probe fails shows as `unavailable` and admission rejects
 * assemblies that need it. Stub probes for in-tree parts return `available`.
 */
export type Probe = () => Availability;

/** The default probe for an in-tree part with all dependencies bound: `available`. */
const ALWAYS_AVAILABLE: Probe = () => "available";

/** Structured WPM dependency binding input accepted by the catalog. */
export type DependencyBindingSource =
  | DependencyBinding[]
  | Record<string, DependencyBinding>
  | { bindingFor(dependency: string): DependencyBinding | undefined };

const SECRET_KEY_RE = /(secret|token|password|credential|private[_-]?key)/i;

const probeToAvailability = (result: ProbeResult): Availability => result;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingFor(
  source: DependencyBindingSource | undefined,
  dependency: string,
): DependencyBinding | undefined {
  if (source === undefined) {
    return undefined;
  }
  if (Array.isArray(source)) {
    return source.find((b) => b.dependency === dependency);
  }
  if ("bindingFor" in source && typeof source.bindingFor === "function") {
    return source.bindingFor(dependency);
  }
  return (source as Record<string, DependencyBinding>)[dependency];
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasUsableText(value: unknown): value is string {
  return hasText(value) && !isRedactionOrTemplatePlaceholder(value);
}

function hasSafeOperatorText(value: unknown): value is string {
  return hasUsableText(value) && redactOperatorText(value) === value;
}

function validateSafeOperatorText(
  value: unknown,
  missing: string[],
  evidencePath: string,
  opts: { required?: boolean } = {},
): boolean {
  if (value === undefined && opts.required !== true) {
    return true;
  }
  if (typeof value !== "string" || value.length === 0) {
    missing.push(evidencePath);
    return false;
  }
  if (isRedactionOrTemplatePlaceholder(value)) {
    missing.push(`${evidencePath}.placeholder`);
    return false;
  }
  if (redactOperatorText(value) !== value) {
    missing.push(`${evidencePath}.unsafe`);
    return false;
  }
  return true;
}

function safeEvidenceSegment(key: string): string {
  return isRedactionOrTemplatePlaceholder(key) || redactOperatorText(key) !== key ? "key" : key;
}

function operatorSafeClone<T>(value: T): T {
  return redactOperatorEgress(structuredClone(value)) as T;
}

function validBundle(
  bundle: unknown,
  requirement: DependencyRequirement,
  missing: string[],
): bundle is WpmBundleEvidence {
  if (!isRecord(bundle)) {
    missing.push("bundle");
    return false;
  }
  const declaredRequires = bundle.declaredRequires;
  let valid = true;
  const expected = requirement.bundle;
  const expectedId = expected?.id ?? requirement.dependency;
  if (!hasText(bundle.id) || bundle.id !== expectedId) {
    missing.push("bundle.id");
    valid = false;
  }
  if (
    !hasText(bundle.version) ||
    (expected?.version !== undefined && bundle.version !== expected.version)
  ) {
    missing.push("bundle.version");
    valid = false;
  }
  if (!isRecord(declaredRequires)) {
    missing.push("bundle.declaredRequires");
    valid = false;
  } else if (expected?.declaredRequires !== undefined) {
    for (const [dependency, range] of Object.entries(expected.declaredRequires)) {
      if (declaredRequires[dependency] !== range) {
        missing.push(`bundle.declaredRequires.${dependency}`);
        valid = false;
      }
    }
  }
  return valid;
}

function validReceipt(receipt: unknown, missing: string[]): receipt is DependencyReceiptEvidence {
  if (!isRecord(receipt) || receipt.status !== "Done") {
    missing.push("receipt");
    return false;
  }
  let valid = true;
  valid =
    validateSafeOperatorText(receipt.taskId, missing, "receipt.taskId", { required: true }) &&
    valid;
  valid = validateSafeOperatorText(receipt.recordedAt, missing, "receipt.recordedAt") && valid;
  if (Array.isArray(receipt.refs)) {
    for (const [index, ref] of receipt.refs.entries()) {
      if (typeof ref !== "string") {
        missing.push(`receipt.refs.${index}`);
        valid = false;
      } else if (isRedactionOrTemplatePlaceholder(ref)) {
        missing.push(`receipt.refs.${index}.placeholder`);
        valid = false;
      } else if (redactOperatorText(ref) !== ref) {
        missing.push(`receipt.refs.${index}.unsafe`);
        valid = false;
      }
    }
  }
  if (isRecord(receipt.checksums)) {
    for (const [key, checksum] of Object.entries(receipt.checksums)) {
      const keyPath = safeEvidenceSegment(key);
      if (isRedactionOrTemplatePlaceholder(key)) {
        missing.push(`receipt.checksums.${keyPath}.placeholder`);
        valid = false;
      } else if (redactOperatorText(key) !== key) {
        missing.push(`receipt.checksums.${keyPath}.unsafe`);
        valid = false;
      }
      if (typeof checksum !== "string") {
        missing.push(`receipt.checksums.${keyPath}`);
        valid = false;
      } else if (isRedactionOrTemplatePlaceholder(checksum)) {
        missing.push(`receipt.checksums.${keyPath}.placeholder`);
        valid = false;
      } else if (redactOperatorText(checksum) !== checksum) {
        missing.push(`receipt.checksums.${keyPath}.unsafe`);
        valid = false;
      }
    }
  }
  return valid;
}

function validProbe(
  probe: unknown,
  missing: string[] = [],
  evidencePath = "lastProbe",
): probe is DependencyProbeEvidence {
  if (
    !isRecord(probe) ||
    (probe.result !== "available" && probe.result !== "degraded" && probe.result !== "unavailable")
  ) {
    return false;
  }
  if (probe.at !== undefined && !hasSafeOperatorText(probe.at)) {
    missing.push(`${evidencePath}.at`);
  }
  validateSafeOperatorText(probe.detail, missing, `${evidencePath}.detail`);
  return !missing.some((m) => m.startsWith(`${evidencePath}.`));
}

function validConnection(
  connection: unknown,
  requirement: DependencyRequirement,
  missing: string[],
): connection is DependencyConnectionEvidence {
  if (!isRecord(connection) || !isRecord(connection.refs)) {
    missing.push("connection.refs");
    return false;
  }
  const refs = connection.refs;
  if (Object.keys(refs).length === 0) {
    missing.push("connection.refs.nonempty");
  }
  for (const requiredRef of requirement.connectionRefs ?? []) {
    if (refs[requiredRef] === undefined) {
      missing.push(`connection.refs.${requiredRef}`);
    }
  }
  const allowedKinds = new Set([
    "literal",
    "secret-ref",
    "path-ref",
    "uri-ref",
    "service-ref",
    "socket-ref",
  ]);
  for (const [key, ref] of Object.entries(refs)) {
    const keyPath = safeEvidenceSegment(key);
    if (isRedactionOrTemplatePlaceholder(key)) {
      missing.push(`connection.refs.${keyPath}.placeholder`);
    } else if (redactOperatorText(key) !== key) {
      missing.push(`connection.refs.${keyPath}.unsafe`);
    }
    if (!isRecord(ref) || !hasText(ref.kind) || !allowedKinds.has(ref.kind) || !hasText(ref.ref)) {
      missing.push(`connection.refs.${keyPath}`);
      continue;
    }
    if (isRedactionOrTemplatePlaceholder(ref.ref)) {
      missing.push(`connection.refs.${keyPath}.placeholder`);
    }
    if (redactOperatorText(ref.ref) !== ref.ref) {
      missing.push(`connection.refs.${keyPath}.unsafe`);
    }
    if (SECRET_KEY_RE.test(key) && ref.kind !== "secret-ref") {
      missing.push(`connection.refs.${keyPath}.secret-ref`);
    }
    if (ref.kind === "secret-ref" && !ref.ref.startsWith("secret:")) {
      missing.push(`connection.refs.${keyPath}.secret-ref-pointer`);
    }
  }
  return !missing.some((m) => m.startsWith("connection."));
}

function validInverseOperation(
  inverseOp: unknown,
  missing: string[],
): inverseOp is DependencyInverseOperation {
  if (!isRecord(inverseOp)) {
    missing.push("inverseOp");
    return false;
  }
  let valid = true;
  valid =
    validateSafeOperatorText(inverseOp.description, missing, "inverseOp.description", {
      required: true,
    }) && valid;
  valid = validateSafeOperatorText(inverseOp.command, missing, "inverseOp.command") && valid;
  valid = validateSafeOperatorText(inverseOp.condition, missing, "inverseOp.condition") && valid;
  return valid;
}

function validDecisionNotes(notes: unknown, missing: string[]): notes is DependencyDecisionNote[] {
  if (notes === undefined) {
    return true;
  }
  if (!Array.isArray(notes)) {
    missing.push("decisionNotes");
    return false;
  }
  let valid = true;
  for (const [index, note] of notes.entries()) {
    if (!isRecord(note)) {
      missing.push(`decisionNotes.${index}`);
      valid = false;
      continue;
    }
    valid =
      validateSafeOperatorText(note.note, missing, `decisionNotes.${index}.note`, {
        required: true,
      }) && valid;
    valid =
      validateSafeOperatorText(note.rationale, missing, `decisionNotes.${index}.rationale`) &&
      valid;
  }
  return valid;
}

function stateMatchesOwnership(ownershipMode: OwnershipMode, state: DependencyState): boolean {
  switch (ownershipMode) {
    case "managed":
      return state === "installed";
    case "local-external":
      return state === "adopted";
    case "remote-external":
      return state === "remote";
    case "manual-byo":
      return state === "manual";
    case "disabled":
      return state === "disabled";
  }
}

function statusFromMissing(
  binding: DependencyBinding | undefined,
  missingEvidence: string[],
): BindingStatus {
  if (binding?.ownershipMode === "disabled" || binding?.state === "disabled") {
    return "unbound";
  }
  if (missingEvidence.length > 0 || binding === undefined) {
    return "unbound";
  }
  if (binding.lastProbe.result !== "available") {
    return "degraded";
  }
  return "bound";
}

function sanitizedConnection(
  connection: DependencyConnectionEvidence | undefined,
): DependencyConnectionEvidence | undefined {
  if (connection === undefined) {
    return undefined;
  }
  return operatorSafeClone(connection);
}

function evaluateRequirement(
  requirement: DependencyRequirement,
  binding: DependencyBinding | undefined,
  currentProbe: DependencyProbeEvidence,
): IndexedDependencyBinding {
  const missingEvidence: string[] = [];
  if (requirement.hostTouching !== true) {
    return {
      ...requirement,
      status: "bound",
      currentProbe,
      missingEvidence,
      diagnostics: { install: "available", runtime: currentProbe.result },
    };
  }

  if (binding === undefined) {
    missingEvidence.push("wpm-receipt");
  } else {
    if (binding.source !== "wpm-receipt") {
      missingEvidence.push("source.wpm-receipt");
    }
    if (binding.dependency !== requirement.dependency) {
      missingEvidence.push("dependency.match");
    }
    validBundle(binding.bundle, requirement, missingEvidence);
    validReceipt(binding.receipt, missingEvidence);
    if (!validProbe(binding.lastProbe, missingEvidence)) {
      missingEvidence.push("lastProbe");
    }
    if (
      binding.ownershipMode !== "managed" &&
      binding.ownershipMode !== "local-external" &&
      binding.ownershipMode !== "remote-external" &&
      binding.ownershipMode !== "manual-byo" &&
      binding.ownershipMode !== "disabled"
    ) {
      missingEvidence.push("ownershipMode");
    }
    if (
      binding.state !== "installed" &&
      binding.state !== "adopted" &&
      binding.state !== "remote" &&
      binding.state !== "manual" &&
      binding.state !== "disabled"
    ) {
      missingEvidence.push("state");
    } else if (!stateMatchesOwnership(binding.ownershipMode, binding.state)) {
      missingEvidence.push("state.ownershipMode");
    }
    if (binding.ownershipMode !== "disabled") {
      validConnection(binding.connection, requirement, missingEvidence);
    }
    if (binding.ownershipMode === "managed" && binding.inverseOp === undefined) {
      missingEvidence.push("inverseOp");
    } else if (binding.inverseOp !== undefined) {
      validInverseOperation(binding.inverseOp, missingEvidence);
    }
    validDecisionNotes(binding.decisionNotes, missingEvidence);
  }

  const status = statusFromMissing(binding, missingEvidence);
  const installProbe: ProbeResult =
    binding !== undefined && validProbe(binding.lastProbe)
      ? binding.lastProbe.result
      : "unavailable";
  const base: IndexedDependencyBinding = {
    ...requirement,
    status,
    currentProbe,
    missingEvidence,
    diagnostics: {
      install: installProbe,
      runtime: currentProbe.result,
    },
  };
  if (binding === undefined) {
    return base;
  }
  const out: IndexedDependencyBinding = {
    ...base,
    ownershipMode: binding.ownershipMode,
    state: binding.state,
    bundle: operatorSafeClone(binding.bundle),
    receipt: operatorSafeClone(binding.receipt),
    lastProbe: operatorSafeClone(binding.lastProbe),
  };
  const connection = sanitizedConnection(binding.connection);
  if (connection !== undefined) {
    out.connection = connection;
  }
  if (binding.inverseOp !== undefined) {
    out.inverseOp = operatorSafeClone(binding.inverseOp) as DependencyInverseOperation;
  }
  if (binding.decisionNotes !== undefined) {
    out.decisionNotes = operatorSafeClone(binding.decisionNotes) as DependencyDecisionNote[];
  }
  return out;
}

/**
 * Derive an entity's availability from validated dependency diagnostics and its current probe —
 * SYSTEM-derived, never read from the manifest. Invalid/missing/disabled WPM evidence forces
 * `unavailable`; a degraded current probe is not available.
 */
function deriveAvailability(
  requires: IndexedDependencyBinding[] | undefined,
  currentProbe: DependencyProbeEvidence,
): Availability {
  for (const dep of requires ?? []) {
    if (dep.status === "unbound" || dep.ownershipMode === "disabled" || dep.state === "disabled") {
      return "unavailable";
    }
  }
  const probed = probeToAvailability(currentProbe.result);
  if (probed === "unavailable") {
    return "unavailable";
  }
  const anyDegraded = (requires ?? []).some((d) => d.status === "degraded");
  if (anyDegraded || probed === "degraded") {
    return "degraded";
  }
  return "available";
}

const PART_FAMILY: Record<string, ProviderFamily> = {
  launcher: "launcher",
  entrypoint: "entrypoint",
  connector: "connector",
  workspace: "workspace",
  detector: "detector",
};

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function providerFamilyForPart(part: string): ProviderFamily | undefined {
  return PART_FAMILY[part];
}

function deriveCompatibleProviders(
  template: TemplateManifest,
  providers: Iterable<ProviderManifest>,
): Record<string, string[]> | undefined {
  const openParts = template.spec.openParts ?? [];
  if (openParts.length === 0) {
    return undefined;
  }
  const explicit = template.spec.compatibleProviders ?? {};
  const providerList = [...providers];
  const providersByName = new Map(
    providerList.map((provider) => [provider.metadata.name, provider]),
  );
  const relationKeyForPart = (part: string): string => `${part}s`;
  const requiredProviderIds = uniqueStrings(Object.values(template.spec.requiredParts));
  const relatedFromRequiredProviders = (part: string): string[] => {
    const relationKey = relationKeyForPart(part);
    return requiredProviderIds.flatMap((providerId) => {
      const compatibleWith = providersByName.get(providerId)?.spec.relations?.compatibleWith;
      return compatibleWith?.[relationKey] ?? [];
    });
  };
  const declaresTemplateCompatibility = (provider: ProviderManifest, part: string): boolean => {
    const family = providerFamilyForPart(part);
    if (provider.spec.family !== family) {
      return false;
    }
    const compatibleWith = provider.spec.relations?.compatibleWith;
    return compatibleWith?.templates?.includes(template.metadata.name) === true;
  };
  const out: Record<string, string[]> = {};
  for (const part of openParts) {
    const defaultProvider = template.spec.requiredParts[part];
    const selfDeclaredProviders = providerList
      .filter((provider) => declaresTemplateCompatibility(provider, part))
      .map((provider) => provider.metadata.name);
    out[part] = uniqueStrings([
      ...(explicit[part] ?? []),
      ...relatedFromRequiredProviders(part),
      ...selfDeclaredProviders,
      ...(defaultProvider !== undefined ? [defaultProvider] : []),
    ]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The indexed entity — what list/show return
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An ingested + indexed catalog entity (the Index row). Extends the kernel's open
 * {@link CatalogEntity} (so it satisfies `CatalogPort`) with the slice's read fields: the family,
 * a capability summary, the system-derived availability, and (for providers) the dependency
 * bindings that drive it. `available` is the boolean the kernel port exposes; `availability` is the
 * three-valued system-derived status.
 */
export interface IndexedEntity extends CatalogEntity {
  name: string;
  kind: string;
  family: string;
  summary: string;
  /** SYSTEM-DERIVED (probe + bindings). The boolean `available` = (availability === "available"). */
  available: boolean;
  availability: Availability;
  /** The evaluated dependency diagnostics backing this provider (empty for pure in-tree parts). */
  requires: IndexedDependencyBinding[];
}

/** Stable catalog/provider diagnostic surfaced by template, catalog, and admission reads. */
export interface CatalogDiagnostic {
  code:
    | "provider.available"
    | "provider.unknown"
    | "provider.unavailable"
    | "provider.degraded"
    | "template.dependency_unavailable";
  message: string;
  provider?: string;
  part?: string;
  family?: string;
  dependency?: string;
  detail?: Record<string, unknown>;
}

/** The binding status of one required part, as `template show` reports it (GLA-017 AC#2). */
export interface PartBinding {
  /** The part-role (launcher | entrypoint | connector | workspace | detector). */
  part: string;
  /** The provider backing the part. */
  provider: string;
  /** The provider family backing this role, when the provider is known. */
  family?: string;
  /** The provider's system-derived availability. */
  availability: Availability;
  /** Boolean convenience for callers that only need an admit/list decision. */
  available: boolean;
  /** Each backing dependency's evaluated binding diagnostics. */
  dependencies: IndexedDependencyBinding[];
  /** Stable provider diagnostics for this template part. */
  diagnostics: CatalogDiagnostic[];
}

/** What `templateShow` returns (GLA-017 AC#2): required parts + each backing dependency's binding. */
export interface TemplateShowResult extends TemplateDescriptor {
  id: string;
  /** The required part-roles (kernel TemplateDescriptor shape). */
  requiredParts: string[];
  openParams: ConfigSchema;
  available: boolean;
  availability: Availability;
  /** Open-part compatibility derived from provider manifests and any explicit template narrowing. */
  compatibleProviders?: Record<string, string[]>;
  /** Template-level dependency diagnostics, e.g. public edge/proxy evidence. */
  dependencies: IndexedDependencyBinding[];
  /** Per required part, the backing provider + its dependency binding status. */
  parts: PartBinding[];
  /** Stable template-level diagnostics, including public-edge dependency failures. */
  diagnostics: CatalogDiagnostic[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Store → Ingester → Index
// ─────────────────────────────────────────────────────────────────────────────

/** The raw descriptors the Store holds (docs/02 §4 step 1). In Slice 1: in-tree manifest data. */
export interface StoreContent {
  providers: ProviderManifest[];
  templates: TemplateManifest[];
}

function providerDiagnostics(
  provider: string,
  ent: IndexedEntity | undefined,
  part?: string,
): CatalogDiagnostic[] {
  if (ent === undefined) {
    return [
      {
        code: "provider.unknown",
        message: `unknown provider "${provider}"`,
        provider,
        ...(part !== undefined ? { part } : {}),
      },
    ];
  }
  if (ent.availability === "available") {
    return [
      {
        code: "provider.available",
        message: `provider "${provider}" is available`,
        provider,
        family: ent.family,
        ...(part !== undefined ? { part } : {}),
      },
    ];
  }
  const code = ent.availability === "degraded" ? "provider.degraded" : "provider.unavailable";
  return [
    {
      code,
      message: `provider "${provider}" is ${ent.availability}`,
      provider,
      family: ent.family,
      ...(part !== undefined ? { part } : {}),
      detail: {
        availability: ent.availability,
        dependencies: ent.requires,
      },
    },
  ];
}

function templateDiagnostics(
  dependencies: IndexedDependencyBinding[],
  parts: PartBinding[],
): CatalogDiagnostic[] {
  const diagnostics: CatalogDiagnostic[] = [];
  for (const dep of dependencies) {
    if (
      dep.status !== "bound" ||
      dep.diagnostics.install !== "available" ||
      dep.diagnostics.runtime !== "available"
    ) {
      diagnostics.push({
        code: "template.dependency_unavailable",
        message: `template dependency "${dep.dependency}" is not available`,
        dependency: dep.dependency,
        detail: { dependency: dep },
      });
    }
  }
  for (const part of parts) {
    diagnostics.push(
      ...part.diagnostics.filter((diagnostic) => diagnostic.code !== "provider.available"),
    );
  }
  return diagnostics;
}

/** Per-probe-name overrides for tests/wiring (flip a part's probe to prove system-derived drop). */
export type ProbeRegistry = Record<string, Probe>;

interface IngestResult {
  entities: Map<string, IndexedEntity>;
  templates: Map<string, TemplateManifest>;
  skills: Map<string, SkillManifest>;
}

/**
 * The Ingester (docs/02 §4): for each manifest — **mutate** (defaults already applied in-tree),
 * **validate** (the manifest conforms to its family shape AND its `config_schema` is itself valid
 * JSON-Schema — the kernel's `validateSchemaShape`), then **index** with system-derived availability
 * (the probe + bindings). A manifest that fails validation is rejected at ingest and never reaches
 * the index (so an unlisted entity is inert — the catalog invariant). Skills are registered with the
 * skill manifest; relations are kept for `template show`.
 */
function ingest(
  content: StoreContent,
  probes: ProbeRegistry,
  bindings: DependencyBindingSource | undefined,
): IngestResult {
  const entities = new Map<string, IndexedEntity>();
  const templates = new Map<string, TemplateManifest>();
  const skills = new Map<string, SkillManifest>();

  const probeFor = (name: string | undefined): Probe => (name && probes[name]) || ALWAYS_AVAILABLE;

  const registerSkills = (list: SkillManifest[] | undefined): void => {
    for (const s of list ?? []) {
      skills.set(s.id, s);
    }
  };

  for (const m of content.providers) {
    // VALIDATE: a config_schema (if declared) must itself be valid before it can constrain anything.
    if (m.spec.config_schema !== undefined) {
      const shape = validateSchemaShape(m.spec.config_schema);
      if (!shape.ok) {
        throw glaError(
          "policy.denied",
          `provider "${m.metadata.name}" has an invalid config_schema`,
          {
            detail: { defects: shape.defects },
          },
        );
      }
    }
    const currentProbe: DependencyProbeEvidence = { result: probeFor(m.spec.probe)() };
    const requires = (m.spec.requires ?? []).map((requirement) =>
      evaluateRequirement(requirement, bindingFor(bindings, requirement.dependency), currentProbe),
    );
    const availability = deriveAvailability(requires, currentProbe);
    entities.set(m.metadata.name, {
      name: m.metadata.name,
      kind: m.kind,
      family: m.spec.family,
      summary: m.spec.capability.summary,
      availability,
      available: availability === "available",
      requires,
    });
    registerSkills(m.spec.skills);
  }

  for (const t of content.templates) {
    if (t.spec.openParams !== undefined) {
      const shape = validateSchemaShape(t.spec.openParams);
      if (!shape.ok) {
        throw glaError("policy.denied", `template "${t.metadata.name}" has invalid openParams`, {
          detail: { defects: shape.defects },
        });
      }
    }
    templates.set(t.metadata.name, t);
    // A template is available iff its template-level dependencies, own probe, and every required part are available.
    const currentProbe: DependencyProbeEvidence = { result: probeFor(t.spec.probe)() };
    const requires = (t.spec.requires ?? []).map((requirement) =>
      evaluateRequirement(requirement, bindingFor(bindings, requirement.dependency), currentProbe),
    );
    const selfAvailability = deriveAvailability(requires, currentProbe);
    const partAvailabilities = Object.values(t.spec.requiredParts).map(
      (provider) => entities.get(provider)?.availability,
    );
    const missingOrUnavailablePart = partAvailabilities.some(
      (availability) => availability === undefined || availability === "unavailable",
    );
    const degradedPart = partAvailabilities.some((availability) => availability === "degraded");
    const availability: Availability =
      selfAvailability === "unavailable" || missingOrUnavailablePart
        ? "unavailable"
        : selfAvailability === "degraded" || degradedPart
          ? "degraded"
          : "available";
    entities.set(t.metadata.name, {
      name: t.metadata.name,
      kind: t.kind,
      family: t.spec.family,
      summary: t.spec.capability.summary,
      availability,
      available: availability === "available",
      requires,
    });
    registerSkills(t.spec.skills);
  }

  return { entities, templates, skills };
}

// ─────────────────────────────────────────────────────────────────────────────
// CatalogService — the read API (CatalogPort + the slice's richer reads)
// ─────────────────────────────────────────────────────────────────────────────

/** Options to build a CatalogService: the Store content + an optional probe registry. */
export interface CatalogServiceOptions {
  content?: StoreContent;
  /** Per-probe overrides; a missing probe defaults to `available` (in-tree parts). */
  probes?: ProbeRegistry;
  /** Structured WPM DependencyBinding receipt evidence. Absent means host-touching deps are unavailable. */
  dependencyBindings?: DependencyBindingSource;
}

/**
 * The default in-tree Store content for the browser-handoff reference slice. Returns a DEEP CLONE
 * of the module-level seed manifests so a caller (or a test) can mutate a binding/probe on the
 * returned content without corrupting the shared seed — each `CatalogService` gets an isolated
 * Store, matching how a real (file-backed) Store hands the Ingester a fresh read each time.
 */
export function defaultStoreContent(): StoreContent {
  return structuredClone({
    providers: [...Object.values(PROVIDER_MANIFESTS), CHANNEL_CLI_MANIFEST],
    templates: [BROWSER_HANDOFF_TEMPLATE],
  });
}

/**
 * Structured WPM receipt fixture for tests/development flows that intentionally simulate an installed
 * reference browser-handoff stack. Production composition should pass real receipts instead.
 */
export function referenceWpmDependencyBindings(): DependencyBinding[] {
  return structuredClone([
    {
      dependency: "browser-runtime",
      source: "wpm-receipt",
      ownershipMode: "managed",
      state: "installed",
      installed: true,
      bundle: {
        id: "browser-runtime",
        version: "0.1.0",
        declaredRequires: { "gla-core": "^0.1.0" },
      },
      receipt: {
        taskId: "browser-runtime-3",
        status: "Done",
        recordedAt: "2026-06-13T00:00:00.000Z",
        refs: ["wpm/wip/bundles/browser-runtime/install-backlog/tasks/browser-runtime-3"],
      },
      connection: {
        refs: {
          chromium: { kind: "path-ref", ref: "playwright:chromium" },
          cdp: { kind: "uri-ref", ref: "runtime:cdp" },
        },
      },
      lastProbe: { at: "2026-06-13T00:00:00.000Z", result: "available" },
      inverseOp: {
        description: "Remove only browser/runtime files installed by the browser-runtime bundle.",
        condition: "Only when receipt ownershipMode is managed.",
      },
      decisionNotes: [{ note: "Managed install fixture for the reference browser runtime." }],
    },
    {
      dependency: "human-view",
      source: "wpm-receipt",
      ownershipMode: "managed",
      state: "installed",
      installed: true,
      bundle: {
        id: "human-view",
        version: "0.1.0",
        declaredRequires: { "gla-core": "^0.1.0", "browser-runtime": "^0.1.0" },
      },
      receipt: {
        taskId: "human-view-3",
        status: "Done",
        recordedAt: "2026-06-13T00:00:00.000Z",
        refs: ["wpm/wip/bundles/human-view/install-backlog/tasks/human-view-3"],
      },
      connection: {
        refs: {
          novnc: { kind: "uri-ref", ref: "runtime:novnc" },
          xvfb: { kind: "service-ref", ref: "runtime:xvfb" },
        },
      },
      lastProbe: { at: "2026-06-13T00:00:00.000Z", result: "available" },
      inverseOp: {
        description: "Remove only noVNC/X stack components installed by the human-view bundle.",
        condition: "Only when receipt ownershipMode is managed.",
      },
      decisionNotes: [{ note: "Managed install fixture for the reference human-view stack." }],
    },
    {
      dependency: "identity-provider",
      source: "wpm-receipt",
      ownershipMode: "local-external",
      state: "adopted",
      installed: true,
      bundle: {
        id: "identity-provider",
        version: "0.1.0",
        declaredRequires: { "gla-core": "^0.1.0" },
      },
      receipt: {
        taskId: "identity-provider-6",
        status: "Done",
        recordedAt: "2026-06-13T00:00:00.000Z",
        refs: ["wpm/wip/bundles/identity-provider/install-backlog/tasks/identity-provider-6"],
      },
      connection: {
        refs: {
          issuerUrl: { kind: "uri-ref", ref: "https://idp.example/application/o/gla/" },
          clientId: { kind: "literal", ref: "gla-client" },
          clientSecret: { kind: "secret-ref", ref: "secret:authentik/client-secret" },
          redirectUri: { kind: "uri-ref", ref: "https://gla.example/auth/callback" },
        },
      },
      lastProbe: { at: "2026-06-13T00:00:00.000Z", result: "available" },
      decisionNotes: [{ note: "Reference adopted authentik identity-provider fixture." }],
    },
    {
      dependency: "edge-proxy",
      source: "wpm-receipt",
      ownershipMode: "local-external",
      state: "adopted",
      installed: true,
      bundle: {
        id: "edge-proxy",
        version: "0.1.0",
        declaredRequires: { "gla-core": "^0.1.0" },
      },
      receipt: {
        taskId: "edge-proxy-3",
        status: "Done",
        recordedAt: "2026-06-13T00:00:00.000Z",
        refs: ["wpm/wip/bundles/edge-proxy/install-backlog/tasks/edge-proxy-3"],
      },
      connection: {
        refs: {
          publicBaseUrl: { kind: "uri-ref", ref: "https://gla.example/" },
          gatewayUpstream: { kind: "uri-ref", ref: "http://127.0.0.1:3000" },
        },
      },
      lastProbe: { at: "2026-06-13T00:00:00.000Z", result: "available" },
      decisionNotes: [
        {
          note: "Reference adopted host edge proxy; GLA Access Gateway remains the grant verifier.",
        },
      ],
    },
  ]);
}

/**
 * The Catalog read service (components/catalog.md). Constructed from Store content (defaults to the
 * in-tree reference slice) and a probe registry; it ingests once at construction and serves the
 * read surface. Implements the kernel {@link CatalogPort} (list/show/resolveTemplate) plus the
 * slice's richer `templateShow`/`skillList`/`skillShow`. All reads are side-effect-free
 * (GLA-017 AC#4): the service mutates nothing after ingest.
 */
export class CatalogService implements CatalogPort {
  private readonly index: IngestResult;
  private readonly store: StoreContent;

  constructor(opts: CatalogServiceOptions = {}) {
    this.store = opts.content ?? defaultStoreContent();
    this.index = ingest(this.store, opts.probes ?? {}, opts.dependencyBindings);
  }

  /**
   * List indexed entities (docs/05 `catalog list`), filtered by `kind` and/or `available`. When
   * `available: true`, only entities whose SYSTEM-DERIVED availability is `available` are returned —
   * never anything the caller asserted (GLA-017 AC#3). Read-only.
   */
  list(filter?: { kind?: string; available?: boolean }): IndexedEntity[] {
    let rows = [...this.index.entities.values()];
    if (filter?.kind !== undefined) {
      const k = filter.kind.toLowerCase();
      rows = rows.filter((e) => e.kind.toLowerCase() === k || e.family.toLowerCase() === k);
    }
    if (filter?.available === true) {
      rows = rows.filter((e) => e.available);
    }
    // Stable order by name so output is deterministic.
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Look up one entity by name (docs/05 `catalog`/`template`/`skill show` lookups). Read-only. */
  show(name: string): IndexedEntity | undefined {
    return this.index.entities.get(name);
  }

  /**
   * Resolve a template to the kernel {@link TemplateDescriptor} (required parts + open-param schema
   * + binding status). Returns `undefined` for an unknown id (the CLI maps that to exit 5). Used by
   * Admission and the Bridge. Read-only.
   */
  resolveTemplate(id: string): TemplateDescriptor | undefined {
    const show = this.tryTemplateShow(id);
    if (show === undefined) {
      return undefined;
    }
    return {
      id: show.id,
      requiredParts: show.requiredParts,
      openParams: show.openParams,
      available: show.available,
      availability: show.availability,
      compatibleProviders: show.compatibleProviders,
      dependencies: show.dependencies,
      parts: show.parts,
      diagnostics: show.diagnostics,
    };
  }

  /**
   * Show a template (docs/05 `template show <id>`, GLA-017 AC#2): its required parts and, per part,
   * the backing provider + **each backing dependency's binding status**. Throws the kernel's
   * not-found error for an unknown id (the CLI maps `catalog.unknown` → exit 5).
   */
  templateShow(id: string): TemplateShowResult {
    const show = this.tryTemplateShow(id);
    if (show === undefined) {
      throw glaError("catalog.unknown", `unknown template: "${id}"`, { detail: { id } });
    }
    return show;
  }

  /** Internal: build the TemplateShowResult, or undefined if the template is unknown. */
  private tryTemplateShow(id: string): TemplateShowResult | undefined {
    const t = this.index.templates.get(id);
    if (t === undefined) {
      return undefined;
    }
    const parts: PartBinding[] = Object.entries(t.spec.requiredParts).map(([part, provider]) => {
      const ent = this.index.entities.get(provider);
      return {
        part,
        provider,
        ...(ent?.family !== undefined ? { family: ent.family } : {}),
        availability: ent?.availability ?? "unavailable",
        available: ent?.availability === "available",
        dependencies: ent?.requires ?? [],
        diagnostics: providerDiagnostics(provider, ent, part),
      };
    });
    const entity = this.index.entities.get(id);
    const availability = entity?.availability ?? "unavailable";
    const dependencies = entity?.requires ?? [];
    const diagnostics = templateDiagnostics(dependencies, parts);
    const compatibleProviders = deriveCompatibleProviders(t, this.store.providers);
    return {
      id,
      requiredParts: Object.keys(t.spec.requiredParts),
      openParams: t.spec.openParams ?? {},
      available: availability === "available",
      availability,
      ...(compatibleProviders !== undefined ? { compatibleProviders } : {}),
      dependencies,
      parts,
      diagnostics,
    };
  }

  /** List registered skills (docs/05 `skill list`), optionally those `--for` a template. Read-only. */
  skillList(filter?: { for?: string }): Array<{ id: string; for?: string }> {
    let rows = [...this.index.skills.values()];
    if (filter?.for !== undefined) {
      rows = rows.filter((s) => s.for === filter.for);
    }
    return rows
      .map((s) => (s.for !== undefined ? { id: s.id, for: s.for } : { id: s.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Show a skill (docs/05 `skill show <id>`): emit the SKILL.md body. Throws the kernel's not-found
   * error for an unknown id (→ exit 5). Read-only.
   */
  skillShow(id: string): { id: string; for?: string; body: string } {
    const s = this.index.skills.get(id);
    if (s === undefined) {
      throw glaError("catalog.unknown", `unknown skill: "${id}"`, { detail: { id } });
    }
    return s.for !== undefined
      ? { id: s.id, for: s.for, body: s.body }
      : { id: s.id, body: s.body };
  }
}

export type { BindingStatus };

// ─────────────────────────────────────────────────────────────────────────────
// Admission-facing view — the catalog facts admission's mutate→validate needs
// ─────────────────────────────────────────────────────────────────────────────
//
// Admission (packages/admission) defines an `AdmissionCatalogPort` it depends on; this is the
// catalog's adapter to it. The shape is declared HERE (structurally identical to admission's port) so
// neither package imports the other — `app`/the CLI passes the value across the seam. Keeping the
// shape duplicated (3 small methods) is the price of zero cross-coupling between two core-adjacent
// packages; the structural-typing test in admission proves they stay compatible.

/** The template defaults (parts + ttl) admission injects in its mutate step. Plain data. */
export interface CatalogTemplateDefaults {
  template: string;
  launcher?: { use: string; params?: Record<string, unknown> };
  entrypoints?: Array<{ use: string; params?: Record<string, unknown> }>;
  connector?: { use: string; params?: Record<string, unknown> };
  workspace?: { use: string; params?: Record<string, unknown> };
  detectors?: Array<{ use: string; params?: Record<string, unknown> }>;
  ttl?: string;
  /** Part-roles the agent MAY override (docs/04 §5); a role not listed is template-FIXED. */
  openParts?: string[];
  /** Per open part-role, the compatible provider `use` names (`relations.compatibleWith`). */
  compatibleProviders?: Record<string, string[]>;
  /** System-derived template availability at the catalog/admission seam. */
  available?: boolean;
  /** Three-valued template availability used for diagnostics. */
  availability?: Availability;
  /** Template-level dependency evidence, such as public-edge proxy bindings. */
  dependencies?: IndexedDependencyBinding[];
  /** Stable diagnostics for unavailable template-level dependencies or required parts. */
  diagnostics?: CatalogDiagnostic[];
}

/** A provider's facts admission reads (availability + its typed config_schema). */
export interface CatalogProviderInfo {
  name: string;
  available: boolean;
  availability: Availability;
  family: string;
  diagnostics: CatalogDiagnostic[];
  dependencies: IndexedDependencyBinding[];
  config_schema?: ConfigSchema;
}

/** A launcher's declared mount capability (kernel `MountCapability`-shaped). */
export interface CatalogLauncherMountCapability {
  file: boolean;
  directory: boolean;
  modes: Array<"ro" | "rw">;
}

/** The catalog facts admission needs (structurally === admission's `AdmissionCatalogPort`). */
export interface CatalogAdmissionView {
  templateDefaults(id: string): CatalogTemplateDefaults | undefined;
  provider(use: string): CatalogProviderInfo | undefined;
  launcherMountCapability(launcher: string): CatalogLauncherMountCapability | undefined;
}

/** Read a launcher manifest's declared mount capability from its `capability.mounts` (docs/02 §3). */
function mountCapabilityOf(
  m: ProviderManifest | undefined,
): CatalogLauncherMountCapability | undefined {
  if (m === undefined) {
    return undefined;
  }
  const mounts = (m.spec.capability as { mounts?: unknown }).mounts as
    | { host_paths?: string[]; modes?: Array<"ro" | "rw"> }
    | undefined;
  if (mounts === undefined) {
    // A launcher with no declared mounts shares no host (mount.unsupported downstream).
    return { file: false, directory: false, modes: [] };
  }
  const hostPaths = mounts.host_paths ?? [];
  return {
    file: hostPaths.includes("file"),
    directory: hostPaths.includes("directory"),
    modes: mounts.modes ?? [],
  };
}

/**
 * Adapt a {@link CatalogService} (+ its Store content) into the {@link CatalogAdmissionView} admission
 * consumes. `templateDefaults` derives the structural defaults from the template's `requiredParts`
 * map (role → provider name) so the resolver fills the holes; `provider` exposes availability + the
 * provider's `config_schema`; `launcherMountCapability` reads the launcher manifest's declared mounts.
 * All reads are over the already-ingested index (system-derived availability); nothing is mutated.
 */
export function toAdmissionCatalog(
  service: CatalogService,
  store: StoreContent = defaultStoreContent(),
): CatalogAdmissionView {
  const providersByName = new Map<string, ProviderManifest>();
  for (const p of store.providers) {
    providersByName.set(p.metadata.name, p);
  }
  const templatesByName = new Map<string, TemplateManifest>();
  for (const t of store.templates) {
    templatesByName.set(t.metadata.name, t);
  }

  return {
    templateDefaults(id: string): CatalogTemplateDefaults | undefined {
      const t = templatesByName.get(id);
      if (t === undefined) {
        return undefined;
      }
      const parts = t.spec.requiredParts;
      const out: CatalogTemplateDefaults = { template: id };
      if (parts.launcher) {
        out.launcher = { use: parts.launcher };
      }
      if (parts.entrypoint) {
        out.entrypoints = [{ use: parts.entrypoint }];
      }
      if (parts.connector) {
        out.connector = { use: parts.connector };
      }
      if (parts.workspace) {
        out.workspace = { use: parts.workspace };
      }
      if (parts.detector) {
        out.detectors = [{ use: parts.detector }];
      }
      if (t.spec.openParts !== undefined) {
        out.openParts = [...t.spec.openParts];
      }
      const compatibleProviders = deriveCompatibleProviders(t, providersByName.values());
      if (compatibleProviders !== undefined) {
        out.compatibleProviders = compatibleProviders;
      }
      const show = service.templateShow(id);
      out.available = show.available;
      out.availability = show.availability;
      out.dependencies = show.dependencies;
      out.diagnostics = show.diagnostics;
      if (show.compatibleProviders !== undefined) {
        out.compatibleProviders = show.compatibleProviders;
      }
      return out;
    },
    provider(use: string): CatalogProviderInfo | undefined {
      const entity = service.show(use);
      if (entity === undefined) {
        return undefined;
      }
      const manifest = providersByName.get(use);
      const info: CatalogProviderInfo = {
        name: use,
        available: entity.available,
        availability: entity.availability,
        family: entity.family,
        dependencies: entity.requires,
        diagnostics: providerDiagnostics(use, entity),
      };
      if (manifest?.spec.config_schema !== undefined) {
        info.config_schema = manifest.spec.config_schema;
      }
      return info;
    },
    launcherMountCapability(launcher: string): CatalogLauncherMountCapability | undefined {
      return mountCapabilityOf(providersByName.get(launcher));
    },
  };
}
