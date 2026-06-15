// @gla/provider-set-reference — trusted reference provider set.
// This package is allowed to import today's concrete adapters because it is a selected provider set,
// not the neutral host and not narrow-waist core. App migration later imports this set as one opaque list.

import { randomUUID } from "node:crypto";
import {
  AUTH_AUTHENTIK_MODULE,
  AuthAuthentikProvider,
  type BoundSubject,
  type PendingAttempt,
} from "@gla/auth-authentik";
import {
  AUTH_WEBAUTHN_MODULE,
  AuthWebauthnProvider,
  type PendingChallenge,
  type StoredCredential,
} from "@gla/auth-webauthn";
import {
  BROWSER_HANDOFF_TEMPLATE,
  CHANNEL_CLI_MANIFEST,
  PROVIDER_MANIFESTS,
  type ProviderManifest,
  type ProviderProfileManifest,
  type ProviderProfileSelection,
  type StoreContent,
} from "@gla/catalog";
import {
  CHANNEL_CLI_MODULE,
  ChannelCli,
  type DeliverySink,
  type InboundSource,
  deliveryToStdout,
} from "@gla/channel-cli";
import { CONNECTOR_CDP_MODULE, ConnectorCdpAdapter } from "@gla/connector-cdp";
import {
  DETECTOR_URL_MODULE,
  DetectorUrlAdapter,
  type DetectorUrlOptions,
} from "@gla/detector-url";
import {
  ENTRYPOINT_NOVNC_MODULE,
  type EntrypointClientAssetMount,
  EntrypointNovncAdapter,
  NOVNC_CLIENT_ASSET_REF,
  novncClientAssetMounts,
} from "@gla/entrypoint-novnc";
import type {
  AuthProviderPort,
  ChannelPort,
  CompletionDetectorPort,
  ConfigSchema,
  HumanEntrypointPort,
  IdentityPort,
  InjectionTarget,
  LauncherPort,
  RawCompletionSignal,
  Ref,
  RuntimeHandle,
  SecretStorePort,
  SecretValue,
  WorkspacePort,
} from "@gla/kernel";
import { EMPTY_CONFIG_SCHEMA } from "@gla/kernel";
import { LAUNCHER_PROCESS_MODULE, LauncherProcessAdapter } from "@gla/launcher-process";
import { ProviderHost } from "@gla/provider-host";
import type {
  CreateProviderOptions,
  GlaProviderModule,
  ProviderCreateContext,
  ProviderHostOptions,
  ProviderId,
  ProviderKvStore,
  ProviderRegistrationContext,
  ProviderStateRoot,
} from "@gla/provider-host";
import { WORKSPACE_PROFILE_MODULE, WorkspaceProfileAdapter } from "@gla/workspace-profile";

/** Stable package-identity marker. */
export const PROVIDER_SET_REFERENCE_MODULE = "@gla/provider-set-reference" as const;
/** Provider id for the in-tree WebAuthn auth provider. */
export const AUTH_WEBAUTHN_PROVIDER_ID = "webauthn" as const;
/** Provider id for the delegated authentik auth provider. */
export const AUTH_AUTHENTIK_PROVIDER_ID = "authentik" as const;
/** Provider id for the reference local-process launcher. */
export const LAUNCHER_PROCESS_PROVIDER_ID = "launcher-process" as const;
/** Provider id for the reference ephemeral browser-profile workspace. */
export const WORKSPACE_PROFILE_PROVIDER_ID = "workspace-profile" as const;
/** Provider id for the reference noVNC human entrypoint. */
export const ENTRYPOINT_NOVNC_PROVIDER_ID = "entrypoint-novnc" as const;
/** Provider id for the reference CDP agent connector. */
export const CONNECTOR_CDP_PROVIDER_ID = "connector-cdp" as const;
/** Provider id for the reference URL watcher completion detector. */
export const DETECTOR_URL_PROVIDER_ID = "url-watcher" as const;
/** Provider id for the reference explicit user-done completion detector. */
export const DETECTOR_USER_DONE_PROVIDER_ID = "user-done" as const;
/** Provider id for the reference in-tree SecretStore provider. */
export const SECRET_STORE_REFERENCE_PROVIDER_ID = "secret-store-reference" as const;
/** Provider id for the reference CLI channel provider. */
export const CHANNEL_CLI_PROVIDER_ID = "channel-cli" as const;

/** Fast local and CI profile id. */
export const REFERENCE_PROFILE_LOCAL_DEV_ID = "local-dev" as const;
/** Single-operator self-hosted profile id. */
export const REFERENCE_PROFILE_SINGLE_OPERATOR_ID = "single-operator" as const;
/** Scenario-01 product reference profile id. */
export const REFERENCE_PROFILE_SCENARIO_01_ID = "scenario-01" as const;
/** Delegated identity posture profile id. */
export const REFERENCE_PROFILE_HARDENED_IDP_ID = "hardened-idp" as const;

/** Named reference provider profiles exposed by the reference provider set. */
export type ReferenceProviderProfileId =
  | typeof REFERENCE_PROFILE_LOCAL_DEV_ID
  | typeof REFERENCE_PROFILE_SINGLE_OPERATOR_ID
  | typeof REFERENCE_PROFILE_SCENARIO_01_ID
  | typeof REFERENCE_PROFILE_HARDENED_IDP_ID;

