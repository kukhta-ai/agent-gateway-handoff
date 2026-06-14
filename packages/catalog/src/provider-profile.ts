import { type ConfigSchema, validateConfig, validateSchemaShape } from "@gla/kernel";
import type {
  ProviderFamily,
  ProviderManifest,
  SkillManifest,
  TemplateManifest,
} from "./manifests.js";

/** Canonical profile family ids used by ProviderProfile and ProviderProfileOverlay manifests. */
export type ProviderProfileFamilyId =
  | "AuthProvider"
  | "Launcher"
  | "Workspace"
  | "HumanEntrypoint"
  | "AgentConnector"
  | "CompletionDetector"
  | "ChannelAdapter"
  | "SecretStore";

/** Runtime provider family selected by a canonical profile family id. */
export type RuntimeProfileProviderFamily = Exclude<ProviderFamily, "template">;

/** Stable canonical family id list for profile schema validation. */
export const PROVIDER_PROFILE_FAMILIES: readonly ProviderProfileFamilyId[] = [
  "AuthProvider",
  "Launcher",
  "Workspace",
  "HumanEntrypoint",
  "AgentConnector",
  "CompletionDetector",
  "ChannelAdapter",
  "SecretStore",
];

/** Mapping from profile-facing family ids to catalog/provider-host runtime families. */
export const PROVIDER_PROFILE_FAMILY_TO_RUNTIME_FAMILY: Record<
  ProviderProfileFamilyId,
  RuntimeProfileProviderFamily
> = {
  AuthProvider: "auth",
  Launcher: "launcher",
  Workspace: "workspace",
  HumanEntrypoint: "entrypoint",
  AgentConnector: "connector",
  CompletionDetector: "detector",
  ChannelAdapter: "channel",
  SecretStore: "secret-store",
};

/** Boot-time lifecycle contract for provider profiles and overlays. */
export interface ProviderProfileLifecycle {
  /** Profiles are operator install/update artifacts. */
  owner?: "operator";
  /** Profile changes apply at daemon boot after validation. */
  apply?: "boot";
  /** Hot reload is intentionally not supported by this contract. */
  hotReload?: false;
}

/** Singleton provider selection value inside a profile or overlay. */
export type ProviderProfileSelection =
  | string
  | null
  | {
      /** Selected provider id. */
      providerId?: string;
      /** Explicit disabled selection; accepted only for family contracts that allow absence. */
      disabled?: true;
    };

/** Base profile manifest selected by a trusted provider set or operator config source. */
export interface ProviderProfileManifest {
  apiVersion: "gla.dev/v1";
  kind: "ProviderProfile";
  metadata: { name: string; version?: string };
  spec: {
    /** Optional base profile id. Inheritance must be acyclic. */
    extends?: string;
    /** Canonical family id to selected provider id. */
    select?: Partial<Record<ProviderProfileFamilyId, ProviderProfileSelection>>;
    /** Provider-owned config keyed by provider id. */
    config?: Record<string, Record<string, unknown>>;
    /** Template/provider defaults keyed by catalog target id. */
    defaults?: Record<string, Record<string, ProviderProfileSelection>>;
    /** Operator-owned boot-time lifecycle declaration. */
    lifecycle?: ProviderProfileLifecycle;
  };
}

/** Operator-approved profile overlay manifest layered during install/update. */
export interface ProviderProfileOverlayManifest {
  apiVersion: "gla.dev/v1";
  kind: "ProviderProfileOverlay";
  metadata: { name: string; version?: string };
  spec: {
    /** Base profile or overlay id. Inheritance must be acyclic. */
    extends?: string;
    /** Canonical family id to selected provider id replacement. */
    select?: Partial<Record<ProviderProfileFamilyId, ProviderProfileSelection>>;
    /** Provider-owned config keyed by provider id. */
    config?: Record<string, Record<string, unknown>>;
    /** Template/provider defaults keyed by catalog target id. */
    defaults?: Record<string, Record<string, ProviderProfileSelection>>;
    /** Operator-owned boot-time lifecycle declaration. */
    lifecycle?: ProviderProfileLifecycle;
  };
}

