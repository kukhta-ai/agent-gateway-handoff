import {
  type ConfigSchema,
  EMPTY_CONFIG_SCHEMA,
  redactOperatorEgress,
  redactOperatorText,
  validateConfig,
  validateSchemaShape,
} from "@gla/kernel";
import type {
  DependencyRequirement,
  ProviderFamily,
  ProviderManifest,
  SkillManifest,
  TemplateManifest,
  WpmBundleEvidence,
} from "./manifests.js";
import {
  type ProviderProfileFamilyId,
  type ProviderProfileSelection,
  type TemplatePackageManifest,
  validateTemplatePackageManifest,
} from "./provider-profile.js";

/** Runtime provider families that can be implemented by a trusted provider package. */
export type ProviderAuthoringRuntimeFamily = Exclude<ProviderFamily, "template">;

/** Stable machine-readable diagnostics returned by provider package authoring validation. */
export type ProviderAuthoringDiagnosticCode =
  | "provider_author.manifest_invalid"
  | "provider_author.family_contract_invalid"
  | "provider_author.schema_invalid"
  | "provider_author.probe_missing"
  | "provider_author.skills_or_docs_missing"
  | "provider_author.dependency_invalid"
  | "provider_author.compatibility_invalid"
  | "provider_author.wpm_bundle_missing"
  | "provider_author.redaction_violation"
  | "provider_author.contract_tests_missing"
  | "provider_author.narrow_waist_edit";

/** Stable machine-readable diagnostics returned by template package authoring validation. */
export type TemplateAuthoringDiagnosticCode =
  | "template_author.catalog_entity_invalid"
  | "template_author.schema_invalid"
  | "template_author.defaults_invalid"
  | "template_author.compatibility_invalid"
  | "template_author.skills_or_docs_missing"
  | "template_author.dependency_invalid"
  | "template_author.wpm_bundle_missing"
  | "template_author.redaction_violation"
  | "template_author.narrow_waist_edit"
  | "template_author.factory_forbidden";

/** Redacted diagnostic safe for provider/template authoring UX surfaces. */
export interface AuthoringDiagnostic {
  /** Stable code for automation and tests; message text is explanatory only. */
  code: ProviderAuthoringDiagnosticCode | TemplateAuthoringDiagnosticCode;
  /** Human-readable explanation with no raw secrets or host credentials. */
  message: string;
  /** Dotted manifest/package path, or a repository path for file-boundary diagnostics. */
  path?: string;
  /** Provider or template id when the validator can determine it. */
  packageId?: string;
  /** Runtime provider family when relevant. */
  family?: string;
  /** Redacted structured details. */
  detail?: Record<string, unknown>;
}

/** WPM bundle skeleton requirement produced before install/update receipt evidence exists. */
export interface AuthoringWpmSkeletonRequirement {
  /** Provider/template dependency requiring host work. */
  dependency: string;
  /** Deterministic bundle id the WPM package should expose. */
  bundleId: string;
  /** Optional bundle version expected by the manifest. */
  version?: string;
  /** Connection references the future WPM receipt must expose. */
  connectionRefs: string[];
  /** Suggested authoring files for the WPM package skeleton. */
  files: string[];
}

/** Provider module evidence supplied by a skeleton generator or static package inspector. */
export interface ProviderAuthoringModuleEvidence {
  /** Provider id registered by the module. */
  providerId?: string;
  /** Runtime family registered by the module. */
  family?: ProviderAuthoringRuntimeFamily;
  /** True when the module registers the family factory for the provider id. */
  registersFactory?: boolean;
  /** True when the module registers the probe declared in the manifest. */
  registersProbe?: boolean;
}

/** Input for validating one provider package authoring surface. */
export interface ProviderPackageAuthoringInput {
  /** ProviderManifest being authored or validated. */
  manifest?: unknown;
  /** Static evidence about module registration collected by scaffold/inspect tooling. */
  module?: ProviderAuthoringModuleEvidence;
  /** Documentation refs shipped by the package when skills are not the primary surface. */
  docs?: readonly string[];
  /** Extra skill manifests shipped outside the manifest. */
  skills?: readonly SkillManifest[];
  /** Contract test refs proving the package behavior. */
  contractTests?: readonly string[];
  /** Deterministic WPM bundle metadata shipped next to the provider package. */
  wpmBundles?: readonly WpmBundleEvidence[];
  /** WPM skeleton requirements generated before install/update decisions are made. */
  wpmSkeletons?: readonly AuthoringWpmSkeletonRequirement[];
  /** Files the authoring operation would create or change. */
  changedFiles?: readonly string[];
}

/** Input for validating one TemplatePackage authoring surface. */
export interface TemplatePackageAuthoringInput {
  /** TemplatePackage manifest being authored or validated. */
  manifest?: unknown;
  /** Provider manifests available while checking defaults and compatibility. */
  providers?: readonly ProviderManifest[] | Record<string, ProviderManifest>;
  /** Documentation refs shipped by the package when skills are not the primary surface. */
  docs?: readonly string[];
  /** Extra skill manifests shipped outside the package manifest. */
  skills?: readonly SkillManifest[];
  /** Deterministic WPM bundle metadata shipped next to the template package. */
  wpmBundles?: readonly WpmBundleEvidence[];
  /** WPM skeleton requirements generated before install/update decisions are made. */
  wpmSkeletons?: readonly AuthoringWpmSkeletonRequirement[];
  /** Files the authoring operation would create or change. */
  changedFiles?: readonly string[];
}

/** Readiness summary for a provider package authoring report. */
export interface ProviderAuthoringReadiness {
  /** Provider id when a valid manifest identity was found. */
  providerId?: string;
  /** Runtime family when a valid family was found. */
  family?: ProviderAuthoringRuntimeFamily;
  /** Host-touching dependencies that still need WPM install/update receipt evidence later. */
  requiredWpmSkeletons: AuthoringWpmSkeletonRequirement[];
  /** Authoring never proves live availability; install receipts and runtime probes do. */
  availability: "not-evaluated";
  /** Explicit handoff into the operator install/update UX. */
  nextUx: "operator-install-update";
}

/** Readiness summary for a template package authoring report. */
export interface TemplateAuthoringReadiness {
  /** TemplatePackage id when a valid manifest identity was found. */
  packageId?: string;
  /** Template ids included in the package. */
  templateIds: string[];
  /** Host-touching template dependencies that need WPM receipt evidence later. */
  requiredWpmSkeletons: AuthoringWpmSkeletonRequirement[];
  /** Template authoring never proves live provider availability. */
  availability: "not-evaluated";
  /** Explicit handoff into the operator install/update UX. */
  nextUx: "operator-install-update";
}

