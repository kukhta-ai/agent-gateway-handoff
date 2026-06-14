// @gla/provider-set-reference — trusted reference provider set.
// This package is allowed to import today's concrete adapters because it is a selected provider set,
// not the neutral host and not narrow-waist core. App migration later imports this set as one opaque list.

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
  CompletionDetectorPort,
  ConfigSchema,
  HumanEntrypointPort,
  IdentityPort,
  LauncherPort,
  RawCompletionSignal,
  RuntimeHandle,
  WorkspacePort,
} from "@gla/kernel";
import { LAUNCHER_PROCESS_MODULE, LauncherProcessAdapter } from "@gla/launcher-process";
import { ProviderHost } from "@gla/provider-host";
import type {
  CreateProviderOptions,
  GlaProviderModule,
  ProviderCreateContext,
  ProviderHostOptions,
  ProviderId,
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
  register: (id: ProviderId, ctx: ProviderRegistrationContext) => void,
): GlaProviderModule {
  return {
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

const USER_DONE_CONTRACT: ConfigSchema = {};

class UserDoneDetectorAdapter implements CompletionDetectorPort {
  readonly contract: ConfigSchema = USER_DONE_CONTRACT;

  async *watch(
    _handle: RuntimeHandle,
    _params: Record<string, unknown>,
  ): AsyncIterable<RawCompletionSignal> {}
}

export const AUTH_WEBAUTHN_PROVIDER_MANIFEST: ProviderManifest = {
  apiVersion: "gla.dev/v1",
  kind: "AuthProvider",
  metadata: { name: AUTH_WEBAUTHN_PROVIDER_ID, version: "0.1.0" },
  spec: {
    family: "auth",
    capability: { summary: "in-tree WebAuthn/passkey auth provider" },
    config_schema: {
      rpID: { type: "string", required: true, min: 1 },
      rpName: { type: "string", required: false, min: 1 },
      expectedOrigin: {
        type: "list",
        required: true,
        min: 1,
        items: { type: "string", min: 1 },
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
    capability: { summary: "delegated authentik OIDC auth provider" },
    config_schema: {
      issuerUrl: { type: "string", required: true, min: 1 },
      clientId: { type: "string", required: true, min: 1 },
      clientSecret: { type: "string", required: true, min: 1, sensitive: true },
      redirectUri: { type: "string", required: true, min: 1 },
      scopes: { type: "string", required: false, min: 1 },
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

export const referenceProviderModules: readonly GlaProviderModule[] = [
  moduleFor(AUTH_WEBAUTHN_PROVIDER_MANIFEST, (id, ctx) => {
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
      slots: {
        credentials: { sensitive: true, summary: "durable WebAuthn credential store" },
        challenges: { sensitive: true, summary: "transient WebAuthn challenge store" },
      },
    });
  }),
  moduleFor(AUTH_AUTHENTIK_PROVIDER_MANIFEST, (id, ctx) => {
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
      slots: {
        subjects: { sensitive: true, summary: "durable authentik subject bindings" },
        attempts: { sensitive: true, summary: "transient OIDC attempts" },
      },
    });
  }),
  moduleFor(providerManifest("launcher-process"), (id, ctx) => {
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
  moduleFor(providerManifest(ENTRYPOINT_NOVNC_PROVIDER_ID), (id, ctx) => {
    ctx.registerHumanEntrypoint(id, { create: () => new EntrypointNovncAdapter() });
  }),
  moduleFor(providerManifest(CONNECTOR_CDP_PROVIDER_ID), (id, ctx) => {
    ctx.registerAgentConnector(id, { create: () => new ConnectorCdpAdapter() });
  }),
  moduleFor(providerManifest("workspace-profile"), (id, ctx) => {
    ctx.registerWorkspace(id, {
      create(createCtx) {
        const root = optionalString(createCtx, "root");
        return new WorkspaceProfileAdapter(root !== undefined ? { root } : {});
      },
    });
  }),
  moduleFor(providerManifest(DETECTOR_URL_PROVIDER_ID), (id, ctx) => {
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
  moduleFor(providerManifest(DETECTOR_USER_DONE_PROVIDER_ID), (id, ctx) => {
    ctx.registerCompletionDetector(id, { create: () => new UserDoneDetectorAdapter() });
  }),
  moduleFor(CHANNEL_CLI_MANIFEST, (id, ctx) => {
    ctx.registerChannel(id, {
      create(createCtx) {
        const identity = createCtx.services.require<IdentityPort>("identity");
        const source = createCtx.services.get<InboundSource>("channelCli.source");
        const sink = createCtx.services.get<DeliverySink>("channelCli.sink") ?? deliveryToStdout;
        return new ChannelCli({
          identity,
          ...(source !== undefined ? { source } : {}),
          sink,
        });
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
  if (providerId === "channel-cli") {
    return CHANNEL_CLI_MODULE;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clientAssetDeclarations(
  manifest: ProviderManifest | undefined,
): Record<string, unknown>[] {
  const assets = manifest?.spec.capability.clientAssets;
  return Array.isArray(assets) ? assets.filter(isRecord) : [];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function providerIdsByFamily(
  host: ProviderHost,
  family: ProviderManifest["spec"]["family"],
): string[] {
  return host
    .providerManifests()
    .filter((provider) => provider.spec.family === family)
    .map((provider) => provider.metadata.name);
}

function templateWithHostCompatibleProviders(host: ProviderHost): typeof BROWSER_HANDOFF_TEMPLATE {
  const template = structuredClone(BROWSER_HANDOFF_TEMPLATE);
  const compatible = template.spec.compatibleProviders ?? {};
  template.spec.compatibleProviders = {
    ...compatible,
    entrypoint: unique([
      ...(compatible.entrypoint ?? []),
      ...providerIdsByFamily(host, "entrypoint"),
    ]),
    connector: unique([...(compatible.connector ?? []), ...providerIdsByFamily(host, "connector")]),
    detector: unique([...(compatible.detector ?? []), ...providerIdsByFamily(host, "detector")]),
  };
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
): StoreContent {
  return {
    providers: host.providerManifests(),
    templates: [templateWithHostCompatibleProviders(host)],
  };
}