/** Catalog package for CapsuleTemplate entities; it is not a Provider Host runtime factory. */
export interface TemplatePackageManifest {
  apiVersion: "gla.dev/v1";
  kind: "TemplatePackage";
  metadata: { name: string; version: string };
  spec: {
    /** CapsuleTemplate catalog manifests shipped by this package. */
    templates: TemplateManifest[];
    /** Package-level schema for author/operator inputs; template openParams may provide the runtime schema. */
    schema?: ConfigSchema;
    /** Package-owned defaults keyed by template or provider id. */
    defaults: Record<string, unknown>;
    /** Compatibility requirements supplied by the package author. */
    compatibility: Record<string, unknown>;
    /** Skills indexed by catalog, if docs are not the primary instruction surface. */
    skills?: SkillManifest[];
    /** Documentation references shipped with the package. */
    docs?: string[];
    /** Contract or acceptance test refs proving the package behavior. */
    tests: string[];
  };
}

/** Stable machine-readable diagnostic codes for profile and template-package validation. */
export type ProviderProfileDiagnosticCode =
  | "profile.schema_invalid"
  | "profile.unknown_family"
  | "profile.unknown_provider"
  | "profile.family_mismatch"
  | "profile.inheritance_cycle"
  | "profile.extends_unknown"
  | "profile.duplicate_singleton"
  | "profile.unresolved_config_ref"
  | "profile.literal_secret"
  | "profile.disabled_forbidden"
  | "profile.config_invalid"
  | "profile.lifecycle_invalid"
  | "template_package.schema_invalid"
  | "template_package.template_invalid"
  | "template_package.factory_forbidden";

/** Redacted profile/template-package validation diagnostic safe for operator-facing surfaces. */
export interface ProviderProfileDiagnostic {
  code: ProviderProfileDiagnosticCode;
  message: string;
  path?: string;
  profile?: string;
  providerId?: string;
  family?: string;
  detail?: Record<string, unknown>;
}

/** Result returned by provider-profile and template-package validators. */
export type ProviderProfileValidationResult =
  | { ok: true; diagnostics: [] }
  | { ok: false; diagnostics: ProviderProfileDiagnostic[] };

/** Input set for validating profile and overlay manifests against an installed provider set. */
export interface ValidateProviderProfileInputs {
  profiles?: readonly unknown[];
  overlays?: readonly unknown[];
  providers?: readonly ProviderManifest[] | Record<string, ProviderManifest>;
  templatePackages?: readonly unknown[];
  /**
   * Families that may not be disabled/null-selected. Defaults to every current profile family,
   * because no current family contract declares absence as valid product behavior.
   */
  securityCriticalFamilies?: readonly ProviderProfileFamilyId[];
}

type ProfileKind = "ProviderProfile" | "ProviderProfileOverlay";

interface ProfileDocRecord {
  name: string;
  kind: ProfileKind;
  spec: Record<string, unknown>;
}

const API_VERSION = "gla.dev/v1";
const FAMILY_SET = new Set<string>(PROVIDER_PROFILE_FAMILIES);
const SECRET_KEY_RE = /(secret|token|password|credential|private[_-]?key)/i;
const PROFILE_TOP_LEVEL_KEYS = new Set(["apiVersion", "kind", "metadata", "spec"]);
const PROFILE_METADATA_KEYS = new Set(["name", "version"]);
const PROFILE_SPEC_KEYS = new Set(["extends", "select", "config", "defaults", "lifecycle"]);
const PROFILE_LIFECYCLE_KEYS = new Set(["owner", "apply", "hotReload"]);
const PROFILE_SELECTION_KEYS = new Set(["providerId", "disabled"]);
const TEMPLATE_PACKAGE_TOP_LEVEL_KEYS = new Set(["apiVersion", "kind", "metadata", "spec"]);
const TEMPLATE_PACKAGE_METADATA_KEYS = new Set(["name", "version"]);
const TEMPLATE_PACKAGE_SPEC_KEYS = new Set([
  "templates",
  "schema",
  "defaults",
  "compatibility",
  "skills",
  "docs",
  "tests",
]);
const TEMPLATE_MANIFEST_TOP_LEVEL_KEYS = new Set(["apiVersion", "kind", "metadata", "spec"]);
const TEMPLATE_MANIFEST_SPEC_KEYS = new Set([
  "family",
  "capability",
  "requiredParts",
  "requires",
  "openParts",
  "compatibleProviders",
  "openParams",
  "probe",
  "skills",
]);
const FORBIDDEN_TEMPLATE_FACTORY_KEYS = new Set([
  "factory",
  "runtimeFactory",
  "providerHostFactory",
  "module",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function addDiagnostic(
  diagnostics: ProviderProfileDiagnostic[],
  diagnostic: ProviderProfileDiagnostic,
): void {
  diagnostics.push(diagnostic);
}

function rejectUnknownKeys(
  diagnostics: ProviderProfileDiagnostic[],
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  profile?: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addDiagnostic(diagnostics, {
        code: "profile.schema_invalid",
        message: `unknown key "${key}" is not allowed at ${path}`,
        path: `${path}.${key}`,
        ...(profile !== undefined ? { profile } : {}),
      });
    }
  }
}