/** Runtime provider ids selected by a named reference profile for app composition. */
export interface ReferenceRuntimeProviderProfile {
  auth: ProviderId;
  launcher: ProviderId;
  connector: ProviderId;
  workspace: ProviderId;
  entrypoint: ProviderId;
  detector: ProviderId;
  channel: ProviderId;
  secretStore: ProviderId;
}

/** Operator-facing read model for a named reference profile. */
export interface ReferenceProviderProfile {
  id: ReferenceProviderProfileId;
  purpose: string;
  manifest: ProviderProfileManifest;
}

const REFERENCE_PROFILE_LIFECYCLE = {
  owner: "operator",
  apply: "boot",
  hotReload: false,
} as const;

function selectionProviderId(selection: ProviderProfileSelection | undefined): ProviderId {
  if (typeof selection === "string" && selection.length > 0) {
    return selection;
  }
  if (
    typeof selection === "object" &&
    selection !== null &&
    "providerId" in selection &&
    typeof selection.providerId === "string" &&
    selection.providerId.length > 0
  ) {
    return selection.providerId;
  }
  throw new Error("reference profile selection is missing a provider id");
}

const referenceBrowserHandoffDefaults: NonNullable<
  ProviderProfileManifest["spec"]["defaults"]
>[string] = {
  Launcher: LAUNCHER_PROCESS_PROVIDER_ID,
  Workspace: WORKSPACE_PROFILE_PROVIDER_ID,
  HumanEntrypoint: ENTRYPOINT_NOVNC_PROVIDER_ID,
  AgentConnector: CONNECTOR_CDP_PROVIDER_ID,
  CompletionDetector: DETECTOR_URL_PROVIDER_ID,
};

function referenceProfileManifest(args: {
  id: ReferenceProviderProfileId;
  select?: Partial<NonNullable<ProviderProfileManifest["spec"]["select"]>>;
  config?: NonNullable<ProviderProfileManifest["spec"]["config"]>;
  defaults?: NonNullable<ProviderProfileManifest["spec"]["defaults"]>[string];
}): ProviderProfileManifest {
  return {
    apiVersion: "gla.dev/v1",
    kind: "ProviderProfile",
    metadata: { name: args.id, version: "0.1.0" },
    spec: {
      lifecycle: REFERENCE_PROFILE_LIFECYCLE,
      select: {
        AuthProvider: AUTH_WEBAUTHN_PROVIDER_ID,
        Launcher: LAUNCHER_PROCESS_PROVIDER_ID,
        Workspace: WORKSPACE_PROFILE_PROVIDER_ID,
        HumanEntrypoint: ENTRYPOINT_NOVNC_PROVIDER_ID,
        AgentConnector: CONNECTOR_CDP_PROVIDER_ID,
        CompletionDetector: DETECTOR_URL_PROVIDER_ID,
        ChannelAdapter: CHANNEL_CLI_PROVIDER_ID,
        SecretStore: SECRET_STORE_REFERENCE_PROVIDER_ID,
        ...(args.select ?? {}),
      },
      defaults: {
        "template.browser-handoff": {
          ...referenceBrowserHandoffDefaults,
          ...(args.defaults ?? {}),
        },
      },
      ...(args.config !== undefined ? { config: args.config } : {}),
    },
  };
}

/** Named `local-dev` reference profile. */
export const REFERENCE_PROFILE_LOCAL_DEV: ReferenceProviderProfile = {
  id: REFERENCE_PROFILE_LOCAL_DEV_ID,
  purpose: "Fast local and CI exercise of the graph with in-tree/local providers.",
  manifest: referenceProfileManifest({
    id: REFERENCE_PROFILE_LOCAL_DEV_ID,
    select: { CompletionDetector: DETECTOR_USER_DONE_PROVIDER_ID },
    defaults: { CompletionDetector: DETECTOR_USER_DONE_PROVIDER_ID },
    config: {
      [AUTH_WEBAUTHN_PROVIDER_ID]: {
        rpID: "localhost",
        rpName: "GLA Local Dev",
        expectedOrigin: ["http://localhost:3000"],
      },
      [LAUNCHER_PROCESS_PROVIDER_ID]: { mode: "headless" },
      [CHANNEL_CLI_PROVIDER_ID]: { delivery: "stdout", inbound: "memory" },
    },
  }),
};

/** Named `single-operator` self-hosted reference profile. */
export const REFERENCE_PROFILE_SINGLE_OPERATOR: ReferenceProviderProfile = {
  id: REFERENCE_PROFILE_SINGLE_OPERATOR_ID,
  purpose: "Single-operator self-hosted VPS posture with local providers and WPM evidence.",
  manifest: referenceProfileManifest({
    id: REFERENCE_PROFILE_SINGLE_OPERATOR_ID,
    config: {
      [AUTH_WEBAUTHN_PROVIDER_ID]: {
        rpID: "gla.example",
        rpName: "GLA",
        expectedOrigin: ["https://gla.example"],
      },
      [LAUNCHER_PROCESS_PROVIDER_ID]: { mode: "auto" },
      [CHANNEL_CLI_PROVIDER_ID]: { delivery: "stdout", inbound: "memory" },
    },
  }),
};

/** Named `scenario-01` product reference profile. */
export const REFERENCE_PROFILE_SCENARIO_01: ReferenceProviderProfile = {
  id: REFERENCE_PROFILE_SCENARIO_01_ID,
  purpose: "Scenario-01 same-session browser handoff reference flow.",
  manifest: referenceProfileManifest({
    id: REFERENCE_PROFILE_SCENARIO_01_ID,
    config: {
      [AUTH_WEBAUTHN_PROVIDER_ID]: {
        rpID: "localhost",
        rpName: "GLA",
        expectedOrigin: ["http://localhost:3000"],
      },
      [LAUNCHER_PROCESS_PROVIDER_ID]: { mode: "auto" },
      [CHANNEL_CLI_PROVIDER_ID]: { delivery: "stdout", inbound: "memory" },
    },
  }),
};