/** Provider authoring validation report with stable diagnostics and install/update handoff data. */
export interface ProviderPackageAuthoringReport {
  ok: boolean;
  diagnostics: AuthoringDiagnostic[];
  readiness: ProviderAuthoringReadiness;
}

/** Template authoring validation report with stable diagnostics and install/update handoff data. */
export interface TemplatePackageAuthoringReport {
  ok: boolean;
  diagnostics: AuthoringDiagnostic[];
  readiness: TemplateAuthoringReadiness;
}

/** Input for producing a provider package skeleton. */
export interface ProviderPackageSkeletonInput {
  providerId: string;
  family: ProviderAuthoringRuntimeFamily;
  /** Optional manifest kind override. Defaults to the canonical kind for the family. */
  kind?: string;
  /** Package/provider version. */
  version?: string;
  /** Operator-facing capability summary. */
  summary?: string;
  /** Config schema exposed by the provider. */
  configSchema?: ConfigSchema;
  /** Factory config schema used at provider construction. */
  factoryConfigSchema?: ConfigSchema;
  /** Host or service dependencies declared by this provider. */
  requires?: readonly DependencyRequirement[];
}

/** Input for producing a TemplatePackage skeleton. */
export interface TemplatePackageSkeletonInput {
  packageId: string;
  templateId: string;
  version?: string;
  summary?: string;
  /** Required template parts, keyed by part role. */
  requiredParts: Record<string, string>;
  /** Agent-overridable part roles. */
  openParts?: readonly string[];
  /** Compatible provider ids for each open part role. */
  compatibleProviders?: Record<string, string[]>;
  /** Template parameter schema. */
  openParams?: ConfigSchema;
  /** Provider config defaults consumed by the provider graph, keyed by provider id or `provider.<id>`. */
  providerDefaults?: Record<string, Record<string, unknown>>;
  /** Template-level host or service dependencies. */
  requires?: readonly DependencyRequirement[];
}

/** Provider authoring skeleton returned by {@link createProviderPackageSkeleton}. */
export interface ProviderPackageSkeleton extends ProviderPackageAuthoringInput {
  manifest: ProviderManifest;
  module: Required<ProviderAuthoringModuleEvidence>;
  contractTests: string[];
  docs: string[];
  changedFiles: string[];
  wpmSkeletons: AuthoringWpmSkeletonRequirement[];
}

/** Template authoring skeleton returned by {@link createTemplatePackageSkeleton}. */
export interface TemplatePackageSkeleton extends TemplatePackageAuthoringInput {
  manifest: TemplatePackageManifest;
  docs: string[];
  changedFiles: string[];
  wpmSkeletons: AuthoringWpmSkeletonRequirement[];
}

const API_VERSION = "gla.dev/v1";
const RUNTIME_FAMILY_SET = new Set<ProviderAuthoringRuntimeFamily>([
  "auth",
  "launcher",
  "entrypoint",
  "connector",
  "workspace",
  "detector",
  "channel",
  "secret-store",
]);
const RELATION_KEY_TO_FAMILY: Record<string, ProviderFamily> = {
  auth: "auth",
  auths: "auth",
  launcher: "launcher",
  launchers: "launcher",
  entrypoint: "entrypoint",
  entrypoints: "entrypoint",
  connector: "connector",
  connectors: "connector",
  workspace: "workspace",
  workspaces: "workspace",
  detector: "detector",
  detectors: "detector",
  channel: "channel",
  channels: "channel",
  "secret-store": "secret-store",
  "secret-stores": "secret-store",
  secretStores: "secret-store",
  templates: "template",
};
const TEMPLATE_DEFAULT_FAMILY_TO_PART: Partial<Record<ProviderProfileFamilyId, string>> = {
  Launcher: "launcher",
  Workspace: "workspace",
  HumanEntrypoint: "entrypoint",
  AgentConnector: "connector",
  CompletionDetector: "detector",
};
const TEMPLATE_PART_TO_DEFAULT_FAMILY: Record<string, ProviderProfileFamilyId> = {
  launcher: "Launcher",
  workspace: "Workspace",
  entrypoint: "HumanEntrypoint",
  connector: "AgentConnector",
  detector: "CompletionDetector",
};
const FAMILY_TO_KIND: Record<ProviderAuthoringRuntimeFamily, string> = {
  auth: "AuthProvider",
  launcher: "Launcher",
  entrypoint: "HumanEntrypoint",
  connector: "AgentConnector",
  workspace: "Workspace",
  detector: "CompletionDetector",
  channel: "ChannelAdapter",
  "secret-store": "SecretStore",
};
const SECRET_KEY_RE = /(secret|token|password|credential|private[_-]?key)/i;
const SCHEMA_PATH_SEGMENTS = new Set([
  "config_schema",
  "factory_config_schema",
  "openParams",
  "schema",
]);
const SAFE_AUTHORING_ID_RE = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function safeDiagnostic(diagnostic: AuthoringDiagnostic): AuthoringDiagnostic {
  return redactOperatorEgress(diagnostic) as AuthoringDiagnostic;
}

function pushDiagnostic(diagnostics: AuthoringDiagnostic[], diagnostic: AuthoringDiagnostic): void {
  diagnostics.push(safeDiagnostic(diagnostic));
}

function hasNonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => hasText(item));
}

function isRuntimeFamily(value: unknown): value is ProviderAuthoringRuntimeFamily {
  return (
    typeof value === "string" && RUNTIME_FAMILY_SET.has(value as ProviderAuthoringRuntimeFamily)
  );
}

function isSafeAuthoringId(value: string): boolean {
  return SAFE_AUTHORING_ID_RE.test(value) && !value.includes("..");
}

function assertSafeAuthoringId(value: string, label: string): void {
  if (!isSafeAuthoringId(value)) {
    throw new TypeError(`${label} must be a safe lowercase authoring id`);
  }
}

function providerIdFromManifest(manifest: unknown): string | undefined {
  return isRecord(manifest) &&
    isRecord(manifest.metadata) &&
    typeof manifest.metadata.name === "string" &&
    manifest.metadata.name.length > 0
    ? manifest.metadata.name
    : undefined;
}

function providerFamilyFromManifest(manifest: unknown): ProviderAuthoringRuntimeFamily | undefined {
  const family = isRecord(manifest) && isRecord(manifest.spec) ? manifest.spec.family : undefined;
  return isRuntimeFamily(family) ? family : undefined;
}