function rejectUnknownTemplatePackageKeys(
  diagnostics: ProviderProfileDiagnostic[],
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addDiagnostic(diagnostics, {
        code: "template_package.schema_invalid",
        message: `unknown key "${key}" is not allowed at ${path}`,
        path: `${path}.${key}`,
      });
    }
  }
}

function indexProviders(
  providers: ValidateProviderProfileInputs["providers"],
): Map<string, ProviderManifest> {
  if (providers === undefined) {
    return new Map();
  }
  if (Array.isArray(providers)) {
    return new Map(providers.map((provider) => [provider.metadata.name, provider]));
  }
  return new Map(Object.entries(providers));
}

function selectionProviderId(selection: unknown): string | undefined {
  if (typeof selection === "string") {
    return selection.length > 0 ? selection : undefined;
  }
  if (isRecord(selection) && typeof selection.providerId === "string") {
    return selection.providerId.length > 0 ? selection.providerId : undefined;
  }
  return undefined;
}

function selectionIsDisabled(selection: unknown): boolean {
  if (selection === null) {
    return true;
  }
  return isRecord(selection) && selection.disabled === true;
}

function validateProfileLifecycle(
  diagnostics: ProviderProfileDiagnostic[],
  lifecycle: unknown,
  profile: string,
): void {
  if (lifecycle === undefined) {
    return;
  }
  if (!isRecord(lifecycle)) {
    addDiagnostic(diagnostics, {
      code: "profile.lifecycle_invalid",
      message: "provider profiles are operator-owned boot-time artifacts",
      path: "spec.lifecycle",
      profile,
    });
    return;
  }
  rejectUnknownKeys(diagnostics, lifecycle, PROFILE_LIFECYCLE_KEYS, "spec.lifecycle", profile);
  if (lifecycle.owner !== undefined && lifecycle.owner !== "operator") {
    addDiagnostic(diagnostics, {
      code: "profile.lifecycle_invalid",
      message: "provider profile lifecycle owner must be operator",
      path: "spec.lifecycle.owner",
      profile,
    });
  }
  if (lifecycle.apply !== undefined && lifecycle.apply !== "boot") {
    addDiagnostic(diagnostics, {
      code: "profile.lifecycle_invalid",
      message: "profile changes apply only during operator install/update followed by daemon boot",
      path: "spec.lifecycle.apply",
      profile,
    });
  }
  if (lifecycle.hotReload === true) {
    addDiagnostic(diagnostics, {
      code: "profile.lifecycle_invalid",
      message: "profile hot reload is not supported; apply profile changes by validated restart",
      path: "spec.lifecycle.hotReload",
      profile,
    });
  }
}

