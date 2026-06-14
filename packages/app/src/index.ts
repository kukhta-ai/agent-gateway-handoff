// @gla/app — COMPOSITION ROOT (baseline §1).
// The :3000 process is booted here: ports meet deployable implementations and are injected inward,
// never from core. Provider-family adapters move behind Provider Host provider sets; non-provider
// infrastructure adapters still meet their ports here until their families migrate.
//
// Slice 2: `createBridge()` wires the **real Cedar PolicyPort** into admission, so `gla session create
// --dry-run` exercises real forbid-wins policy. A real run dispatches a Session in `issued` (no spawn).
// Slice 3: `createProvisioningBridge()` additionally wires the **real worker plane** — the process
// launcher (T2, headless ‖ full noVNC, auto-detected) + the temp-profile workspace + the CDP connector
// + the noVNC entrypoint — and a SessionService whose `provision()` runs the create-saga, so `gla
// session create` (no --dry-run) provisions a live capsule and returns `{capsule, connector}`, and `gla
// session connector` re-emits it.

// Concrete adapters (the outward side) — importable ONLY from this composition root until their provider
// families migrate behind Provider Host:
import { AdmissionService } from "@gla/admission";
import { AgentBridge } from "@gla/bridge";
import { CapabilityService } from "@gla/capability";
import {
  CatalogService,
  type CatalogServiceOptions,
  type DependencyBinding,
  type IndexedDependencyBinding,
  toAdmissionCatalog,
} from "@gla/catalog";
import { CompletionService, type DetectorContract } from "@gla/completion";
import { AccessGateway } from "@gla/gateway";
import { type EnrollmentRecord, IdentityService } from "@gla/identity";
// Core / core-adjacent ports (the inward side of the seam):
import {
  type AgentConnector,
  type AgentConnectorPort,
  type AuthAssuranceProfile,
  type AuthProviderPort,
  type CapabilityId,
  type ChannelPort,
  type CompletionDetectorPort,
  type ConfigSchema,
  HmacCapabilitySigner,
  type HumanEntrypointPort,
  KERNEL_MODULE,
  type OpaqueToken,
  type RecipientRef,
  type Ref,
  type ResolvedAssemblySpec,
  type RuntimeHandle,
  type SessionId,
  authAssurancePolicyFromProfile,
  authAssurancePolicyFromRequiredAuthStrength,
  glaError,
  redactOperatorText,
} from "@gla/kernel";
import { CedarPolicyAdapter, MVP_POLICY_SET, POLICY_CEDAR_MODULE } from "@gla/policy-cedar";
import {
  type ProviderHost,
  type ProviderId,
  type ProviderKvStore,
  type ProviderStateRoot,
  providerServices,
} from "@gla/provider-host";
import {
  AUTH_WEBAUTHN_PROVIDER_ID,
  CHANNEL_CLI_PROVIDER_ID,
  CONNECTOR_CDP_PROVIDER_ID,
  DETECTOR_URL_PROVIDER_ID,
  ENTRYPOINT_NOVNC_PROVIDER_ID,
  LAUNCHER_PROCESS_PROVIDER_ID,
  WORKSPACE_PROFILE_PROVIDER_ID,
  createReferenceAuthProvider,
  createReferenceProviderHost,
  referenceAuthModuleForProviderId,
  referenceEntrypointClientAssetMounts,
  referenceProviderModuleForProviderId,
  referenceProviderStoreContent,
} from "@gla/provider-set-reference";
import { RouteController } from "@gla/route";
import {
  type CompletionDeps,
  type HandoffDeps,
  SessionService,
  type SessionServiceOptions,
  type SessionServiceSnapshot,
} from "@gla/session";
import { TaskService, type TaskServiceSnapshot } from "@gla/task";
import {
  CapsuleLifecycleManager,
  type CapsuleRecord,
  CleanupReconciler,
  SpawnerRegistry,
  WorkspaceManager,
  attachConnector,
} from "@gla/worker";
import { DaemonStateRoot } from "./daemon-state.js";
import { type DaemonHandle, runServe, serve } from "./daemon.js";

/** The MVP default wiring (baseline §5): which adapter is bound to each kernel port. */
export interface Wiring {
  kernel: string;
  policy: string;
  auth: string;
  launcher: string;
  connector: string;
  workspace: string;
  detector: string;
  channel: string;
}

/** Provider-neutral sink used by channel providers that expose line-oriented delivery in dev/test. */
export interface DeliverySink {
  write(line: string): void;
}

const deliveryToStdout: DeliverySink = {
  write: (line) => void process.stdout.write(`${line}\n`),
};

/** The composed application handle. `listen()` boots the real long-running daemon (the `:3000` deployable). */
export interface App {
  readonly wiring: Wiring;
  /**
   * Boot the real long-running daemon: bind the Access Gateway on the PUBLIC `:port` (default 3000), bind the
   * Agent Bridge on a LOCAL endpoint, and stay alive until `close()`. Returns the running {@link DaemonHandle}
   * (gateway addr, bridge endpoint, public base, and the graceful-shutdown `close()`). For full control over the
   * bind host, the bridge endpoint, and the public base URL, call {@link serve} directly (this is the terse
   * default: `0.0.0.0:<port>`, the default uds bridge endpoint, links against `http://127.0.0.1:<port>`).
   */
  listen(port?: number): Promise<DaemonHandle>;
}