function templatePackageIdFromManifest(manifest: unknown): string | undefined {
  return isRecord(manifest) &&
    isRecord(manifest.metadata) &&
    typeof manifest.metadata.name === "string" &&
    manifest.metadata.name.length > 0
    ? manifest.metadata.name
    : undefined;
}

function isSchemaPath(path: string): boolean {
  return path
    .split(".")
    .some((segment) => SCHEMA_PATH_SEGMENTS.has(segment.replace(/\[[0-9]+\]$/u, "")));
}

function isSecretRefObject(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value.secretRef === "string" &&
    value.secretRef.length > 0
  );
}

function scanRedactionViolations(
  diagnostics: AuthoringDiagnostic[],
  code: ProviderAuthoringDiagnosticCode | TemplateAuthoringDiagnosticCode,
  value: unknown,
  path: string,
  packageId: string | undefined,
  secretContext = false,
): void {
  if (typeof value === "string") {
    if ((secretContext && !path.endsWith(".secretRef")) || redactOperatorText(value) !== value) {
      pushDiagnostic(diagnostics, {
        code,
        message: "authoring input contains raw secret, grant, token, or redaction placeholder text",
        path,
        ...(packageId !== undefined ? { packageId } : {}),
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      scanRedactionViolations(
        diagnostics,
        code,
        item,
        `${path}.${index}`,
        packageId,
        secretContext,
      );
    }
    return;
  }
  if (!isRecord(value)) {
    if (secretContext && value !== undefined && value !== null) {
      pushDiagnostic(diagnostics, {
        code,
        message: "authoring input contains a literal secret-shaped value",
        path,
        ...(packageId !== undefined ? { packageId } : {}),
      });
    }
    return;
  }
  if (isSecretRefObject(value)) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const childPath = path === "$" ? key : `${path}.${key}`;
    const childSecretContext =
      secretContext || (!isSchemaPath(childPath) && SECRET_KEY_RE.test(key));
    scanRedactionViolations(diagnostics, code, nested, childPath, packageId, childSecretContext);
  }
}

function narrowWaistViolation(file: string): boolean {
  return (
    file.startsWith("packages/app/") ||
    file.startsWith("packages/kernel/") ||
    file.startsWith("packages/gateway/") ||
    file.startsWith("packages/session/") ||
    file.startsWith("packages/identity/") ||
    file.startsWith("packages/route/") ||
    file.startsWith("packages/completion/") ||
    file.startsWith("packages/worker/")
  );
}

function normalizeRepoPath(file: string): string | undefined {
  if (file.length === 0 || file.startsWith("/") || file.includes("\0")) {
    return undefined;
  }
  const stack: string[] = [];
  for (const part of file.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      return undefined;
    }
    stack.push(part);
  }
  return stack.length === 0 ? undefined : stack.join("/");
}

function validateChangedFiles(
  diagnostics: AuthoringDiagnostic[],
  code: ProviderAuthoringDiagnosticCode | TemplateAuthoringDiagnosticCode,
  files: readonly string[] | undefined,
  packageId: string | undefined,
): void {
  for (const file of files ?? []) {
    const normalized = normalizeRepoPath(file);
    if (normalized === undefined || narrowWaistViolation(normalized)) {
      pushDiagnostic(diagnostics, {
        code,
        message:
          "provider/template authoring must not require edits to generic app composition or narrow-waist packages",
        path: file,
        ...(packageId !== undefined ? { packageId } : {}),
      });
    }
  }
}

function validateSchema(
  diagnostics: AuthoringDiagnostic[],
  code: ProviderAuthoringDiagnosticCode | TemplateAuthoringDiagnosticCode,
  schema: unknown,
  path: string,
  packageId: string | undefined,
): void {
  if (schema === undefined) {
    return;
  }
  if (!isRecord(schema)) {
    pushDiagnostic(diagnostics, {
      code,
      message: "config schema must be an object",
      path,
      ...(packageId !== undefined ? { packageId } : {}),
    });
    return;
  }
  const result = validateSchemaShape(schema);
  if (!result.ok) {
    pushDiagnostic(diagnostics, {
      code,
      message: "config schema shape is invalid",
      path,
      ...(packageId !== undefined ? { packageId } : {}),
      detail: { defects: result.defects },
    });
  }
}

function wpmBundleFor(
  requirement: DependencyRequirement,
  bundles: readonly WpmBundleEvidence[] | undefined,
): WpmBundleEvidence | undefined {
  const expectedId = requirement.bundle?.id ?? requirement.dependency;
  return (bundles ?? []).find((bundle) => bundle.id === expectedId);
}

function wpmSkeletonFor(
  requirement: DependencyRequirement,
  skeletons: readonly AuthoringWpmSkeletonRequirement[] | undefined,
): AuthoringWpmSkeletonRequirement | undefined {
  const expectedId = requirement.bundle?.id ?? requirement.dependency;
  return (skeletons ?? []).find(
    (skeleton) =>
      skeleton.dependency === requirement.dependency || skeleton.bundleId === expectedId,
  );
}

function skeletonRequirementFromDependency(
  requirement: DependencyRequirement,
): AuthoringWpmSkeletonRequirement {
  const bundleId = requirement.bundle?.id ?? requirement.dependency;
  assertSafeAuthoringId(requirement.dependency, "dependency");
  assertSafeAuthoringId(bundleId, "bundle id");
  const version = requirement.bundle?.version;
  return {
    dependency: requirement.dependency,
    bundleId,
    ...(version !== undefined ? { version } : {}),
    connectionRefs: requirement.connectionRefs ?? [],
    files: [
      `wpm/bundles/${bundleId}/bundle.yml`,
      `wpm/bundles/${bundleId}/install-backlog.md`,
      `wpm/bundles/${bundleId}/verify.ts`,
    ],
  };
}