function validateProviderSelection(
  diagnostics: ProviderProfileDiagnostic[],
  family: string,
  selection: unknown,
  profile: string,
  providers: ReadonlyMap<string, ProviderManifest>,
  securityCriticalFamilies: ReadonlySet<string>,
  pathPrefix = "spec.select",
): void {
  if (!FAMILY_SET.has(family)) {
    addDiagnostic(diagnostics, {
      code: "profile.unknown_family",
      message: `unknown provider profile family "${family}"`,
      path: `${pathPrefix}.${family}`,
      profile,
      family,
    });
    return;
  }
  if (Array.isArray(selection)) {
    addDiagnostic(diagnostics, {
      code: "profile.duplicate_singleton",
      message: `family "${family}" is singleton and cannot select multiple providers`,
      path: `${pathPrefix}.${family}`,
      profile,
      family,
    });
    return;
  }
  if (isRecord(selection)) {
    rejectUnknownKeys(
      diagnostics,
      selection,
      PROFILE_SELECTION_KEYS,
      `${pathPrefix}.${family}`,
      profile,
    );
  }
  if (selectionIsDisabled(selection)) {
    if (securityCriticalFamilies.has(family)) {
      addDiagnostic(diagnostics, {
        code: "profile.disabled_forbidden",
        message: `family "${family}" cannot be disabled by the current family contract`,
        path: `${pathPrefix}.${family}`,
        profile,
        family,
      });
    }
    return;
  }

  const providerId = selectionProviderId(selection);
  if (providerId === undefined) {
    addDiagnostic(diagnostics, {
      code: "profile.schema_invalid",
      message: `selection for family "${family}" must be a provider id or disabled/null marker`,
      path: `${pathPrefix}.${family}`,
      profile,
      family,
    });
    return;
  }
  const manifest = providers.get(providerId);
  if (manifest === undefined) {
    addDiagnostic(diagnostics, {
      code: "profile.unknown_provider",
      message: `provider "${providerId}" is not registered in the selected provider set`,
      path: `${pathPrefix}.${family}`,
      profile,
      providerId,
      family,
    });
    return;
  }
  const expectedFamily =
    PROVIDER_PROFILE_FAMILY_TO_RUNTIME_FAMILY[family as ProviderProfileFamilyId];
  if (manifest.spec.family !== expectedFamily) {
    addDiagnostic(diagnostics, {
      code: "profile.family_mismatch",
      message: `provider "${providerId}" is ${manifest.spec.family}, not ${expectedFamily}`,
      path: `${pathPrefix}.${family}`,
      profile,
      providerId,
      family,
      detail: { actualFamily: manifest.spec.family, expectedFamily },
    });
  }
}

function validateProfileDefaults(
  diagnostics: ProviderProfileDiagnostic[],
  defaults: unknown,
  profile: string,
  providers: ReadonlyMap<string, ProviderManifest>,
  securityCriticalFamilies: ReadonlySet<string>,
): void {
  if (defaults === undefined) {
    return;
  }
  if (!isRecord(defaults)) {
    addDiagnostic(diagnostics, {
      code: "profile.schema_invalid",
      message: "spec.defaults must be an object keyed by template or provider id",
      path: "spec.defaults",
      profile,
    });
    return;
  }
  for (const [targetId, selections] of Object.entries(defaults)) {
    const targetPath = `spec.defaults.${targetId}`;
    if (!isRecord(selections)) {
      addDiagnostic(diagnostics, {
        code: "profile.schema_invalid",
        message: `defaults for "${targetId}" must be an object keyed by canonical family id`,
        path: targetPath,
        profile,
      });
      continue;
    }
    for (const [family, selection] of Object.entries(selections)) {
      validateProviderSelection(
        diagnostics,
        family,
        selection,
        profile,
        providers,
        securityCriticalFamilies,
        targetPath,
      );
    }
  }
}

function validateSecrets(
  diagnostics: ProviderProfileDiagnostic[],
  value: unknown,
  path: string,
  profile: string,
  secretContext = false,
): void {
  if (typeof value === "string") {
    if (secretContext || value.startsWith("secret:")) {
      addDiagnostic(diagnostics, {
        code: "profile.literal_secret",
        message: "literal or ad-hoc secret values are not allowed; use { secretRef }",
        path,
        profile,
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, nested] of value.entries()) {
      validateSecrets(diagnostics, nested, `${path}.${index}`, profile, secretContext);
    }
    return;
  }
  if (!isRecord(value)) {
    if (secretContext) {
      addDiagnostic(diagnostics, {
        code: "profile.literal_secret",
        message: "literal secret values are not allowed; use { secretRef }",
        path,
        profile,
      });
    }
    return;
  }
  if (
    Object.keys(value).length === 1 &&
    typeof value.secretRef === "string" &&
    value.secretRef.length > 0
  ) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    const nestedIsSecret = secretContext || SECRET_KEY_RE.test(key);
    if (
      nestedIsSecret &&
      isRecord(nested) &&
      Object.keys(nested).length === 1 &&
      typeof nested.secretRef === "string" &&
      nested.secretRef.length > 0
    ) {
      continue;
    }
    validateSecrets(diagnostics, nested, nestedPath, profile, nestedIsSecret);
  }
}

