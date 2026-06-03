// @gla/app — COMPOSITION ROOT (baseline §1).
// The ONLY package permitted to import concrete adapters: here ports meet implementations and the
// :3000 process is booted. `new CedarPolicyAdapter()` and friends live here, injected inward — never
// in core. (The module-boundary lint exempts packages/app/** from the no-adapter-imports rule; this
// file is the living proof that the exemption works — it imports adapters that core may not.)
//
// Slice 2: `createBridge()` wires the **real Cedar PolicyPort** into admission, so `gla session create
// --dry-run` exercises real forbid-wins policy. A real run dispatches a Session in `issued` (no spawn).
// Slice 3: `createProvisioningBridge()` additionally wires the **real worker plane** — the process
// launcher (T2, headless ‖ full noVNC, auto-detected) + the temp-profile workspace + the CDP connector
// + the noVNC entrypoint — and a SessionService whose `provision()` runs the create-saga, so `gla
// session create` (no --dry-run) provisions a live capsule and returns `{capsule, connector}`, and `gla
// session connector` re-emits it.

// Concrete adapters (the outward side) — importable ONLY from this composition root:
import { AdmissionService } from "@gla/admission";
import { AUTH_WEBAUTHN_MODULE } from "@gla/auth-webauthn";
import { AgentBridge } from "@gla/bridge";
import { CapabilityService } from "@gla/capability";
import { CatalogService, toAdmissionCatalog } from "@gla/catalog";
import { CHANNEL_CLI_MODULE } from "@gla/channel-cli";
import { CONNECTOR_CDP_MODULE, ConnectorCdpAdapter } from "@gla/connector-cdp";
import { DETECTOR_URL_MODULE } from "@gla/detector-url";
import { EntrypointNovncAdapter } from "@gla/entrypoint-novnc";
// Core / core-adjacent ports (the inward side of the seam):
import { type CapabilityId, HmacCapabilitySigner, KERNEL_MODULE } from "@gla/kernel";
import { LAUNCHER_PROCESS_MODULE, LauncherProcessAdapter } from "@gla/launcher-process";
import { CedarPolicyAdapter, MVP_POLICY_SET, POLICY_CEDAR_MODULE } from "@gla/policy-cedar";
import { SessionService } from "@gla/session";
import { TaskService } from "@gla/task";
import {
  CapsuleLifecycleManager,
  CleanupReconciler,
  SpawnerRegistry,
  WorkspaceManager,
  attachConnector,
} from "@gla/worker";
import { WORKSPACE_PROFILE_MODULE, WorkspaceProfileAdapter } from "@gla/workspace-profile";

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

/** The composed application handle. A real `listen()` lands in a later task. */
export interface App {
  readonly wiring: Wiring;
  /** Bind the Access Gateway on :3000. Stubbed in the GLA-003 skeleton (returns the port only). */
  listen(port?: number): Promise<{ port: number }>;
}

/** Compose the default single-operator profile: bind the default adapters to the kernel ports. */
export function createApp(): App {
  const wiring: Wiring = {
    kernel: KERNEL_MODULE,
    policy: POLICY_CEDAR_MODULE,
    auth: AUTH_WEBAUTHN_MODULE,
    launcher: LAUNCHER_PROCESS_MODULE,
    connector: CONNECTOR_CDP_MODULE,
    workspace: WORKSPACE_PROFILE_MODULE,
    detector: DETECTOR_URL_MODULE,
    channel: CHANNEL_CLI_MODULE,
  };
  return {
    wiring,
    listen(port = 3000) {
      // Skeleton: no socket is bound yet. The Access Gateway (packages/gateway) wires here later.
      return Promise.resolve({ port });
    },
  };
}

/** Options for {@link createBridge}: an override Cedar policy set (defaults to the MVP set). */
export interface CreateBridgeOptions {
  /** The Cedar policy set source (defaults to {@link MVP_POLICY_SET}). */
  policySet?: string;
}

/**
 * Compose the runnable {@link AgentBridge} with the **real Cedar PolicyPort** injected into admission
 * (Slice 2). This is the single place the Cedar adapter meets the kernel `PolicyPort`. A real-run
 * `session create` dispatches a Session in `issued` — NO spawn (provisioning is `createProvisioningBridge`).
 */
export function createBridge(opts: CreateBridgeOptions = {}): AgentBridge {
  const catalog = new CatalogService();
  const policy = new CedarPolicyAdapter(
    opts.policySet !== undefined ? { policySet: opts.policySet } : { policySet: MVP_POLICY_SET },
  );
  const admission = new AdmissionService({
    policy,
    catalog: toAdmissionCatalog(catalog),
  });
  return new AgentBridge({ catalog, admission });
}