function validateWpmBundleEvidence(
  diagnostics: AuthoringDiagnostic[],
  code: ProviderAuthoringDiagnosticCode | TemplateAuthoringDiagnosticCode,
  requirement: DependencyRequirement,
  bundle: WpmBundleEvidence | undefined,
  path: string,
  packageId: string | undefined,
): void {
  if (bundle === undefined) {
    return;
  }
  const expected = requirement.bundle;
  if (!hasText(bundle.id) || bundle.id !== (expected?.id ?? requirement.dependency)) {
    pushDiagnostic(diagnostics, {
      code,
      message: "WPM bundle id must match the host-touching dependency requirement",
      path: `${path}.bundle.id`,
      ...(packageId !== undefined ? { packageId } : {}),
    });
  }
  if (!hasText(bundle.version)) {
    pushDiagnostic(diagnostics, {
      code,
      message: "WPM bundle metadata must include a version",
      path: `${path}.bundle.version`,
      ...(packageId !== undefined ? { packageId } : {}),
    });
  }
  if (!isRecord(bundle.declaredRequires)) {
    pushDiagnostic(diagnostics, {
      code,
      message: "WPM bundle metadata must include declaredRequires",
      path: `${path}.bundle.declaredRequires`,
      ...(packageId !== undefined ? { packageId } : {}),
    });
  }
}

function validateDependencyRequirements(
  diagnostics: AuthoringDiagnostic[],
  codes: {
    dependency: ProviderAuthoringDiagnosticCode | TemplateAuthoringDiagnosticCode;
    wpm: ProviderAuthoringDiagnosticCode | TemplateAuthoringDiagnosticCode;
  },
  requirements: unknown,
  path: string,
  packageId: string | undefined,
  bundles: readonly WpmBundleEvidence[] | undefined,
  skeletons: readonly AuthoringWpmSkeletonRequirement[] | undefined,
): AuthoringWpmSkeletonRequirement[] {
  const requiredWpmSkeletons: AuthoringWpmSkeletonRequirement[] = [];
  if (requirements === undefined) {
    return requiredWpmSkeletons;
  }
  if (!Array.isArray(requirements)) {
    pushDiagnostic(diagnostics, {
      code: codes.dependency,
      message: "dependency requirements must be an array",
      path,
      ...(packageId !== undefined ? { packageId } : {}),
    });
    return requiredWpmSkeletons;
  }
  for (const [index, requirement] of requirements.entries()) {
    const requirementPath = `${path}.${index}`;
    if (!isRecord(requirement) || !hasText(requirement.dependency)) {
      pushDiagnostic(diagnostics, {
        code: codes.dependency,
        message: "dependency requirement must include dependency",
        path: `${requirementPath}.dependency`,
        ...(packageId !== undefined ? { packageId } : {}),
      });
      continue;
    }
    if (!isSafeAuthoringId(requirement.dependency)) {
      pushDiagnostic(diagnostics, {
        code: codes.dependency,
        message: "dependency id must be a safe lowercase authoring id",
        path: `${requirementPath}.dependency`,
        ...(packageId !== undefined ? { packageId } : {}),
      });
      continue;
    }
    const bundleId = isRecord(requirement.bundle) ? requirement.bundle.id : undefined;
    if (bundleId !== undefined && (!hasText(bundleId) || !isSafeAuthoringId(bundleId))) {
      pushDiagnostic(diagnostics, {
        code: codes.dependency,
        message: "dependency bundle id must be a safe lowercase authoring id",
        path: `${requirementPath}.bundle.id`,
        ...(packageId !== undefined ? { packageId } : {}),
      });
      continue;
    }
    if (
      requirement.connectionRefs !== undefined &&
      !hasNonEmptyStringArray(requirement.connectionRefs)
    ) {
      pushDiagnostic(diagnostics, {
        code: codes.dependency,
        message: "dependency connectionRefs must be non-empty strings when present",
        path: `${requirementPath}.connectionRefs`,
        ...(packageId !== undefined ? { packageId } : {}),
      });
    }
    if (requirement.hostTouching === true) {
      const typedRequirement = requirement as unknown as DependencyRequirement;
      requiredWpmSkeletons.push(skeletonRequirementFromDependency(typedRequirement));
      const packageBundle = typedRequirement.bundle ?? wpmBundleFor(typedRequirement, bundles);
      const packageSkeleton = wpmSkeletonFor(typedRequirement, skeletons);
      validateWpmBundleEvidence(
        diagnostics,
        codes.wpm,
        typedRequirement,
        packageBundle,
        requirementPath,
        packageId,
      );
      if (packageBundle === undefined && packageSkeleton === undefined) {
        pushDiagnostic(diagnostics, {
          code: codes.wpm,
          message:
            "host-touching dependencies require WPM bundle metadata or a generated WPM skeleton before install/update",
          path: requirementPath,
          ...(packageId !== undefined ? { packageId } : {}),
          detail: { dependency: typedRequirement.dependency },
        });
      }
    }
  }
  return requiredWpmSkeletons;
}

function validateProviderManifestIdentity(
  diagnostics: AuthoringDiagnostic[],
  manifest: unknown,
): manifest is ProviderManifest {
  if (!isRecord(manifest)) {
    pushDiagnostic(diagnostics, {
      code: "provider_author.manifest_invalid",
      message: "provider manifest must be an object",
    });
    return false;
  }
  let valid = true;
  const packageId = providerIdFromManifest(manifest);
  if (manifest.apiVersion !== API_VERSION) {
    valid = false;
    pushDiagnostic(diagnostics, {
      code: "provider_author.manifest_invalid",
      message: `provider manifest apiVersion must be ${API_VERSION}`,
      path: "apiVersion",
      ...(packageId !== undefined ? { packageId } : {}),
    });
  }
  if (!hasText(manifest.kind)) {
    valid = false;
    pushDiagnostic(diagnostics, {
      code: "provider_author.manifest_invalid",
      message: "provider manifest kind must be a non-empty string",
      path: "kind",
      ...(packageId !== undefined ? { packageId } : {}),
    });
  }
  if (
    !isRecord(manifest.metadata) ||
    !hasText(manifest.metadata.name) ||
    !hasText(manifest.metadata.version)
  ) {
    valid = false;
    pushDiagnostic(diagnostics, {
      code: "provider_author.manifest_invalid",
      message: "provider manifest metadata.name and metadata.version are required",
      path: "metadata",
      ...(packageId !== undefined ? { packageId } : {}),
    });
  }
  if (!isRecord(manifest.spec)) {
    valid = false;
    pushDiagnostic(diagnostics, {
      code: "provider_author.manifest_invalid",
      message: "provider manifest spec must be an object",
      path: "spec",
      ...(packageId !== undefined ? { packageId } : {}),
    });
    return false;
  }
  if (!isRuntimeFamily(manifest.spec.family)) {
    valid = false;
    pushDiagnostic(diagnostics, {
      code: "provider_author.family_contract_invalid",
      message: "provider manifest spec.family must be a supported runtime provider family",
      path: "spec.family",
      ...(packageId !== undefined ? { packageId } : {}),
      ...(hasText(manifest.spec.family) ? { family: manifest.spec.family } : {}),
    });
  }
  if (!isRecord(manifest.spec.capability) || !hasText(manifest.spec.capability.summary)) {
    valid = false;
    pushDiagnostic(diagnostics, {
      code: "provider_author.manifest_invalid",
      message: "provider manifest capability.summary is required",
      path: "spec.capability.summary",
      ...(packageId !== undefined ? { packageId } : {}),
    });
  }
  return valid;
}

