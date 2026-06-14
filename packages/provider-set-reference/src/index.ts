// @gla/provider-set-reference — trusted reference provider set.
// This package is allowed to import today's concrete adapters because it is a selected provider set,
// not the neutral host and not narrow-waist core. App migration later imports this set as one opaque list.

import { AuthAuthentikProvider, type BoundSubject, type PendingAttempt } from "@gla/auth-authentik";
import {
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
  ChannelCli,
  type DeliverySink,
  type InboundSource,
  deliveryToStdout,
} from "@gla/channel-cli";
import { ConnectorCdpAdapter } from "@gla/connector-cdp";
import { DetectorUrlAdapter } from "@gla/detector-url";
import { EntrypointNovncAdapter } from "@gla/entrypoint-novnc";
import type {
  CompletionDetectorPort,
  ConfigSchema,
  IdentityPort,
  RawCompletionSignal,
  RuntimeHandle,
} from "@gla/kernel";
import { LauncherProcessAdapter } from "@gla/launcher-process";
import { ProviderHost } from "@gla/provider-host";
import type {
  GlaProviderModule,
  ProviderCreateContext,
  ProviderId,
  ProviderRegistrationContext,
} from "@gla/provider-host";
import { WorkspaceProfileAdapter } from "@gla/workspace-profile";

/** Stable package-identity marker. */
export const PROVIDER_SET_REFERENCE_MODULE = "@gla/provider-set-reference" as const;

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
  metadata: { name: "webauthn", version: "0.1.0" },
  spec: {
    family: "auth",
    capability: { summary: "in-tree WebAuthn/passkey auth provider" },
    config_schema: {
      rpID: { type: "string", required: true, min: 1 },
      rpName: { type: "string", required: false, min: 1 },
      expectedOrigin: { type: "string", required: true, min: 1 },
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
  metadata: { name: "authentik", version: "0.1.0" },
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
          expectedOrigin: requiredString(createCtx, "expectedOrigin"),
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
        const headless = createCtx.config.headless;
        const mode = headless === true ? "headless" : headless === false ? "full" : "auto";
        return new LauncherProcessAdapter({ mode });
      },
    });
  }),
  moduleFor(providerManifest("entrypoint-novnc"), (id, ctx) => {
    ctx.registerHumanEntrypoint(id, { create: () => new EntrypointNovncAdapter() });
  }),
  moduleFor(providerManifest("connector-cdp"), (id, ctx) => {
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
  moduleFor(providerManifest("url-watcher"), (id, ctx) => {
    ctx.registerCompletionDetector(id, {
      create(createCtx) {
        const pollMs = optionalNumber(createCtx, "pollMs");
        return new DetectorUrlAdapter(pollMs !== undefined ? { pollMs } : {});
      },
    });
  }),
  moduleFor(providerManifest("user-done"), (id, ctx) => {
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

/** Build the trusted reference Provider Host from today's in-tree provider modules. */
export function createReferenceProviderHost(): ProviderHost {
  return new ProviderHost().registerModules(referenceProviderModules);
}

/** Catalog store content derived from Provider Host registration data, not parallel app tables. */
export function referenceProviderStoreContent(
  host: ProviderHost = createReferenceProviderHost(),
): StoreContent {
  return {
    providers: host.providerManifests(),
    templates: [structuredClone(BROWSER_HANDOFF_TEMPLATE)],
  };
}