function validateProfileConfig(
  diagnostics: ProviderProfileDiagnostic[],
  config: unknown,
  profile: string,
  providers: ReadonlyMap<string, ProviderManifest>,
): void {
  if (config === undefined) {
    return;
  }
  if (!isRecord(config)) {
    addDiagnostic(diagnostics, {
      code: "profile.schema_invalid",
      message: "spec.config must be an object keyed by provider id",
      path: "spec.config",
      profile,
    });
    return;
  }
  for (const [providerId, providerConfig] of Object.entries(config)) {
    if (!isRecord(providerConfig)) {
      addDiagnostic(diagnostics, {
        code: "profile.schema_invalid",
        message: `config for provider "${providerId}" must be an object`,
        path: `spec.config.${providerId}`,
        profile,
        providerId,
      });
      continue;
    }
    validateSecrets(diagnostics, providerConfig, `spec.config.${providerId}`, profile);
    const provider = providers.get(providerId);
    if (provider === undefined) {
      addDiagnostic(diagnostics, {
        code: "profile.unresolved_config_ref",
        message: `config references unknown provider "${providerId}"`,
        path: `spec.config.${providerId}`,
        profile,
        providerId,
      });
      continue;
    }
    if (provider.spec.config_schema !== undefined) {
      const validation = validateConfig(provider.spec.config_schema, providerConfig);
      if (!validation.ok) {
        addDiagnostic(diagnostics, {
          code: "profile.config_invalid",
          message: `config for provider "${providerId}" does not match its config_schema`,
          path: `spec.config.${providerId}`,
          profile,
          providerId,
          detail: { defects: validation.defects },
        });
      }
    }
  }
}

function parseProfileDoc(
  diagnostics: ProviderProfileDiagnostic[],
  input: unknown,
  expectedKind: ProfileKind,
): ProfileDocRecord | undefined {
  if (!isRecord(input)) {
    addDiagnostic(diagnostics, {
      code: "profile.schema_invalid",
      message: `${expectedKind} must be an object`,
    });
    return undefined;
  }
  rejectUnknownKeys(diagnostics, input, PROFILE_TOP_LEVEL_KEYS, "$");
  if (input.apiVersion !== API_VERSION) {
    addDiagnostic(diagnostics, {
      code: "profile.schema_invalid",
      message: `${expectedKind} apiVersion must be ${API_VERSION}`,
      path: "apiVersion",
    });
  }
  if (input.kind !== expectedKind) {
    addDiagnostic(diagnostics, {
      code: "profile.schema_invalid",
      message: `manifest kind must be ${expectedKind}`,
      path: "kind",
    });
  }
  if (!isRecord(input.metadata)) {
    addDiagnostic(diagnostics, {
      code: "profile.schema_invalid",
      message: `${expectedKind} metadata must be an object`,
      path: "metadata",
    });
    return undefined;
  }
  rejectUnknownKeys(diagnostics, input.metadata, PROFILE_METADATA_KEYS, "metadata");
  if (!hasText(input.metadata.name)) {
    addDiagnostic(diagnostics, {
      code: "profile.schema_invalid",
      message: `${expectedKind} metadata.name must be a non-empty string`,
      path: "metadata.name",
    });
    return undefined;
  }
  const profile = input.metadata.name;
  if (!isRecord(input.spec)) {
    addDiagnostic(diagnostics, {
      code: "profile.schema_invalid",
      message: `${expectedKind} spec must be an object`,
      path: "spec",
      profile,
    });
    return undefined;
  }
  rejectUnknownKeys(diagnostics, input.spec, PROFILE_SPEC_KEYS, "spec", profile);
  return { name: profile, kind: expectedKind, spec: input.spec };
}