/** Named `hardened-idp` delegated identity reference profile. */
export const REFERENCE_PROFILE_HARDENED_IDP: ReferenceProviderProfile = {
  id: REFERENCE_PROFILE_HARDENED_IDP_ID,
  purpose:
    "Delegated authentik/OIDC posture; unavailable until operator overlay supplies IdP config and evidence.",
  manifest: referenceProfileManifest({
    id: REFERENCE_PROFILE_HARDENED_IDP_ID,
    select: { AuthProvider: AUTH_AUTHENTIK_PROVIDER_ID },
    config: {
      [LAUNCHER_PROCESS_PROVIDER_ID]: { mode: "auto" },
      [CHANNEL_CLI_PROVIDER_ID]: { delivery: "stdout", inbound: "memory" },
    },
  }),
};

/** All named reference provider profile read models. */
export const referenceProviderProfiles: readonly ReferenceProviderProfile[] = [
  REFERENCE_PROFILE_LOCAL_DEV,
  REFERENCE_PROFILE_SINGLE_OPERATOR,
  REFERENCE_PROFILE_SCENARIO_01,
  REFERENCE_PROFILE_HARDENED_IDP,
];

/** ProviderProfile manifests exposed by the reference provider set. */
export const referenceProviderProfileManifests: readonly ProviderProfileManifest[] =
  referenceProviderProfiles.map((profile) => profile.manifest);

/** Return one named reference profile read model. */
export function referenceProviderProfile(
  profileId: ReferenceProviderProfileId,
): ReferenceProviderProfile {
  const profile = referenceProviderProfiles.find((entry) => entry.id === profileId);
  if (profile === undefined) {
    throw new Error(`unknown reference provider profile "${profileId}"`);
  }
  return profile;
}

/** Runtime provider id selection for app composition from a named reference profile. */
export function referenceProviderRuntimeProfile(
  profileId: ReferenceProviderProfileId = REFERENCE_PROFILE_SCENARIO_01_ID,
): ReferenceRuntimeProviderProfile {
  const select = referenceProviderProfile(profileId).manifest.spec.select ?? {};
  return {
    auth: selectionProviderId(select.AuthProvider),
    launcher: selectionProviderId(select.Launcher),
    connector: selectionProviderId(select.AgentConnector),
    workspace: selectionProviderId(select.Workspace),
    entrypoint: selectionProviderId(select.HumanEntrypoint),
    detector: selectionProviderId(select.CompletionDetector),
    channel: selectionProviderId(select.ChannelAdapter),
    secretStore: selectionProviderId(select.SecretStore),
  };
}

/** Provider-owned auth config values keyed by the selected provider's schema. */
export type ReferenceAuthProviderConfig = Record<string, unknown>;

/** Inputs for creating a reference auth provider through Provider Host. */
export interface ReferenceAuthProviderCreateOptions {
  /** Opaque provider id. Defaults to {@link AUTH_WEBAUTHN_PROVIDER_ID}. */
  providerId?: ProviderId;
  /** Provider-owned config validated against the provider's registered schema. */
  config?: ReferenceAuthProviderConfig;
  /** Provider Host state root used for provider-owned durable state namespaces. */
  stateRoot?: ProviderStateRoot;
  /** WPM/catalog dependency evidence required by host-touching auth providers. */
  dependencyBindings?: CreateProviderOptions["dependencyBindings"];
}

/** Result of creating a reference auth provider through Provider Host. */
export interface ReferenceAuthProviderCreateResult {
  providerId: ProviderId;
  module: string;
  provider: AuthProviderPort;
}

/** Provider-owned launcher config values keyed by the selected provider's schema. */
export type ReferenceLauncherProviderConfig = Record<string, unknown>;

/** Inputs for creating a reference launcher provider through Provider Host. */
export interface ReferenceLauncherProviderCreateOptions {
  /** Opaque launcher provider id. Defaults to {@link LAUNCHER_PROCESS_PROVIDER_ID}. */
  providerId?: ProviderId;
  /** Provider-owned config validated against the provider's registered schema. */
  config?: ReferenceLauncherProviderConfig;
  /** WPM/catalog dependency evidence required by host-touching launcher providers. */
  dependencyBindings?: CreateProviderOptions["dependencyBindings"];
}

/** Result of creating a reference launcher provider through Provider Host. */
export interface ReferenceLauncherProviderCreateResult {
  providerId: ProviderId;
  module: string;
  provider: LauncherPort;
}

/** Provider-owned workspace config values keyed by the selected provider's schema. */
export type ReferenceWorkspaceProviderConfig = Record<string, unknown>;

/** Inputs for creating a reference workspace provider through Provider Host. */
export interface ReferenceWorkspaceProviderCreateOptions {
  /** Opaque workspace provider id. Defaults to {@link WORKSPACE_PROFILE_PROVIDER_ID}. */
  providerId?: ProviderId;
  /** Provider-owned config validated against the provider's registered schema. */
  config?: ReferenceWorkspaceProviderConfig;
  /** WPM/catalog dependency evidence required by host-touching workspace providers. */
  dependencyBindings?: CreateProviderOptions["dependencyBindings"];
}