function templateIdsFromManifest(manifest: unknown): string[] {
  if (!isRecord(manifest) || !isRecord(manifest.spec) || !Array.isArray(manifest.spec.templates)) {
    return [];
  }
  return manifest.spec.templates.flatMap((template) =>
    isRecord(template) &&
    isRecord(template.metadata) &&
    typeof template.metadata.name === "string" &&
    template.metadata.name.length > 0
      ? [template.metadata.name]
      : [],
  );
}

function providersById(
  providers: TemplatePackageAuthoringInput["providers"],
): Map<string, ProviderManifest> {
  if (providers === undefined) {
    return new Map();
  }
  if (Array.isArray(providers)) {
    return new Map(providers.map((provider) => [provider.metadata.name, provider]));
  }
  return new Map(Object.entries(providers));
}

function providerIdFromDefaultTarget(targetId: string): string {
  return targetId.startsWith("provider.") ? targetId.slice("provider.".length) : targetId;
}

function templateDefaultKeys(templateId: string): string[] {
  return [`template.${templateId}`, templateId];
}

function templateDefaultTargets(manifest: unknown): Map<string, string> {
  const targets = new Map<string, string>();
  for (const templateId of templateIdsFromManifest(manifest)) {
    for (const key of templateDefaultKeys(templateId)) {
      targets.set(key, templateId);
    }
  }
  return targets;
}

function providerIdFromSelection(
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

function validateProviderRelations(
  diagnostics: AuthoringDiagnostic[],
  manifest: ProviderManifest,
): void {
  const compatibleWith = manifest.spec.relations?.compatibleWith;
  if (!isRecord(compatibleWith)) {
    return;
  }
  for (const [relationKey, ids] of Object.entries(compatibleWith)) {
    const expectedFamily = RELATION_KEY_TO_FAMILY[relationKey];
    if (expectedFamily === undefined) {
      pushDiagnostic(diagnostics, {
        code: "provider_author.compatibility_invalid",
        message: "provider compatibleWith relation key is not known to the provider graph",
        path: `spec.relations.compatibleWith.${relationKey}`,
        packageId: manifest.metadata.name,
        family: manifest.spec.family,
        detail: { relationKey },
      });
      continue;
    }
    if (!hasNonEmptyStringArray(ids)) {
      pushDiagnostic(diagnostics, {
        code: "provider_author.compatibility_invalid",
        message: "provider compatibleWith relation must be a non-empty provider/template id list",
        path: `spec.relations.compatibleWith.${relationKey}`,
        packageId: manifest.metadata.name,
        family: manifest.spec.family,
        detail: { expectedFamily },
      });
    }
  }
}

/** Validate a provider package for the provider-author/developer UX before operator install/update. */
export function validateProviderPackageAuthoring(
  input: ProviderPackageAuthoringInput,
): ProviderPackageAuthoringReport {
  const diagnostics: AuthoringDiagnostic[] = [];
  const packageId = providerIdFromManifest(input.manifest);
  const family = providerFamilyFromManifest(input.manifest);
  let requiredWpmSkeletons: AuthoringWpmSkeletonRequirement[] = [];

  if (validateProviderManifestIdentity(diagnostics, input.manifest)) {
    const manifest = input.manifest;
    const expectedKind = FAMILY_TO_KIND[manifest.spec.family as ProviderAuthoringRuntimeFamily];
    if (manifest.kind !== expectedKind) {
      pushDiagnostic(diagnostics, {
        code: "provider_author.family_contract_invalid",
        message: `provider family "${manifest.spec.family}" must use manifest kind "${expectedKind}"`,
        path: "kind",
        packageId: manifest.metadata.name,
        family: manifest.spec.family,
        detail: { expectedKind, actualKind: manifest.kind },
      });
    }
    if (input.module === undefined || input.module.registersFactory !== true) {
      pushDiagnostic(diagnostics, {
        code: "provider_author.family_contract_invalid",
        message: "provider package must register a factory for its runtime family",
        path: "module.registersFactory",
        packageId: manifest.metadata.name,
        family: manifest.spec.family,
      });
    }
    if (
      input.module?.providerId !== undefined &&
      input.module.providerId !== manifest.metadata.name
    ) {
      pushDiagnostic(diagnostics, {
        code: "provider_author.family_contract_invalid",
        message: "module provider id must match ProviderManifest metadata.name",
        path: "module.providerId",
        packageId: manifest.metadata.name,
        family: manifest.spec.family,
      });
    }
    if (input.module?.family !== undefined && input.module.family !== manifest.spec.family) {
      pushDiagnostic(diagnostics, {
        code: "provider_author.family_contract_invalid",
        message: "module runtime family must match ProviderManifest spec.family",
        path: "module.family",
        packageId: manifest.metadata.name,
        family: manifest.spec.family,
      });
    }
    validateSchema(
      diagnostics,
      "provider_author.schema_invalid",
      manifest.spec.config_schema,
      "spec.config_schema",
      manifest.metadata.name,
    );
    validateSchema(
      diagnostics,
      "provider_author.schema_invalid",
      manifest.spec.factory_config_schema,
      "spec.factory_config_schema",
      manifest.metadata.name,
    );
    validateProviderRelations(diagnostics, manifest);
    if (!hasText(manifest.spec.probe) || input.module?.registersProbe !== true) {
      pushDiagnostic(diagnostics, {
        code: "provider_author.probe_missing",
        message: "provider package must declare and register a probe before it can be selected",
        path: !hasText(manifest.spec.probe) ? "spec.probe" : "module.registersProbe",
        packageId: manifest.metadata.name,
        family: manifest.spec.family,
      });
    }
    if (
      !(Array.isArray(manifest.spec.skills) && manifest.spec.skills.length > 0) &&
      !(Array.isArray(input.skills) && input.skills.length > 0) &&
      !hasNonEmptyStringArray(input.docs)
    ) {
      pushDiagnostic(diagnostics, {
        code: "provider_author.skills_or_docs_missing",
        message: "provider package must include skills or docs for the developer/operator-agent UX",
        path: "spec.skills",
        packageId: manifest.metadata.name,
        family: manifest.spec.family,
      });
    }
    requiredWpmSkeletons = validateDependencyRequirements(
      diagnostics,
      {
        dependency: "provider_author.dependency_invalid",
        wpm: "provider_author.wpm_bundle_missing",
      },
      manifest.spec.requires,
      "spec.requires",
      manifest.metadata.name,
      input.wpmBundles,
      input.wpmSkeletons,
    );
  }

  if (!hasNonEmptyStringArray(input.contractTests)) {
    pushDiagnostic(diagnostics, {
      code: "provider_author.contract_tests_missing",
      message:
        "provider package must list contract tests for manifest, probe, dependency, and runtime behavior",
      path: "contractTests",
      ...(packageId !== undefined ? { packageId } : {}),
      ...(family !== undefined ? { family } : {}),
    });
  }
  scanRedactionViolations(
    diagnostics,
    "provider_author.redaction_violation",
    input,
    "$",
    packageId,
  );
  validateChangedFiles(
    diagnostics,
    "provider_author.narrow_waist_edit",
    input.changedFiles,
    packageId,
  );

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    readiness: {
      ...(packageId !== undefined ? { providerId: packageId } : {}),
      ...(family !== undefined ? { family } : {}),
      requiredWpmSkeletons,
      availability: "not-evaluated",
      nextUx: "operator-install-update",
    },
  };
}

