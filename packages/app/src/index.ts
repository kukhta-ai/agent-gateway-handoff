// @gla/app — COMPOSITION ROOT (baseline §1).
// The ONLY package permitted to import concrete adapters: here ports meet implementations and the
// :3000 process is booted. `new CedarPolicyAdapter()` and friends live here, injected inward — never
// in core. (The module-boundary lint exempts packages/app/** from the no-adapter-imports rule; this
// file is the living proof that the exemption works — it imports adapters that core may not.)
//
// Slice 2: the composition wires the **real Cedar PolicyPort** into the AdmissionService and hands the
// AgentBridge a Cedar-backed admission (`createBridge()`), so `gla session create --dry-run` exercises
// real forbid-wins policy. The :3000 socket bind is still a later task; `createApp()` records the
// wiring and `createBridge()` builds the runnable bridge.

// Concrete adapters (the outward side) — importable ONLY from this composition root:
import { AdmissionService } from "@gla/admission";
import { AUTH_WEBAUTHN_MODULE } from "@gla/auth-webauthn";
import { AgentBridge } from "@gla/bridge";
import { CatalogService, toAdmissionCatalog } from "@gla/catalog";
import { CHANNEL_CLI_MODULE } from "@gla/channel-cli";
import { CONNECTOR_CDP_MODULE } from "@gla/connector-cdp";
import { DETECTOR_URL_MODULE } from "@gla/detector-url";
// Core / core-adjacent ports (the inward side of the seam):
import { KERNEL_MODULE } from "@gla/kernel";
import { LAUNCHER_PROCESS_MODULE } from "@gla/launcher-process";
import { CedarPolicyAdapter, MVP_POLICY_SET, POLICY_CEDAR_MODULE } from "@gla/policy-cedar";
import { WORKSPACE_PROFILE_MODULE } from "@gla/workspace-profile";

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
 * (Slice 2). This is the single place the Cedar adapter meets the kernel `PolicyPort` — the bridge,
 * CLI, and core never import `@gla/policy-cedar` (the import-boundary lint proves it). The catalog is
 * the in-tree reference-slice catalog, adapted to admission's catalog port via `toAdmissionCatalog`.
 *
 * The agent-authority/task capability signer inside the bridge is shared so the `task` capability
 * attenuates from the agent anchor (child ⊆ parent); admission receives the presented task cap and
 * the Cedar policy decides forbid-wins.
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

/** Process entry point for the :3000 deployable. Stub: composes the app, does not yet bind. */
export async function main(): Promise<void> {
  const app = createApp();
  await app.listen(3000);
}