/** Result of creating a reference workspace provider through Provider Host. */
export interface ReferenceWorkspaceProviderCreateResult {
  providerId: ProviderId;
  module: string;
  provider: WorkspacePort;
}

/** Provider-owned entrypoint config values keyed by the selected provider's schema. */
export type ReferenceEntrypointProviderConfig = Record<string, unknown>;

/** Inputs for creating a reference human-entrypoint provider through Provider Host. */
export interface ReferenceEntrypointProviderCreateOptions {
  /** Opaque entrypoint provider id. Defaults to {@link ENTRYPOINT_NOVNC_PROVIDER_ID}. */
  providerId?: ProviderId;
  /** Provider-owned config validated against the provider's registered schema. */
  config?: ReferenceEntrypointProviderConfig;
  /** WPM/catalog dependency evidence required by host-touching entrypoint providers. */
  dependencyBindings?: CreateProviderOptions["dependencyBindings"];
}

/** Result of creating a reference human-entrypoint provider through Provider Host. */
export interface ReferenceEntrypointProviderCreateResult {
  providerId: ProviderId;
  module: string;
  provider: HumanEntrypointPort;
}

/** Provider-owned channel config values keyed by the selected provider's schema. */
export type ReferenceChannelProviderConfig = Record<string, unknown>;

/** Inputs for creating a reference channel provider through Provider Host. */
export interface ReferenceChannelProviderCreateOptions {
  /** Opaque channel provider id. Defaults to {@link CHANNEL_CLI_PROVIDER_ID}. */
  providerId?: ProviderId;
  /** Provider-owned config validated against the provider's registered schema. */
  config?: ReferenceChannelProviderConfig;
  /** WPM/catalog dependency evidence required by host-touching channel providers. */
  dependencyBindings?: CreateProviderOptions["dependencyBindings"];
  /** Non-provider services needed by the selected channel provider, such as IdentityPort. */
  services?: CreateProviderOptions["services"];
}

/** Result of creating a reference channel provider through Provider Host. */
export interface ReferenceChannelProviderCreateResult {
  providerId: ProviderId;
  module: string;
  provider: ChannelPort;
}

/** Provider-owned SecretStore config values keyed by the selected provider's schema. */
export type ReferenceSecretStoreProviderConfig = Record<string, unknown>;

/** Inputs for creating a reference SecretStore provider through Provider Host. */
export interface ReferenceSecretStoreProviderCreateOptions {
  /** Opaque SecretStore provider id. Defaults to {@link SECRET_STORE_REFERENCE_PROVIDER_ID}. */
  providerId?: ProviderId;
  /** Provider-owned config validated against the provider's registered schema. */
  config?: ReferenceSecretStoreProviderConfig;
  /** Provider Host state root used for provider-owned secret-ref indexes. */
  stateRoot?: ProviderStateRoot;
  /** WPM/catalog dependency evidence required by host-touching SecretStore providers. */
  dependencyBindings?: CreateProviderOptions["dependencyBindings"];
}

/** Result of creating a reference SecretStore provider through Provider Host. */
export interface ReferenceSecretStoreProviderCreateResult {
  providerId: ProviderId;
  module: string;
  provider: SecretStorePort;
}

function requiredString(ctx: ProviderCreateContext, field: string): string {
  const value = ctx.config[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`provider "${ctx.providerId}" expected string config field "${field}"`);
  }
  return value;
}