function validateTemplateDefaults(
  diagnostics: AuthoringDiagnostic[],
  manifest: unknown,
  providerIndex: ReadonlyMap<string, ProviderManifest>,
  packageId: string | undefined,
): void {
  if (!isRecord(manifest) || !isRecord(manifest.spec)) {
    return;
  }
  const defaults = manifest.spec.defaults;
  if (!isRecord(defaults)) {
    pushDiagnostic(diagnostics, {
      code: "template_author.defaults_invalid",
      message: "TemplatePackage spec.defaults must be an object",
      path: "spec.defaults",
      ...(packageId !== undefined ? { packageId } : {}),
    });
    return;
  }
  const templateTargets = templateDefaultTargets(manifest);
  for (const [targetId, targetDefaults] of Object.entries(defaults)) {
    const templateId = templateTargets.get(targetId);
    if (templateId !== undefined) {
      validateTemplateProviderDefaults(
        diagnostics,
        targetId,
        templateId,
        targetDefaults,
        providerIndex,
        packageId,
      );
      continue;
    }
    const providerId = providerIdFromDefaultTarget(targetId);
    const provider = providerIndex.get(providerId);
    if (provider === undefined) {
      pushDiagnostic(diagnostics, {
        code: "template_author.defaults_invalid",
        message: "template defaults must be keyed by a known provider id or provider.<id>",
        path: `spec.defaults.${targetId}`,
        ...(packageId !== undefined ? { packageId } : {}),
        detail: { targetId },
      });
      continue;
    }
    if (!isRecord(targetDefaults)) {
      pushDiagnostic(diagnostics, {
        code: "template_author.defaults_invalid",
        message: "template defaults target must be an object",
        path: `spec.defaults.${targetId}`,
        ...(packageId !== undefined ? { packageId } : {}),
      });
      continue;
    }
    const validation = validateConfig(
      provider.spec.config_schema ?? EMPTY_CONFIG_SCHEMA,
      targetDefaults,
    );
    if (!validation.ok) {
      pushDiagnostic(diagnostics, {
        code: "template_author.defaults_invalid",
        message: "template defaults must match the target provider config_schema",
        path: `spec.defaults.${targetId}`,
        ...(packageId !== undefined ? { packageId } : {}),
        family: provider.spec.family,
        detail: { providerId, defects: validation.defects },
      });
    }
  }
}

function validateTemplateProviderDefaults(
  diagnostics: AuthoringDiagnostic[],
  targetId: string,
  templateId: string,
  targetDefaults: unknown,
  providerIndex: ReadonlyMap<string, ProviderManifest>,
  packageId: string | undefined,
): void {
  if (!isRecord(targetDefaults)) {
    pushDiagnostic(diagnostics, {
      code: "template_author.defaults_invalid",
      message:
        "template provider defaults target must be an object keyed by capsule provider family",
      path: `spec.defaults.${targetId}`,
      ...(packageId !== undefined ? { packageId } : {}),
      detail: { templateId },
    });
    return;
  }
  for (const [family, selection] of Object.entries(targetDefaults)) {
    const part = TEMPLATE_DEFAULT_FAMILY_TO_PART[family as ProviderProfileFamilyId];
    if (part === undefined) {
      pushDiagnostic(diagnostics, {
        code: "template_author.defaults_invalid",
        message: "template provider defaults may only name capsule provider families",
        path: `spec.defaults.${targetId}.${family}`,
        ...(packageId !== undefined ? { packageId } : {}),
        detail: { family, templateId },
      });
      continue;
    }
    const providerId = providerIdFromSelection(selection as ProviderProfileSelection);
    if (providerId === undefined) {
      pushDiagnostic(diagnostics, {
        code: "template_author.defaults_invalid",
        message: "template provider defaults must select a provider id",
        path: `spec.defaults.${targetId}.${family}`,
        ...(packageId !== undefined ? { packageId } : {}),
        detail: { family, templateId },
      });
      continue;
    }
    const provider = providerIndex.get(providerId);
    if (provider === undefined) {
      pushDiagnostic(diagnostics, {
        code: "template_author.defaults_invalid",
        message: "template provider defaults must select a known provider id",
        path: `spec.defaults.${targetId}.${family}`,
        ...(packageId !== undefined ? { packageId } : {}),
        detail: { family, providerId, templateId },
      });
      continue;
    }
    const expectedFamily = RELATION_KEY_TO_FAMILY[part];
    if (expectedFamily !== undefined && provider.spec.family !== expectedFamily) {
      pushDiagnostic(diagnostics, {
        code: "template_author.defaults_invalid",
        message:
          "template provider defaults must select a provider from the matching capsule family",
        path: `spec.defaults.${targetId}.${family}`,
        ...(packageId !== undefined ? { packageId } : {}),
        family: provider.spec.family,
        detail: { expectedFamily, providerId, templateId },
      });
    }
  }
}

