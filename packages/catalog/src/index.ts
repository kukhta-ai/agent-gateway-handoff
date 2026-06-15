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
  validateConfig,
  validateSchemaShape,
} from "@gla/kernel";
import {
  type AuthProviderAssuranceCapability,
  BROWSER_HANDOFF_TEMPLATE,
  type BindingStatus,
  CHANNEL_CLI_MANIFEST,
  type DependencyBinding,
  type DependencyConnectionEvidence,
  type DependencyConnectionRef,
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
  type PublicEdgeLogRedactionPosture,
  type PublicEdgeLogRedactionState,
  type PublicEdgeRouteMode,
  type PublicEdgeTransportDescriptor,
  type PublicEdgeTransportEvidence,
  type SkillManifest,
  type TemplateManifest,
  type WpmBundleEvidence,
} from "./manifests.js";
import {
  PROVIDER_PROFILE_FAMILY_TO_RUNTIME_FAMILY,
  type ProviderProfileFamilyId,
  type ProviderProfileManifest,
  type ProviderProfileOverlayManifest,
  type ProviderProfileSelection,
  type TemplatePackageManifest,
} from "./provider-profile.js";

export * from "./manifests.js";
export * from "./provider-profile.js";

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
const ALWAYS_UNAVAILABLE: Probe = () => "unavailable";

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

function requirementNeedsCurrentProbe(
  requirements: readonly DependencyRequirement[] | undefined,
): boolean {
  return (requirements ?? []).some((requirement) => requirement.hostTouching === true);
}