function validateProfileDoc(
  diagnostics: ProviderProfileDiagnostic[],
  doc: ProfileDocRecord,
  providers: ReadonlyMap<string, ProviderManifest>,
  securityCriticalFamilies: ReadonlySet<string>,
): void {
  const { name, spec } = doc;
  if (spec.extends !== undefined && !hasText(spec.extends)) {
    addDiagnostic(diagnostics, {
      code: "profile.schema_invalid",
      message: "spec.extends must be a non-empty profile id when present",
      path: "spec.extends",
      profile: name,
    });
  }
  validateProfileLifecycle(diagnostics, spec.lifecycle, name);
  if (spec.select !== undefined) {
    if (!isRecord(spec.select)) {
      addDiagnostic(diagnostics, {
        code: "profile.schema_invalid",
        message: "spec.select must be an object keyed by canonical family id",
        path: "spec.select",
        profile: name,
      });
    } else {
      for (const [family, selection] of Object.entries(spec.select)) {
        validateProviderSelection(
          diagnostics,
          family,
          selection,
          name,
          providers,
          securityCriticalFamilies,
        );
      }
    }
  }
  validateProfileConfig(diagnostics, spec.config, name, providers);
  validateProfileDefaults(diagnostics, spec.defaults, name, providers, securityCriticalFamilies);
}

function validateInheritance(
  diagnostics: ProviderProfileDiagnostic[],
  docs: readonly ProfileDocRecord[],
): void {
  const byName = new Map(docs.map((doc) => [doc.name, doc]));
  for (const doc of docs) {
    if (
      doc.spec.extends !== undefined &&
      hasText(doc.spec.extends) &&
      !byName.has(doc.spec.extends)
    ) {
      addDiagnostic(diagnostics, {
        code: "profile.extends_unknown",
        message: `profile "${doc.name}" extends unknown profile "${doc.spec.extends}"`,
        path: "spec.extends",
        profile: doc.name,
      });
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (doc: ProfileDocRecord, path: string[]): void => {
    if (visited.has(doc.name)) {
      return;
    }
    if (visiting.has(doc.name)) {
      const cycleStart = path.indexOf(doc.name);
      const cycle = [...path.slice(cycleStart >= 0 ? cycleStart : 0), doc.name];
      addDiagnostic(diagnostics, {
        code: "profile.inheritance_cycle",
        message: `profile inheritance cycle detected: ${cycle.join(" -> ")}`,
        path: "spec.extends",
        profile: doc.name,
        detail: { cycle },
      });
      return;
    }
    visiting.add(doc.name);
    const baseName = doc.spec.extends;
    if (hasText(baseName)) {
      const base = byName.get(baseName);
      if (base !== undefined) {
        visit(base, [...path, doc.name]);
      }
    }
    visiting.delete(doc.name);
    visited.add(doc.name);
  };

  for (const doc of docs) {
    visit(doc, []);
  }
}

function hasForbiddenTemplateFactoryKey(value: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_TEMPLATE_FACTORY_KEYS.has(key)) {
      return key;
    }
  }
  return undefined;
}

function rejectForbiddenTemplateFactoryKeys(
  diagnostics: ProviderProfileDiagnostic[],
  value: Record<string, unknown>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_TEMPLATE_FACTORY_KEYS.has(key)) {
      addDiagnostic(diagnostics, {
        code: "template_package.factory_forbidden",
        message: "TemplatePackage must not declare a Provider Host runtime factory",
        path: path === "$" ? key : `${path}.${key}`,
        detail: { key },
      });
    }
  }
}

function hasNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => hasText(item));
}