function validateTemplateCompatibility(
  diagnostics: AuthoringDiagnostic[],
  manifest: unknown,
  providerIndex: ReadonlyMap<string, ProviderManifest>,
  packageId: string | undefined,
): void {
  if (!isRecord(manifest) || !isRecord(manifest.spec)) {
    return;
  }
  if (
    !isRecord(manifest.spec.compatibility) ||
    Object.keys(manifest.spec.compatibility).length === 0
  ) {
    pushDiagnostic(diagnostics, {
      code: "template_author.compatibility_invalid",
      message: "TemplatePackage spec.compatibility must be a non-empty object",
      path: "spec.compatibility",
      ...(packageId !== undefined ? { packageId } : {}),
    });
  }
  const compatibility = isRecord(manifest.spec.compatibility) ? manifest.spec.compatibility : {};
  for (const key of Object.keys(compatibility)) {
    if (key !== "requiredParts") {
      pushDiagnostic(diagnostics, {
        code: "template_author.compatibility_invalid",
        message:
          "TemplatePackage spec.compatibility only supports requiredParts consumed by the provider graph",
        path: `spec.compatibility.${key}`,
        ...(packageId !== undefined ? { packageId } : {}),
      });
    }
  }
  const templates = Array.isArray(manifest.spec.templates) ? manifest.spec.templates : [];
  const openPartSet = new Set<string>();
  for (const [index, template] of templates.entries()) {
    if (!isRecord(template) || !isRecord(template.spec)) {
      continue;
    }
    const templatePath = `spec.templates.${index}`;
    const openParts = Array.isArray(template.spec.openParts)
      ? template.spec.openParts.filter((part): part is string => typeof part === "string")
      : [];
    for (const part of openParts) {
      openPartSet.add(part);
    }
    const compatibleProviders = isRecord(template.spec.compatibleProviders)
      ? template.spec.compatibleProviders
      : {};
    for (const part of openParts) {
      const compatible = compatibleProviders[part];
      if (!hasNonEmptyStringArray(compatible)) {
        pushDiagnostic(diagnostics, {
          code: "template_author.compatibility_invalid",
          message: "each open template part must declare compatible providers",
          path: `${templatePath}.spec.compatibleProviders.${part}`,
          ...(packageId !== undefined ? { packageId } : {}),
        });
        continue;
      }
      for (const providerId of compatible) {
        if (!providerIndex.has(providerId)) {
          pushDiagnostic(diagnostics, {
            code: "template_author.compatibility_invalid",
            message: "compatible provider must be a known provider id",
            path: `${templatePath}.spec.compatibleProviders.${part}`,
            ...(packageId !== undefined ? { packageId } : {}),
            detail: { providerId },
          });
        }
      }
    }
    for (const part of Object.keys(compatibleProviders)) {
      if (!openParts.includes(part)) {
        pushDiagnostic(diagnostics, {
          code: "template_author.compatibility_invalid",
          message: "compatibleProviders may only name open template parts",
          path: `${templatePath}.spec.compatibleProviders.${part}`,
          ...(packageId !== undefined ? { packageId } : {}),
        });
      }
    }
  }
  const requiredParts = compatibility.requiredParts;
  if (!hasNonEmptyStringArray(requiredParts)) {
    pushDiagnostic(diagnostics, {
      code: "template_author.compatibility_invalid",
      message:
        "TemplatePackage spec.compatibility.requiredParts must list open parts requiring explicit compatibility checks",
      path: "spec.compatibility.requiredParts",
      ...(packageId !== undefined ? { packageId } : {}),
    });
    return;
  }
  for (const part of requiredParts) {
    if (!openPartSet.has(part)) {
      pushDiagnostic(diagnostics, {
        code: "template_author.compatibility_invalid",
        message: "TemplatePackage compatibility requiredParts may only name open template parts",
        path: "spec.compatibility.requiredParts",
        ...(packageId !== undefined ? { packageId } : {}),
        detail: { part },
      });
    }
  }
}

/** Validate a TemplatePackage for the provider/template authoring UX before operator install/update. */
export function validateTemplatePackageAuthoring(
  input: TemplatePackageAuthoringInput,
): TemplatePackageAuthoringReport {
  const diagnostics: AuthoringDiagnostic[] = [];
  const packageId = templatePackageIdFromManifest(input.manifest);
  const providerIndex = providersById(input.providers);
  const templateIds = templateIdsFromManifest(input.manifest);
  const packageResult = validateTemplatePackageManifest(input.manifest);
  if (!packageResult.ok) {
    for (const diagnostic of packageResult.diagnostics) {
      const path = diagnostic.path ?? "";
      let code: TemplateAuthoringDiagnosticCode = "template_author.catalog_entity_invalid";
      if (diagnostic.code === "template_package.factory_forbidden") {
        code = "template_author.factory_forbidden";
      } else if (diagnostic.code === "template_package.schema_invalid") {
        if (path.startsWith("spec.defaults")) {
          code = "template_author.defaults_invalid";
        } else if (path.startsWith("spec.compatibility")) {
          code = "template_author.compatibility_invalid";
        } else if (path.startsWith("spec.skills") || path.startsWith("spec.docs")) {
          code = "template_author.skills_or_docs_missing";
        } else {
          code = "template_author.schema_invalid";
        }
      }
      pushDiagnostic(diagnostics, {
        code,
        message: diagnostic.message,
        ...(diagnostic.path !== undefined ? { path: diagnostic.path } : {}),
        ...(packageId !== undefined ? { packageId } : {}),
        ...(diagnostic.detail !== undefined ? { detail: diagnostic.detail } : {}),
      });
    }
  }
  if (isRecord(input.manifest) && isRecord(input.manifest.spec)) {
    validateTemplateDefaults(diagnostics, input.manifest, providerIndex, packageId);
    validateTemplateCompatibility(diagnostics, input.manifest, providerIndex, packageId);
  }
  if (
    isRecord(input.manifest) &&
    isRecord(input.manifest.spec) &&
    !(Array.isArray(input.manifest.spec.skills) && input.manifest.spec.skills.length > 0) &&
    !hasNonEmptyStringArray(input.manifest.spec.docs) &&
    !(Array.isArray(input.skills) && input.skills.length > 0) &&
    !hasNonEmptyStringArray(input.docs)
  ) {
    const hasTemplateSkills =
      Array.isArray(input.manifest.spec.templates) &&
      input.manifest.spec.templates.some(
        (template) =>
          isRecord(template) &&
          isRecord(template.spec) &&
          Array.isArray(template.spec.skills) &&
          template.spec.skills.length > 0,
      );
    if (!hasTemplateSkills) {
      pushDiagnostic(diagnostics, {
        code: "template_author.skills_or_docs_missing",
        message: "TemplatePackage must include skills or docs for the authoring UX",
        path: "spec.skills",
        ...(packageId !== undefined ? { packageId } : {}),
      });
    }
  }

  const requiredWpmSkeletons: AuthoringWpmSkeletonRequirement[] = [];
  if (
    isRecord(input.manifest) &&
    isRecord(input.manifest.spec) &&
    Array.isArray(input.manifest.spec.templates)
  ) {
    for (const [index, template] of input.manifest.spec.templates.entries()) {
      if (!isRecord(template) || !isRecord(template.spec)) {
        continue;
      }
      requiredWpmSkeletons.push(
        ...validateDependencyRequirements(
          diagnostics,
          {
            dependency: "template_author.dependency_invalid",
            wpm: "template_author.wpm_bundle_missing",
          },
          template.spec.requires,
          `spec.templates.${index}.spec.requires`,
          packageId,
          input.wpmBundles,
          input.wpmSkeletons,
        ),
      );
    }
  }
  scanRedactionViolations(
    diagnostics,
    "template_author.redaction_violation",
    input,
    "$",
    packageId,
  );
  validateChangedFiles(
    diagnostics,
    "template_author.narrow_waist_edit",
    input.changedFiles,
    packageId,
  );

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    readiness: {
      ...(packageId !== undefined ? { packageId } : {}),
      templateIds,
      requiredWpmSkeletons,
      availability: "not-evaluated",
      nextUx: "operator-install-update",
    },
  };
}