function currentProbeEvidence(
  probes: ProbeRegistry | undefined,
  probeId: string | undefined,
  required: boolean,
): DependencyProbeEvidence {
  if (probeId === undefined && required) {
    return { result: ALWAYS_UNAVAILABLE() };
  }
  const probe = probeId !== undefined ? probes?.[probeId] : undefined;
  return { result: (probe ?? ALWAYS_AVAILABLE)() };
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

function isDependencyConnectionRef(value: unknown): value is DependencyConnectionRef {
  return isRecord(value) && hasText(value.kind) && hasText(value.ref);
}

function publicBasePath(
  publicBaseUrl: DependencyConnectionRef,
  missing: string[],
): string | undefined {
  if (publicBaseUrl.kind !== "uri-ref") {
    missing.push("publicEdge.publicBaseUrl.uri-ref");
    return undefined;
  }
  try {
    const url = new URL(publicBaseUrl.ref);
    return url.pathname.length > 0 ? url.pathname : "/";
  } catch {
    missing.push("publicEdge.publicBaseUrl.uri");
    return undefined;
  }
}

function validPublicEdgeRouteMode(value: unknown): value is PublicEdgeRouteMode {
  return value === "route-programming" || value === "manual-route";
}

function validPublicEdgeLogRedactionState(value: unknown): value is PublicEdgeLogRedactionState {
  return value === "redacted" || value === "not-logged";
}

function validPublicEdgeLogRedaction(
  value: unknown,
  missing: string[],
): value is PublicEdgeLogRedactionPosture {
  if (!isRecord(value)) {
    missing.push("publicEdge.logRedaction");
    return false;
  }
  let valid = true;
  for (const field of ["queryString", "cookie", "authorization", "secWebSocketProtocol"] as const) {
    if (!validPublicEdgeLogRedactionState(value[field])) {
      missing.push(`publicEdge.logRedaction.${field}`);
      valid = false;
    }
  }
  return valid;
}

function validPublicEdgeEvidence(
  value: unknown,
  publicBaseUrl: DependencyConnectionRef | undefined,
  missing: string[],
): value is PublicEdgeTransportEvidence {
  if (!isRecord(value)) {
    missing.push("publicEdge");
    return false;
  }
  let valid = true;
  if (!hasSafeOperatorText(value.basePath) || !value.basePath.startsWith("/")) {
    missing.push("publicEdge.basePath");
    valid = false;
  } else if (publicBaseUrl !== undefined) {
    const path = publicBasePath(publicBaseUrl, missing);
    if (path !== undefined && path !== value.basePath) {
      missing.push("publicEdge.basePath.publicBaseUrl");
      valid = false;
    }
  }
  if (!validPublicEdgeRouteMode(value.routeMode)) {
    missing.push("publicEdge.routeMode");
    valid = false;
  }
  valid = validPublicEdgeLogRedaction(value.logRedaction, missing) && valid;
  return valid;
}

function publicEdgeTransportDescriptor(
  requirement: DependencyRequirement,
  binding: DependencyBinding,
  currentProbe: DependencyProbeEvidence,
  missing: string[],
): PublicEdgeTransportDescriptor | undefined {
  if (requirement.publicEdge !== true) {
    return undefined;
  }
  const publicBaseUrl = binding.connection?.refs.publicBaseUrl;
  const accessGatewayUpstream = binding.connection?.refs.gatewayUpstream;
  if (!isDependencyConnectionRef(publicBaseUrl)) {
    missing.push("publicEdge.publicBaseUrl");
  }
  if (!isDependencyConnectionRef(accessGatewayUpstream)) {
    missing.push("publicEdge.gatewayUpstream");
  } else if (accessGatewayUpstream.kind !== "uri-ref") {
    missing.push("publicEdge.gatewayUpstream.uri-ref");
  }
  if (
    !isDependencyConnectionRef(publicBaseUrl) ||
    !isDependencyConnectionRef(accessGatewayUpstream)
  ) {
    validPublicEdgeEvidence(binding.publicEdge, undefined, missing);
    return undefined;
  }
  if (!validPublicEdgeEvidence(binding.publicEdge, publicBaseUrl, missing)) {
    return undefined;
  }
  return {
    dependency: requirement.dependency,
    publicBaseUrl: operatorSafeClone(publicBaseUrl),
    basePath: binding.publicEdge.basePath,
    accessGatewayUpstream: operatorSafeClone(accessGatewayUpstream),
    routeMode: binding.publicEdge.routeMode,
    logRedaction: operatorSafeClone(binding.publicEdge.logRedaction),
    acceptedReceipt: {
      source: "wpm-receipt",
      bundleId: binding.bundle.id,
      bundleVersion: binding.bundle.version,
      taskId: binding.receipt.taskId,
      ...(binding.receipt.refs !== undefined
        ? { refs: operatorSafeClone(binding.receipt.refs) }
        : {}),
    },
    currentReachability: operatorSafeClone(currentProbe),
  };
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
  let publicEdgeTransport: PublicEdgeTransportDescriptor | undefined;
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
    if (binding.ownershipMode !== "disabled" && requirement.publicEdge === true) {
      publicEdgeTransport = publicEdgeTransportDescriptor(
        requirement,
        binding,
        currentProbe,
        missingEvidence,
      );
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
  if (publicEdgeTransport !== undefined && status !== "unbound") {
    out.publicEdgeTransport = publicEdgeTransport;
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
  /** AuthProvider-only provider-neutral assurance capability declared by the provider manifest. */
  authAssurance?: AuthProviderAssuranceCapability;
}

/** Stable catalog/provider diagnostic surfaced by template, catalog, and admission reads. */
export interface CatalogDiagnostic {
  code:
    | "provider.available"
    | "provider.unknown"
    | "provider.unavailable"
    | "provider.degraded"
    | "template.dependency_unavailable"
    | "graph.unknown_family"
    | "graph.unknown_provider"
    | "graph.family_mismatch"
    | "graph.duplicate_provider_version"
    | "graph.overlay_extends_unknown"
    | "graph.overlay_cycle"
    | "graph.unresolved_relation"
    | "graph.dependency_unavailable"
    | "graph.compatibility_ambiguous"
    | "graph.config_invalid";
  message: string;
  provider?: string;
  part?: string;
  family?: string;
  dependency?: string;
  dependencyScope?: "provider" | "template";
  dependencyStatus?: BindingStatus;
  install?: ProbeResult;
  runtime?: ProbeResult;
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
        dependencyScope: "template",
        dependencyStatus: dep.status,
        install: dep.diagnostics.install,
        runtime: dep.diagnostics.runtime,
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
    const currentProbe = currentProbeEvidence(
      probes,
      m.spec.probe,
      requirementNeedsCurrentProbe(m.spec.requires),
    );
    const requires = (m.spec.requires ?? []).map((requirement) =>
      evaluateRequirement(requirement, bindingFor(bindings, requirement.dependency), currentProbe),
    );
    const availability = deriveAvailability(requires, currentProbe);
    const authAssurance = authAssuranceCapabilityOf(m);
    entities.set(m.metadata.name, {
      name: m.metadata.name,
      kind: m.kind,
      family: m.spec.family,
      summary: m.spec.capability.summary,
      availability,
      available: availability === "available",
      requires,
      ...(authAssurance !== undefined ? { authAssurance } : {}),
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
    const currentProbe = currentProbeEvidence(
      probes,
      t.spec.probe,
      requirementNeedsCurrentProbe(t.spec.requires),
    );
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
  /** Optional resolved provider graph used to align catalog diagnostics with admission/doctor/boot. */
  providerGraph?: ProviderGraphProjection | ProviderGraphProjectionResult;
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
      publicEdge: {
        basePath: "/",
        routeMode: "manual-route",
        logRedaction: {
          queryString: "redacted",
          cookie: "redacted",
          authorization: "redacted",
          secWebSocketProtocol: "redacted",
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
  private readonly providerGraph?: ProviderGraphProjection | ProviderGraphProjectionResult;

  constructor(opts: CatalogServiceOptions = {}) {
    this.store = opts.content ?? defaultStoreContent();
    this.index = ingest(this.store, opts.probes ?? {}, opts.dependencyBindings);
    if (opts.providerGraph !== undefined) {
      this.providerGraph = opts.providerGraph;
    }
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
    rows = rows.map((entity) => entityWithProviderGraph(entity, this.providerGraph));
    if (filter?.available === true) {
      rows = rows.filter((e) => e.available);
    }
    // Stable order by name so output is deterministic.
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Look up one entity by name (docs/05 `catalog`/`template`/`skill show` lookups). Read-only. */
  show(name: string): IndexedEntity | undefined {
    const entity = this.index.entities.get(name);
    return entity !== undefined ? entityWithProviderGraph(entity, this.providerGraph) : undefined;
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
    const entity = this.index.entities.get(id);
    const graphTemplate = templateFromProviderGraph(this.providerGraph, id);
    const parts: PartBinding[] =
      partBindingsFromProviderGraphTemplate(this.providerGraph, id) ??
      Object.entries(t.spec.requiredParts).map(([part, provider]) => {
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
    const graphDiagnostics = catalogDiagnosticsFromProviderGraph(this.providerGraph, {
      template: id,
    }).filter((diagnostic) => diagnostic.code !== "graph.dependency_unavailable");
    const dependencies = graphTemplate?.dependencies ?? entity?.requires ?? [];
    const diagnostics = [...templateDiagnostics(dependencies, parts), ...graphDiagnostics];
    const graphDefects =
      graphDiagnostics.length > 0 ||
      hasBlockingGraphDiagnostics(diagnostics) ||
      providerGraphHasGlobalDefects(this.providerGraph);
    const availability = graphDefects
      ? "unavailable"
      : (graphTemplate?.availability ?? entity?.availability ?? "unavailable");
    const compatibleProviders =
      graphTemplate?.compatibleProviders ?? deriveCompatibleProviders(t, this.store.providers);
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
  /** AuthProvider-only provider-neutral assurance capability declared by the provider manifest. */
  authAssurance?: AuthProviderAssuranceCapability;
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

function authAssuranceCapabilityOf(
  m: ProviderManifest | undefined,
): AuthProviderAssuranceCapability | undefined {
  if (m === undefined || m.spec.family !== "auth") {
    return undefined;
  }
  const capability = m.spec.capability as { authAssurance?: AuthProviderAssuranceCapability };
  return capability.authAssurance !== undefined
    ? structuredClone(capability.authAssurance)
    : undefined;
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
      if (entity.authAssurance !== undefined) {
        info.authAssurance = structuredClone(entity.authAssurance);
      }
      return info;
    },
    launcherMountCapability(launcher: string): CatalogLauncherMountCapability | undefined {
      return mountCapabilityOf(providersByName.get(launcher));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic provider graph projection
// ─────────────────────────────────────────────────────────────────────────────

/** Stable diagnostic codes produced by deterministic provider graph projection. */
export type ProviderGraphDiagnosticCode =
  | "graph.unknown_family"
  | "graph.unknown_provider"
  | "graph.family_mismatch"
  | "graph.duplicate_provider_version"
  | "graph.overlay_extends_unknown"
  | "graph.overlay_cycle"
  | "graph.unresolved_relation"
  | "graph.dependency_unavailable"
  | "graph.compatibility_ambiguous"
  | "graph.config_invalid";

/** Redacted deterministic graph diagnostic safe for install/update, catalog, and admission surfaces. */
export interface ProviderGraphDiagnostic {
  code: ProviderGraphDiagnosticCode;
  message: string;
  path?: string;
  profile?: string;
  providerId?: string;
  family?: string;
  template?: string;
  dependency?: string;
  dependencyScope?: "provider" | "template";
  dependencyStatus?: BindingStatus;
  install?: ProbeResult;
  runtime?: ProbeResult;
  detail?: Record<string, unknown>;
}

/** Provider-set manifest inputs consumed by deterministic graph projection. */
export interface ProviderGraphProviderSetInput {
  /** Stable provider-set identity for diagnostics. */
  id?: string;
  /** Trusted provider manifests registered by the selected provider set. */
  providers?: readonly ProviderManifest[];
  /** Trusted template manifests shipped by the selected provider set. */
  templates?: readonly TemplateManifest[];
  /** Provider-set-level default config, lower precedence than profile config. */
  defaultConfig?: Record<string, Record<string, unknown>>;
}

/** One config layer that participated in provider config precedence. */
export interface ProviderGraphConfigLayer {
  source:
    | "provider-schema-defaults"
    | "provider-set-default-config"
    | "base-profile-config"
    | "overlay-config"
    | "template-defaults"
    | "runtime-assembly-params";
  providerId: string;
  values: Record<string, unknown>;
  profile?: string;
  templatePackage?: string;
}

/** Resolved selected provider facts after profile/overlay/default/config precedence. */
export interface ProviderGraphResolvedProvider {
  family: ProviderProfileFamilyId;
  runtimeFamily: RuntimeProfileFamilyName;
  providerId: string;
  manifest: ProviderManifest;
  available: boolean;
  availability: Availability;
  dependencies: IndexedDependencyBinding[];
  /** AuthProvider-only provider-neutral assurance capability declared by the provider manifest. */
  authAssurance?: AuthProviderAssuranceCapability;
  config: Record<string, unknown>;
  configLayers: ProviderGraphConfigLayer[];
}

/** Registered provider facts in the graph projection, including non-selected compatible providers. */
export interface ProviderGraphProviderFact {
  providerId: string;
  runtimeFamily: Exclude<ProviderFamily, "template">;
  manifest: ProviderManifest;
  available: boolean;
  availability: Availability;
  dependencies: IndexedDependencyBinding[];
  /** AuthProvider-only provider-neutral assurance capability declared by the provider manifest. */
  authAssurance?: AuthProviderAssuranceCapability;
}

/** Resolved template facts in the graph projection. */
export interface ProviderGraphResolvedTemplate {
  templateId: string;
  manifest: TemplateManifest;
  available: boolean;
  availability: Availability;
  dependencies: IndexedDependencyBinding[];
  requiredParts: Record<string, string>;
  compatibleProviders?: Record<string, string[]>;
}

/** Resolved deterministic graph projection used by catalog, doctor, provider-host boot, and admission. */
export interface ProviderGraphProjection {
  providerSetId?: string;
  profileId: string;
  selectedProviders: Partial<Record<ProviderProfileFamilyId, string>>;
  providerFacts: ProviderGraphProviderFact[];
  providers: ProviderGraphResolvedProvider[];
  templates: ProviderGraphResolvedTemplate[];
}

/** Inputs for deterministic provider graph projection. */
export interface ResolveProviderGraphProjectionInput {
  providerSet?: ProviderGraphProviderSetInput;
  providerManifests?: readonly ProviderManifest[];
  templatePackages?: readonly TemplatePackageManifest[];
  templates?: readonly TemplateManifest[];
  baseProfile: ProviderProfileManifest;
  overlays?: readonly ProviderProfileOverlayManifest[];
  dependencyBindings?: DependencyBindingSource;
  probes?: ProbeRegistry;
  /** Part roles whose family contract requires explicit compatibility evidence. */
  compatibilityRequiredParts?: readonly string[];
  /** Runtime part params keyed by selected provider id; highest config precedence layer. */
  runtimeAssemblyParams?: Record<string, Record<string, unknown>>;
  /**
   * Config schema used when validating merged selected-provider config.
   * `runtime` validates the agent/template-facing config_schema; `factory` validates Provider Host
   * construction config when a provider declares a separate factory_config_schema.
   */
  configValidationMode?: "runtime" | "factory";
  /** When set, merged config is validated only for these selected provider ids. */
  configValidationProviderIds?: readonly string[];
}

/** Provider graph projection result; false means downstream boot/admission must reject it. */
export type ProviderGraphProjectionResult =
  | { ok: true; projection: ProviderGraphProjection; diagnostics: [] }
  | {
      ok: false;
      projection: ProviderGraphProjection;
      diagnostics: ProviderGraphDiagnostic[];
    };

type RuntimeProfileFamilyName =
  (typeof PROVIDER_PROFILE_FAMILY_TO_RUNTIME_FAMILY)[ProviderProfileFamilyId];

interface ProfileGraphDoc {
  name: string;
  kind: "ProviderProfile" | "ProviderProfileOverlay";
  spec: ProviderProfileManifest["spec"] | ProviderProfileOverlayManifest["spec"];
}

const PROFILE_FAMILY_SET = new Set<string>(Object.keys(PROVIDER_PROFILE_FAMILY_TO_RUNTIME_FAMILY));
const RELATION_KEY_TO_FAMILY: Record<string, ProviderFamily> = {
  auth: "auth",
  auths: "auth",
  launchers: "launcher",
  launcher: "launcher",
  entrypoints: "entrypoint",
  entrypoint: "entrypoint",
  connectors: "connector",
  connector: "connector",
  workspaces: "workspace",
  workspace: "workspace",
  detectors: "detector",
  detector: "detector",
  channels: "channel",
  channel: "channel",
  secretStores: "secret-store",
  "secret-stores": "secret-store",
  "secret-store": "secret-store",
};

function graphAddDiagnostic(
  diagnostics: ProviderGraphDiagnostic[],
  diagnostic: ProviderGraphDiagnostic,
): void {
  diagnostics.push(redactOperatorEgress(diagnostic) as ProviderGraphDiagnostic);
}

function graphSelectionProviderId(
  selection: ProviderProfileSelection | undefined,
): string | undefined {
  if (typeof selection === "string") {
    return selection.length > 0 ? selection : undefined;
  }
  if (isRecord(selection) && typeof selection.providerId === "string") {
    return selection.providerId.length > 0 ? selection.providerId : undefined;
  }
  return undefined;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

function mergeRecords(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out = cloneRecord(base);
  for (const [key, value] of Object.entries(overlay)) {
    const current = out[key];
    out[key] =
      isRecord(current) && isRecord(value) && !("secretRef" in current) && !("secretRef" in value)
        ? mergeRecords(current, value)
        : structuredClone(value);
  }
  return out;
}

function schemaDefaults(schema: ConfigSchema | undefined): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema ?? {})) {
    if (field.default !== undefined) {
      defaults[name] = structuredClone(field.default);
    }
  }
  return defaults;
}

function addConfigLayer(
  layers: ProviderGraphConfigLayer[],
  layer: Omit<ProviderGraphConfigLayer, "values"> & {
    values?: Record<string, unknown> | undefined;
  },
): void {
  if (layer.values === undefined || Object.keys(layer.values).length === 0) {
    return;
  }
  layers.push({ ...layer, values: cloneRecord(layer.values) });
}

function combineProviderManifests(
  input: ResolveProviderGraphProjectionInput,
  diagnostics: ProviderGraphDiagnostic[],
): Map<string, ProviderManifest> {
  const providers = [...(input.providerSet?.providers ?? []), ...(input.providerManifests ?? [])];
  const byName = new Map<string, ProviderManifest>();
  for (const provider of providers) {
    const id = provider.metadata.name;
    const prior = byName.get(id);
    if (prior !== undefined) {
      if (prior.metadata.version !== provider.metadata.version) {
        graphAddDiagnostic(diagnostics, {
          code: "graph.duplicate_provider_version",
          message: `provider "${id}" appears with multiple versions`,
          providerId: id,
          detail: {
            versions: [prior.metadata.version, provider.metadata.version],
          },
        });
      }
      continue;
    }
    byName.set(id, provider);
  }
  return byName;
}

function templatePackageTemplates(
  packages: readonly TemplatePackageManifest[] | undefined,
): TemplateManifest[] {
  return (packages ?? []).flatMap((pkg) => pkg.spec.templates);
}

function combineTemplates(
  input: ResolveProviderGraphProjectionInput,
): Map<string, TemplateManifest> {
  const templates = [
    ...(input.providerSet?.templates ?? []),
    ...(input.templates ?? []),
    ...templatePackageTemplates(input.templatePackages),
  ];
  return new Map(templates.map((template) => [template.metadata.name, template]));
}

function graphDocs(input: ResolveProviderGraphProjectionInput): ProfileGraphDoc[] {
  return [
    {
      name: input.baseProfile.metadata.name,
      kind: "ProviderProfile",
      spec: input.baseProfile.spec,
    },
    ...(input.overlays ?? []).map(
      (overlay): ProfileGraphDoc => ({
        name: overlay.metadata.name,
        kind: "ProviderProfileOverlay",
        spec: overlay.spec,
      }),
    ),
  ];
}

function validateGraphInheritance(
  input: ResolveProviderGraphProjectionInput,
  diagnostics: ProviderGraphDiagnostic[],
): void {
  const docs = graphDocs(input);
  const byName = new Map(docs.map((doc) => [doc.name, doc]));
  for (const doc of docs) {
    if (doc.spec.extends !== undefined && !byName.has(doc.spec.extends)) {
      graphAddDiagnostic(diagnostics, {
        code: "graph.overlay_extends_unknown",
        message: `${doc.kind} "${doc.name}" extends unknown profile or overlay "${doc.spec.extends}"`,
        path: "spec.extends",
        profile: doc.name,
        detail: { extends: doc.spec.extends },
      });
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (doc: ProfileGraphDoc, path: string[]): void => {
    if (visited.has(doc.name)) {
      return;
    }
    if (visiting.has(doc.name)) {
      const cycleStart = path.indexOf(doc.name);
      const cycle = [...path.slice(cycleStart >= 0 ? cycleStart : 0), doc.name];
      graphAddDiagnostic(diagnostics, {
        code: "graph.overlay_cycle",
        message: `provider profile inheritance cycle detected: ${cycle.join(" -> ")}`,
        path: "spec.extends",
        profile: doc.name,
        detail: { cycle },
      });
      return;
    }
    visiting.add(doc.name);
    const parent = doc.spec.extends !== undefined ? byName.get(doc.spec.extends) : undefined;
    if (parent !== undefined) {
      visit(parent, [...path, doc.name]);
    }
    visiting.delete(doc.name);
    visited.add(doc.name);
  };

  for (const doc of docs) {
    visit(doc, []);
  }
}

function materializeSelections(
  input: ResolveProviderGraphProjectionInput,
): Partial<Record<ProviderProfileFamilyId, ProviderProfileSelection>> {
  const selected: Partial<Record<ProviderProfileFamilyId, ProviderProfileSelection>> = {
    ...(input.baseProfile.spec.select ?? {}),
  };
  for (const overlay of input.overlays ?? []) {
    Object.assign(selected, overlay.spec.select ?? {});
  }
  return selected;
}

function profileConfigLayers(
  input: ResolveProviderGraphProjectionInput,
  providerId: string,
): ProviderGraphConfigLayer[] {
  const layers: ProviderGraphConfigLayer[] = [];
  addConfigLayer(layers, {
    source: "base-profile-config",
    providerId,
    profile: input.baseProfile.metadata.name,
    values: input.baseProfile.spec.config?.[providerId],
  });
  for (const overlay of input.overlays ?? []) {
    addConfigLayer(layers, {
      source: "overlay-config",
      providerId,
      profile: overlay.metadata.name,
      values: overlay.spec.config?.[providerId],
    });
  }
  return layers;
}

function templateDefaultConfigLayers(
  input: ResolveProviderGraphProjectionInput,
  providerId: string,
): ProviderGraphConfigLayer[] {
  const layers: ProviderGraphConfigLayer[] = [];
  for (const pkg of input.templatePackages ?? []) {
    for (const key of [providerId, `provider.${providerId}`]) {
      const values = pkg.spec.defaults[key];
      if (isRecord(values)) {
        addConfigLayer(layers, {
          source: "template-defaults",
          providerId,
          templatePackage: pkg.metadata.name,
          values,
        });
      }
    }
  }
  return layers;
}

function resolveProviderConfig(
  input: ResolveProviderGraphProjectionInput,
  providerId: string,
  manifest: ProviderManifest,
  diagnostics: ProviderGraphDiagnostic[],
): { config: Record<string, unknown>; layers: ProviderGraphConfigLayer[] } {
  const layers: ProviderGraphConfigLayer[] = [];
  addConfigLayer(layers, {
    source: "provider-schema-defaults",
    providerId,
    values: schemaDefaults(manifest.spec.config_schema),
  });
  addConfigLayer(layers, {
    source: "provider-set-default-config",
    providerId,
    values: input.providerSet?.defaultConfig?.[providerId],
  });
  layers.push(...profileConfigLayers(input, providerId));
  layers.push(...templateDefaultConfigLayers(input, providerId));
  addConfigLayer(layers, {
    source: "runtime-assembly-params",
    providerId,
    values: input.runtimeAssemblyParams?.[providerId],
  });

  const config = layers.reduce<Record<string, unknown>>(
    (current, layer) => mergeRecords(current, layer.values),
    {},
  );
  if (
    input.configValidationProviderIds !== undefined &&
    !input.configValidationProviderIds.includes(providerId)
  ) {
    return { config, layers };
  }
  const schema =
    input.configValidationMode === "factory"
      ? (manifest.spec.factory_config_schema ?? manifest.spec.config_schema ?? {})
      : (manifest.spec.config_schema ?? {});
  const validation = validateConfig(schema, config);
  if (!validation.ok) {
    graphAddDiagnostic(diagnostics, {
      code: "graph.config_invalid",
      message: `merged config for provider "${providerId}" does not match its config_schema`,
      providerId,
      family: manifest.spec.family,
      detail: { defects: validation.defects },
    });
  }
  return { config, layers };
}

function currentProbeFor(
  probes: ProbeRegistry | undefined,
  probeId: string | undefined,
  required: boolean,
): DependencyProbeEvidence {
  return currentProbeEvidence(probes, probeId, required);
}

function providerAvailability(
  provider: ProviderManifest,
  input: ResolveProviderGraphProjectionInput,
): { availability: Availability; dependencies: IndexedDependencyBinding[] } {
  const currentProbe = currentProbeFor(
    input.probes,
    provider.spec.probe,
    requirementNeedsCurrentProbe(provider.spec.requires),
  );
  const dependencies = (provider.spec.requires ?? []).map((requirement) =>
    evaluateRequirement(
      requirement,
      bindingFor(input.dependencyBindings, requirement.dependency),
      currentProbe,
    ),
  );
  return {
    availability: deriveAvailability(dependencies, currentProbe),
    dependencies,
  };
}

function templateAvailability(
  template: TemplateManifest,
  providersByName: ReadonlyMap<string, ProviderManifest>,
  providerAvailabilityById: ReadonlyMap<string, Availability>,
  input: ResolveProviderGraphProjectionInput,
): { availability: Availability; dependencies: IndexedDependencyBinding[] } {
  const currentProbe = currentProbeFor(
    input.probes,
    template.spec.probe,
    requirementNeedsCurrentProbe(template.spec.requires),
  );
  const dependencies = (template.spec.requires ?? []).map((requirement) =>
    evaluateRequirement(
      requirement,
      bindingFor(input.dependencyBindings, requirement.dependency),
      currentProbe,
    ),
  );
  const selfAvailability = deriveAvailability(dependencies, currentProbe);
  const partAvailabilities = Object.values(template.spec.requiredParts).map((providerId) =>
    providersByName.has(providerId) ? providerAvailabilityById.get(providerId) : undefined,
  );
  const unavailablePart = partAvailabilities.some(
    (availability) => availability === undefined || availability === "unavailable",
  );
  const degradedPart = partAvailabilities.some((availability) => availability === "degraded");
  return {
    availability:
      selfAvailability === "unavailable" || unavailablePart
        ? "unavailable"
        : selfAvailability === "degraded" || degradedPart
          ? "degraded"
          : "available",
    dependencies,
  };
}

function validateSelectedProviders(
  selected: Partial<Record<ProviderProfileFamilyId, ProviderProfileSelection>>,
  providersByName: ReadonlyMap<string, ProviderManifest>,
  diagnostics: ProviderGraphDiagnostic[],
): Partial<Record<ProviderProfileFamilyId, string>> {
  const out: Partial<Record<ProviderProfileFamilyId, string>> = {};
  for (const [family, selection] of Object.entries(selected)) {
    if (!PROFILE_FAMILY_SET.has(family)) {
      graphAddDiagnostic(diagnostics, {
        code: "graph.unknown_family",
        message: `unknown provider profile family "${family}"`,
        path: `spec.select.${family}`,
        family,
      });
      continue;
    }
    const providerId = graphSelectionProviderId(selection as ProviderProfileSelection);
    if (providerId === undefined) {
      continue;
    }
    const typedFamily = family as ProviderProfileFamilyId;
    const provider = providersByName.get(providerId);
    if (provider === undefined) {
      graphAddDiagnostic(diagnostics, {
        code: "graph.unknown_provider",
        message: `provider "${providerId}" is not registered in the selected provider set`,
        path: `spec.select.${family}`,
        family,
        providerId,
      });
      continue;
    }
    const expectedFamily = PROVIDER_PROFILE_FAMILY_TO_RUNTIME_FAMILY[typedFamily];
    if (provider.spec.family !== expectedFamily) {
      graphAddDiagnostic(diagnostics, {
        code: "graph.family_mismatch",
        message: `provider "${providerId}" is ${provider.spec.family}, not ${expectedFamily}`,
        path: `spec.select.${family}`,
        family,
        providerId,
        detail: { actualFamily: provider.spec.family, expectedFamily },
      });
      continue;
    }
    out[typedFamily] = providerId;
  }
  return out;
}

function validateProviderRelations(
  providersByName: ReadonlyMap<string, ProviderManifest>,
  templatesByName: ReadonlyMap<string, TemplateManifest>,
  diagnostics: ProviderGraphDiagnostic[],
): void {
  for (const provider of providersByName.values()) {
    const compatibleWith = provider.spec.relations?.compatibleWith ?? {};
    for (const [relationKey, ids] of Object.entries(compatibleWith)) {
      if (!Array.isArray(ids)) {
        graphAddDiagnostic(diagnostics, {
          code: "graph.unresolved_relation",
          message: `provider "${provider.metadata.name}" relation "${relationKey}" must be a provider/template id list`,
          providerId: provider.metadata.name,
          family: provider.spec.family,
          detail: { relationKey },
        });
        continue;
      }
      if (relationKey === "templates") {
        for (const id of ids) {
          if (!templatesByName.has(id)) {
            graphAddDiagnostic(diagnostics, {
              code: "graph.unresolved_relation",
              message: `provider "${provider.metadata.name}" references unknown template "${id}"`,
              providerId: provider.metadata.name,
              template: id,
              detail: { relationKey },
            });
          }
        }
        continue;
      }
      const expectedFamily = RELATION_KEY_TO_FAMILY[relationKey];
      if (expectedFamily === undefined) {
        continue;
      }
      for (const id of ids) {
        const related = providersByName.get(id);
        if (related === undefined) {
          graphAddDiagnostic(diagnostics, {
            code: "graph.unresolved_relation",
            message: `provider "${provider.metadata.name}" relation "${relationKey}" references unknown provider "${id}"`,
            providerId: id,
            family: expectedFamily,
            detail: { sourceProvider: provider.metadata.name, relationKey },
          });
          continue;
        }
        if (related.spec.family !== expectedFamily) {
          graphAddDiagnostic(diagnostics, {
            code: "graph.family_mismatch",
            message: `provider "${id}" is ${related.spec.family}, not ${expectedFamily}`,
            providerId: id,
            family: expectedFamily,
            detail: {
              sourceProvider: provider.metadata.name,
              relationKey,
              actualFamily: related.spec.family,
            },
          });
        }
      }
    }
  }
}

function templateHasCompatibilityEvidence(
  template: TemplateManifest,
  part: string,
  providersByName: ReadonlyMap<string, ProviderManifest>,
): boolean {
  const explicit = template.spec.compatibleProviders?.[part];
  if (explicit !== undefined && explicit.length > 0) {
    return true;
  }
  const relationKey = `${part}s`;
  const requiredProviderIds = Object.values(template.spec.requiredParts);
  const requiredProviderRelations = requiredProviderIds.some(
    (providerId) =>
      (providersByName.get(providerId)?.spec.relations?.compatibleWith?.[relationKey] ?? [])
        .length > 0,
  );
  if (requiredProviderRelations) {
    return true;
  }
  const defaultProviderId = template.spec.requiredParts[part];
  return (
    defaultProviderId !== undefined &&
    providersByName
      .get(defaultProviderId)
      ?.spec.relations?.compatibleWith?.templates?.includes(template.metadata.name) === true
  );
}

function validateTemplateRelations(
  templatesByName: ReadonlyMap<string, TemplateManifest>,
  providersByName: ReadonlyMap<string, ProviderManifest>,
  input: ResolveProviderGraphProjectionInput,
  diagnostics: ProviderGraphDiagnostic[],
): void {
  for (const template of templatesByName.values()) {
    const compatibilityRequiredParts = compatibilityRequiredPartsForTemplate(input, template);
    for (const [part, providerId] of Object.entries(template.spec.requiredParts)) {
      const expectedFamily = providerFamilyForPart(part);
      const provider = providersByName.get(providerId);
      if (provider === undefined) {
        graphAddDiagnostic(diagnostics, {
          code: "graph.unknown_provider",
          message: `template "${template.metadata.name}" required part "${part}" references unknown provider "${providerId}"`,
          providerId,
          template: template.metadata.name,
          path: `spec.requiredParts.${part}`,
        });
        continue;
      }
      if (expectedFamily !== undefined && provider.spec.family !== expectedFamily) {
        graphAddDiagnostic(diagnostics, {
          code: "graph.family_mismatch",
          message: `template "${template.metadata.name}" part "${part}" uses ${provider.spec.family}, not ${expectedFamily}`,
          providerId,
          family: expectedFamily,
          template: template.metadata.name,
          path: `spec.requiredParts.${part}`,
          detail: { actualFamily: provider.spec.family },
        });
      }
    }

    for (const [part, ids] of Object.entries(template.spec.compatibleProviders ?? {})) {
      const expectedFamily = providerFamilyForPart(part);
      for (const id of ids) {
        const provider = providersByName.get(id);
        if (provider === undefined) {
          graphAddDiagnostic(diagnostics, {
            code: "graph.unresolved_relation",
            message: `template "${template.metadata.name}" compatible part "${part}" references unknown provider "${id}"`,
            providerId: id,
            template: template.metadata.name,
            path: `spec.compatibleProviders.${part}`,
          });
          continue;
        }
        if (expectedFamily !== undefined && provider.spec.family !== expectedFamily) {
          graphAddDiagnostic(diagnostics, {
            code: "graph.family_mismatch",
            message: `provider "${id}" is ${provider.spec.family}, not ${expectedFamily}`,
            providerId: id,
            family: expectedFamily,
            template: template.metadata.name,
            path: `spec.compatibleProviders.${part}`,
            detail: { actualFamily: provider.spec.family },
          });
        }
      }
    }

    for (const part of template.spec.openParts ?? []) {
      if (
        compatibilityRequiredParts.has(part) &&
        !templateHasCompatibilityEvidence(template, part, providersByName)
      ) {
        graphAddDiagnostic(diagnostics, {
          code: "graph.compatibility_ambiguous",
          message: `template "${template.metadata.name}" open part "${part}" has no explicit compatibility relation`,
          template: template.metadata.name,
          path: `spec.openParts.${part}`,
          detail: { part },
        });
      }
    }
  }
}

function compatibilityRequiredPartsForTemplate(
  input: ResolveProviderGraphProjectionInput,
  template: TemplateManifest,
): Set<string> {
  const required = new Set(input.compatibilityRequiredParts ?? []);
  for (const pkg of input.templatePackages ?? []) {
    const ownsTemplate = pkg.spec.templates.some(
      (entry) => entry.metadata.name === template.metadata.name,
    );
    if (!ownsTemplate || !isRecord(pkg.spec.compatibility)) {
      continue;
    }
    const packageRequired = pkg.spec.compatibility.requiredParts;
    if (Array.isArray(packageRequired)) {
      for (const part of packageRequired) {
        if (typeof part === "string" && part.length > 0) {
          required.add(part);
        }
      }
    }
  }
  return required;
}

function addDependencyDiagnostics(
  diagnostics: ProviderGraphDiagnostic[],
  owner: { providerId?: string; template?: string },
  dependencies: readonly IndexedDependencyBinding[],
): void {
  for (const dependency of dependencies) {
    if (
      dependency.status === "bound" &&
      dependency.diagnostics.install === "available" &&
      dependency.diagnostics.runtime === "available"
    ) {
      continue;
    }
    graphAddDiagnostic(diagnostics, {
      code: "graph.dependency_unavailable",
      message: `dependency "${dependency.dependency}" is not available`,
      dependency: dependency.dependency,
      dependencyScope: owner.template !== undefined ? "template" : "provider",
      dependencyStatus: dependency.status,
      install: dependency.diagnostics.install,
      runtime: dependency.diagnostics.runtime,
      ...(owner.providerId !== undefined ? { providerId: owner.providerId } : {}),
      ...(owner.template !== undefined ? { template: owner.template } : {}),
      detail: { dependency },
    });
  }
}

/**
 * Build the deterministic provider graph projection for one selected provider set/profile.
 *
 * The projection owns profile/overlay selection, template defaults, dependency availability,
 * compatibility checks, and config/default precedence. It treats WPM {@link DependencyBinding}
 * records as dependency evidence only; they are surfaced on `dependencies` and never merged into
 * provider config.
 */
export function resolveProviderGraphProjection(
  input: ResolveProviderGraphProjectionInput,
): ProviderGraphProjectionResult {
  const diagnostics: ProviderGraphDiagnostic[] = [];
  const providersByName = combineProviderManifests(input, diagnostics);
  const templatesByName = combineTemplates(input);

  validateGraphInheritance(input, diagnostics);
  validateProviderRelations(providersByName, templatesByName, diagnostics);
  validateTemplateRelations(templatesByName, providersByName, input, diagnostics);

  const selected = validateSelectedProviders(
    materializeSelections(input),
    providersByName,
    diagnostics,
  );

  const availabilityById = new Map<string, Availability>();
  const dependenciesById = new Map<string, IndexedDependencyBinding[]>();
  for (const provider of providersByName.values()) {
    const availability = providerAvailability(provider, input);
    availabilityById.set(provider.metadata.name, availability.availability);
    dependenciesById.set(provider.metadata.name, availability.dependencies);
  }

  const providerFacts: ProviderGraphProviderFact[] = [];
  for (const provider of providersByName.values()) {
    if (provider.spec.family === "template") {
      continue;
    }
    const dependencies = dependenciesById.get(provider.metadata.name) ?? [];
    const availability = availabilityById.get(provider.metadata.name) ?? "unavailable";
    const authAssurance = authAssuranceCapabilityOf(provider);
    providerFacts.push({
      providerId: provider.metadata.name,
      runtimeFamily: provider.spec.family,
      manifest: structuredClone(provider),
      available: availability === "available",
      availability,
      dependencies: structuredClone(dependencies),
      ...(authAssurance !== undefined ? { authAssurance } : {}),
    });
  }

  const selectedProviders: ProviderGraphResolvedProvider[] = [];
  for (const [family, providerId] of Object.entries(selected) as Array<
    [ProviderProfileFamilyId, string]
  >) {
    const manifest = providersByName.get(providerId);
    if (manifest === undefined) {
      continue;
    }
    const dependencies = dependenciesById.get(providerId) ?? [];
    const availability = availabilityById.get(providerId) ?? "unavailable";
    addDependencyDiagnostics(diagnostics, { providerId }, dependencies);
    const config = resolveProviderConfig(input, providerId, manifest, diagnostics);
    const authAssurance = authAssuranceCapabilityOf(manifest);
    selectedProviders.push({
      family,
      runtimeFamily: PROVIDER_PROFILE_FAMILY_TO_RUNTIME_FAMILY[family],
      providerId,
      manifest: structuredClone(manifest),
      available: availability === "available",
      availability,
      dependencies: structuredClone(dependencies),
      ...(authAssurance !== undefined ? { authAssurance } : {}),
      config: config.config,
      configLayers: config.layers,
    });
  }

  const templates: ProviderGraphResolvedTemplate[] = [];
  for (const template of templatesByName.values()) {
    const availability = templateAvailability(template, providersByName, availabilityById, input);
    addDependencyDiagnostics(
      diagnostics,
      { template: template.metadata.name },
      availability.dependencies,
    );
    for (const providerId of uniqueStrings(Object.values(template.spec.requiredParts))) {
      addDependencyDiagnostics(
        diagnostics,
        { template: template.metadata.name, providerId },
        dependenciesById.get(providerId) ?? [],
      );
    }
    const compatibleProviders = deriveCompatibleProviders(template, providersByName.values());
    templates.push({
      templateId: template.metadata.name,
      manifest: structuredClone(template),
      available: availability.availability === "available",
      availability: availability.availability,
      dependencies: structuredClone(availability.dependencies),
      requiredParts: structuredClone(template.spec.requiredParts),
      ...(compatibleProviders !== undefined
        ? { compatibleProviders: structuredClone(compatibleProviders) }
        : {}),
    });
  }

  const projection: ProviderGraphProjection = {
    ...(input.providerSet?.id !== undefined ? { providerSetId: input.providerSet.id } : {}),
    profileId: input.baseProfile.metadata.name,
    selectedProviders: selected,
    providerFacts: providerFacts.sort((a, b) => a.providerId.localeCompare(b.providerId)),
    providers: selectedProviders.sort((a, b) => a.providerId.localeCompare(b.providerId)),
    templates: templates.sort((a, b) => a.templateId.localeCompare(b.templateId)),
  };

  return diagnostics.length === 0
    ? { ok: true, projection, diagnostics: [] }
    : { ok: false, projection, diagnostics };
}

function graphProjectionParts(input: ProviderGraphProjection | ProviderGraphProjectionResult): {
  projection: ProviderGraphProjection;
  diagnostics: ProviderGraphDiagnostic[];
} {
  if ("ok" in input) {
    return {
      projection: input.projection,
      diagnostics: input.diagnostics,
    };
  }
  return { projection: input, diagnostics: [] };
}

function providerGraphGlobalDiagnostics(
  input: ProviderGraphProjection | ProviderGraphProjectionResult | undefined,
): ProviderGraphDiagnostic[] {
  if (input === undefined) {
    return [];
  }
  return graphProjectionParts(input).diagnostics.filter(
    (diagnostic) => diagnostic.providerId === undefined && diagnostic.template === undefined,
  );
}

function providerGraphHasGlobalDefects(
  input: ProviderGraphProjection | ProviderGraphProjectionResult | undefined,
): boolean {
  return providerGraphGlobalDiagnostics(input).length > 0;
}

function graphDiagnosticsAsCatalog(
  diagnostics: readonly ProviderGraphDiagnostic[],
  filter: { providerId?: string; template?: string; part?: string } = {},
): CatalogDiagnostic[] {
  return diagnostics
    .filter((diagnostic) => {
      if (filter.providerId !== undefined && diagnostic.providerId !== filter.providerId) {
        return false;
      }
      if (filter.template !== undefined && diagnostic.template !== filter.template) {
        return false;
      }
      return true;
    })
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.providerId !== undefined ? { provider: diagnostic.providerId } : {}),
      ...(filter.part !== undefined ? { part: filter.part } : {}),
      ...(diagnostic.family !== undefined ? { family: diagnostic.family } : {}),
      ...(diagnostic.dependency !== undefined ? { dependency: diagnostic.dependency } : {}),
      ...(diagnostic.dependencyScope !== undefined
        ? { dependencyScope: diagnostic.dependencyScope }
        : {}),
      ...(diagnostic.dependencyStatus !== undefined
        ? { dependencyStatus: diagnostic.dependencyStatus }
        : {}),
      ...(diagnostic.install !== undefined ? { install: diagnostic.install } : {}),
      ...(diagnostic.runtime !== undefined ? { runtime: diagnostic.runtime } : {}),
      ...(diagnostic.detail !== undefined ? { detail: diagnostic.detail } : {}),
    }));
}

function catalogDiagnosticsFromProviderGraph(
  input: ProviderGraphProjection | ProviderGraphProjectionResult | undefined,
  filter: { providerId?: string; template?: string; part?: string } = {},
): CatalogDiagnostic[] {
  if (input === undefined) {
    return [];
  }
  const diagnostics = graphProjectionParts(input).diagnostics;
  const target = graphDiagnosticsAsCatalog(diagnostics, filter);
  if (filter.providerId === undefined && filter.template === undefined) {
    return target;
  }
  return [...target, ...graphDiagnosticsAsCatalog(providerGraphGlobalDiagnostics(input))];
}

function providerFactFromProviderGraph(
  input: ProviderGraphProjection | ProviderGraphProjectionResult | undefined,
  providerId: string,
): ProviderGraphProviderFact | undefined {
  if (input === undefined) {
    return undefined;
  }
  return graphProjectionParts(input).projection.providerFacts.find(
    (provider) => provider.providerId === providerId,
  );
}

function templateFromProviderGraph(
  input: ProviderGraphProjection | ProviderGraphProjectionResult | undefined,
  templateId: string,
): ProviderGraphResolvedTemplate | undefined {
  if (input === undefined) {
    return undefined;
  }
  return graphProjectionParts(input).projection.templates.find(
    (template) => template.templateId === templateId,
  );
}

function hasBlockingGraphDiagnostics(diagnostics: readonly CatalogDiagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.code.startsWith("graph.") && diagnostic.code !== "graph.dependency_unavailable",
  );
}

function templateProviderGraphDiagnostics(
  input: ProviderGraphProjection | ProviderGraphProjectionResult | undefined,
  templateId: string,
): CatalogDiagnostic[] {
  if (input === undefined) {
    return [];
  }
  const { projection, diagnostics } = graphProjectionParts(input);
  const template = projection.templates.find((entry) => entry.templateId === templateId);
  if (template === undefined) {
    return [];
  }
  return Object.entries(template.requiredParts).flatMap(([part, providerId]) =>
    graphDiagnosticsAsCatalog(diagnostics, { providerId, part }),
  );
}

function partBindingsFromProviderGraphTemplate(
  input: ProviderGraphProjection | ProviderGraphProjectionResult | undefined,
  templateId: string,
): PartBinding[] | undefined {
  if (input === undefined) {
    return undefined;
  }
  const { projection, diagnostics } = graphProjectionParts(input);
  const template = projection.templates.find((entry) => entry.templateId === templateId);
  if (template === undefined) {
    return undefined;
  }
  const providersById = new Map(
    projection.providerFacts.map((provider) => [provider.providerId, provider]),
  );
  return partBindingsFromProjectionTemplate(template, providersById, diagnostics);
}

function entityWithProviderGraph(
  entity: IndexedEntity,
  graph: ProviderGraphProjection | ProviderGraphProjectionResult | undefined,
): IndexedEntity {
  if (graph === undefined) {
    return entity;
  }
  const diagnostics = catalogDiagnosticsFromProviderGraph(graph, {
    ...(entity.kind === "CapsuleTemplate" || entity.family === "template"
      ? { template: entity.name }
      : { providerId: entity.name }),
  });
  const requiredProviderDiagnostics =
    entity.kind === "CapsuleTemplate" || entity.family === "template"
      ? templateProviderGraphDiagnostics(graph, entity.name)
      : [];
  const graphDefects =
    diagnostics.length > 0 ||
    hasBlockingGraphDiagnostics(requiredProviderDiagnostics) ||
    providerGraphHasGlobalDefects(graph);
  const graphAvailability =
    entity.kind === "CapsuleTemplate" || entity.family === "template"
      ? templateFromProviderGraph(graph, entity.name)?.availability
      : providerFactFromProviderGraph(graph, entity.name)?.availability;
  const graphProvider = providerFactFromProviderGraph(graph, entity.name);
  const availability = graphDefects ? "unavailable" : (graphAvailability ?? entity.availability);
  return {
    ...entity,
    availability,
    available: availability === "available",
    ...(graphProvider !== undefined ? { requires: graphProvider.dependencies } : {}),
    ...(graphProvider?.authAssurance !== undefined
      ? { authAssurance: structuredClone(graphProvider.authAssurance) }
      : {}),
  };
}

function providerDiagnosticsFromGraphFact(
  provider: ProviderGraphProviderFact | undefined,
  providerId: string,
  diagnostics: readonly ProviderGraphDiagnostic[],
  part?: string,
): CatalogDiagnostic[] {
  if (provider === undefined) {
    return [
      {
        code: "provider.unknown",
        message: `unknown provider "${providerId}"`,
        provider: providerId,
        ...(part !== undefined ? { part } : {}),
      },
    ];
  }
  const base: CatalogDiagnostic =
    provider.availability === "available"
      ? {
          code: "provider.available",
          message: `provider "${providerId}" is available`,
          provider: providerId,
          family: provider.runtimeFamily,
          ...(part !== undefined ? { part } : {}),
        }
      : {
          code: provider.availability === "degraded" ? "provider.degraded" : "provider.unavailable",
          message: `provider "${providerId}" is ${provider.availability}`,
          provider: providerId,
          family: provider.runtimeFamily,
          ...(part !== undefined ? { part } : {}),
          detail: {
            availability: provider.availability,
            dependencies: provider.dependencies,
          },
        };
  return [
    base,
    ...graphDiagnosticsAsCatalog(
      diagnostics,
      part !== undefined ? { providerId, part } : { providerId },
    ),
  ];
}

function partBindingsFromProjectionTemplate(
  template: ProviderGraphResolvedTemplate,
  providersById: ReadonlyMap<string, ProviderGraphProviderFact>,
  diagnostics: readonly ProviderGraphDiagnostic[],
): PartBinding[] {
  return Object.entries(template.requiredParts).map(([part, providerId]) => {
    const provider = providersById.get(providerId);
    return {
      part,
      provider: providerId,
      ...(provider?.runtimeFamily !== undefined ? { family: provider.runtimeFamily } : {}),
      availability: provider?.availability ?? "unavailable",
      available: provider?.available === true,
      dependencies: provider?.dependencies ?? [],
      diagnostics: providerDiagnosticsFromGraphFact(provider, providerId, diagnostics, part),
    };
  });
}

/**
 * Adapt a resolved provider graph into the {@link CatalogAdmissionView} admission consumes.
 *
 * Admission keeps its mutate/validate pipeline, but its template/provider facts now come directly
 * from the shared graph projection: availability, dependency evidence, compatibility, diagnostics,
 * and provider schemas all have the same source as catalog/doctor/boot reads.
 */
export function toAdmissionCatalogFromProviderGraphProjection(
  input: ProviderGraphProjection | ProviderGraphProjectionResult,
): CatalogAdmissionView {
  const { projection, diagnostics } = graphProjectionParts(input);
  const providersById = new Map(
    projection.providerFacts.map((provider) => [provider.providerId, provider]),
  );
  const templatesById = new Map(
    projection.templates.map((template) => [template.templateId, template]),
  );

  return {
    templateDefaults(id: string): CatalogTemplateDefaults | undefined {
      const template = templatesById.get(id);
      if (template === undefined) {
        return undefined;
      }
      const parts = template.requiredParts;
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
      if (template.manifest.spec.openParts !== undefined) {
        out.openParts = [...template.manifest.spec.openParts];
      }
      if (template.compatibleProviders !== undefined) {
        out.compatibleProviders = structuredClone(template.compatibleProviders);
      }
      const partBindings = partBindingsFromProjectionTemplate(template, providersById, diagnostics);
      const graphDiagnostics = catalogDiagnosticsFromProviderGraph(input, {
        template: id,
      }).filter((diagnostic) => diagnostic.code !== "graph.dependency_unavailable");
      const templateDiagnosticRows = templateDiagnostics(template.dependencies, partBindings);
      const graphDefects =
        graphDiagnostics.length > 0 || hasBlockingGraphDiagnostics(templateDiagnosticRows);
      out.available = template.available && !graphDefects;
      out.availability = graphDefects ? "unavailable" : template.availability;
      out.dependencies = structuredClone(template.dependencies);
      out.diagnostics = [...templateDiagnosticRows, ...graphDiagnostics];
      return out;
    },
    provider(use: string): CatalogProviderInfo | undefined {
      const provider = providersById.get(use);
      if (provider === undefined) {
        return undefined;
      }
      const graphDiagnostics = catalogDiagnosticsFromProviderGraph(input, { providerId: use });
      const graphDefects = graphDiagnostics.length > 0;
      const info: CatalogProviderInfo = {
        name: use,
        available: provider.available && !graphDefects,
        availability: graphDefects ? "unavailable" : provider.availability,
        family: provider.runtimeFamily,
        dependencies: structuredClone(provider.dependencies),
        diagnostics: [...providerDiagnosticsFromGraphFact(provider, use, []), ...graphDiagnostics],
      };
      if (provider.manifest.spec.config_schema !== undefined) {
        info.config_schema = provider.manifest.spec.config_schema;
      }
      if (provider.authAssurance !== undefined) {
        info.authAssurance = structuredClone(provider.authAssurance);
      }
      return info;
    },
    launcherMountCapability(launcher: string): CatalogLauncherMountCapability | undefined {
      return mountCapabilityOf(providersById.get(launcher)?.manifest);
    },
  };
}

export type ProviderGraphDoctorStatus = "PASS" | "DEGRADED" | "FAIL";

export interface ProviderGraphDoctorProvider {
  providerId: string;
  family: string;
  selected: boolean;
  available: boolean;
  availability: Availability;
  dependencies: IndexedDependencyBinding[];
  diagnostics: CatalogDiagnostic[];
  /** AuthProvider-only provider-neutral assurance capability declared by the provider manifest. */
  authAssurance?: AuthProviderAssuranceCapability;
}

export interface ProviderGraphDoctorTemplate {
  templateId: string;
  available: boolean;
  availability: Availability;
  dependencies: IndexedDependencyBinding[];
  diagnostics: CatalogDiagnostic[];
}

/** Read-only doctor summary for the selected provider graph. */
export interface ProviderGraphDoctorReport {
  status: ProviderGraphDoctorStatus;
  providerSetId?: string;
  profileId: string;
  selectedProviders: Partial<Record<ProviderProfileFamilyId, string>>;
  providers: ProviderGraphDoctorProvider[];
  templates: ProviderGraphDoctorTemplate[];
  diagnostics: CatalogDiagnostic[];
}

/**
 * Build the doctor/readiness report from the same graph result used by catalog, admission, and boot.
 *
 * The overall status follows the selected profile: unselected optional providers are listed for
 * diagnostics but do not fail this profile until a template/admitted assembly chooses them.
 */
export function providerGraphDoctorReport(
  input: ProviderGraphProjection | ProviderGraphProjectionResult,
): ProviderGraphDoctorReport {
  const { projection, diagnostics } = graphProjectionParts(input);
  const selectedIds = new Set(Object.values(projection.selectedProviders).filter(hasText));
  const providersById = new Map(
    projection.providerFacts.map((provider) => [provider.providerId, provider]),
  );
  const providers = projection.providerFacts.map((provider) => {
    const selected = selectedIds.has(provider.providerId);
    const graphDiagnostics = catalogDiagnosticsFromProviderGraph(input, {
      providerId: provider.providerId,
    });
    const graphDefects = graphDiagnostics.length > 0;
    return {
      providerId: provider.providerId,
      family: provider.runtimeFamily,
      selected,
      available: provider.available && !graphDefects,
      availability: graphDefects ? "unavailable" : provider.availability,
      dependencies: structuredClone(provider.dependencies),
      diagnostics: [
        ...providerDiagnosticsFromGraphFact(provider, provider.providerId, []),
        ...graphDiagnostics,
      ],
      ...(provider.authAssurance !== undefined
        ? { authAssurance: structuredClone(provider.authAssurance) }
        : {}),
    };
  });
  const templates = projection.templates.map((template) => {
    const partBindings = partBindingsFromProjectionTemplate(template, providersById, diagnostics);
    const graphDiagnostics = catalogDiagnosticsFromProviderGraph(input, {
      template: template.templateId,
    }).filter((diagnostic) => diagnostic.code !== "graph.dependency_unavailable");
    const templateDiagnosticRows = templateDiagnostics(template.dependencies, partBindings);
    const graphDefects =
      graphDiagnostics.length > 0 || hasBlockingGraphDiagnostics(templateDiagnosticRows);
    return {
      templateId: template.templateId,
      available: template.available && !graphDefects,
      availability: graphDefects ? "unavailable" : template.availability,
      dependencies: structuredClone(template.dependencies),
      diagnostics: [...templateDiagnosticRows, ...graphDiagnostics],
    };
  });
  const selectedProviderRows = providers.filter((provider) => provider.selected);
  const selectedOrTemplateUnavailable =
    selectedProviderRows.some((provider) => provider.availability === "unavailable") ||
    templates.some((template) => template.availability === "unavailable");
  const selectedOrTemplateDegraded =
    selectedProviderRows.some((provider) => provider.availability === "degraded") ||
    templates.some((template) => template.availability === "degraded");
  const graphDiagnostics = graphDiagnosticsAsCatalog(diagnostics);
  const status: ProviderGraphDoctorStatus =
    graphDiagnostics.length > 0 || selectedOrTemplateUnavailable
      ? "FAIL"
      : selectedOrTemplateDegraded
        ? "DEGRADED"
        : "PASS";

  return {
    status,
    ...(projection.providerSetId !== undefined ? { providerSetId: projection.providerSetId } : {}),
    profileId: projection.profileId,
    selectedProviders: structuredClone(projection.selectedProviders),
    providers,
    templates,
    diagnostics: graphDiagnostics,
  };
}