function optionalString(ctx: ProviderCreateContext, field: string): string | undefined {
  const value = ctx.config[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredStringList(ctx: ProviderCreateContext, field: string): string[] {
  const value = ctx.config[field];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new Error(
      `provider "${ctx.providerId}" expected non-empty string list config field "${field}"`,
    );
  }
  return value;
}

function optionalNumber(ctx: ProviderCreateContext, field: string): number | undefined {
  const value = ctx.config[field];
  return typeof value === "number" ? value : undefined;
}

function providerManifest(name: keyof typeof PROVIDER_MANIFESTS): ProviderManifest {
  const manifest = PROVIDER_MANIFESTS[name];
  if (manifest === undefined) {
    throw new Error(`missing reference provider manifest: ${name}`);
  }
  return manifest;
}

function moduleFor(
  manifest: ProviderManifest,
  moduleId: string,
  register: (id: ProviderId, ctx: ProviderRegistrationContext) => void,
): GlaProviderModule {
  return {
    moduleId,
    manifest,
    register(ctx) {
      const id = manifest.metadata.name;
      register(id, ctx);
      if (manifest.spec.probe !== undefined) {
        ctx.registerProbe(id, () => "available");
      }
    },
  };
}

const USER_DONE_CONTRACT: ConfigSchema = EMPTY_CONFIG_SCHEMA;

class UserDoneDetectorAdapter implements CompletionDetectorPort {
  readonly contract: ConfigSchema = USER_DONE_CONTRACT;

  async *watch(
    _handle: RuntimeHandle,
    _params: Record<string, unknown>,
  ): AsyncIterable<RawCompletionSignal> {}
}

interface StoredReferenceSecret {
  value: SecretValue;
  audience: string;
}

interface SecretInjectionReceiver {
  injectSecret?(ref: Ref<"secret-ref">, value: SecretValue): void | Promise<void>;
}

class ReferenceSecretStore implements SecretStorePort {
  constructor(
    private readonly refs: ProviderKvStore<StoredReferenceSecret>,
    private readonly namespace: string,
  ) {}

  async put(value: SecretValue, audience: string): Promise<Ref<"secret-ref">> {
    const ref = `secret:gla/${this.namespace}/${randomUUID()}` as Ref<"secret-ref">;
    this.refs.set(ref, { value, audience });
    return ref;
  }

  async injectInto(ref: Ref<"secret-ref">, target: InjectionTarget): Promise<void> {
    const stored = this.refs.get(ref);
    if (stored === undefined) {
      throw new Error("secret reference is not known to this provider");
    }
    const receiver = target as SecretInjectionReceiver;
    await receiver.injectSecret?.(ref, stored.value);
  }
}

export const AUTH_WEBAUTHN_PROVIDER_MANIFEST: ProviderManifest = {
  apiVersion: "gla.dev/v1",
  kind: "AuthProvider",
  metadata: { name: AUTH_WEBAUTHN_PROVIDER_ID, version: "0.1.0" },
  spec: {
    family: "auth",
    capability: {
      summary: "in-tree WebAuthn/passkey auth provider",
      authAssurance: {
        supportedPolicies: ["phishing-resistant", "password-permitted"],
        maxLevel: "phishing-resistant",
        requiredEvidence: ["userVerified", "recipientBound", "replayResistant"],
        degradesTo: "none",
        diagnostics: ["missing-user-verification", "assertion-verification-failed"],
      },
    },
    config_schema: {
      type: "object",
      additionalProperties: false,
      required: ["rpID", "expectedOrigin"],
      properties: {
        rpID: { type: "string", minLength: 1 },
        rpName: { type: "string", minLength: 1 },
        expectedOrigin: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
      },
    },
    probe: "webauthn",
    skills: [
      {
        id: "use-auth-webauthn",
        for: "webauthn",
        body: "# use-auth-webauthn\nUse the in-tree WebAuthn provider through the AuthProviderPort.",
      },
    ],
  },
};

export const AUTH_AUTHENTIK_PROVIDER_MANIFEST: ProviderManifest = {
  apiVersion: "gla.dev/v1",
  kind: "AuthProvider",
  metadata: { name: AUTH_AUTHENTIK_PROVIDER_ID, version: "0.1.0" },
  spec: {
    family: "auth",
    capability: {
      summary: "delegated authentik OIDC auth provider",
      authAssurance: {
        supportedPolicies: ["phishing-resistant", "password-permitted"],
        maxLevel: "phishing-resistant",
        requiredEvidence: ["userVerified", "recipientBound", "replayResistant"],
        degradesTo: "password",
        diagnostics: [
          "missing-user-verification",
          "method-unresolved",
          "ambiguous-provider-evidence",
          "password-grade-proof",
        ],
      },
    },
    config_schema: {
      type: "object",
      additionalProperties: false,
      required: ["issuerUrl", "clientId", "clientSecret", "redirectUri"],
      properties: {
        issuerUrl: { type: "string", minLength: 1 },
        clientId: { type: "string", minLength: 1 },
        clientSecret: { type: "string", minLength: 1, "x-gla-sensitive": true },
        redirectUri: { type: "string", minLength: 1 },
        scopes: { type: "string", minLength: 1 },
      },
    },
    requires: [
      {
        dependency: "identity-provider",
        hostTouching: true,
        connectionRefs: ["issuerUrl", "clientId", "clientSecret", "redirectUri"],
        bundle: {
          id: "identity-provider",
          version: "0.1.0",
          declaredRequires: { "gla-core": "^0.1.0" },
        },
      },
    ],
    probe: "authentik",
    skills: [
      {
        id: "use-auth-authentik",
        for: "authentik",
        body: "# use-auth-authentik\nUse delegated authentik OIDC through the AuthProviderPort.",
      },
    ],
  },
};

/** The reference in-tree SecretStore provider manifest. */
export const SECRET_STORE_REFERENCE_MANIFEST: ProviderManifest = {
  apiVersion: "gla.dev/v1",
  kind: "SecretStore",
  metadata: { name: SECRET_STORE_REFERENCE_PROVIDER_ID, version: "0.1.0" },
  spec: {
    family: "secret-store",
    capability: {
      summary: "in-tree SecretStore for tests and single-process reference deployments",
      diagnostics: "secret-ref-only",
    },
    config_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        namespace: { type: "string", minLength: 1 },
      },
    },
    probe: "secret-store-reference",
    skills: [
      {
        id: "use-secret-store-reference",
        for: SECRET_STORE_REFERENCE_PROVIDER_ID,
        body: [
          "# use-secret-store-reference",
          "",
          "Use the in-tree SecretStore only through SecretStorePort. Store raw values with `put`,",
          "pass only returned `secret:` refs across agent-visible seams, and keep diagnostics",
          "secret-ref-only.",
        ].join("\n"),
      },
    ],
  },
};