/** Compose the default single-operator profile: bind the default adapters to the kernel ports. */
export function createApp(): App {
  const wiring: Wiring = {
    kernel: KERNEL_MODULE,
    policy: POLICY_CEDAR_MODULE,
    auth: referenceAuthModuleForProviderId(AUTH_WEBAUTHN_PROVIDER_ID),
    launcher: referenceProviderModuleForProviderId(LAUNCHER_PROCESS_PROVIDER_ID),
    connector: referenceProviderModuleForProviderId(CONNECTOR_CDP_PROVIDER_ID),
    workspace: referenceProviderModuleForProviderId(WORKSPACE_PROFILE_PROVIDER_ID),
    detector: referenceProviderModuleForProviderId(DETECTOR_URL_PROVIDER_ID),
    channel: referenceProviderModuleForProviderId(CHANNEL_CLI_PROVIDER_ID),
  };
  return {
    wiring,
    // Boot the real daemon (no longer a stub): bind the gateway + the local bridge, stay alive, graceful shutdown.
    listen: (port = 3000) => serve({ port }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth-provider SELECTION (authentik-integration.md §1/§7, GLA-096)
//
// The default IdP is the in-tree WebAuthn provider; authentik is an opt-in alternative behind the same
// kernel `AuthProviderPort`. The app no longer imports auth adapter implementations or owns auth state
// schemas: it passes an opaque provider id, provider-owned config, dependency evidence, and a generic
// state root into the trusted reference provider set.
// ─────────────────────────────────────────────────────────────────────────────

/** Opaque auth-provider id selected by operator or deployment config. */
export type AuthProviderKind = ProviderId;
/** Provider-owned auth config, validated by the selected provider's registered schema. */
export type AuthProviderConfig = Record<string, unknown>;

/**
 * The provider-selection inputs shared by the provisioning + enrollment composition (doc §7). When
 * `authProvider` is unset, the WebAuthn path is taken by default; non-default providers receive only
 * provider-owned config records validated by their Provider Host schema.
 */
export interface AuthProviderSelection {
  /** The selected provider. Default `"webauthn"`. */
  authProvider?: AuthProviderKind;
  /** Provider-owned config — required when the selected provider's schema requires fields. */
  authProviderConfig?: AuthProviderConfig;
}

/**
 * Build the chosen {@link AuthProviderPort} adapter (the single provider-selection seam, doc §1/§7).
 * Provider selection goes through the trusted reference Provider Host. The app passes only an opaque provider id,
 * provider-owned config, dependency evidence, and a generic provider-state root.
 *
 * @throws GlaErrorException if provider id/config/dependency evidence fails Provider Host validation.
 */
function buildAuthProvider(
  selection: AuthProviderSelection,
  webauthn: { rpID: string; rpName: string; expectedOrigin: string | string[] },
  stateRoot: ProviderStateRoot | undefined,
  dependencyBindings: IndexedDependencyBinding[] | undefined,
): { provider: AuthProviderPort; module: string } {
  const providerId = selection.authProvider ?? AUTH_WEBAUTHN_PROVIDER_ID;
  const config =
    providerId === AUTH_WEBAUTHN_PROVIDER_ID
      ? {
          rpID: webauthn.rpID,
          rpName: webauthn.rpName,
          expectedOrigin: Array.isArray(webauthn.expectedOrigin)
            ? webauthn.expectedOrigin
            : [webauthn.expectedOrigin],
        }
      : (selection.authProviderConfig ?? {});
  const created = createReferenceAuthProvider({
    providerId,
    config,
    ...(stateRoot !== undefined ? { stateRoot } : {}),
    ...(dependencyBindings !== undefined ? { dependencyBindings } : {}),
  });
  return { provider: created.provider, module: created.module };
}

class DaemonProviderStateRoot implements ProviderStateRoot {
  constructor(private readonly state: DaemonStateRoot) {}

  namespace(providerId: ProviderId): { kv<T>(slot: string): ProviderKvStore<T> } {
    return {
      kv: <T>(slot: string) => this.state.kv<T>(`provider.${providerId}.${slot}`),
    };
  }
}

function providerStateRoot(state: DaemonStateRoot | undefined): ProviderStateRoot | undefined {
  if (state === undefined) {
    return undefined;
  }
  return new DaemonProviderStateRoot(state);
}

function stateSlot<T>(
  state: DaemonStateRoot | undefined,
  kind: string,
  fallback: T,
): { load(): T; save(snapshot: T): void } | undefined {
  if (state === undefined) {
    return undefined;
  }
  const file = state.file<T>(kind, fallback);
  return {
    load: () => file.read(),
    save: (snapshot) => file.write(snapshot),
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function referenceCatalogOptions(
  dependencyBindings: DependencyBinding[] | undefined,
  providerHost?: ProviderHost,
  providerDefaults: ReferenceTemplateProviderDefaults = {},
): CatalogServiceOptions {
  const host = providerHost ?? createReferenceProviderHost();
  const content = referenceProviderStoreContent(host);
  const template = content.templates.find(
    (candidate) => candidate.metadata.name === "browser-handoff",
  );
  if (template !== undefined) {
    const compatible = template.spec.compatibleProviders ?? {};
    template.spec.compatibleProviders = {
      ...compatible,
      entrypoint: uniqueStrings([
        ...(compatible.entrypoint ?? []),
        ...content.providers
          .filter((provider) => provider.spec.family === "entrypoint")
          .map((provider) => provider.metadata.name),
      ]),
      connector: uniqueStrings([
        ...(compatible.connector ?? []),
        ...content.providers
          .filter((provider) => provider.spec.family === "connector")
          .map((provider) => provider.metadata.name),
      ]),
      detector: uniqueStrings([
        ...(compatible.detector ?? []),
        ...content.providers
          .filter((provider) => provider.spec.family === "detector")
          .map((provider) => provider.metadata.name),
      ]),
    };
    const required = template.spec.requiredParts;
    if (providerDefaults.launcher !== undefined) {
      required.launcher = providerDefaults.launcher;
    }
    if (providerDefaults.entrypoint !== undefined) {
      required.entrypoint = providerDefaults.entrypoint;
    }
    if (providerDefaults.connector !== undefined) {
      required.connector = providerDefaults.connector;
    }
    if (providerDefaults.workspace !== undefined) {
      required.workspace = providerDefaults.workspace;
    }
    if (providerDefaults.detector !== undefined) {
      required.detector = providerDefaults.detector;
    }
  }
  const options: CatalogServiceOptions = {
    content,
  };
  if (dependencyBindings !== undefined) {
    options.dependencyBindings = dependencyBindings;
  }
  return options;
}

interface ReferenceTemplateProviderDefaults {
  launcher?: ProviderId;
  entrypoint?: ProviderId;
  connector?: ProviderId;
  workspace?: ProviderId;
  detector?: ProviderId;
}

function providerDependencyEvidence(
  providerId: ProviderId,
  dependencyBindings: DependencyBinding[] | undefined,
  providerHost?: ProviderHost,
): IndexedDependencyBinding[] | undefined {
  const requires = new CatalogService(
    referenceCatalogOptions(dependencyBindings, providerHost),
  ).show(providerId)?.requires;
  return requires !== undefined && requires.length > 0 ? requires : undefined;
}

function buildChannelProvider(opts: {
  providerHost: ProviderHost;
  providerId: ProviderId;
  config?: Record<string, unknown>;
  dependencyBindings?: DependencyBinding[];
  identity: IdentityService;
  deliverySink?: DeliverySink;
}): ChannelPort {
  const dependencyEvidence = providerDependencyEvidence(
    opts.providerId,
    opts.dependencyBindings,
    opts.providerHost,
  );
  return opts.providerHost.createProviderSync("channel", opts.providerId, {
    config: opts.config ?? {},
    ...(dependencyEvidence !== undefined ? { dependencyBindings: dependencyEvidence } : {}),
    services: providerServices({
      identity: opts.identity,
      "channel.sink": opts.deliverySink ?? deliveryToStdout,
    }),
  });
}

interface ConnectorLifecycleMethods {
  bindSecretRef?(resourceId: string, secretRef: Ref<"secret-ref">): void;
  unbindSecretRef?(resourceId: string): void;
  suspendByResourceId?(resourceId: string): void;
  resumeByResourceId?(resourceId: string): void;
  isSuspended?(resourceIdOrProviderHandle: string): boolean;
  liveSocketCount?(resourceIdOrProviderHandle: string): number;
  hasBinding?(resourceId: string): boolean;
  close?(): Promise<void> | void;
}

function connectorLifecycle(port: AgentConnectorPort): ConnectorLifecycleMethods {
  return port as AgentConnectorPort & ConnectorLifecycleMethods;
}

function managedAgentConnectorPort(port: AgentConnectorPort): ManagedAgentConnectorPort {
  const lifecycle = connectorLifecycle(port);
  const controlsAgentChannel =
    typeof lifecycle.suspendByResourceId === "function" &&
    typeof lifecycle.resumeByResourceId === "function";
  const bound = new Map<string, Ref<"secret-ref">>();
  const suspended = new Set<string>();
  return {
    controlsAgentChannel,
    async attach(runtime) {
      const connector = { ...(await port.attach(runtime)) };
      const secretRef = bound.get(connector.resourceId);
      if (secretRef !== undefined && connector.secret_ref === undefined) {
        connector.secret_ref = secretRef;
      }
      return connector;
    },
    bindSecretRef(resourceId, secretRef) {
      bound.set(resourceId, secretRef);
      lifecycle.bindSecretRef?.(resourceId, secretRef);
    },
    unbindSecretRef(resourceId) {
      bound.delete(resourceId);
      suspended.delete(resourceId);
      lifecycle.unbindSecretRef?.(resourceId);
    },
    suspendByResourceId(resourceId) {
      suspended.add(resourceId);
      lifecycle.suspendByResourceId?.(resourceId);
    },
    resumeByResourceId(resourceId) {
      suspended.delete(resourceId);
      lifecycle.resumeByResourceId?.(resourceId);
    },
    isSuspended(resourceIdOrProviderHandle) {
      return (
        lifecycle.isSuspended?.(resourceIdOrProviderHandle) ??
        suspended.has(resourceIdOrProviderHandle)
      );
    },
    liveSocketCount(resourceIdOrProviderHandle) {
      return lifecycle.liveSocketCount?.(resourceIdOrProviderHandle) ?? 0;
    },
    hasBinding(resourceId) {
      return lifecycle.hasBinding?.(resourceId) ?? bound.has(resourceId);
    },
    async close() {
      await lifecycle.close?.();
    },
  };
}

function connectorProviderIdForSpec(spec: ResolvedAssemblySpec, fallback: ProviderId): ProviderId {
  return spec.spec.connector?.use ?? fallback;
}

function entrypointProviderIdForSpec(spec: ResolvedAssemblySpec, fallback: ProviderId): ProviderId {
  return spec.spec.entrypoints?.[0]?.use ?? fallback;
}

function detectorProviderIdForSpec(spec: ResolvedAssemblySpec, fallback: ProviderId): ProviderId {
  const detectors = spec.spec.detectors ?? [];
  const explicitDefault = detectors.find((detector) => detector.use === fallback);
  if (explicitDefault !== undefined) {
    return explicitDefault.use;
  }
  const urlWatcher = detectors.find((detector) => detector.use === DETECTOR_URL_PROVIDER_ID);
  return urlWatcher?.use ?? detectors[0]?.use ?? fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusRulesFrom(value: unknown): DetectorContract["statuses"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const out: DetectorContract["statuses"] = {};
  for (const [status, rule] of Object.entries(value)) {
    if (!isRecord(rule) || typeof rule.status !== "string" || rule.status.length === 0) {
      return undefined;
    }
    out[status] =
      typeof rule.next === "string" && rule.next.length > 0
        ? { status: rule.status, next: rule.next }
        : { status: rule.status };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function completionCapability(
  providerHost: ProviderHost,
  providerId: ProviderId,
): Record<string, unknown> {
  const completion = providerHost.providerManifest(providerId)?.spec.capability.completion;
  if (!isRecord(completion)) {
    throw glaError(
      "catalog.unknown",
      `detector provider "${providerId}" has no completion contract metadata`,
      {
        detail: { providerId },
      },
    );
  }
  return completion;
}

function detectorParams(
  session: SessionService | undefined,
  sessionId: import("@gla/kernel").SessionId,
  detectorProviderId: ProviderId,
): Record<string, unknown> {
  return declaredDetectorPart(session, sessionId, detectorProviderId)?.params ?? {};
}

function declaredDetectorPart(
  session: SessionService | undefined,
  sessionId: import("@gla/kernel").SessionId,
  detectorProviderId: ProviderId,
): { params?: Record<string, unknown> } | undefined {
  if (session === undefined) {
    return undefined;
  }
  try {
    const spec = session.get(sessionId).spec;
    return spec.spec.detectors?.find((d) => d.use === detectorProviderId) as
      | { params?: Record<string, unknown> }
      | undefined;
  } catch {
    // Unknown session (shouldn't happen on a live window) -> no declared detector.
    return undefined;
  }
}

function buildDetectorContract(
  session: SessionService | undefined,
  sessionId: import("@gla/kernel").SessionId,
  providerHost: ProviderHost,
  detectorProviderId: ProviderId,
  statusMap:
    | {
        intermediate?: { status: string; next?: string };
        complete: { status: string; next?: string };
      }
    | undefined,
): DetectorContract {
  if (declaredDetectorPart(session, sessionId, detectorProviderId) === undefined) {
    return { detector: detectorProviderId, statuses: {} };
  }
  const completion = completionCapability(providerHost, detectorProviderId);
  let statuses = statusRulesFrom(completion.statuses);
  if (detectorProviderId === DETECTOR_URL_PROVIDER_ID && statusMap !== undefined) {
    statuses = {
      "url-complete": statusMap.complete,
      ...(statusMap.intermediate !== undefined
        ? { "url-intermediate": statusMap.intermediate }
        : {}),
    };
  }
  if (statuses === undefined) {
    throw glaError(
      "catalog.unknown",
      `detector provider "${detectorProviderId}" has no completion status rules`,
      {
        detail: { providerId: detectorProviderId },
      },
    );
  }
  const contract: DetectorContract = { detector: detectorProviderId, statuses };
  if (isRecord(completion.resultSchema)) {
    contract.resultSchema = completion.resultSchema as ConfigSchema;
  }
  return contract;
}

/** Options for {@link createBridge}: an override Cedar policy set (defaults to the MVP set). */
export interface CreateBridgeOptions {
  /** The Cedar policy set source (defaults to {@link MVP_POLICY_SET}). */
  policySet?: string;
  /** Structured WPM dependency binding receipts. Absent means host-touching catalog providers are unavailable. */
  dependencyBindings?: DependencyBinding[];
  /** Trusted provider-host registry for catalog/runtime selection. Defaults to the reference provider set. */
  providerHost?: ProviderHost;
}

/**
 * Compose the runnable {@link AgentBridge} with the **real Cedar PolicyPort** injected into admission
 * (Slice 2). This is the single place the Cedar adapter meets the kernel `PolicyPort`. A real-run
 * `session create` dispatches a Session in `issued` — NO spawn (provisioning is `createProvisioningBridge`).
 */
export function createBridge(opts: CreateBridgeOptions = {}): AgentBridge {
  const catalogOptions = referenceCatalogOptions(opts.dependencyBindings, opts.providerHost);
  const catalog = new CatalogService(catalogOptions);
  const policy = new CedarPolicyAdapter(
    opts.policySet !== undefined ? { policySet: opts.policySet } : { policySet: MVP_POLICY_SET },
  );
  const admission = new AdmissionService({
    policy,
    catalog: toAdmissionCatalog(catalog, catalogOptions.content),
  });
  return new AgentBridge({ catalog, admission });
}

/** Options for {@link createProvisioningBridge}. */
export interface CreateProvisioningBridgeOptions extends CreateBridgeOptions {
  /** Opaque launcher provider id. Default `"launcher-process"`. */
  launcherProvider?: ProviderId;
  /** Provider-owned launcher config. Defaults preserve the legacy launcher options for launcher-process. */
  launcherProviderConfig?: Record<string, unknown>;
  /** Force the launcher mode (tests / hermes-1): default `"auto"` (full if Xvfb/x11vnc/websockify, else headless). */
  launcherMode?: "auto" | "full" | "headless";
  /** Opaque workspace provider id. Default `"workspace-profile"`. */
  workspaceProvider?: ProviderId;
  /** Provider-owned workspace config. Defaults preserve the legacy workspaceRoot option for workspace-profile. */
  workspaceProviderConfig?: Record<string, unknown>;
  /** Opaque agent-connector provider id. Default `"connector-cdp"`. */
  connectorProvider?: ProviderId;
  /** Provider-owned agent-connector config. */
  connectorProviderConfig?: Record<string, unknown>;
  /** Opaque human-entrypoint provider id. Default `"entrypoint-novnc"` when handoff is wired. */
  entrypointProvider?: ProviderId;
  /** Provider-owned human-entrypoint config. */
  entrypointProviderConfig?: Record<string, unknown>;
  /** Opaque completion-detector provider id. Default `"url-watcher"` when completion is wired. */
  detectorProvider?: ProviderId;
  /** Provider-owned completion-detector config. */
  detectorProviderConfig?: Record<string, unknown>;
  /** Opaque channel-provider id. Default `"channel-cli"` when handoff delivery is wired. */
  channelProvider?: ProviderId;
  /** Provider-owned channel config. Defaults preserve the CLI channel's injected-sink behaviour. */
  channelProviderConfig?: Record<string, unknown>;
  /** Override the workspace root (tests pass a scratch dir under which profile dirs are created). */
  workspaceRoot?: string;
  /**
   * Restart-safe daemon state root. When set, security-critical daemon facts are encrypted, authenticated, and
   * stored here with 0700/0600 permissions before the public gateway is bound.
   */
  stateRoot?: string;
  /** Override the Chromium executable path (default: the cached browser via playwright-core). */
  chromiumPath?: string;
  /** Override the CDP start timeout, ms. */
  startTimeoutMs?: number;
  /**
   * Wire the Slice-4b HANDOFF pipeline into the SessionService (so `handoff open/wait/get/list/cancel` work). When
   * present, the Access Gateway + Route controller + identity step-up are wired and the session's open-window saga
   * mints a recipient-bound grant, programs a route, and delivers the link. Requires the WebAuthn rp config (the
   * gateway runs the step-up against the enrolled credential).
   */
  handoff?: {
    /**
     * The auth provider to wire behind the kernel `AuthProviderPort` (doc §1/§7). Default `"webauthn"` (the
     * in-tree default. Non-default providers receive {@link AuthProviderSelection.authProviderConfig}.
     */
    authProvider?: AuthProviderKind;
    /** Provider-owned auth config, validated by the selected provider's registered schema. */
    authProviderConfig?: AuthProviderConfig;
    /** The Relying-Party ID the passkey is bound to (no scheme/port). Default `"localhost"`. WebAuthn-path config. */
    rpID?: string;
    /** The human-visible RP name. Default `"GLA"`. WebAuthn-path config. */
    rpName?: string;
    /** The expected page ORIGIN(s) the step-up ceremony runs on (scheme+host+port). WebAuthn-path config. */
    expectedOrigin: string | string[];
    /** The public base URL handoff links are built against, e.g. `http://localhost:3000`. */
    publicBaseUrl: string;
    /**
     * Trust `X-Forwarded-Prefix` for strip-prefix reverse proxies. Enable only behind an edge that sanitizes that
     * header; prefix-preserving proxying does not need it.
     */
    trustForwardedPrefix?: boolean;
    /** Gateway bind host. Default `0.0.0.0` (hermes-1); tests pass `127.0.0.1`. */
    host?: string;
    /** Gateway bind port. Default `3000`; tests pass `0` for an ephemeral port. */
    port?: number;
    /**
     * The AUTH-REUSE TTL (ms) — how long a recipient's successful step-up stays valid for REUSE on a LATER handoff
     * window for the SAME recipient (scenario-01 Phase 12, GLA-050/051: "auth still valid, no re-prompt"). Within
     * the TTL, a second window for that recipient opens with NO fresh WebAuthn ceremony; an expired/absent validity
     * (or a different recipient) re-prompts (Phase 6). The grant is STILL verified cryptographically every request.
     * Defaults to the gateway default (≈15m, the window TTL). Set 0 to disable reuse (always re-prompt).
     */
    authReuseTtlMs?: number;
    /**
     * Provider-neutral assurance policy profile for handoff step-up. Default `"phishing-resistant"` requires
     * passkey-grade evidence; `"password-permitted"` explicitly admits password-grade evidence.
     */
    authAssuranceProfile?: AuthAssuranceProfile;
    /**
     * Deprecated compatibility input. Prefer {@link authAssuranceProfile}. `"password"` maps to
     * `"password-permitted"`; `"webauthn"` maps to `"phishing-resistant"`.
     */
    requiredAuthStrength?: "password" | "webauthn";
    /** Where the channel writes the recipient-bound handoff link (defaults to stdout). */
    deliverySink?: DeliverySink;
    /** A shared identity service (so enrollment + handoff use the SAME enrolled credential store). */
    identity?: IdentityService;
    /**
     * Override the human-entrypoint resolver the open-window saga exposes. Tests inject stubs with different
     * provider/client/transport bindings; the real adapter supplies the current live-view transport in full mode.
     */
    entrypoint?: {
      open(
        handle: import("@gla/kernel").RuntimeHandle,
      ): Promise<import("@gla/kernel").HumanEntrypointBinding>;
    };
    /**
     * Wire the Slice-5 COMPLETION-CLOSE pipeline (so a validated done-signal RETURNS to `handoff wait` and CLOSES
     * the window — scenario-01 Phase 8/13). When present, the url-watcher detector watches each open window's live
     * URL over CDP; a match is validated by the Completion service against the declared detector contract and
     * normalized to an envelope; the session runs the close-window step (reverse-of-open) and returns to `active`
     * with the capsule running. The agent connector is SUSPENDED while a window is open (S-2 agent-blind) and
     * RESUMED on close. When absent, the Slice-4b behaviour holds (the window TTL-expires; `handoff wait` exit 6).
     */
    completion?: {
      /**
       * The url-watcher → envelope status map (the detector/template author's declaration, like a `config_schema`).
       * Defaults to the scenario-01 mapping: an `intermediate` (`/verify`) match → `{status:"submitted",
       * next:"email-verification"}`; a `complete_on` (`/dashboard`) match → `{status:"verified"}`.
       */
      statusMap?: {
        intermediate?: { status: string; next?: string };
        complete: { status: string; next?: string };
      };
      /**
       * A custom URL reader for the detector (tests inject a scripted `/register`→`/verify`→`/dashboard` sequence);
       * the default reads the capsule's CDP `/json` active-target URL. A non-firing reader → the window TTL-expires.
       */
      readUrl?: (handle: import("@gla/kernel").RuntimeHandle) => Promise<string | undefined>;
      /** The detector poll interval (ms). Default 200. */
      pollMs?: number;
    };
  };
}

/** Agent-connector shape the app/session need after provider selection, with optional test observability. */
export interface ManagedAgentConnectorPort {
  readonly controlsAgentChannel: boolean;
  attach(runtime: RuntimeHandle): Promise<AgentConnector>;
  bindSecretRef(resourceId: string, secretRef: Ref<"secret-ref">): void;
  unbindSecretRef(resourceId: string): void;
  suspendByResourceId(resourceId: string): void;
  resumeByResourceId(resourceId: string): void;
  isSuspended(resourceIdOrProviderHandle: string): boolean;
  liveSocketCount(resourceIdOrProviderHandle: string): number;
  hasBinding(resourceId: string): boolean;
  close(): Promise<void>;
}

/** A provisioning bridge plus the worker handles a caller can use to reconcile/teardown (tests, shutdown). */
export interface ProvisioningStack {
  /** Resolves after restart recovery has converged; public listeners must not bind before this is settled. */
  ready: Promise<void>;
  /** Idempotently closes runtime handles owned by this stack, including the daemon state-root lock. */
  close(): Promise<void>;
  bridge: AgentBridge;
  /** The capsule lifecycle manager (spawn/health/stop tracking). */
  lifecycle: CapsuleLifecycleManager;
  /** The cleanup reconciler (idempotent terminal-session teardown + orphan scan). */
  reconciler: CleanupReconciler;
  /** The spawner registry (so a test can register a second launcher — the pluggability proof). */
  registry: SpawnerRegistry;
  /** The selected human-entrypoint provider, present when handoff composition requires one. */
  entrypoint?: HumanEntrypointPort;
  /** The SHARED capability service (one signer for the anchor + task + connector caps). */
  capability: CapabilityService;
  /** The SHARED task service (so a caller can resolve a task's cap id / drive teardown). */
  task: TaskService;
  /** The provision-capable session service (so a caller can observe connector lineage / teardown). */
  session: SessionService;
  /** The selected agent-connector provider, normalized to the app/session connector lifecycle contract. */
  connector: ManagedAgentConnectorPort;
  /** The selected completion-detector provider, present when completion watching is wired. */
  detector?: CompletionDetectorPort;
  /** The Access Gateway (Slice 4b: the sole public entry; serves the handoff step-up + proxies the WS). Present only when handoff is wired. */
  gateway?: AccessGateway;
  /** The Route controller (Slice 4b: programs grant-bound routes on the gateway). Present only when handoff is wired. */
  route?: RouteController;
  /** The identity service (Slice 4b: enrolled-credential store the gateway steps up against). Present only when handoff is wired. */
  identity?: IdentityService;
  /**
   * The auth module actually wired behind the kernel `AuthProviderPort` (the wiring record, doc §7):
   * Adapter module marker mapped from the selected auth provider id by the trusted provider set.
   * Lets a caller/test observe WHICH provider was selected without reaching into the identity service.
   */
  authModule: string;
  /**
   * The OPERATOR enrollment action (Phase E; present only when handoff is wired, since the gateway then fronts
   * enrollment too). Mint a single-use operator-discharge grant bound to the recipient + deliver the enrollment
   * invite link. Returns an operator-safe read model; the usable grant-bearing link is delivered only through the
   * recipient channel.
   */
  enrollInvite?: (
    recipient: RecipientRef,
  ) => Promise<{ link: string; grant: OpaqueToken; nonce: string }>;
  /**
   * The public base URL handoff/enroll links are built against (present only when handoff is wired) — so a caller can
   * compose links the same way the gateway does.
   */
  publicBaseUrl?: string;
}

/**
 * Compose a PROVISIONING {@link AgentBridge} (Slice 3) — the Slice-2 Cedar admission PLUS the real
 * worker plane wired into a `provision()`-capable SessionService. This is where the worker/launcher/
 * connector/entrypoint adapters meet their kernel ports:
 *   - SpawnerRegistry ← the process launcher (T2, default; headless ‖ full, auto-detected)
 *   - WorkspaceManager ← the temp-profile workspace adapter
 *   - CapsuleLifecycleManager(registry, workspace) — spawn→health→stop, no-orphan teardown
 *   - the CDP connector adapter (agent-blind secret_ref) + the noVNC entrypoint adapter
 *   - CapabilityService.mintConnector — the agent-connector capability (agent-blind ref)
 * A real-run `session create` then provisions a live capsule and returns `{capsule, connector}`; `session
 * connector` re-emits it; teardown leaves no orphan. Returns the bridge + the worker handles.
 */
export function createProvisioningBridge(
  opts: CreateProvisioningBridgeOptions = {},
): ProvisioningStack {
  const providerHost = opts.providerHost ?? createReferenceProviderHost();
  const state =
    opts.stateRoot !== undefined
      ? DaemonStateRoot.open({
          root: opts.stateRoot,
          unsafeRoots: opts.workspaceRoot !== undefined ? [opts.workspaceRoot] : [],
        })
      : undefined;
  let stateOwnedByStack = false;
  try {
    const launcherProviderId = opts.launcherProvider ?? LAUNCHER_PROCESS_PROVIDER_ID;
    const workspaceProviderId = opts.workspaceProvider ?? WORKSPACE_PROFILE_PROVIDER_ID;
    const connectorProviderId = opts.connectorProvider ?? CONNECTOR_CDP_PROVIDER_ID;
    const entrypointProviderId = opts.entrypointProvider ?? ENTRYPOINT_NOVNC_PROVIDER_ID;
    const detectorProviderId = opts.detectorProvider ?? DETECTOR_URL_PROVIDER_ID;
    const channelProviderId = opts.channelProvider ?? CHANNEL_CLI_PROVIDER_ID;
    const catalogOptions = referenceCatalogOptions(opts.dependencyBindings, providerHost, {
      ...(opts.launcherProvider !== undefined ? { launcher: opts.launcherProvider } : {}),
      ...(opts.workspaceProvider !== undefined ? { workspace: opts.workspaceProvider } : {}),
      ...(opts.connectorProvider !== undefined ? { connector: opts.connectorProvider } : {}),
      ...(opts.entrypointProvider !== undefined ? { entrypoint: opts.entrypointProvider } : {}),
      ...(opts.detectorProvider !== undefined ? { detector: opts.detectorProvider } : {}),
    });
    const catalog = new CatalogService(catalogOptions);
    const policy = new CedarPolicyAdapter(
      opts.policySet !== undefined ? { policySet: opts.policySet } : { policySet: MVP_POLICY_SET },
    );
    const admission = new AdmissionService({
      policy,
      catalog: toAdmissionCatalog(catalog, catalogOptions.content),
    });

    // ── Worker plane: Provider Host creates launcher/workspace ports, then worker core receives only ports.
    const launcherProviderConfig =
      opts.launcherProviderConfig ??
      (launcherProviderId === LAUNCHER_PROCESS_PROVIDER_ID
        ? {
            mode: opts.launcherMode ?? "auto",
            ...(opts.chromiumPath !== undefined ? { chromiumPath: opts.chromiumPath } : {}),
            ...(opts.startTimeoutMs !== undefined ? { startTimeoutMs: opts.startTimeoutMs } : {}),
          }
        : {});
    const launcherDependencyEvidence = providerDependencyEvidence(
      launcherProviderId,
      opts.dependencyBindings,
      providerHost,
    );
    const launcher = providerHost.createProviderSync("launcher", launcherProviderId, {
      config: launcherProviderConfig,
      ...(launcherDependencyEvidence !== undefined
        ? { dependencyBindings: launcherDependencyEvidence }
        : {}),
    });
    const registry = new SpawnerRegistry();
    registry.register(launcherProviderId, launcher, { default: true });

    const workspaceProviderConfig =
      opts.workspaceProviderConfig ??
      (workspaceProviderId === WORKSPACE_PROFILE_PROVIDER_ID
        ? {
            ...(opts.workspaceRoot !== undefined ? { root: opts.workspaceRoot } : {}),
          }
        : {});
    const workspaceDependencyEvidence = providerDependencyEvidence(
      workspaceProviderId,
      opts.dependencyBindings,
      providerHost,
    );
    const workspacePort = providerHost.createProviderSync("workspace", workspaceProviderId, {
      config: workspaceProviderConfig,
      ...(workspaceDependencyEvidence !== undefined
        ? { dependencyBindings: workspaceDependencyEvidence }
        : {}),
    });
    const workspace = new WorkspaceManager(workspacePort);
    const lifecycleStore = stateSlot<CapsuleRecord[]>(state, "worker.lifecycle", []);
    const lifecycle = new CapsuleLifecycleManager({
      registry,
      workspace,
      ...(lifecycleStore !== undefined ? { store: lifecycleStore } : {}),
    });

    // ── ONE shared capability signer underpins the agent-authority anchor, the TASK capability, AND the
    //    agent-connector capability — so the connector genuinely DESCENDS from the task cap (same key) and
    //    a revocation of the task cap CASCADES to the connector by lineage (capability-service.md). Using
    //    separate signers would break both the lineage tag and the shared revocation snapshot.
    const signer = new HmacCapabilitySigner(
      state?.secretBytes("capability.signing-key", 32),
      state?.revocations("capability.revocations"),
    );
    const capability = new CapabilityService(
      signer,
      state !== undefined
        ? { spentNonces: state.stringSet("capability.spent-enrollment-nonces") }
        : {},
    );
    const connectorPorts = new Map<ProviderId, ManagedAgentConnectorPort>();
    const connectorForProvider = (providerId: ProviderId): ManagedAgentConnectorPort => {
      let port = connectorPorts.get(providerId);
      if (port !== undefined) {
        return port;
      }
      const connectorDependencyEvidence = providerDependencyEvidence(
        providerId,
        opts.dependencyBindings,
        providerHost,
      );
      port = managedAgentConnectorPort(
        providerHost.createProviderSync("connector", providerId, {
          config: providerId === connectorProviderId ? (opts.connectorProviderConfig ?? {}) : {},
          ...(connectorDependencyEvidence !== undefined
            ? { dependencyBindings: connectorDependencyEvidence }
            : {}),
        }),
      );
      connectorPorts.set(providerId, port);
      return port;
    };
    const connector = connectorForProvider(connectorProviderId);
    // A holder so the Task service's TEARDOWN dep (Slice 7) can call the SessionService's terminal
    // `teardownSession` — the SessionService is constructed later (it needs the handoff/completion deps),
    // so the closure reads it from `.svc` (assigned once built). Avoids a forward `let` / construction cycle.
    const sessionRef: { svc?: SessionService } = {};
    const connectorProviderIdForSession = (sessionId: SessionId): ProviderId => {
      const spec = sessionRef.svc?.get(sessionId).spec;
      return spec !== undefined
        ? connectorProviderIdForSpec(spec, connectorProviderId)
        : connectorProviderId;
    };
    const connectorForSession = (sessionId: SessionId): ManagedAgentConnectorPort =>
      connectorForProvider(connectorProviderIdForSession(sessionId));
    // ── Slice 7 — the Task service is built with its TERMINAL-teardown wiring: `task complete`/`task revoke`
    //    tear down every session under the task (via the SessionService's `teardownSession`) and revoke the
    //    task capability (which, by lineage, stops every descendant cap — the session grants + the connector —
    //    verifying; kernel-contracts.md §2). The session teardown is delegated; the cap revoke is the Task
    //    service's own job via the shared signer it already holds.
    const taskStore = stateSlot<TaskServiceSnapshot>(state, "task.state", {
      tasks: [],
      tokens: [],
    });
    const taskOptions: ConstructorParameters<typeof TaskService>[0] = {
      capability: signer,
      teardown: {
        teardownSession: (sessionId, disposition) =>
          sessionRef.svc?.teardownSession(sessionId, disposition) ?? Promise.resolve(),
      },
    };
    if (taskStore !== undefined) {
      taskOptions.store = taskStore;
    }
    const task = new TaskService(taskOptions);

    // ── Slice 4b — the HANDOFF pipeline (the Access Gateway + Route controller + identity step-up + channel),
    //    wired into the SessionService's open-window saga when `opts.handoff` is present. The gateway is the sole
    //    public entry (it serves the step-up + proxies the WS); the route controller programs grant-bound routes ON
    //    the gateway; the saga mints a recipient-bound grant (attenuated from the task cap), programs the route, and
    //    delivers the recipient-bound link.
    let gateway: AccessGateway | undefined;
    let route: RouteController | undefined;
    let identity: IdentityService | undefined;
    let entrypoint: HumanEntrypointPort | undefined;
    let detector: CompletionDetectorPort | undefined;
    let handoffDeps: HandoffDeps | undefined;
    let completionDeps: CompletionDeps | undefined;
    /** The auth module actually wired behind the AuthProviderPort (doc §7 wiring record). Default the in-tree WebAuthn. */
    let authModule: string = referenceAuthModuleForProviderId(AUTH_WEBAUTHN_PROVIDER_ID);
    /** The operator enrollment action (wired when handoff is, since the same gateway then fronts enrollment). */
    let enrollInvite:
      | ((recipient: RecipientRef) => Promise<{ link: string; grant: OpaqueToken; nonce: string }>)
      | undefined;
    let publicBaseUrl: string | undefined;
    // (`sessionRef` is declared above with the Task-service teardown wiring — the completion deps' closures
    //  resolved only when a window opens/closes read the SessionService back from `.svc` once it is built.)
    if (opts.handoff !== undefined) {
      const h = opts.handoff;
      // Provider selection (doc §1/§7): default → the in-tree WebAuthn provider (unchanged); `authentik` → the
      // delegated OIDC adapter. Both implement `AuthProviderPort`, so the IdentityService injection is identical.
      const selected = buildAuthProvider(
        {
          ...(h.authProvider !== undefined ? { authProvider: h.authProvider } : {}),
          ...(h.authProviderConfig !== undefined
            ? { authProviderConfig: h.authProviderConfig }
            : {}),
        },
        {
          rpID: h.rpID ?? "localhost",
          rpName: h.rpName ?? "GLA",
          expectedOrigin: h.expectedOrigin,
        },
        providerStateRoot(state),
        providerDependencyEvidence(
          h.authProvider ?? AUTH_WEBAUTHN_PROVIDER_ID,
          opts.dependencyBindings,
          providerHost,
        ),
      );
      authModule = selected.module;
      identity =
        h.identity ??
        new IdentityService({
          authProvider: selected.provider,
          ...(state !== undefined
            ? { enrollments: state.kv<EnrollmentRecord>("identity.enrollments") }
            : {}),
        });
      const channel = buildChannelProvider({
        providerHost,
        providerId: channelProviderId,
        config: opts.channelProviderConfig ?? {},
        identity,
        ...(opts.dependencyBindings !== undefined
          ? { dependencyBindings: opts.dependencyBindings }
          : {}),
        ...(h.deliverySink !== undefined ? { deliverySink: h.deliverySink } : {}),
      });
      const authAssurancePolicy =
        h.authAssuranceProfile !== undefined
          ? authAssurancePolicyFromProfile(h.authAssuranceProfile)
          : h.requiredAuthStrength !== undefined
            ? authAssurancePolicyFromRequiredAuthStrength(h.requiredAuthStrength)
            : undefined;
      const entrypointPorts = new Map<ProviderId, HumanEntrypointPort>();
      const entrypointForProvider = (providerId: ProviderId): HumanEntrypointPort => {
        if (h.entrypoint !== undefined && providerId === entrypointProviderId) {
          return h.entrypoint;
        }
        let port = entrypointPorts.get(providerId);
        if (port !== undefined) {
          return port;
        }
        const entrypointDependencyEvidence = providerDependencyEvidence(
          providerId,
          opts.dependencyBindings,
          providerHost,
        );
        port = providerHost.createProviderSync("entrypoint", providerId, {
          config: providerId === entrypointProviderId ? (opts.entrypointProviderConfig ?? {}) : {},
          ...(entrypointDependencyEvidence !== undefined
            ? { dependencyBindings: entrypointDependencyEvidence }
            : {}),
        });
        entrypointPorts.set(providerId, port);
        return port;
      };
      entrypoint = entrypointForProvider(entrypointProviderId);
      // The gateway is the Route controller's abstract edge AND the public step-up/WS-proxy entry. It verifies the
      // recipient-bound grant statelessly + requires the bound identity (step-up) before forwarding to the capsule.
      gateway = new AccessGateway({
        // ONE gateway fronts BOTH enrollment (Phase E) AND the handoff (Phases 6/12) — the sole public entry on
        // hermes-1. The enrollment seams (the capability grant verifier + the identity enroll surface) let the SAME
        // gateway serve the grant-verified enrollment flow against the SAME enrolled-credential store the step-up
        // verifies against, so a real two-handoff scenario (enroll → handoff → re-open) runs through one edge.
        grants: capability,
        identity,
        sessionGrants: capability,
        stepUp: identity,
        host: h.host ?? "0.0.0.0",
        port: h.port ?? 3000,
        publicBaseUrl: h.publicBaseUrl,
        ...(h.trustForwardedPrefix !== undefined
          ? { trustForwardedPrefix: h.trustForwardedPrefix }
          : {}),
        // The auth-reuse TTL (GLA-050/051): a recipient's step-up stays valid for a later window for THIS recipient,
        // so scenario-01 Phase 12's second window opens with no re-prompt. Defaults to the gateway default (~15m).
        ...(h.authReuseTtlMs !== undefined ? { authReuseTtlMs: h.authReuseTtlMs } : {}),
        // Provider-neutral assurance profile (default phishing-resistant): app translates deployment policy to the
        // gateway's common contract; gateway code never names provider method claims.
        ...(authAssurancePolicy !== undefined ? { authAssurancePolicy } : {}),
        // Entrypoint providers own browser-client assets; the gateway only sees generic static mounts.
        entrypointClientAssets: referenceEntrypointClientAssetMounts(providerHost),
      });
      route = new RouteController({ gateway });
      handoffDeps = {
        capability: {
          // Thread the session-computed `scopePath` (nested under the task scope `/task/<taskId>/…` when the grant
          // attenuates from the task cap) straight through, so the grant's scope is ⊆ the parent task scope.
          mintSessionGrant: (req) =>
            capability
              .mintSessionGrant(req)
              .then((m) => ({ grantId: m.capability.id, token: m.token, scopePath: m.scopePath })),
          revoke: (id) => capability.revoke(id),
          // Force-close the live WS at the edge so a revoked/expired grant's surface is unreachable (GLA-039 AC#3).
          forceCloseGrant: (grantId) => gateway?.forceCloseGrant(grantId),
        },
        route: {
          program: (window, grantId, entrypointBinding, path) => {
            if (route === undefined) {
              throw new Error("route controller not wired");
            }
            return route.program(window, grantId, entrypointBinding, path);
          },
          unmount: (windowId) => (route ? route.unmount(windowId) : Promise.resolve()),
        },
        entrypoint,
        entrypointFor: (spec) =>
          entrypointForProvider(entrypointProviderIdForSpec(spec, entrypointProviderId)),
        channel,
        // Build the recipient-bound handoff link from the route path + the grant token (the gateway's helper).
        buildLink: (path, token) => AccessGateway.handoffLink(h.publicBaseUrl, path, token),
        // The grant attenuates FROM the session's TASK capability TOKEN (so it cannot widen recipient/scope/ttl and
        // cascades on the task cap's revoke). Resolve the task → its minted task-capability bearer token.
        parentTokenFor: (_sessionId, taskId) => task.capabilityToken(taskId),
      };

      // The operator enrollment action (Phase E) on the SAME gateway + credential store the step-up verifies against —
      // mint a single-use operator-discharge grant bound to the recipient + deliver the invite link. The precondition
      // for any handoff (the recipient must be enrolled before window 1).
      publicBaseUrl = h.publicBaseUrl;
      enrollInvite = async (recipient: RecipientRef) => {
        const minted = await capability.mintEnrollmentGrant(recipient);
        const link = AccessGateway.enrollLink(h.publicBaseUrl, minted.token);
        await channel.deliver(recipient, link, minted.token);
        return redactedEnrollmentInvite(link, minted.token, minted.nonce);
      };

      // ── Slice 5 — the COMPLETION-CLOSE pipeline (the Completion service + the url-watcher detector + the
      //    connector severance), wired into the SessionService when `opts.handoff.completion` is present. The
      //    url-watcher watches each open window's live URL over CDP; a match is validated by the Completion service
      //    against the declared detector contract + normalized to an envelope; the session closes the window
      //    (reverse-of-open) and returns to `active` with the capsule running. The agent's brokered CDP socket is
      //    SEVERED while a window is open (S-2 agent-blind — its live connection is destroyed) and re-allowed on close.
      if (h.completion !== undefined) {
        const c = h.completion;
        const completionSvc = new CompletionService();
        const detectorPorts = new Map<ProviderId, CompletionDetectorPort>();
        const detectorForProvider = (providerId: ProviderId): CompletionDetectorPort => {
          let port = detectorPorts.get(providerId);
          if (port !== undefined) {
            return port;
          }
          const detectorConfig =
            providerId === detectorProviderId
              ? (opts.detectorProviderConfig ??
                (providerId === DETECTOR_URL_PROVIDER_ID && c.pollMs !== undefined
                  ? { pollMs: c.pollMs }
                  : {}))
              : {};
          const detectorServices =
            providerId === DETECTOR_URL_PROVIDER_ID && c.readUrl !== undefined
              ? providerServices({ "detectorUrl.readUrl": c.readUrl })
              : undefined;
          const detectorDependencyEvidence = providerDependencyEvidence(
            providerId,
            opts.dependencyBindings,
            providerHost,
          );
          port = providerHost.createProviderSync("detector", providerId, {
            config: detectorConfig,
            ...(detectorDependencyEvidence !== undefined
              ? { dependencyBindings: detectorDependencyEvidence }
              : {}),
            ...(detectorServices !== undefined ? { services: detectorServices } : {}),
          });
          detectorPorts.set(providerId, port);
          return port;
        };
        const detectorProviderIdForSession = (sessionId: SessionId): ProviderId => {
          const spec = sessionRef.svc?.get(sessionId).spec;
          return spec !== undefined
            ? detectorProviderIdForSpec(spec, detectorProviderId)
            : detectorProviderId;
        };
        detector = detectorForProvider(detectorProviderId);
        // The url-watcher → envelope status map (the detector/template author's declaration). Default: the
        // scenario-01 mapping (intermediate `/verify` → submitted+next; complete `/dashboard` → verified).
        const statusMap = c.statusMap ?? {
          intermediate: { status: "submitted", next: "email-verification" },
          complete: { status: "verified" },
        };
        completionDeps = {
          completion: completionSvc,
          // Build the DECLARED detector contract from provider metadata: admitted raw statuses -> normalization.
          // These closures run only when a window opens/closes — AFTER `sessionRef.svc` is assigned below.
          contractFor: (sessionId) =>
            buildDetectorContract(
              sessionRef.svc,
              sessionId,
              providerHost,
              detectorProviderIdForSession(sessionId),
              statusMap,
            ),
          detector,
          detectorFor: (spec) =>
            detectorForProvider(detectorProviderIdForSpec(spec, detectorProviderId)),
          // The params the selected detector watches with — the session's declared detector part.
          detectorParamsFor: (sessionId) =>
            detectorParams(sessionRef.svc, sessionId, detectorProviderIdForSession(sessionId)),
          // S-2 agent-blind: SEVER/resume the agent connector by the session's connector resource id. The provider
          // adapter owns how that id maps to live sockets, so session/app do not key lifecycle to a transport URL.
          connectorControl: {
            assertControllable: (sessionId) => {
              const providerId = connectorProviderIdForSession(sessionId);
              if (!connectorForProvider(providerId).controlsAgentChannel) {
                throw glaError(
                  "dependency.unavailable",
                  `connector provider "${providerId}" cannot enforce agent-blind channel control`,
                  {
                    detail: {
                      diagnostics: [
                        {
                          code: "provider.service_missing",
                          providerId,
                          family: "connector",
                          message:
                            "connector provider must expose suspend/resume by resource id for handoff completion",
                        },
                      ],
                    },
                  },
                );
              }
            },
            suspend: (sessionId) => {
              const resourceId =
                sessionRef.svc?.connectorTeardownInfo(sessionId)?.connectorResourceId;
              if (resourceId !== undefined && resourceId.length > 0) {
                connectorForSession(sessionId).suspendByResourceId(resourceId);
              }
            },
            resume: (sessionId) => {
              const resourceId =
                sessionRef.svc?.connectorTeardownInfo(sessionId)?.connectorResourceId;
              if (resourceId !== undefined && resourceId.length > 0) {
                connectorForSession(sessionId).resumeByResourceId(resourceId);
              }
            },
          },
        };
      }
    }

    // ── The provision-capable SessionService: inject the worker/capability/connector seams (+ handoff when wired).
    //    `parentCapabilityRefFor` threads the session's TASK capability id down as the connector's parent
    //    (Finding #1) — so `mintConnector` produces a CHILD of the task cap, not a fresh root.
    const sessionStore = stateSlot<SessionServiceSnapshot>(state, "session.state", {
      sessions: [],
      provisioned: [],
      handoffs: [],
      completions: [],
    });
    const sessionOpts: SessionServiceOptions = {
      provision: {
        worker: lifecycle,
        capability: {
          async mintConnector(sessionId, parentRef) {
            const minted = await capability.mintConnector(sessionId, parentRef);
            // Surface the lineage parent (the task cap id) so the session records the connector
            // genuinely descends from the task cap (Finding #1; the revoke-the-parent cascade applies).
            return parentRef !== undefined
              ? { capabilityId: minted.capability.id, secretRef: minted.secretRef, parentRef }
              : { capabilityId: minted.capability.id, secretRef: minted.secretRef };
          },
          revoke: (capId) => capability.revoke(capId),
        },
        connector,
        connectorFor: (spec) =>
          connectorForProvider(connectorProviderIdForSpec(spec, connectorProviderId)),
        parentCapabilityRefFor: (_sessionId, taskId) => {
          // Resolve the session's task → its minted task-capability id (the connector's lineage parent).
          const t = task.tryGet(taskId);
          return t !== undefined ? (t.taskCapabilityRef as unknown as CapabilityId) : undefined;
        },
      },
    };
    if (sessionStore !== undefined) {
      sessionOpts.store = sessionStore;
    }
    if (handoffDeps !== undefined) {
      sessionOpts.handoff = handoffDeps;
    }
    if (completionDeps !== undefined) {
      sessionOpts.completion = completionDeps;
    }
    // ── Slice 7 — the SessionService's TERMINAL-teardown seam (`teardownSession`'s STOP-the-capsule step):
    //    `reconcile(sessionId)` is the worker's Cleanup Reconciler (built just below), which stops the capsule
    //    (kills the process group), reaps the workspace (wipes the ephemeral temp profile — host mounts
    //    survive), revokes the connector cap, and forgets the bookkeeping — idempotent + restart-safe, and
    //    reconciling by STATE regardless of launcher. The reconciler is constructed after the session (it
    //    reads the session for the connector-teardown info), so the seam reads it from the holder.
    const reconcilerRef: { rec?: CleanupReconciler } = {};
    sessionOpts.teardown = {
      reconcile: (sessionId) => reconcilerRef.rec?.reconcile(sessionId) ?? Promise.resolve(),
    };
    const session = new SessionService(sessionOpts);
    // Publish the session into the holder the completion deps' closures read (they run only on a later open/close).
    sessionRef.svc = session;

    // ── The Cleanup Reconciler's TERMINAL teardown now revokes the connector cap AND unbinds its
    //    secret_ref (Finding #2) — symmetric with the saga's failure compensation, so a session that
    //    provisions successfully and is later reaped leaves NO live connector cap and NO residual binding.
    const reconciler = new CleanupReconciler({
      lifecycle,
      revokeConnector: async (sessionId) => {
        const info = session.connectorTeardownInfo(sessionId as never);
        if (info === undefined) {
          return; // never provisioned / already cleaned — idempotent no-op.
        }
        // Drop the agent-blind resource binding (no residual) and revoke the connector cap.
        connectorForSession(sessionId as never).unbindSecretRef(info.connectorResourceId);
        await capability.revoke(info.connectorCapId);
        // Forget the provision bookkeeping so a second teardown is a clean no-op (idempotent).
        session.clearProvisioned(sessionId as never);
      },
    });
    // Publish the reconciler into the holder the SessionService's teardown seam reads (Slice 7) — so
    // `teardownSession`/`task complete` stop+reap the capsule via the SAME idempotent reconciler.
    reconcilerRef.rec = reconciler;

    // Inject the SHARED signer + capability service + task service into the bridge so the agent anchor,
    // the task cap, and the connector cap are all minted/verified/revoked by the ONE signer (the lineage
    // cascade across anchor→task→connector holds, and the bridge verifies with the minting key).
    const bridge = new AgentBridge({
      catalog,
      admission,
      session,
      task,
      capability,
      signer,
      provisioning: true,
    });
    // `attachConnector` is the worker's connector helper; the session uses the connector port directly,
    // but exposing the reference keeps the wired surface explicit (and tree-shake-safe).
    void attachConnector;
    let stackClosed = false;
    const close = async (): Promise<void> => {
      if (stackClosed) {
        return;
      }
      stackClosed = true;
      try {
        for (const sessionId of lifecycle.liveSessions()) {
          await reconciler.reconcile(sessionId).catch(() => {});
        }
        for (const port of connectorPorts.values()) {
          await port.close().catch(() => {});
        }
        await gateway?.close().catch(() => {});
      } finally {
        state?.close();
      }
    };
    const stack: ProvisioningStack = {
      ready: session.recoveryComplete(),
      close,
      bridge,
      lifecycle,
      reconciler,
      registry,
      capability,
      task,
      session,
      connector,
      authModule,
    };
    if (entrypoint !== undefined) {
      stack.entrypoint = entrypoint;
    }
    if (detector !== undefined) {
      stack.detector = detector;
    }
    // Slice 4b: expose the handoff pipeline handles when wired (so a test/caller can drive the gateway/route/identity).
    if (gateway !== undefined) {
      stack.gateway = gateway;
    }
    if (route !== undefined) {
      stack.route = route;
    }
    if (identity !== undefined) {
      stack.identity = identity;
    }
    if (enrollInvite !== undefined) {
      stack.enrollInvite = enrollInvite;
    }
    if (publicBaseUrl !== undefined) {
      stack.publicBaseUrl = publicBaseUrl;
    }
    stateOwnedByStack = true;
    return stack;
  } catch (error) {
    if (!stateOwnedByStack) {
      state?.close();
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slice 4a — recipient enrollment (scenario-01 Phase E)
// ─────────────────────────────────────────────────────────────────────────────

/** Options for {@link createEnrollmentStack}. */
export interface CreateEnrollmentStackOptions {
  /**
   * The auth provider to wire behind the kernel `AuthProviderPort` (doc §1/§7). Default `"webauthn"` (the
   * in-tree default. Non-default providers receive {@link AuthProviderSelection.authProviderConfig}.
   */
  authProvider?: AuthProviderKind;
  /** Provider-owned auth config, validated by the selected provider's registered schema. */
  authProviderConfig?: AuthProviderConfig;
  /**
   * The Relying-Party ID — the registrable host the passkey is bound to (no scheme/port). hermes-1: the gateway's
   * host; the loopback test: `"localhost"`. MUST match the page origin host. Default `"localhost"`. WebAuthn-path config.
   */
  rpID?: string;
  /** The human-visible RP name in the OS passkey UI. Default `"GLA"`. */
  rpName?: string;
  /**
   * The expected page ORIGIN(s) the WebAuthn ceremony runs on (scheme+host+port), e.g. `http://localhost:3000`.
   * Required so the attestation/assertion is verified against the right origin. A single string or a list.
   */
  expectedOrigin: string | string[];
  /** The public base URL enrollment invite links are built against, e.g. `http://localhost:3000`. */
  publicBaseUrl: string;
  /**
   * Trust `X-Forwarded-Prefix` for strip-prefix reverse proxies. Enable only behind an edge that sanitizes that
   * header; prefix-preserving proxying does not need it.
   */
  trustForwardedPrefix?: boolean;
  /** Gateway bind host. Default `0.0.0.0` (hermes-1); tests pass `127.0.0.1`. */
  host?: string;
  /** Gateway bind port. Default `3000`; tests pass `0` for an ephemeral port. */
  port?: number;
  /** Structured WPM dependency evidence used by host-touching auth providers. */
  dependencyBindings?: DependencyBinding[];
  /** Trusted provider-host registry for channel selection. Defaults to the reference provider set. */
  providerHost?: ProviderHost;
  /** Opaque channel-provider id. Default `"channel-cli"`. */
  channelProvider?: ProviderId;
  /** Provider-owned channel config. Defaults preserve the CLI channel's injected-sink behaviour. */
  channelProviderConfig?: Record<string, unknown>;
  /** Where the channel writes the enrollment invite link (defaults to stdout). */
  deliverySink?: DeliverySink;
  /**
   * A PRE-BUILT auth provider to inject behind the kernel `AuthProviderPort`, bypassing {@link buildAuthProvider}
   * for deterministic tests or external composition. When set, it wins over Provider Host creation; `authModule`
   * is taken from {@link authModuleOverride}
   * (or, when that is absent, the resolved provider kind). Mirrors `createProvisioningBridge`'s `handoff.identity`
   * injection. (The PRODUCTION browser-redirect/callback path that feeds `{code,state}` to `enrollComplete` is
   * GLA-072's shared deliverable, see authentik-integration.md §2 / authentik-enrollment.md §8.1.)
   */
  authProviderOverride?: AuthProviderPort;
  /** The module marker recorded in {@link EnrollmentStack.authModule} when {@link authProviderOverride} is set. */
  authModuleOverride?: string;
}

/**
 * The composed enrollment stack (Slice 4a): the wired Access Gateway + the operator's `enrollInvite` action + the
 * handles a caller/test needs to observe enrolled-vs-not from outside.
 */
export interface EnrollmentStack {
  /** The Access Gateway HTTP server (sole public entry; serves the grant-verified enrollment flow). */
  gateway: AccessGateway;
  /** The capability service (mints the operator-discharge grant; owns the single-use spent-set). */
  capability: CapabilityService;
  /** The identity service (owns the enrollment fact + auth_strength; wired with the selected provider). */
  identity: IdentityService;
  /**
   * The auth provider injected behind the kernel `AuthProviderPort` (only `app` imports the concrete adapter).
   * Typed as the PORT because it is the in-tree WebAuthn provider by default, or the delegated authentik adapter
   * when selected (doc §7) — both satisfy `AuthProviderPort`.
   */
  authProvider: AuthProviderPort;
  /**
   * The auth module actually wired, mapped from the selected provider id by the trusted provider set.
   */
  authModule: string;
  /** The channel provider the invite is delivered through (recipient-bound). */
  channel: ChannelPort;
  /**
   * The OPERATOR enrollment action (docs/05 §3: NOT on the agent surface). Mint a single-use operator-discharge
   * grant bound to the recipient, then deliver the enrollment invite link (carrying the grant) to exactly that
   * recipient via the channel. Returns only an operator-safe redacted read model; tests or channels that need the
   * usable link must observe recipient delivery.
   */
  enrollInvite(
    recipient: RecipientRef,
  ): Promise<{ link: string; grant: OpaqueToken; nonce: string }>;
}

/**
 * Compose the Slice-4a enrollment stack. This is the single place the real WebAuthn provider meets the kernel
 * `AuthProviderPort` and is injected into the Identity service; the Access Gateway is wired with the capability +
 * identity seams (it imports neither adapter). After this, `enrollInvite(recipient)` mints+delivers an invite, and
 * the gateway serves the grant-verified enrollment flow on `host:port`.
 *
 * Wiring (the ports→adapter seams):
 *   - AuthProviderPort from Provider Host ← selected provider id + provider-owned config
 *   - IdentityService ← the WebAuthn provider (the swap-IdP boundary: identity depends on the PORT)
 *   - CapabilityService.mintEnrollmentGrant / verifyEnrollmentGrant(Token) / markSpent — the single-use grant
 *   - AccessGateway ← the capability grant seam + the identity enroll seam (no adapter import)
 *   - ChannelPort from Provider Host ← selected provider id + provider-owned config
 */
export function createEnrollmentStack(opts: CreateEnrollmentStackOptions): EnrollmentStack {
  // Provider selection (doc §1/§7): default → the in-tree WebAuthn provider (constructed exactly as before);
  // `authentik` → the delegated OIDC adapter. Both implement `AuthProviderPort` (the IdentityService injection
  // is identical), so swapping the provider is this one `buildAuthProvider` call — no downstream change. A
  // pre-built `authProviderOverride` wins, so delegated enrollment paths can still be tested end-to-end with no
  // real network.
  let authProvider: AuthProviderPort;
  let authModule: string;
  if (opts.authProviderOverride !== undefined) {
    authProvider = opts.authProviderOverride;
    authModule =
      opts.authModuleOverride ??
      referenceAuthModuleForProviderId(opts.authProvider ?? AUTH_WEBAUTHN_PROVIDER_ID);
  } else {
    const built = buildAuthProvider(
      {
        ...(opts.authProvider !== undefined ? { authProvider: opts.authProvider } : {}),
        ...(opts.authProviderConfig !== undefined
          ? { authProviderConfig: opts.authProviderConfig }
          : {}),
      },
      {
        rpID: opts.rpID ?? "localhost",
        rpName: opts.rpName ?? "GLA",
        expectedOrigin: opts.expectedOrigin,
      },
      undefined,
      providerDependencyEvidence(
        opts.authProvider ?? AUTH_WEBAUTHN_PROVIDER_ID,
        opts.dependencyBindings,
      ),
    );
    authProvider = built.provider;
    authModule = built.module;
  }
  const identity = new IdentityService({ authProvider });
  const capability = new CapabilityService();
  const providerHost = opts.providerHost ?? createReferenceProviderHost();
  const channel = buildChannelProvider({
    providerHost,
    providerId: opts.channelProvider ?? CHANNEL_CLI_PROVIDER_ID,
    config: opts.channelProviderConfig ?? {},
    identity,
    ...(opts.dependencyBindings !== undefined
      ? { dependencyBindings: opts.dependencyBindings }
      : {}),
    ...(opts.deliverySink !== undefined ? { deliverySink: opts.deliverySink } : {}),
  });
  const gateway = new AccessGateway({
    grants: capability,
    identity,
    host: opts.host ?? "0.0.0.0",
    port: opts.port ?? 3000,
    publicBaseUrl: opts.publicBaseUrl,
    ...(opts.trustForwardedPrefix !== undefined
      ? { trustForwardedPrefix: opts.trustForwardedPrefix }
      : {}),
  });

  return {
    gateway,
    capability,
    identity,
    authProvider,
    authModule,
    channel,
    async enrollInvite(recipient) {
      // 1) Mint the single-use operator-discharge grant bound to this recipient (distinct from a handoff grant).
      const minted = await capability.mintEnrollmentGrant(recipient);
      // 2) Build the enrollment invite link carrying the grant, and deliver it to EXACTLY the bound recipient.
      const link = AccessGateway.enrollLink(opts.publicBaseUrl, minted.token);
      // The channel-delegation token would gate a richer channel; the CLI fallback records it but does not enforce.
      await channel.deliver(recipient, link, minted.token);
      return redactedEnrollmentInvite(link, minted.token, minted.nonce);
    },
  };
}

function redactedEnrollmentInvite(
  link: string,
  grant: OpaqueToken,
  nonce: string,
): { link: string; grant: OpaqueToken; nonce: string } {
  void grant;
  void nonce;
  return {
    link: redactOperatorText(link),
    grant: "<redacted>" as OpaqueToken,
    nonce: "<redacted>",
  };
}

/**
 * Process entry point for the `:3000` deployable: boot the real long-running daemon and keep it alive until a
 * termination signal, then shut down GRACEFULLY (tear down live capsules → close the connector/gateway/bridge).
 * Delegates to {@link runServe} (the `gla serve` command), which wires SIGINT/SIGTERM → `handle.close()`.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  await runServe(argv);
}

export {
  serve,
  runServe,
  parseServeArgs,
  defaultBridgeEndpoint,
  endpointIsLocal,
} from "./daemon.js";
export type { ServeOptions, DaemonHandle } from "./daemon.js";