function validateTemplateManifestShape(
  diagnostics: ProviderProfileDiagnostic[],
  template: unknown,
  path: string,
): boolean {
  if (!isRecord(template)) {
    addDiagnostic(diagnostics, {
      code: "template_package.template_invalid",
      message: "template entry must be an object",
      path,
    });
    return false;
  }
  rejectUnknownTemplatePackageKeys(diagnostics, template, TEMPLATE_MANIFEST_TOP_LEVEL_KEYS, path);
  rejectForbiddenTemplateFactoryKeys(diagnostics, template, path);
  if (template.apiVersion !== API_VERSION || template.kind !== "CapsuleTemplate") {
    addDiagnostic(diagnostics, {
      code: "template_package.template_invalid",
      message: "template package entries must be CapsuleTemplate manifests",
      path,
    });
    return false;
  }
  if (!isRecord(template.metadata) || !hasText(template.metadata.name)) {
    addDiagnostic(diagnostics, {
      code: "template_package.template_invalid",
      message: "CapsuleTemplate metadata.name must be a non-empty string",
      path: `${path}.metadata.name`,
    });
    return false;
  }
  if (!isRecord(template.spec) || template.spec.family !== "template") {
    addDiagnostic(diagnostics, {
      code: "template_package.template_invalid",
      message: "CapsuleTemplate spec.family must be template",
      path: `${path}.spec.family`,
    });
    return false;
  }
  rejectUnknownTemplatePackageKeys(
    diagnostics,
    template.spec,
    TEMPLATE_MANIFEST_SPEC_KEYS,
    `${path}.spec`,
  );
  rejectForbiddenTemplateFactoryKeys(diagnostics, template.spec, `${path}.spec`);
  if (
    !isRecord(template.spec.requiredParts) ||
    Object.keys(template.spec.requiredParts).length === 0
  ) {
    addDiagnostic(diagnostics, {
      code: "template_package.template_invalid",
      message: "CapsuleTemplate must declare requiredParts",
      path: `${path}.spec.requiredParts`,
    });
  }
  if (template.spec.openParams !== undefined) {
    const schemaValidation = validateSchemaShape(template.spec.openParams as ConfigSchema);
    if (!schemaValidation.ok) {
      addDiagnostic(diagnostics, {
        code: "template_package.schema_invalid",
        message: "CapsuleTemplate openParams schema is invalid",
        path: `${path}.spec.openParams`,
        detail: { defects: schemaValidation.defects },
      });
    }
  }
  return true;
}

/** Validate one CapsuleTemplate catalog package manifest. */
export function validateTemplatePackageManifest(input: unknown): ProviderProfileValidationResult {
  const diagnostics: ProviderProfileDiagnostic[] = [];
  if (!isRecord(input)) {
    addDiagnostic(diagnostics, {
      code: "template_package.schema_invalid",
      message: "TemplatePackage must be an object",
    });
    return { ok: false, diagnostics };
  }
  const topForbidden = hasForbiddenTemplateFactoryKey(input);
  if (topForbidden !== undefined) {
    addDiagnostic(diagnostics, {
      code: "template_package.factory_forbidden",
      message: "TemplatePackage must not declare a Provider Host runtime factory",
      path: topForbidden,
      detail: { key: topForbidden },
    });
  }
  rejectUnknownTemplatePackageKeys(diagnostics, input, TEMPLATE_PACKAGE_TOP_LEVEL_KEYS, "$");
  if (input.apiVersion !== API_VERSION || input.kind !== "TemplatePackage") {
    addDiagnostic(diagnostics, {
      code: "template_package.schema_invalid",
      message: `TemplatePackage apiVersion/kind must be ${API_VERSION} TemplatePackage`,
    });
  }
  if (
    !isRecord(input.metadata) ||
    !hasText(input.metadata.name) ||
    !hasText(input.metadata.version)
  ) {
    addDiagnostic(diagnostics, {
      code: "template_package.schema_invalid",
      message: "TemplatePackage metadata.name and metadata.version are required",
      path: "metadata",
    });
  } else {
    rejectUnknownTemplatePackageKeys(
      diagnostics,
      input.metadata,
      TEMPLATE_PACKAGE_METADATA_KEYS,
      "metadata",
    );
  }
  if (!isRecord(input.spec)) {
    addDiagnostic(diagnostics, {
      code: "template_package.schema_invalid",
      message: "TemplatePackage spec must be an object",
      path: "spec",
    });
    return diagnostics.length === 0 ? { ok: true, diagnostics: [] } : { ok: false, diagnostics };
  }
  const specForbidden = hasForbiddenTemplateFactoryKey(input.spec);
  if (specForbidden !== undefined) {
    addDiagnostic(diagnostics, {
      code: "template_package.factory_forbidden",
      message: "TemplatePackage must not declare a Provider Host runtime factory",
      path: `spec.${specForbidden}`,
      detail: { key: specForbidden },
    });
  }
  rejectUnknownTemplatePackageKeys(diagnostics, input.spec, TEMPLATE_PACKAGE_SPEC_KEYS, "spec");

  const templates = input.spec.templates;
  let hasTemplateSchema = false;
  if (!Array.isArray(templates) || templates.length === 0) {
    addDiagnostic(diagnostics, {
      code: "template_package.template_invalid",
      message: "TemplatePackage spec.templates must contain at least one CapsuleTemplate",
      path: "spec.templates",
    });
  } else {
    for (const [index, template] of templates.entries()) {
      if (isRecord(template) && isRecord(template.spec) && template.spec.openParams !== undefined) {
        hasTemplateSchema = true;
      }
      validateTemplateManifestShape(diagnostics, template, `spec.templates.${index}`);
    }
  }

  if (input.spec.schema !== undefined) {
    if (!isRecord(input.spec.schema)) {
      addDiagnostic(diagnostics, {
        code: "template_package.schema_invalid",
        message: "TemplatePackage spec.schema must be a config schema object",
        path: "spec.schema",
      });
    } else {
      const schemaValidation = validateSchemaShape(input.spec.schema as ConfigSchema);
      if (!schemaValidation.ok) {
        addDiagnostic(diagnostics, {
          code: "template_package.schema_invalid",
          message: "TemplatePackage spec.schema is invalid",
          path: "spec.schema",
          detail: { defects: schemaValidation.defects },
        });
      }
    }
  } else if (!hasTemplateSchema) {
    addDiagnostic(diagnostics, {
      code: "template_package.schema_invalid",
      message: "TemplatePackage must expose package schema or template openParams schema",
      path: "spec.schema",
    });
  }
  if (!isRecord(input.spec.defaults)) {
    addDiagnostic(diagnostics, {
      code: "template_package.schema_invalid",
      message: "TemplatePackage spec.defaults must be an object",
      path: "spec.defaults",
    });
  }
  if (!isRecord(input.spec.compatibility)) {
    addDiagnostic(diagnostics, {
      code: "template_package.schema_invalid",
      message: "TemplatePackage spec.compatibility must be an object",
      path: "spec.compatibility",
    });
  }
  const packageSkills = input.spec.skills;
  const packageDocs = input.spec.docs;
  const templateSkills =
    Array.isArray(templates) &&
    templates.some(
      (template) =>
        isRecord(template) &&
        isRecord(template.spec) &&
        Array.isArray(template.spec.skills) &&
        template.spec.skills.length > 0,
    );
  if (
    !templateSkills &&
    !(Array.isArray(packageSkills) && packageSkills.length > 0) &&
    !hasNonEmptyStringArray(packageDocs)
  ) {
    addDiagnostic(diagnostics, {
      code: "template_package.schema_invalid",
      message: "TemplatePackage must include skills or docs",
      path: "spec.skills",
    });
  }
  if (!hasNonEmptyStringArray(input.spec.tests)) {
    addDiagnostic(diagnostics, {
      code: "template_package.schema_invalid",
      message: "TemplatePackage spec.tests must list package tests",
      path: "spec.tests",
    });
  }

  return diagnostics.length === 0 ? { ok: true, diagnostics: [] } : { ok: false, diagnostics };
}