export const referenceProviderModules: readonly GlaProviderModule[] = [
  moduleFor(AUTH_WEBAUTHN_PROVIDER_MANIFEST, AUTH_WEBAUTHN_MODULE, (id, ctx) => {
    ctx.registerAuthProvider(id, {
      create(createCtx) {
        const rpName = optionalString(createCtx, "rpName");
        return new AuthWebauthnProvider({
          rpID: requiredString(createCtx, "rpID"),
          expectedOrigin: requiredStringList(createCtx, "expectedOrigin"),
          ...(rpName !== undefined ? { rpName } : {}),
          credentials: createCtx.state.kv<StoredCredential>("credentials"),
          challenges: createCtx.state.kv<PendingChallenge>("challenges"),
        });
      },
    });
    ctx.registerStateSchema(id, {
      schemaVersion: 1,
      sensitivity: "sensitive",
      migration: "fail-closed",
      slots: {
        credentials: { sensitive: true, summary: "durable WebAuthn credential store" },
        challenges: { sensitive: true, summary: "transient WebAuthn challenge store" },
      },
    });
  }),
  moduleFor(AUTH_AUTHENTIK_PROVIDER_MANIFEST, AUTH_AUTHENTIK_MODULE, (id, ctx) => {
    ctx.registerAuthProvider(id, {
      create(createCtx) {
        const scopes = optionalString(createCtx, "scopes");
        return new AuthAuthentikProvider({
          issuerUrl: requiredString(createCtx, "issuerUrl"),
          clientId: requiredString(createCtx, "clientId"),
          clientSecret: requiredString(createCtx, "clientSecret"),
          redirectUri: requiredString(createCtx, "redirectUri"),
          ...(scopes !== undefined ? { scopes } : {}),
          subjects: createCtx.state.kv<BoundSubject>("subjects"),
          attempts: createCtx.state.kv<PendingAttempt>("attempts"),
        });
      },
    });
    ctx.registerStateSchema(id, {
      schemaVersion: 1,
      sensitivity: "sensitive",
      migration: "fail-closed",
      slots: {
        subjects: { sensitive: true, summary: "durable authentik subject bindings" },
        attempts: { sensitive: true, summary: "transient OIDC attempts" },
      },
    });
  }),
  moduleFor(providerManifest("launcher-process"), LAUNCHER_PROCESS_MODULE, (id, ctx) => {
    ctx.registerLauncher(id, {
      create(createCtx) {
        const configuredMode = optionalString(createCtx, "mode");
        const headless = createCtx.config.headless;
        const mode =
          configuredMode === "headless" || configuredMode === "full" || configuredMode === "auto"
            ? configuredMode
            : headless === true
              ? "headless"
              : headless === false
                ? "full"
                : "auto";
        const chromiumPath = optionalString(createCtx, "chromiumPath");
        const startTimeoutMs = optionalNumber(createCtx, "startTimeoutMs");
        return new LauncherProcessAdapter({
          mode,
          ...(chromiumPath !== undefined ? { chromiumPath } : {}),
          ...(startTimeoutMs !== undefined ? { startTimeoutMs } : {}),
        });
      },
    });
  }),
  moduleFor(providerManifest(ENTRYPOINT_NOVNC_PROVIDER_ID), ENTRYPOINT_NOVNC_MODULE, (id, ctx) => {
    ctx.registerHumanEntrypoint(id, { create: () => new EntrypointNovncAdapter() });
  }),
  moduleFor(providerManifest(CONNECTOR_CDP_PROVIDER_ID), CONNECTOR_CDP_MODULE, (id, ctx) => {
    ctx.registerAgentConnector(id, { create: () => new ConnectorCdpAdapter() });
  }),
  moduleFor(providerManifest("workspace-profile"), WORKSPACE_PROFILE_MODULE, (id, ctx) => {
    ctx.registerWorkspace(id, {
      create(createCtx) {
        const root = optionalString(createCtx, "root");
        return new WorkspaceProfileAdapter(root !== undefined ? { root } : {});
      },
    });
  }),
  moduleFor(providerManifest(DETECTOR_URL_PROVIDER_ID), DETECTOR_URL_MODULE, (id, ctx) => {
    ctx.registerCompletionDetector(id, {
      create(createCtx) {
        const pollMs = optionalNumber(createCtx, "pollMs");
        const readUrl =
          createCtx.services.get<DetectorUrlOptions["readUrl"]>("detectorUrl.readUrl");
        return new DetectorUrlAdapter({
          ...(pollMs !== undefined ? { pollMs } : {}),
          ...(readUrl !== undefined ? { readUrl } : {}),
        });
      },
    });
  }),
  moduleFor(
    providerManifest(DETECTOR_USER_DONE_PROVIDER_ID),
    PROVIDER_SET_REFERENCE_MODULE,
    (id, ctx) => {
      ctx.registerCompletionDetector(id, { create: () => new UserDoneDetectorAdapter() });
    },
  ),
  moduleFor(CHANNEL_CLI_MANIFEST, CHANNEL_CLI_MODULE, (id, ctx) => {
    ctx.registerChannel(id, {
      create(createCtx) {
        const identity = createCtx.services.require<IdentityPort>("identity");
        const sourceService =
          createCtx.services.get<InboundSource>("channel.source") ??
          createCtx.services.get<InboundSource>("channelCli.source");
        const sinkService =
          createCtx.services.get<DeliverySink>("channel.sink") ??
          createCtx.services.get<DeliverySink>("channelCli.sink");
        const inbound = optionalString(createCtx, "inbound");
        const delivery = optionalString(createCtx, "delivery");
        if (inbound === "injected" && sourceService === undefined) {
          throw new Error(
            'channel-cli config inbound="injected" requires service "channel.source"',
          );
        }
        if (delivery === "injected" && sinkService === undefined) {
          throw new Error('channel-cli config delivery="injected" requires service "channel.sink"');
        }
        const source = inbound === "memory" ? undefined : sourceService;
        const sink = delivery === "stdout" ? deliveryToStdout : (sinkService ?? deliveryToStdout);
        return new ChannelCli({
          identity,
          ...(source !== undefined ? { source } : {}),
          sink,
        });
      },
    });
  }),
  moduleFor(SECRET_STORE_REFERENCE_MANIFEST, PROVIDER_SET_REFERENCE_MODULE, (id, ctx) => {
    ctx.registerSecretStore(id, {
      create(createCtx) {
        return new ReferenceSecretStore(
          createCtx.state.kv<StoredReferenceSecret>("refs"),
          optionalString(createCtx, "namespace") ?? "reference",
        );
      },
    });
    ctx.registerStateSchema(id, {
      schemaVersion: 1,
      sensitivity: "secret",
      migration: "fail-closed",
      slots: {
        refs: { sensitive: true, summary: "opaque secret refs mapped to raw agent-blind values" },
      },
    });
  }),
];