/** Produce a provider package skeleton that stays outside generic runtime/narrow-waist packages. */
export function createProviderPackageSkeleton(
  input: ProviderPackageSkeletonInput,
): ProviderPackageSkeleton {
  assertSafeAuthoringId(input.providerId, "provider id");
  const version = input.version ?? "0.1.0";
  const kind = input.kind ?? FAMILY_TO_KIND[input.family];
  const requires = [...(input.requires ?? [])];
  const manifest: ProviderManifest = {
    apiVersion: API_VERSION,
    kind,
    metadata: { name: input.providerId, version },
    spec: {
      family: input.family,
      capability: { summary: input.summary ?? `${input.providerId} ${input.family} provider` },
      config_schema: input.configSchema ?? EMPTY_CONFIG_SCHEMA,
      ...(input.factoryConfigSchema !== undefined
        ? { factory_config_schema: input.factoryConfigSchema }
        : {}),
      ...(requires.length > 0 ? { requires } : {}),
      probe: input.providerId,
      skills: [
        {
          id: `use-${input.providerId}`,
          for: input.providerId,
          body: `# use-${input.providerId}\n\nProvider authoring skeleton for ${input.providerId}.`,
        },
      ],
    },
  };
  const wpmSkeletons = requires
    .filter((requirement) => requirement.hostTouching === true)
    .map((requirement) => skeletonRequirementFromDependency(requirement));
  return {
    manifest,
    module: {
      providerId: input.providerId,
      family: input.family,
      registersFactory: true,
      registersProbe: true,
    },
    docs: [`adapters/${input.providerId}/README.md`],
    contractTests: [`adapters/${input.providerId}/test/contract/${input.providerId}.test.ts`],
    changedFiles: [
      `adapters/${input.providerId}/src/index.ts`,
      `adapters/${input.providerId}/test/contract/${input.providerId}.test.ts`,
      `adapters/${input.providerId}/README.md`,
      `packages/provider-set-${input.providerId}/src/index.ts`,
    ],
    wpmSkeletons,
  };
}

/** Produce a TemplatePackage skeleton that stays outside generic runtime/narrow-waist packages. */
export function createTemplatePackageSkeleton(
  input: TemplatePackageSkeletonInput,
): TemplatePackageSkeleton {
  assertSafeAuthoringId(input.packageId, "package id");
  assertSafeAuthoringId(input.templateId, "template id");
  const version = input.version ?? "0.1.0";
  const requires = [...(input.requires ?? [])];
  const compatibleProviders = input.compatibleProviders ?? {};
  const template: TemplateManifest = {
    apiVersion: API_VERSION,
    kind: "CapsuleTemplate",
    metadata: { name: input.templateId, version },
    spec: {
      family: "template",
      capability: { summary: input.summary ?? `${input.templateId} capsule template` },
      requiredParts: input.requiredParts,
      ...(requires.length > 0 ? { requires } : {}),
      ...(input.openParts !== undefined ? { openParts: [...input.openParts] } : {}),
      ...(Object.keys(compatibleProviders).length > 0 ? { compatibleProviders } : {}),
      openParams: input.openParams ?? EMPTY_CONFIG_SCHEMA,
      skills: [
        {
          id: input.templateId,
          for: input.templateId,
          body: `# ${input.templateId}\n\nTemplate package skeleton for ${input.templateId}.`,
        },
      ],
    },
  };
  const manifest: TemplatePackageManifest = {
    apiVersion: API_VERSION,
    kind: "TemplatePackage",
    metadata: { name: input.packageId, version },
    spec: {
      templates: [template],
      schema: input.openParams ?? EMPTY_CONFIG_SCHEMA,
      defaults: {
        ...(input.providerDefaults ?? {}),
        [`template.${input.templateId}`]: templateProviderDefaultsFromRequiredParts(
          input.requiredParts,
        ),
      },
      compatibility: { requiredParts: input.openParts ?? Object.keys(compatibleProviders) },
      docs: [`templates/${input.templateId}/README.md`],
      tests: [`templates/${input.templateId}/test/contract/${input.templateId}.test.ts`],
    },
  };
  const wpmSkeletons = requires
    .filter((requirement) => requirement.hostTouching === true)
    .map((requirement) => skeletonRequirementFromDependency(requirement));
  return {
    manifest,
    docs: [`templates/${input.templateId}/README.md`],
    changedFiles: [
      `templates/${input.templateId}/template-package.json`,
      `templates/${input.templateId}/test/contract/${input.templateId}.test.ts`,
      `templates/${input.templateId}/README.md`,
    ],
    wpmSkeletons,
  };
}

function templateProviderDefaultsFromRequiredParts(
  requiredParts: Record<string, string>,
): Record<string, ProviderProfileSelection> {
  const defaults: Record<string, ProviderProfileSelection> = {};
  for (const [part, providerId] of Object.entries(requiredParts)) {
    const family = TEMPLATE_PART_TO_DEFAULT_FAMILY[part];
    if (family !== undefined && providerId.length > 0) {
      defaults[family] = providerId;
    }
  }
  return defaults;
}