/** Validate ProviderProfile, ProviderProfileOverlay, and TemplatePackage inputs in one pass. */
export function validateProviderProfileInputs(
  input: ValidateProviderProfileInputs,
): ProviderProfileValidationResult {
  const diagnostics: ProviderProfileDiagnostic[] = [];
  const providers = indexProviders(input.providers);
  const securityCriticalFamilies = new Set(
    input.securityCriticalFamilies ?? PROVIDER_PROFILE_FAMILIES,
  );
  const profileDocs = [
    ...(input.profiles ?? []).flatMap((profile) => {
      const parsed = parseProfileDoc(diagnostics, profile, "ProviderProfile");
      return parsed === undefined ? [] : [parsed];
    }),
    ...(input.overlays ?? []).flatMap((overlay) => {
      const parsed = parseProfileDoc(diagnostics, overlay, "ProviderProfileOverlay");
      return parsed === undefined ? [] : [parsed];
    }),
  ];

  for (const doc of profileDocs) {
    validateProfileDoc(diagnostics, doc, providers, securityCriticalFamilies);
  }
  validateInheritance(diagnostics, profileDocs);
  for (const templatePackage of input.templatePackages ?? []) {
    const result = validateTemplatePackageManifest(templatePackage);
    if (!result.ok) {
      diagnostics.push(...result.diagnostics);
    }
  }

  return diagnostics.length === 0 ? { ok: true, diagnostics: [] } : { ok: false, diagnostics };
}