/** Return the adapter module marker associated with a reference auth provider id. */
export function referenceAuthModuleForProviderId(providerId: ProviderId): string {
  if (providerId === AUTH_WEBAUTHN_PROVIDER_ID) {
    return AUTH_WEBAUTHN_MODULE;
  }
  if (providerId === AUTH_AUTHENTIK_PROVIDER_ID) {
    return AUTH_AUTHENTIK_MODULE;
  }
  return providerId;
}

/** Return the adapter module marker associated with a reference provider id. */
export function referenceProviderModuleForProviderId(providerId: ProviderId): string {
  const authModule = referenceAuthModuleForProviderId(providerId);
  if (authModule !== providerId) {
    return authModule;
  }
  if (providerId === LAUNCHER_PROCESS_PROVIDER_ID) {
    return LAUNCHER_PROCESS_MODULE;
  }
  if (providerId === WORKSPACE_PROFILE_PROVIDER_ID) {
    return WORKSPACE_PROFILE_MODULE;
  }
  if (providerId === ENTRYPOINT_NOVNC_PROVIDER_ID) {
    return ENTRYPOINT_NOVNC_MODULE;
  }
  if (providerId === CONNECTOR_CDP_PROVIDER_ID) {
    return CONNECTOR_CDP_MODULE;
  }
  if (providerId === DETECTOR_URL_PROVIDER_ID) {
    return DETECTOR_URL_MODULE;
  }
  if (providerId === CHANNEL_CLI_PROVIDER_ID) {
    return CHANNEL_CLI_MODULE;
  }
  if (providerId === SECRET_STORE_REFERENCE_PROVIDER_ID) {
    return PROVIDER_SET_REFERENCE_MODULE;
  }
  return providerId;
}

/** Build the trusted reference Provider Host from today's in-tree provider modules. */
export function createReferenceProviderHost(opts: ProviderHostOptions = {}): ProviderHost {
  return new ProviderHost(opts).registerModules(referenceProviderModules);
}

/** Create a reference AuthProviderPort through Provider Host. */
export function createReferenceAuthProvider(
  opts: ReferenceAuthProviderCreateOptions = {},
): ReferenceAuthProviderCreateResult {
  const providerId = opts.providerId ?? AUTH_WEBAUTHN_PROVIDER_ID;
  const host = createReferenceProviderHost(
    opts.stateRoot !== undefined ? { stateRoot: opts.stateRoot } : {},
  );
  const provider = host.createProviderSync("auth", providerId, {
    config: opts.config ?? {},
    ...(opts.stateRoot !== undefined ? { stateRoot: opts.stateRoot } : {}),
    ...(opts.dependencyBindings !== undefined
      ? { dependencyBindings: opts.dependencyBindings }
      : {}),
  });
  return { providerId, module: referenceAuthModuleForProviderId(providerId), provider };
}

/** Create a reference launcher through Provider Host. */
export function createReferenceLauncherProvider(
  opts: ReferenceLauncherProviderCreateOptions = {},
): ReferenceLauncherProviderCreateResult {
  const providerId = opts.providerId ?? LAUNCHER_PROCESS_PROVIDER_ID;
  const host = createReferenceProviderHost();
  const provider = host.createProviderSync("launcher", providerId, {
    config: opts.config ?? {},
    ...(opts.dependencyBindings !== undefined
      ? { dependencyBindings: opts.dependencyBindings }
      : {}),
  });
  return { providerId, module: referenceProviderModuleForProviderId(providerId), provider };
}

/** Create a reference workspace through Provider Host. */
export function createReferenceWorkspaceProvider(
  opts: ReferenceWorkspaceProviderCreateOptions = {},
): ReferenceWorkspaceProviderCreateResult {
  const providerId = opts.providerId ?? WORKSPACE_PROFILE_PROVIDER_ID;
  const host = createReferenceProviderHost();
  const provider = host.createProviderSync("workspace", providerId, {
    config: opts.config ?? {},
    ...(opts.dependencyBindings !== undefined
      ? { dependencyBindings: opts.dependencyBindings }
      : {}),
  });
  return { providerId, module: referenceProviderModuleForProviderId(providerId), provider };
}

/** Create a reference human-entrypoint through Provider Host. */
export function createReferenceEntrypointProvider(
  opts: ReferenceEntrypointProviderCreateOptions = {},
): ReferenceEntrypointProviderCreateResult {
  const providerId = opts.providerId ?? ENTRYPOINT_NOVNC_PROVIDER_ID;
  const host = createReferenceProviderHost();
  const provider = host.createProviderSync("entrypoint", providerId, {
    config: opts.config ?? {},
    ...(opts.dependencyBindings !== undefined
      ? { dependencyBindings: opts.dependencyBindings }
      : {}),
  });
  return { providerId, module: referenceProviderModuleForProviderId(providerId), provider };
}