/** Options for {@link createProvisioningBridge}. */
export interface CreateProvisioningBridgeOptions extends CreateBridgeOptions {
  /** Force the launcher mode (tests / hermes-1): default `"auto"` (full if Xvfb/x11vnc/websockify, else headless). */
  launcherMode?: "auto" | "full" | "headless";
  /** Override the workspace root (tests pass a scratch dir under which profile dirs are created). */
  workspaceRoot?: string;
  /** Override the Chromium executable path (default: the cached browser via playwright-core). */
  chromiumPath?: string;
  /** Override the CDP start timeout, ms. */
  startTimeoutMs?: number;
}

/** A provisioning bridge plus the worker handles a caller can use to reconcile/teardown (tests, shutdown). */
export interface ProvisioningStack {
  bridge: AgentBridge;
  /** The capsule lifecycle manager (spawn/health/stop tracking). */
  lifecycle: CapsuleLifecycleManager;
  /** The cleanup reconciler (idempotent terminal-session teardown + orphan scan). */
  reconciler: CleanupReconciler;
  /** The spawner registry (so a test can register a second launcher — the pluggability proof). */
  registry: SpawnerRegistry;
  /** The noVNC human-entrypoint adapter (full mode: a ws endpoint; headless: reports unavailable). */
  entrypoint: EntrypointNovncAdapter;
  /** The SHARED capability service (one signer for the anchor + task + connector caps). */
  capability: CapabilityService;
  /** The SHARED task service (so a caller can resolve a task's cap id / drive teardown). */
  task: TaskService;
  /** The provision-capable session service (so a caller can observe connector lineage / teardown). */
  session: SessionService;
  /** The CDP connector adapter (so a caller can observe its secret_ref→cdpUrl binding map). */
  connector: ConnectorCdpAdapter;
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
  const catalog = new CatalogService();
  const policy = new CedarPolicyAdapter(
    opts.policySet !== undefined ? { policySet: opts.policySet } : { policySet: MVP_POLICY_SET },
  );
  const admission = new AdmissionService({ policy, catalog: toAdmissionCatalog(catalog) });

  // ── Worker plane: the spawner registry + lifecycle + workspace + reconciler (over kernel ports).
  const launcher = new LauncherProcessAdapter({
    mode: opts.launcherMode ?? "auto",
    ...(opts.chromiumPath !== undefined ? { chromiumPath: opts.chromiumPath } : {}),
    ...(opts.startTimeoutMs !== undefined ? { startTimeoutMs: opts.startTimeoutMs } : {}),
  });
  const registry = new SpawnerRegistry();
  registry.register("launcher-process", launcher, { default: true });

  const workspaceAdapter = new WorkspaceProfileAdapter(
    opts.workspaceRoot !== undefined ? { root: opts.workspaceRoot } : {},
  );
  const workspace = new WorkspaceManager(workspaceAdapter);
  const lifecycle = new CapsuleLifecycleManager({ registry, workspace });

  // ── ONE shared capability signer underpins the agent-authority anchor, the TASK capability, AND the
  //    agent-connector capability — so the connector genuinely DESCENDS from the task cap (same key) and
  //    a revocation of the task cap CASCADES to the connector by lineage (capability-service.md). Using
  //    separate signers would break both the lineage tag and the shared revocation snapshot.
  const signer = new HmacCapabilitySigner();
  const capability = new CapabilityService(signer);
  const task = new TaskService({ capability: signer });
  const connector = new ConnectorCdpAdapter();

  // ── The provision-capable SessionService: inject the worker/capability/connector seams.
  //    `parentCapabilityRefFor` threads the session's TASK capability id down as the connector's parent
  //    (Finding #1) — so `mintConnector` produces a CHILD of the task cap, not a fresh root.
  const session = new SessionService({
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
      parentCapabilityRefFor: (_sessionId, taskId) => {
        // Resolve the session's task → its minted task-capability id (the connector's lineage parent).
        const t = task.tryGet(taskId);
        return t !== undefined ? (t.taskCapabilityRef as unknown as CapabilityId) : undefined;
      },
    },
  });

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
      // Drop the agent-blind secret_ref→cdpUrl binding (no residual) and revoke the connector cap.
      connector.unbindSecretRef(info.cdpUrl);
      await capability.revoke(info.connectorCapId);
      // Forget the provision bookkeeping so a second teardown is a clean no-op (idempotent).
      session.clearProvisioned(sessionId as never);
    },
  });

  // The noVNC human entrypoint (full mode: the ws endpoint the gateway will proxy in Slice 4; headless:
  // reports unavailable). Stood up here so the full-mode test can read it; not returned to the agent in
  // Slice 3 (only the connector is — the entrypoint is the human side, proxied later).
  const entrypoint = new EntrypointNovncAdapter();

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
  return {
    bridge,
    lifecycle,
    reconciler,
    registry,
    entrypoint,
    capability,
    task,
    session,
    connector,
  };
}

/** Process entry point for the :3000 deployable. Stub: composes the app, does not yet bind. */
export async function main(): Promise<void> {
  const app = createApp();
  await app.listen(3000);
}