/** Create a reference channel provider through Provider Host. */
export function createReferenceChannelProvider(
  opts: ReferenceChannelProviderCreateOptions = {},
): ReferenceChannelProviderCreateResult {
  const providerId = opts.providerId ?? CHANNEL_CLI_PROVIDER_ID;
  const host = createReferenceProviderHost();
  const provider = host.createProviderSync("channel", providerId, {
    config: opts.config ?? {},
    ...(opts.dependencyBindings !== undefined
      ? { dependencyBindings: opts.dependencyBindings }
      : {}),
    ...(opts.services !== undefined ? { services: opts.services } : {}),
  });
  return { providerId, module: referenceProviderModuleForProviderId(providerId), provider };
}

/** Create a reference SecretStore provider through Provider Host. */
export function createReferenceSecretStoreProvider(
  opts: ReferenceSecretStoreProviderCreateOptions = {},
): ReferenceSecretStoreProviderCreateResult {
  const providerId = opts.providerId ?? SECRET_STORE_REFERENCE_PROVIDER_ID;
  const host = createReferenceProviderHost(
    opts.stateRoot !== undefined ? { stateRoot: opts.stateRoot } : {},
  );
  const provider = host.createProviderSync("secret-store", providerId, {
    config: opts.config ?? {},
    ...(opts.stateRoot !== undefined ? { stateRoot: opts.stateRoot } : {}),
    ...(opts.dependencyBindings !== undefined
      ? { dependencyBindings: opts.dependencyBindings }
      : {}),
  });
  return { providerId, module: referenceProviderModuleForProviderId(providerId), provider };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clientAssetDeclarations(
  manifest: ProviderManifest | undefined,
): Record<string, unknown>[] {
  const assets = manifest?.spec.capability.clientAssets;
  return Array.isArray(assets) ? assets.filter(isRecord) : [];
}

/** Provider ids that should replace the reference browser-handoff defaults for this composition. */
export interface ReferenceTemplateProviderDefaults {
  launcher?: ProviderId;
  entrypoint?: ProviderId;
  connector?: ProviderId;
  workspace?: ProviderId;
  detector?: ProviderId;
}

/** Template provider defaults selected by a named reference profile. */
export function referenceTemplateProviderDefaultsForProfile(
  profileId: ReferenceProviderProfileId = REFERENCE_PROFILE_SCENARIO_01_ID,
): ReferenceTemplateProviderDefaults {
  const profile = referenceProviderProfile(profileId).manifest;
  const defaults =
    profile.spec.defaults?.["template.browser-handoff"] ??
    profile.spec.defaults?.["browser-handoff"];
  return {
    ...(defaults?.Launcher !== undefined
      ? { launcher: selectionProviderId(defaults.Launcher) }
      : {}),
    ...(defaults?.HumanEntrypoint !== undefined
      ? { entrypoint: selectionProviderId(defaults.HumanEntrypoint) }
      : {}),
    ...(defaults?.AgentConnector !== undefined
      ? { connector: selectionProviderId(defaults.AgentConnector) }
      : {}),
    ...(defaults?.Workspace !== undefined
      ? { workspace: selectionProviderId(defaults.Workspace) }
      : {}),
    ...(defaults?.CompletionDetector !== undefined
      ? { detector: selectionProviderId(defaults.CompletionDetector) }
      : {}),
  };
}

function templateWithProviderDefaults(
  defaults: ReferenceTemplateProviderDefaults = {},
): typeof BROWSER_HANDOFF_TEMPLATE {
  const template = structuredClone(BROWSER_HANDOFF_TEMPLATE);
  const required = template.spec.requiredParts;
  if (defaults.launcher !== undefined) {
    required.launcher = defaults.launcher;
  }
  if (defaults.entrypoint !== undefined) {
    required.entrypoint = defaults.entrypoint;
  }
  if (defaults.connector !== undefined) {
    required.connector = defaults.connector;
  }
  if (defaults.workspace !== undefined) {
    required.workspace = defaults.workspace;
  }
  if (defaults.detector !== undefined) {
    required.detector = defaults.detector;
  }
  return template;
}

/**
 * Resolve provider-declared browser-client asset mounts for reference entrypoint providers.
 *
 * The app/gateway see only generic asset mounts keyed by provider manifest metadata; concrete package
 * resolution remains inside the selected reference provider set.
 */
export function referenceEntrypointClientAssetMounts(
  host: ProviderHost = createReferenceProviderHost(),
  providerIds: readonly ProviderId[] = host.providerIds("entrypoint"),
): EntrypointClientAssetMount[] {
  return providerIds.flatMap((providerId) => {
    const declarations = clientAssetDeclarations(host.providerManifest(providerId));
    const declaresNovnc = declarations.some(
      (asset) => asset.ref === NOVNC_CLIENT_ASSET_REF && asset.package === "@novnc/novnc",
    );
    return declaresNovnc ? novncClientAssetMounts() : [];
  });
}

/** Catalog store content derived from Provider Host registration data, not parallel app tables. */
export function referenceProviderStoreContent(
  host: ProviderHost = createReferenceProviderHost(),
  templateDefaults: ReferenceTemplateProviderDefaults = {},
): StoreContent {
  return {
    providers: host.providerManifests(),
    templates: [templateWithProviderDefaults(templateDefaults)],
  };
}
